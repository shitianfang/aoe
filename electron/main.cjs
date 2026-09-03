const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");

const DEV_URL = process.env.PRIME_DESKTOP_DEV_URL || "http://localhost:3000";
const NIM_UPSTREAM = "https://integrate.api.nvidia.com/v1";

/** Key comes from the environment or <userData>/config.json — never from the bundle. */
function loadNimKey() {
  let key = process.env.NIM_API_KEY || "";
  try {
    const p = path.join(app.getPath("userData"), "config.json");
    if (fs.existsSync(p)) {
      key = JSON.parse(fs.readFileSync(p, "utf8")).nimApiKey || key;
    }
  } catch {
    /* unreadable config — fall back to env */
  }
  return key;
}

/** Packaged builds have no Vite proxy, so main hosts the same /api/nim bridge locally. */
function startBridge() {
  const key = loadNimKey();
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
    const upstream = https.request(
      NIM_UPSTREAM + req.url.slice("/api/nim".length),
      {
        method: req.method,
        headers: {
          "content-type": req.headers["content-type"] || "application/json",
          accept: req.headers.accept || "*/*",
          authorization: `Bearer ${key}`,
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
    req.pipe(upstream);
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
