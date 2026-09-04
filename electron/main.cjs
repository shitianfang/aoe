const { app, BrowserWindow, net, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

const DEV_URL = process.env.AOE_DEV_URL || process.env.PRIME_DESKTOP_DEV_URL || "http://localhost:3000";
// Not NVIDIA directly: the daemon bridge (hosted in this process for a
// packaged build) proxies to NIM and is the single place requests are counted
// for the usage readout. Going straight out would leave that count short. The
// gateway takes the same road, for the stricter reason that the key it needs
// only ever exists inside the daemon bridge.
const BRIDGE_ORIGIN = () => `http://127.0.0.1:${process.env.PRIME_BRIDGE_PORT || "3117"}`;
const NIM_UPSTREAM = () => `${BRIDGE_ORIGIN()}/nim/v1`;
const GATEWAY_UPSTREAM = () => `${BRIDGE_ORIGIN()}/gw/v1`;

/** A shell build points at a hosted AOE instead of hosting one. The renderer
 *  already resolves /bridge and /api against its own origin whenever the page
 *  carries no port in its query (that is how the dev browser works), so
 *  loading that origin bare is the whole of it — and this process must then
 *  start no bridge and no daemon of its own, which would answer nothing and
 *  only fight the host for the port.
 *
 *  The URL is baked at package time into electron/remote.json; the
 *  environment overrides it, so one build can be pointed somewhere else
 *  without repackaging. Neither present means an ordinary self-hosted build. */
function remoteUrl() {
  if (process.env.AOE_REMOTE_URL) return process.env.AOE_REMOTE_URL.trim();
  try {
    const p = path.join(__dirname, "remote.json");
    if (fs.existsSync(p)) return String(JSON.parse(fs.readFileSync(p, "utf8")).url || "").trim();
  } catch {
    /* unreadable — a self-hosted build is the right fallback */
  }
  return "";
}

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
  const remote = remoteUrl();
  // A shell's own host is the app; anywhere else is a link someone wrote.
  const sameHost = (url) => {
    try {
      return !!remote && new URL(url).origin === new URL(remote).origin;
    } catch {
      return false;
    }
  };
  win.webContents.on("will-navigate", (e, url) => {
    if (url === win.webContents.getURL() || sameHost(url)) return;
    e.preventDefault();
    external(url);
  });
  if (remote) {
    // The host this shell points at is a machine that gets turned off. A
    // failed load would leave a white window saying nothing, with no way back
    // once the host returns — so the window says what it is waiting for and
    // keeps knocking until it answers.
    let waiting = false;
    // Ask whether the host is back before navigating to it. Retrying with
    // loadURL instead replaces the waiting page with Chromium's own error
    // page — which says ERR_CONNECTION_REFUSED to someone who never chose a
    // host, and which nothing then navigates away from.
    const answers = () =>
      new Promise((resolve) => {
        const req = net.request({ method: "GET", url: remote });
        req.on("response", (r) => {
          r.on("data", () => {});
          r.on("end", () => {});
          resolve(true);
        });
        req.on("error", () => resolve(false));
        req.end();
      });
    const knock = async () => {
      if (!waiting) return;
      if (await answers()) {
        waiting = false;
        win.loadURL(remote).catch(() => {
          /* did-fail-load puts the waiting page back */
        });
      } else {
        setTimeout(knock, 4000);
      }
    };
    win.webContents.on("did-fail-load", (_e, code, desc, _url, isMainFrame) => {
      // -3 is a load the app itself replaced, not a host that failed to answer.
      if (!isMainFrame || code === -3 || waiting) return;
      waiting = true;
      win.loadFile(path.join(__dirname, "offline.html"), { query: { url: remote, why: desc || "" } });
      setTimeout(knock, 4000);
    });
    win.loadURL(remote).catch(() => {
      /* did-fail-load has it */
    });
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

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
