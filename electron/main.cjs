const { app, BrowserWindow, ipcMain, net, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

// Chromium keeps its shared buffers in /dev/shm, and a container hands it 64MB
// by default — enough to open the window and then not enough to navigate again.
// What that looks like from the outside is the bug this guards: the first load
// paints, the next one returns a document with nothing in it, no error in the
// console and none on the page, because the failure (ERR_INSUFFICIENT_RESOURCES)
// belongs to the navigation and never reaches the renderer. Falling back to
// temp files is slower and correct; on a desktop with a real /dev/shm nothing
// here changes.
try {
  const shm = fs.statfsSync("/dev/shm");
  if (shm.bsize * shm.blocks < 256 * 1024 * 1024) app.commandLine.appendSwitch("disable-dev-shm-usage");
} catch {
  /* no /dev/shm to measure (not Linux, or statfs unavailable) — leave it alone */
}

const DEV_URL = process.env.AOE_DEV_URL || process.env.PRIME_DESKTOP_DEV_URL || "http://localhost:3000";
// Not NVIDIA directly: the daemon bridge (hosted in this process for a
// packaged build) proxies to NIM and is the single place requests are counted
// for the usage readout. Going straight out would leave that count short. The
// gateway takes the same road, for the stricter reason that the key it needs
// only ever exists inside the daemon bridge.
const BRIDGE_ORIGIN = () => `http://127.0.0.1:${process.env.PRIME_BRIDGE_PORT || "3117"}`;
const NIM_UPSTREAM = () => `${BRIDGE_ORIGIN()}/nim/v1`;
const GATEWAY_UPSTREAM = () => `${BRIDGE_ORIGIN()}/gw/v1`;

/* ---- shell mode ----------------------------------------------------------
 *
 * A shell build points at a hosted AOE instead of hosting one. The renderer
 * already resolves /bridge and /api against its own origin whenever the page
 * carries no port in its query (that is how the dev browser works), so loading
 * that origin bare is the whole mechanism — and this process must then start
 * no bridge and no daemon of its own, which would answer nothing and only
 * fight the host for the port.
 *
 * Which host is the user's answer, not the packager's: the app asks on first
 * run and remembers it. A build therefore carries no address, which is the
 * point — an address baked into a public download is a published address.
 */

/** electron/remote.json marks a shell build. Its `url` is only a default, and
 *  normally empty; a build without the file at all is self-hosted as before. */
const SHELL_FILE = path.join(__dirname, "remote.json");
const isShell = () => {
  try {
    return fs.existsSync(SHELL_FILE);
  } catch {
    return false;
  }
};
const readUrl = (file) => {
  try {
    return String(JSON.parse(fs.readFileSync(file, "utf8")).url || "");
  } catch {
    return "";
  }
};
/** A trailing slash would make every same-origin check compare against a URL
 *  the host never serves. */
const tidyHost = (u) => String(u || "").trim().replace(/\/+$/, "");
const isHost = (u) => /^https?:\/\/[^/\s]+/i.test(tidyHost(u));

/** Where the host the user typed is kept, beside their config. */
const hostFile = () => path.join(app.getPath("userData"), "host.json");
const rememberHost = (url) => {
  try {
    fs.mkdirSync(path.dirname(hostFile()), { recursive: true });
    fs.writeFileSync(hostFile(), `${JSON.stringify({ url }, null, 2)}\n`);
  } catch {
    /* read-only home — the window still works, it just asks again next time */
  }
};
/** The environment wins (one build, pointed anywhere, without repackaging),
 *  then what the user typed, then whatever the packager defaulted to. */
const hostUrl = () => tidyHost(process.env.AOE_REMOTE_URL || readUrl(hostFile()) || readUrl(SHELL_FILE));

/** Does the host answer? Asked before navigating, because a loadURL that fails
 *  replaces the window with Chromium's own error page — which says
 *  ERR_CONNECTION_REFUSED to someone who never chose a host, and which nothing
 *  navigates away from again. */
function hostAnswers(url) {
  return new Promise((resolve) => {
    try {
      const req = net.request({ method: "GET", url });
      req.on("response", (r) => {
        r.on("data", () => {});
        r.on("end", () => {});
        resolve(true);
      });
      req.on("error", () => resolve(false));
      req.end();
    } catch {
      resolve(false); // a URL net.request will not even accept
    }
  });
}

/** The live shell window, for the IPC handlers registered once at startup. */
let shellWindow = null;

/** Keys and model come from the environment or <userData>/config.json — never from the bundle. */
function loadConfig() {
  let key = process.env.NIM_API_KEY || "";
  let model = process.env.NIM_MODEL || "deepseek-ai/deepseek-v4-pro-0813";
  let gatewayKey = process.env.AI_GATEWAY_API_KEY || "";
  try {
    const p = path.join(app.getPath("userData"), "config.json");
    // Renaming the app to AOE moved userData; an install that predates the
    // rename keeps its key in the old folder. Copy it across once, so nobody
    // has to re-enter a key an upgrade quietly hid.
    if (!fs.existsSync(p)) {
      const appData = app.getPath("appData");
      for (const old of ["Prime Agent", "prime-desktop"]) {
        const legacy = path.join(appData, old, "config.json");
        if (fs.existsSync(legacy)) {
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.copyFileSync(legacy, p);
          break;
        }
      }
    }
    if (fs.existsSync(p)) {
      const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
      key = cfg.nimApiKey || key;
      model = cfg.nimModel || model;
      gatewayKey = cfg.gatewayApiKey || gatewayKey;
    }
  } catch {
    /* unreadable config — fall back to env */
  }
  return { key, model, gatewayKey };
}

/** Packaged builds have no Vite proxy, so main hosts the same /api/* bridge locally. */
function startBridge() {
  const { key, model, gatewayKey } = loadConfig();
  // The daemon bridge, imported into this process a moment later, is the only
  // holder of the gateway key. An install that keeps it in config.json rather
  // than the environment hands it over here.
  if (gatewayKey && !process.env.AI_GATEWAY_API_KEY) {
    process.env.AI_GATEWAY_API_KEY = gatewayKey;
  }
  const server = http.createServer((req, res) => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    // Two proxied providers, one shape. NIM's key is attached here; the
    // gateway's is attached by the daemon bridge, so nothing is sent for it.
    const route = !req.url
      ? null
      : req.url.startsWith("/api/nim/")
        ? { url: NIM_UPSTREAM() + req.url.slice("/api/nim".length), auth: `Bearer ${key}`, fallbackModel: model }
        : req.url.startsWith("/api/gw/")
          ? { url: GATEWAY_UPSTREAM() + req.url.slice("/api/gw".length), auth: null, fallbackModel: "" }
          : null;
    if (!route) {
      res.writeHead(404, cors);
      res.end();
      return;
    }
    const send = (body) => {
      const upstream = http.request(
        route.url,
        {
          method: req.method,
          headers: {
            "content-type": req.headers["content-type"] || "application/json",
            accept: req.headers.accept || "*/*",
            ...(route.auth ? { authorization: route.auth } : {}),
            ...(body ? { "content-length": Buffer.byteLength(body) } : {}),
          },
        },
        (up) => {
          res.writeHead(up.statusCode || 502, { ...up.headers, ...cors });
          up.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502, cors);
        res.end(JSON.stringify({ error: "bridge: upstream unreachable" }));
      });
      if (body) upstream.end(body);
      else req.pipe(upstream);
    };
    if (route.fallbackModel && req.method === "POST" && req.url.includes("/chat/completions")) {
      // The renderer sends the user-picked model at runtime; env/config is the
      // fallback default when it sends none. Gateway calls always name one, so
      // they stream straight through instead of being buffered to be patched.
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        let body = Buffer.concat(chunks).toString("utf8");
        try {
          const parsed = JSON.parse(body);
          if (!parsed.model) parsed.model = route.fallbackModel;
          body = JSON.stringify(parsed);
        } catch {
          /* not JSON — forward as-is */
        }
        send(body);
      });
    } else {
      send(null);
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: "#e9ebee",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
    },
  });
  // Markdown in agent replies can carry links: they open in the OS browser,
  // never as a second app window and never in place of the app itself.
  const external = (url) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    external(url);
    return { action: "deny" };
  });
  // A shell's own host is the app; anywhere else is a link someone wrote. The
  // host can change while the window is open, so this reads the current one.
  let host = isShell() ? hostUrl() : "";
  win.webContents.on("will-navigate", (e, url) => {
    let same = false;
    try {
      same = !!host && new URL(url).origin === new URL(host).origin;
    } catch {
      same = false;
    }
    if (url === win.webContents.getURL() || same) return;
    e.preventDefault();
    external(url);
  });
  if (isShell()) {
    // The host is a machine someone turns off. A failed load would leave a
    // white window saying nothing, with no way back once the host returns, so
    // the window says which host it is waiting for and keeps knocking.
    let waiting = false;
    const local = (file, query) => {
      waiting = false;
      win.loadFile(path.join(__dirname, file), { query });
    };
    const ask = (why) => local("setup.html", { ...(host ? { url: host } : {}), ...(why ? { why } : {}) });
    const open = () => {
      waiting = false;
      win.loadURL(host).catch(() => {
        /* did-fail-load puts the waiting page up */
      });
    };
    const knock = async () => {
      if (!waiting) return;
      if (await hostAnswers(host)) open();
      else setTimeout(knock, 4000);
    };
    win.webContents.on("did-fail-load", (_e, code, desc, _url, isMainFrame) => {
      // -3 is a load the app itself replaced, not a host that failed to answer.
      if (!isMainFrame || code === -3 || waiting) return;
      waiting = true;
      win.loadFile(path.join(__dirname, "offline.html"), { query: { url: host, why: desc || "" } });
      setTimeout(knock, 4000);
    });
    // The IPC handlers are registered once, at startup; this is how they reach
    // the window that is actually open.
    shellWindow = {
      use: (url) => {
        host = tidyHost(url);
        rememberHost(host);
        open();
      },
      ask: () => ask(""),
    };
    // No host yet is the first run, not an error: ask, and nothing is loaded
    // from anywhere until the user has said where.
    if (host) open();
    else ask("");
    return;
  }
  if (app.isPackaged) {
    const port = await startBridge();
    // The daemon bridge listens on its own fixed port; loading it here gives
    // the packaged app the same real runtime the dev browser gets.
    let daemonBridgePort = "";
    try {
      await import(path.join(__dirname, "bridge.mjs"));
      daemonBridgePort = process.env.PRIME_BRIDGE_PORT || "3117";
    } catch (e) {
      console.error("daemon bridge unavailable:", e?.message);
    }
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"), {
      query: { bridge: String(port), ...(daemonBridgePort ? { pbridge: daemonBridgePort } : {}) },
    });
  } else {
    win.loadURL(DEV_URL);
  }
}

/** Only the app's own pages may name a host. The renderer loaded from the
 *  host is the AOE UI, and it has no business repointing the window at
 *  somewhere else — so these answer file:// frames and nothing else. */
const fromOwnPage = (e) => {
  try {
    return String(e.senderFrame?.url || "").startsWith("file:");
  } catch {
    return false;
  }
};

app.whenReady().then(() => {
  ipcMain.handle("aoe:probe-host", async (e, url) => {
    if (!fromOwnPage(e) || !isHost(url)) return false;
    return hostAnswers(tidyHost(url));
  });
  ipcMain.handle("aoe:use-host", (e, url) => {
    if (!fromOwnPage(e) || !isHost(url) || !shellWindow) return false;
    shellWindow.use(url);
    return true;
  });
  ipcMain.handle("aoe:change-host", (e) => {
    if (!fromOwnPage(e) || !shellWindow) return false;
    shellWindow.ask();
    return true;
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
