/**
 * Daemon bridge: connects to the prime-agent daemon over its local socket
 * (SDK: @earendil-works/pi-coding-agent) and exposes a tiny HTTP surface the
 * renderer can reach from a browser or the Electron renderer:
 *
 *   GET  /bridge/events   SSE stream of session events + snapshots
 *   POST /bridge/cmd      { op: "prompt"|"steer"|"follow_up"|"abort"|"refine", text? }
 *   GET  /bridge/health   { connected, master }
 *
 * Runs standalone in dev (`npm run bridge`) and inside Electron main later.
 * The renderer never touches the daemon socket directly.
 */
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";

const PORT = Number(process.env.PRIME_BRIDGE_PORT || 3117);
const PRIME_AGENT_DIR = process.env.PRIME_AGENT_DIR || "/workspace/prime-agent";
const SDK_PATH = path.join(PRIME_AGENT_DIR, "packages/coding-agent/dist/index.js");
const CLI = path.join(PRIME_AGENT_DIR, "prime-agent.sh");
const WORKSPACE_DIR =
  process.env.PRIME_WORKSPACE_DIR || path.join(os.homedir(), ".prime", "desktop", "general");

/** @type {Set<import("node:http").ServerResponse>} */
const sseClients = new Set();
let daemon = { connected: false, master: null, error: null, workspace: path.basename(WORKSPACE_DIR) };
/** @type {any} */ let masterConn = null;
/** @type {any} */ let daemonClient = null;
/** @type {string|null} */ let masterSessionId = null;
/** @type {string|null} */ let sessionDir = null;

/** Continual-harness state: lessons live in harness_state.json (local per
 *  session, global under ~/.prime/agent/harness). Read-only surface. */
function readHarness(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function learnedPayload() {
  const local = sessionDir ? readHarness(path.join(sessionDir, "harness", "harness_state.json")) : null;
  const global_ = readHarness(
    path.join(os.homedir(), ".prime", "agent", "harness", "harness_state.json"),
  );
  return { local, global: global_ };
}

function broadcast(payload) {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) res.write(frame);
}

function canConnect(socketPath) {
  return new Promise((resolve) => {
    const sock = createConnection(socketPath);
    const done = (ok) => {
      sock.removeAllListeners();
      sock.destroy();
      resolve(ok);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    setTimeout(() => done(false), 1500).unref();
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function connectDaemon() {
  const sdk = await import(SDK_PATH);
  const socketPath = process.env.PRIME_AGENT_DAEMON_SOCKET || sdk.defaultDaemonSocketPath();

  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  if (!(await canConnect(socketPath))) {
    // Spawn the supervisor directly (same path daemon-launch.ts takes).
    const entry = path.join(PRIME_AGENT_DIR, "packages/coding-agent/dist/cli.js");
    const child = spawn(process.execPath, [entry, "--mode", "daemon", "--daemon-socket", socketPath], {
      cwd: WORKSPACE_DIR,
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.on("error", (e) => console.error("[bridge] daemon spawn error:", e?.message));
    child.unref();
    for (let i = 0; i < 200 && !(await canConnect(socketPath)); i++) await delay(100);
    if (!(await canConnect(socketPath))) throw new Error("daemon did not come up");
  }

  const client = new sdk.DaemonClient(socketPath);
  await client.connect();
  daemonClient = client;

  // Idempotent master: attach if a worker is live, resume from disk if not,
  // create fresh only when no master session exists at all.
  const listed = await client.request({ type: "list", all: true });
  if (!listed.success) throw new Error(listed.error || "list failed");
  let master = (listed.data.sessions || []).find(
    (s) => s.sessionName === "master" && (s.rlmDepth ?? 0) === 0,
  );
  if (!master?.activeSessionId) {
    const created = await client.request({
      type: "create",
      ...(master?.sessionFile ? { sessionPath: master.sessionFile } : { name: "master" }),
      lifecycle: "resident",
      config: { cwd: WORKSPACE_DIR },
      launchEnv: { ...process.env },
    });
    if (created.success) {
      master = created.data;
    } else if (created.errorInfo?.code === "session_already_active" && created.errorInfo.activeSessionId) {
      master = { activeSessionId: created.errorInfo.activeSessionId };
    } else {
      throw new Error(created.error || "create failed");
    }
  }
  const activeSessionId = master.activeSessionId ?? master.id;

  masterConn = await sdk.DaemonAgentConnection.attach(client, activeSessionId, {
    closeClientOnDispose: false,
    sendClientEnv: true,
  });

  masterConn.subscribe((event) => {
    // AgentConnectionEvent wraps session events; renderer consumes the inner shape.
    if (event?.type === "session_event") {
      broadcast({ type: "event", event: event.event });
    } else if (event?.type === "connection_status" || event?.type === "closed") {
      broadcast({ type: "bridge_status", event });
    } else if (event?.type === "heartbeats_changed") {
      broadcast({ type: "heartbeats_changed" });
    }
  });

  const snapshot = await masterConn.getInitialSnapshot();
  sessionDir = snapshot.state?.sessionDir ?? null;
  masterSessionId = activeSessionId;
  daemon = {
    connected: true,
    master: { name: "master", activeSessionId },
    error: null,
    workspace: path.basename(WORKSPACE_DIR),
  };
  broadcast({ type: "hello", daemon });
  broadcast({
    type: "snapshot",
    state: {
      goal: snapshot.state?.goal ?? null,
      heartbeat: snapshot.state?.heartbeat ?? null,
      sessionDir: snapshot.state?.sessionDir ?? null,
    },
    children: snapshot.children ?? [],
    messages: snapshot.messages ?? [],
  });
}

/** An aborted run leaves the session input pump suspended and it never
 *  self-heals; resume_queue restores it (even when it answers "No queued work
 *  to resume"), after which the retried command succeeds. */
async function withResumeRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    if (!/queued session input is suspended/i.test(e?.message || "")) throw e;
    if (daemonClient && masterSessionId) {
      await daemonClient
        .request({ type: "resume_queue", activeSessionId: masterSessionId })
        .catch(() => undefined);
    }
    return await fn();
  }
}

async function handleCmd(body) {
  if (!masterConn) throw new Error("daemon not connected");
  switch (body.op) {
    case "prompt":
      await withResumeRetry(() => masterConn.prompt(String(body.text ?? "")));
      return {};
    case "steer":
      await withResumeRetry(() => masterConn.steer(String(body.text ?? "")));
      return {};
    case "follow_up":
      await withResumeRetry(() => masterConn.followUp(String(body.text ?? "")));
      return {};
    case "abort":
      await masterConn.abort();
      return {};
    case "refine":
      return { result: await masterConn.refine(body.text ? { instructions: body.text } : {}) };
    case "agent_message": {
      // Messages to helpers are always steer-queued by the runtime; the
      // receipt says delivered vs queued.
      const receipt = await masterConn.sendAgentMessage(String(body.target ?? ""), String(body.text ?? ""));
      return { receipt: { deliveryStatus: receipt?.deliveryStatus ?? "queued" } };
    }
    case "stop_helper":
      return { cancelled: await masterConn.cancelRlmChild(String(body.target ?? "")) };
    case "remove_helper": {
      if (!daemonClient || !masterSessionId) throw new Error("daemon not connected");
      const r = await daemonClient.request({
        type: "delete_rlm_subagent",
        activeSessionId: masterSessionId,
        childId: String(body.target ?? ""),
      });
      if (!r.success) throw new Error(r.error || "remove failed");
      return {};
    }
    default:
      throw new Error(`unknown op ${body.op}`);
  }
}

const server = http.createServer(async (req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  if (req.url === "/bridge/learned") {
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    return res.end(JSON.stringify(learnedPayload()));
  }
  if (req.url === "/bridge/heartbeats") {
    if (!masterConn) {
      res.writeHead(200, { ...cors, "content-type": "application/json" });
      return res.end(JSON.stringify({ heartbeats: [] }));
    }
    masterConn
      .listHeartbeats()
      .then((heartbeats) => {
        res.writeHead(200, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ heartbeats }));
      })
      .catch((e) => {
        res.writeHead(500, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ error: e?.message || String(e) }));
      });
    return;
  }
  if (req.url === "/bridge/health") {
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    return res.end(JSON.stringify(daemon));
  }
  if (req.url === "/bridge/events") {
    res.writeHead(200, {
      ...cors,
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "hello", daemon })}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }
  if (req.url === "/bridge/cmd" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      try {
        const out = await handleCmd(JSON.parse(raw || "{}"));
        res.writeHead(200, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, ...out }));
      } catch (e) {
        res.writeHead(500, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }));
      }
    });
    return;
  }
  res.writeHead(404, cors);
  res.end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[bridge] listening on 127.0.0.1:${PORT}`);
  connectDaemon().catch((e) => {
    daemon = { connected: false, master: null, error: e?.message || String(e) };
    console.error("[bridge] daemon connect failed:", daemon.error);
    broadcast({ type: "hello", daemon });
  });
});
