const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");

const DEV_URL = process.env.AOE_DEV_URL || process.env.PRIME_DESKTOP_DEV_URL || "http://localhost:3000";
const NIM_UPSTREAM = "https://integrate.api.nvidia.com/v1";

/** Key and model come from the environment or <userData>/config.json — never from the bundle. */
function loadNimConfig() {
  let key = process.env.NIM_API_KEY || "";
  let model = process.env.NIM_MODEL || "deepseek-ai/deepseek-v4-flash-0731";
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
    }
  } catch {
    /* unreadable config — fall back to env */
  }
  return { key, model };
}

/** Packaged builds have no Vite proxy, so main hosts the same /api/nim bridge locally. */
function startBridge() {
  const { key, model } = loadNimConfig();
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
    if (!req.url || !req.url.startsWith("/api/nim/")) {
      res.writeHead(404, cors);
      res.end();
      return;
    }
    const send = (body) => {
      const upstream = https.request(
        NIM_UPSTREAM + req.url.slice("/api/nim".length),
        {
          method: req.method,
          headers: {
            "content-type": req.headers["content-type"] || "application/json",
            accept: req.headers.accept || "*/*",
            authorization: `Bearer ${key}`,
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
    if (req.method === "POST" && req.url.includes("/chat/completions")) {
      // The renderer sends the user-picked model at runtime; env/config is the
      // fallback default when it sends none.
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        let body = Buffer.concat(chunks).toString("utf8");
        try {
          const parsed = JSON.parse(body);
          if (!parsed.model) parsed.model = model;
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
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault();
      external(url);
    }
  });
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
