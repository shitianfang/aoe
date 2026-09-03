/**
 * Daemon bridge: connects to the prime-agent daemon over its local socket
 * (SDK: @earendil-works/pi-coding-agent) and exposes a tiny HTTP surface the
 * renderer can reach from a browser or the Electron renderer:
 *
 *   GET  /bridge/events   SSE stream of session events + snapshots
 *   POST /bridge/cmd      { op: "prompt"|"steer"|"follow_up"|"abort"|"refine"
 *                               |"heartbeat_set"|"heartbeat_update"
 *                               |"refine_rollback"|"refine_global"|…, text?, target? }
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
import { createPreviewStore } from "./preview.mjs";

const PORT = Number(process.env.PRIME_BRIDGE_PORT || 3117);
const PRIME_AGENT_DIR = process.env.PRIME_AGENT_DIR || "/workspace/prime-agent";
const SDK_PATH = path.join(PRIME_AGENT_DIR, "packages/coding-agent/dist/index.js");
const CLI = path.join(PRIME_AGENT_DIR, "prime-agent.sh");
// Workspaces are directories under one root; "general" is the pinned default.
// Top-level session names are globally unique, so each workspace's resident
// master gets its own session name while the UI always shows "master".
const WORKSPACE_ROOT =
  process.env.PRIME_WORKSPACE_ROOT || path.join(os.homedir(), ".prime", "desktop");
const WS_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
let currentWorkspace = process.env.PRIME_WORKSPACE || "general";
let WORKSPACE_DIR = path.join(WORKSPACE_ROOT, currentWorkspace);
const masterNameFor = (ws) => (ws === "general" ? "master" : `master@${ws}`);

/** @type {Set<import("node:http").ServerResponse>} */
const sseClients = new Set();
let daemon = { connected: false, master: null, error: null, workspace: currentWorkspace };
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

// Preview pipeline (client-inferred, electron/preview.mjs): fed from the
// session-event tap below; versions snapshot on agent_end. Rebuilt on
// workspace switch — the store is bound to one workspace directory.
let preview = createPreviewStore({
  workspaceDir: WORKSPACE_DIR,
  onUpdate: () => broadcast({ type: "preview_update" }),
});

// ---- workspace file activity ----------------------------------------------
// All real writes happen inside the python kernel (the only tool is ipython),
// so the filesystem is the source of truth: scan the workspace at each turn
// end and diff against the last manifest.
const SCAN_IGNORE = new Set(["node_modules", ".git", "__pycache__"]);
let manifest = new Map();

function scanWorkspace(dir, prefix = "", out = new Map(), depth = 0) {
  if (depth > 4) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SCAN_IGNORE.has(e.name)) scanWorkspace(path.join(dir, e.name), rel, out, depth + 1);
    } else if (e.isFile()) {
      try {
        const st = fs.statSync(path.join(dir, e.name));
        out.set(rel, `${st.mtimeMs}:${st.size}`);
      } catch {
        /* raced with a delete */
      }
    }
  }
  return out;
}

function resetManifest() {
  manifest = scanWorkspace(WORKSPACE_DIR);
}

function diffWorkspace() {
  const next = scanWorkspace(WORKSPACE_DIR);
  const changed = [];
  for (const [rel, sig] of next) if (manifest.get(rel) !== sig) changed.push(rel);
  manifest = next;
  return changed;
}
// ---------------------------------------------------------------------------

/** Plain text of an AgentMessage content (string or content-block array). */
function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b && typeof b.text === "string" ? b.text : "")).join("");
  }
  return "";
}

/** Slim the attach snapshot's transcript for history replay: the renderer only
 *  needs [{role, text, at?, from?}], not full message objects. Keeps user and
 *  assistant text plus agent_message customs (bare details.message — content is
 *  the model-facing envelope); drops autonomous_status and every other custom,
 *  drops empty entries, caps at the most recent 200. */
function slimHistory(messages) {
  const out = [];
  for (const m of messages ?? []) {
    if (!m || typeof m !== "object") continue;
    const at = typeof m.timestamp === "number" ? m.timestamp : undefined;
    if (m.role === "user" || m.role === "assistant") {
      const text = contentText(m.content);
      if (text) out.push({ role: m.role, text, ...(at !== undefined ? { at } : {}) });
    } else if (m.role === "custom" && m.customType === "agent_message") {
      const text = typeof m.details?.message === "string" ? m.details.message : "";
      if (!text) continue;
      const from = m.details?.from?.sessionName;
      out.push({
        role: "agent_message",
        text,
        ...(from ? { from } : {}),
        ...(at !== undefined ? { at } : {}),
      });
    }
  }
  return out.slice(-200);
}

/** Root sessions beyond this bridge's masters (rlmDepth 0, non-master names),
 *  read-only in the Agents column. */
async function agentsPayload() {
  if (!daemonClient) return { agents: [] };
  const listed = await daemonClient.request({ type: "list", all: true });
  if (!listed.success) throw new Error(listed.error || "list failed");
  const agents = (listed.data.sessions || [])
    .filter((s) => (s.rlmDepth ?? 0) === 0 && !String(s.sessionName ?? "").startsWith("master"))
    .map((s) => ({
      name: s.sessionName || String(s.firstMessage ?? "").slice(0, 40) || "unnamed",
      state: s.isSessionActive ? (s.isStreaming ? "running" : "idle") : "inactive",
    }));
  return { agents };
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
      // Under packaged Electron, execPath is the app binary; run it as node.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    child.on("error", (e) => console.error("[bridge] daemon spawn error:", e?.message));
    child.unref();
    for (let i = 0; i < 200 && !(await canConnect(socketPath)); i++) await delay(100);
    if (!(await canConnect(socketPath))) throw new Error("daemon did not come up");
  }

  const client = new sdk.DaemonClient(socketPath);
  await client.connect();
  daemonClient = client;
  sdkRef = sdk;
  await attachMaster();
}

/** @type {any} */ let sdkRef = null;

async function attachMaster() {
  const client = daemonClient;
  const name = masterNameFor(currentWorkspace);
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  // Idempotent master: attach if a worker is live, resume from disk if not,
  // create fresh only when no master session exists at all.
  const listed = await client.request({ type: "list", all: true });
  if (!listed.success) throw new Error(listed.error || "list failed");
  let master = (listed.data.sessions || []).find(
    (s) => s.sessionName === name && (s.rlmDepth ?? 0) === 0,
  );
  if (!master?.activeSessionId) {
    const created = await client.request({
      type: "create",
      ...(master?.sessionFile ? { sessionPath: master.sessionFile } : { name }),
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

  masterConn = await sdkRef.DaemonAgentConnection.attach(client, activeSessionId, {
    closeClientOnDispose: false,
    sendClientEnv: true,
  });

  masterConn.subscribe((event) => {
    // AgentConnectionEvent wraps session events; renderer consumes the inner shape.
    if (event?.type === "session_event") {
      const inner = event.event;
      if (inner?.type === "agent_end") {
        // fs truth first, so the preview snapshot pass sees every change
        for (const rel of diffWorkspace()) {
          preview.touch(rel);
          broadcast({
            type: "file_activity",
            file: { path: rel, name: rel.split("/").pop(), at: new Date().toISOString() },
          });
        }
        preview.observe(inner);
        // agent_end carries the full message history — the renderer never needs it
        broadcast({ type: "event", event: { type: "agent_end" } });
        return;
      }
      preview.observe(inner);
      broadcast({ type: "event", event: inner });
    } else if (event?.type === "extension_ui_request") {
      // free "what is it doing" copy (setWorkingMessage); empty payload clears
      const req = event.request;
      if (req?.method === "setWorkingMessage") {
        broadcast({ type: "working_message", text: req.payload?.message ?? "" });
      }
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
    workspace: currentWorkspace,
  };
  resetManifest();
  lastSnapshot = {
    type: "snapshot",
    state: {
      goal: snapshot.state?.goal ?? null,
      heartbeat: snapshot.state?.heartbeat ?? null,
      sessionDir: snapshot.state?.sessionDir ?? null,
    },
    children: snapshot.children ?? [],
    messages: slimHistory(snapshot.messages),
  };
  broadcast({ type: "hello", daemon });
  broadcast(lastSnapshot);
}

/** Latest snapshot payload, replayed to late-joining SSE clients. */
let lastSnapshot = null;

async function switchWorkspace(name) {
  if (!WS_NAME_RE.test(name)) throw new Error("invalid workspace name");
  if (!daemonClient) throw new Error("daemon not connected");
  if (name === currentWorkspace && masterConn) return;
  if (masterConn) {
    try {
      await masterConn.dispose(); // resident worker keeps running; this only detaches
    } catch {
      /* best-effort detach */
    }
    masterConn = null;
  }
  currentWorkspace = name;
  WORKSPACE_DIR = path.join(WORKSPACE_ROOT, name);
  sessionDir = null;
  masterSessionId = null;
  daemon = { connected: false, master: null, error: null, workspace: name };
  preview = createPreviewStore({
    workspaceDir: WORKSPACE_DIR,
    onUpdate: () => broadcast({ type: "preview_update" }),
  });
  await attachMaster();
}

async function workspacesPayload() {
  fs.mkdirSync(path.join(WORKSPACE_ROOT, "general"), { recursive: true });
  const dirs = fs
    .readdirSync(WORKSPACE_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort((a, b) => (a === "general" ? -1 : b === "general" ? 1 : a.localeCompare(b)));
  let sessions = [];
  if (daemonClient) {
    const listed = await daemonClient.request({ type: "list", all: true }).catch(() => null);
    if (listed?.success) sessions = listed.data.sessions || [];
  }
  const workspaces = dirs.map((ws) => {
    const s = sessions.find((x) => x.sessionName === masterNameFor(ws) && (x.rlmDepth ?? 0) === 0);
    let state = s?.isSessionActive ? (s.isStreaming ? "running" : "idle") : "off";
    // The roster can lag right after (re)attach; the live connection is truth
    // for the workspace we are attached to.
    if (ws === currentWorkspace && daemon.connected && state === "off") state = "idle";
    return { name: ws, pinned: ws === "general", state };
  });
  return { current: currentWorkspace, workspaces };
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
    case "refine_rollback":
      // Undo one lesson; recorded by the harness as a new refinement.
      return { result: await masterConn.refine({ rollbackId: String(body.target ?? "") }) };
    case "refine_global":
      // Runs a new global review — the kept lesson may differ from the local one.
      return {
        result: await masterConn.refine({
          global: true,
          ...(body.text ? { instructions: String(body.text) } : {}),
        }),
      };
    case "agent_message": {
      // Messages to helpers are always steer-queued by the runtime; the
      // receipt says delivered vs queued.
      const receipt = await masterConn.sendAgentMessage(String(body.target ?? ""), String(body.text ?? ""));
      return { receipt: { deliveryStatus: receipt?.deliveryStatus ?? "queued" } };
    }
    case "heartbeat_set":
      // schedule like "every 30m"; mode "steer" | "follow_up" (SDK default applies if omitted)
      return {
        job: await masterConn.setHeartbeat(
          String(body.schedule ?? ""),
          String(body.text ?? ""),
          body.mode ? String(body.mode) : undefined,
        ),
      };
    case "heartbeat_update":
      // action "pause" | "resume" | "clear" — master's own heartbeat only
      return { job: (await masterConn.updateHeartbeat(String(body.action ?? ""))) ?? null };
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
  if (req.url === "/bridge/workspaces") {
    workspacesPayload()
      .then((p) => {
        res.writeHead(200, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify(p));
      })
      .catch((e) => {
        res.writeHead(500, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ error: e?.message || String(e) }));
      });
    return;
  }
  if (req.url === "/bridge/workspace" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      try {
        const { name } = JSON.parse(raw || "{}");
        await switchWorkspace(String(name ?? ""));
        res.writeHead(200, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, workspace: currentWorkspace }));
      } catch (e) {
        res.writeHead(500, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }));
      }
    });
    return;
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
  if (req.url === "/bridge/preview") {
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    return res.end(JSON.stringify({ files: preview.list() }));
  }
  if (req.url && req.url.startsWith("/bridge/preview/file")) {
    const u = new URL(req.url, "http://localhost");
    try {
      const { buffer, contentType } = preview.read(
        u.searchParams.get("path") ?? "",
        u.searchParams.get("v") ?? "",
      );
      res.writeHead(200, { ...cors, "content-type": contentType });
      return res.end(buffer);
    } catch (e) {
      res.writeHead(404, { ...cors, "content-type": "application/json" });
      return res.end(JSON.stringify({ error: e?.message || "not found" }));
    }
  }
  if (req.url === "/bridge/agents") {
    agentsPayload()
      .then((p) => {
        res.writeHead(200, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify(p));
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
    if (daemon.connected && lastSnapshot) {
      res.write(`data: ${JSON.stringify(lastSnapshot)}\n\n`);
    }
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
