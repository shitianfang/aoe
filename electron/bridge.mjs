/**
 * Daemon bridge: connects to the prime-agent daemon over its local socket
 * (SDK: @earendil-works/pi-coding-agent) and exposes a tiny HTTP surface the
 * renderer can reach from a browser or the Electron renderer:
 *
 *   GET  /bridge/events   SSE stream of session events + snapshots
 *   POST /bridge/cmd      { op: "prompt"|"steer"|"follow_up"|"abort"|"refine"
 *                               |"heartbeat_set"|"heartbeat_update"|"cron_cancel"
 *                               |"refine_rollback"|"refine_global"
 *                               |"agent_message"|"stop_helper"|"remove_helper"
 *                               |"watch_helper"|"unwatch_helper"
 *                               |"watch_root"|"unwatch_root"|"root_prompt"
 *                               |"root_steer"|"root_follow_up"|"root_abort",
 *                             text?, target? }
 *   GET  /bridge/crons    { crons } — master's scheduled re-entries (cron_list,
 *                         heartbeat-sourced jobs excluded; those are /bridge/heartbeats)
 *   GET  /bridge/autonomous { autonomous, autoRefine } — read-only status blocks
 *                         (get_connection_state; null on pre-schema-27 daemons)
 *   GET  /bridge/skills   { items: [{ name, detail? }] } — read-only skill catalog
 *   GET  /bridge/extensions { items: [{ name, detail? }] } — providers, MCP, extensions
 *   GET  /bridge/health   { connected, master, capabilities }
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
/** Server capabilities from daemon_hello (e.g. "preview_events" — the daemon
 *  emits preview_published session events). Empty on older daemons. */
/** @type {string[]} */ let serverCaps = [];
let daemon = {
  connected: false,
  master: null,
  error: null,
  workspace: currentWorkspace,
  capabilities: serverCaps,
};
/** @type {any} */ let masterConn = null;
/** @type {any} */ let daemonClient = null;
/** Live child-session attaches for the helper view, keyed by activeSessionId.
 *  Same socket as master (multi-attach is verified, findings §5). */
/** @type {Map<string, any>} */ const childConns = new Map();
/** Live attaches to other root sessions ("Other" in the Agents column),
 *  keyed by session name (top-level names are unique). Same socket as master.
 *  @type {Map<string, { conn: any, activeSessionId: string }>} */
const rootConns = new Map();
/** @type {string|null} */ let masterSessionId = null;
/** @type {string|null} */ let sessionDir = null;
/** Master's session uuid — the session-artifacts directory name. */
/** @type {string|null} */ let masterUuid = null;

/** Continual-harness state: lessons live in harness_state.json (local per
 *  session, global under ~/.prime/agent/harness). Read-only surface. */
function readHarness(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
/** Master's autonomous + auto-refine status blocks, read-only via
 *  get_connection_state (schema 27: lastInjection, autoRefine.lastReviewAt).
 *  Older daemons return a state without the blocks — both come back null. */
async function statusPayload() {
  if (!daemonClient || !masterSessionId) return { autonomous: null, autoRefine: null };
  const r = await daemonClient
    .request({ type: "get_connection_state", activeSessionId: masterSessionId })
    .catch(() => null);
  if (!r?.success) return { autonomous: null, autoRefine: null };
  return {
    autonomous: r.data?.autonomous ?? null,
    autoRefine: r.data?.autoRefine ?? null,
  };
}

function learnedPayload() {
  // Local harness lives under the session's artifact dir, keyed by session uuid
  // (state.sessionDir is the sessions root, not this session's artifacts).
  const local = masterUuid
    ? readHarness(
        path.join(
          os.homedir(),
          ".prime",
          "agent",
          "session-artifacts",
          masterUuid,
          "harness",
          "harness_state.json",
        ),
      )
    : null;
  const global_ = readHarness(
    path.join(os.homedir(), ".prime", "agent", "harness", "harness_state.json"),
  );
  return { local, global: global_ };
}

// ---- skills / extensions (read-only catalogs) ------------------------------
// Both columns only report what the runtime already has on disk; nothing here
// installs, enables or edits anything. Credentials are never read as values —
// auth.json is opened for its KEY NAMES only (they say which integrations are
// connected), never for the secrets behind them.

const AGENT_HOME = path.join(os.homedir(), ".prime", "agent");

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Global agent settings (~/.prime/agent/settings.json); {} when absent. */
function agentSettings() {
  const s = readJsonFile(path.join(AGENT_HOME, "settings.json"));
  return s && typeof s === "object" ? s : {};
}

/** Where the kernel actually bootstrapped its python skills from — the daemon
 *  may run out of a fork, so trust the venv's record over PRIME_AGENT_DIR. */
function bundledSkillsDir() {
  const boot = readJsonFile(path.join(AGENT_HOME, "kernel-venv", ".bootstrap-version"));
  const first = boot?.pythonSkills?.[0]?.packagePath;
  if (typeof first === "string" && first) return path.dirname(first);
  return path.join(PRIME_AGENT_DIR, "packages", "coding-agent", "skills");
}

/** name + description out of a SKILL.md YAML frontmatter block. `name` is
 *  optional in the runtime (it falls back to the directory), `description`
 *  is required — a skill without one is dropped by the loader too. */
function readSkillMd(file, dirName) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) return null;
  const field = (key) => {
    const m = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(fm[1]);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  };
  const description = field("description");
  if (!description) return null;
  return { name: field("name") || dirName, description };
}

/** Collect skill dirs under a root: a directory holding SKILL.md IS a skill
 *  and recursion stops there (same rule the runtime's loader uses). */
function collectSkills(root, out, depth = 0) {
  if (depth > 3) return;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
    const dir = path.join(root, e.name);
    const md = path.join(dir, "SKILL.md");
    if (fs.existsSync(md)) {
      const s = readSkillMd(md, e.name);
      if (s && !out.has(s.name)) out.set(s.name, s);
    } else {
      collectSkills(dir, out, depth + 1);
    }
  }
}

/** First sentence of a description, capped — the column shows one small line. */
function oneLine(s, cap = 90) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const stop = t.search(/\.(\s|$)/);
  const first = stop > 0 ? t.slice(0, stop) : t;
  return first.length > cap ? `${first.slice(0, cap - 1)}…` : first;
}

/** GET /bridge/skills — skills the runtime can load, project first, then the
 *  user dir, then what the runtime bundles. Empty when nothing is on disk. */
function skillsPayload() {
  const settings = agentSettings();
  const roots = [
    path.join(WORKSPACE_DIR, ".prime", "agent", "skills"),
    path.join(AGENT_HOME, "skills"),
    bundledSkillsDir(),
    // settings.skills may be the array of extra paths, or the legacy object form.
    ...(Array.isArray(settings.skills) ? settings.skills : []).map((p) =>
      path.resolve(AGENT_HOME, String(p).replace(/^[+-]/, "")),
    ),
  ];
  const found = new Map();
  for (const r of roots) collectSkills(r, found);
  const items = [...found.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => {
      const detail = oneLine(s.description);
      return detail ? { name: s.name, detail } : { name: s.name };
    });
  return { items };
}

/** GET /bridge/extensions — what the agent is wired into: model providers,
 *  MCP servers, connected integrations, local extension modules. */
function extensionsPayload() {
  const settings = agentSettings();
  const items = [];

  // Model providers (~/.prime/agent/models.json).
  const models = readJsonFile(path.join(AGENT_HOME, "models.json"));
  for (const [id, p] of Object.entries(models?.providers ?? {})) {
    const n = Array.isArray(p?.models) ? p.models.length : 0;
    const bits = ["provider", `${n} model${n === 1 ? "" : "s"}`];
    if (settings.defaultProvider === id) bits.push("default");
    items.push({ name: p?.name || id, detail: bits.join(" · ") });
  }

  // User-declared MCP servers (settings.mcpServers: name → { type: http|stdio }).
  for (const [name, cfg] of Object.entries(settings.mcpServers ?? {})) {
    items.push({ name, detail: `mcp · ${cfg?.type || "server"}` });
  }

  // Built-in integrations that have been logged in: auth.json keys are
  // "mcp:<server>". Key names only — no credential value is ever read here.
  const auth = readJsonFile(path.join(AGENT_HOME, "auth.json"));
  for (const k of Object.keys(auth ?? {})) {
    if (k.startsWith("mcp:")) items.push({ name: k.slice(4), detail: "mcp · connected" });
  }

  // Local extension modules (~/.prime/agent/extensions and the project dir).
  const extRoots = [
    path.join(WORKSPACE_DIR, ".prime", "agent", "extensions"),
    path.join(AGENT_HOME, "extensions"),
  ];
  const seen = new Set();
  for (const root of extRoots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const name = e.isFile() ? e.name.replace(/\.(t|j)s$/, "") : e.name;
      if (e.isFile() && !/\.(t|j)s$/.test(e.name)) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      items.push({ name, detail: "extension" });
    }
  }
  for (const p of Array.isArray(settings.extensions) ? settings.extensions : []) {
    const name = path.basename(String(p).replace(/^[+-]/, "")).replace(/\.(t|j)s$/, "");
    if (name && !seen.has(name)) {
      seen.add(name);
      items.push({ name, detail: "extension" });
    }
  }

  return { items };
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
  // daemon_hello carries the server capability list; older daemons/SDKs may
  // lack the accessor or the field — both degrade to "no capabilities".
  try {
    const hello = client.hello ?? (await client.waitForHello?.(3000));
    serverCaps = Array.isArray(hello?.serverCapabilities) ? [...hello.serverCapabilities] : [];
  } catch {
    serverCaps = [];
  }
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
  masterUuid = master.sessionId ?? null;
  if (!masterUuid) {
    const relisted = await client.request({ type: "list", all: true }).catch(() => null);
    masterUuid =
      relisted?.data?.sessions?.find((s) => s.activeSessionId === activeSessionId)?.sessionId ?? null;
  }

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
      // Declared preview (capability preview_events): snapshot right away,
      // tagged declared with its label. The agent_end scan seeing the same
      // file later is a no-op — snapshots dedupe by path + content hash.
      if (inner?.type === "preview_published") preview.declare(inner.preview);
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
    capabilities: serverCaps,
  };
  resetManifest();
  lastSnapshot = {
    type: "snapshot",
    state: {
      goal: snapshot.state?.goal ?? null,
      heartbeat: snapshot.state?.heartbeat ?? null,
      sessionDir: snapshot.state?.sessionDir ?? null,
      // schema 27 status blocks; null on older daemons (renderer omits).
      autonomous: snapshot.state?.autonomous ?? null,
      autoRefine: snapshot.state?.autoRefine ?? null,
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
  await disposeChildConns(); // helper attaches belong to the old workspace's master
  await disposeRootConns(); // root attaches are per-view; drop them with the workspace
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
  daemon = { connected: false, master: null, error: null, workspace: name, capabilities: serverCaps };
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
async function withResumeRetry(fn, activeSessionId = masterSessionId) {
  try {
    return await fn();
  } catch (e) {
    if (!/queued session input is suspended/i.test(e?.message || "")) throw e;
    if (daemonClient && activeSessionId) {
      await daemonClient
        .request({ type: "resume_queue", activeSessionId })
        .catch(() => undefined);
    }
    return await fn();
  }
}

/** Thin one child-session message the way the master timeline does: text
 *  blocks joined, empty text dropped. Custom messages carry the bare text in
 *  details.message — content is the model-facing envelope (findings §4.5). */
function thinChildMessage(message) {
  const role = message?.role;
  if (role !== "assistant" && role !== "user" && role !== "custom") return null;
  let text = "";
  if (role === "custom" && typeof message.details?.message === "string") {
    text = message.details.message;
  } else if (typeof message.content === "string") {
    text = message.content;
  } else if (Array.isArray(message.content)) {
    text = message.content.map((b) => (typeof b?.text === "string" ? b.text : "")).join("");
  }
  if (!text) return null;
  const at = typeof message.timestamp === "number" ? new Date(message.timestamp).toISOString() : null;
  return { role, text, at };
}

function thinChildMessages(messages) {
  const out = [];
  for (const m of messages ?? []) {
    const thin = thinChildMessage(m);
    if (thin) out.push(thin);
  }
  return out;
}

/** Attach to a helper's live session and feed the renderer a thinned
 *  transcript. Attach can fail when the helper ran inline or was deleted —
 *  the caller surfaces {ok:false, error}; no retry (findings §6.3). */
async function watchHelper(target) {
  if (!target) throw new Error("missing target");
  if (childConns.has(target)) return;
  if (!daemonClient || !sdkRef) throw new Error("daemon not connected");
  const conn = await sdkRef.DaemonAgentConnection.attach(daemonClient, target, {
    closeClientOnDispose: false,
    sendClientEnv: false,
    directTransport: false,
  });
  childConns.set(target, conn);
  const resync = (messages) =>
    broadcast({
      type: "helper_event",
      sessionId: target,
      event: { kind: "resync", messages: thinChildMessages(messages) },
    });
  conn.subscribe((event) => {
    if (event?.type === "session_event") {
      const inner = event.event;
      const t = inner?.type;
      if (t === "message_start" || t === "message_end") {
        // Every start gets an end carrying the final text (findings §7);
        // emitting only the end keeps one row per message.
        if (t !== "message_end") return;
        const msg = thinChildMessage(inner.message);
        if (msg) broadcast({ type: "helper_event", sessionId: target, event: { kind: "msg", ...msg } });
      } else if (t === "tool_execution_start" || t === "tool_execution_end") {
        broadcast({
          type: "helper_event",
          sessionId: target,
          event: {
            kind: "tool",
            id: String(inner.toolCallId ?? ""),
            name: String(inner.toolName ?? "tool"),
            status: t === "tool_execution_start" ? "running" : inner.isError ? "error" : "done",
          },
        });
      } else if (t === "agent_end") {
        // agent_end carries the full message history — a free canonical refresh
        resync(inner.messages);
      }
    } else if (event?.type === "session_resynced") {
      // The attach-instant snapshot can be empty (the transcript is written
      // while the helper runs); this follows with the full one. Replace wholesale.
      resync(event.snapshot?.messages);
    } else if (event?.type === "extension_ui_request") {
      // free "what is it doing" copy; empty payload clears (findings §5.2)
      const req = event.request;
      if (req?.method === "setWorkingMessage") {
        broadcast({ type: "helper_working", sessionId: target, text: req.payload?.message ?? "" });
      }
    }
  });
  const snapshot = await conn.getInitialSnapshot().catch(() => null);
  resync(snapshot?.messages);
}

async function unwatchHelper(target) {
  const conn = childConns.get(target);
  if (!conn) return;
  childConns.delete(target);
  try {
    await conn.dispose(); // master connection stays usable (findings §5)
  } catch {
    /* best-effort detach */
  }
}

async function disposeChildConns() {
  const targets = [...childConns.keys()];
  for (const target of targets) await unwatchHelper(target);
}

/** Resolve another root session (rlmDepth 0, non-master) by name to a live
 *  activeSessionId. A root whose worker is down is resumed from disk first —
 *  normal daemon behavior; a later prompt is what wakes it into a turn. */
async function resolveRoot(name) {
  if (!name) throw new Error("missing target");
  if (!daemonClient) throw new Error("daemon not connected");
  if (name.startsWith("master")) throw new Error("master names are reserved");
  const listed = await daemonClient.request({ type: "list", all: true });
  if (!listed.success) throw new Error(listed.error || "list failed");
  const s = (listed.data.sessions || []).find(
    (x) => (x.rlmDepth ?? 0) === 0 && x.sessionName === name,
  );
  if (!s) throw new Error(`agent ${name} not found`);
  if (s.activeSessionId) return s.activeSessionId;
  const created = await daemonClient.request({
    type: "create",
    ...(s.sessionFile ? { sessionPath: s.sessionFile } : { name }),
    lifecycle: "resident",
    config: { cwd: s.cwd || WORKSPACE_DIR },
    launchEnv: { ...process.env },
  });
  if (created.success) return created.data.activeSessionId ?? created.data.id;
  if (created.errorInfo?.code === "session_already_active" && created.errorInfo.activeSessionId) {
    return created.errorInfo.activeSessionId;
  }
  throw new Error(created.error || "resume failed");
}

/** Attach to another root session (idempotent) and stream its events to the
 *  renderer tagged with the root's name. The initial snapshot is replayed as a
 *  root_snapshot; attached mid-run it can be empty — flagged partial so the
 *  renderer shows loading, never "nothing happened" (session_resynced backfills). */
async function ensureRootConn(name) {
  const existing = rootConns.get(name);
  if (existing) return existing;
  if (!sdkRef) throw new Error("daemon not connected");
  const activeSessionId = await resolveRoot(name);
  const conn = await sdkRef.DaemonAgentConnection.attach(daemonClient, activeSessionId, {
    closeClientOnDispose: false,
    sendClientEnv: false,
    directTransport: false,
  });
  const entry = { conn, activeSessionId };
  rootConns.set(name, entry);
  const resync = (messages, { partial = false, running } = {}) =>
    broadcast({
      type: "root_snapshot",
      root: name,
      messages: slimHistory(messages),
      partial,
      ...(running === undefined ? {} : { running }),
    });
  conn.subscribe((event) => {
    if (event?.type === "session_event") {
      const inner = event.event;
      if (inner?.type === "agent_end") {
        // agent_end carries the full message history — the renderer only needs the mark
        broadcast({ type: "root_event", root: name, event: { type: "agent_end" } });
        return;
      }
      broadcast({ type: "root_event", root: name, event: inner });
    } else if (event?.type === "session_resynced") {
      // Canonical transcript after a mid-run attach; replace wholesale.
      resync(event.snapshot?.messages, {
        running: Boolean(event.snapshot?.state?.isStreaming),
      });
    } else if (event?.type === "extension_ui_request") {
      const req = event.request;
      if (req?.method === "setWorkingMessage") {
        broadcast({ type: "root_working", root: name, text: req.payload?.message ?? "" });
      }
    }
  });
  const snapshot = await conn.getInitialSnapshot().catch(() => null);
  const running = Boolean(snapshot?.state?.isStreaming);
  const messages = snapshot?.messages ?? [];
  resync(messages, { partial: messages.length === 0 && running, running });
  return entry;
}

async function unwatchRoot(name) {
  const entry = rootConns.get(name);
  if (!entry) return;
  rootConns.delete(name);
  try {
    await entry.conn.dispose(); // master connection stays usable (findings §5)
  } catch {
    /* best-effort detach */
  }
}

async function disposeRootConns() {
  for (const name of [...rootConns.keys()]) await unwatchRoot(name);
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
    case "cron_cancel":
      // Cancel one scheduled re-entry (cron_cancel); heartbeats use heartbeat_update.
      return { job: await masterConn.cancelCronJob(String(body.target ?? "")) };
    case "create_agent": {
      const name = String(body.text ?? "").trim();
      if (!WS_NAME_RE.test(name)) throw new Error("invalid agent name");
      if (name.toLowerCase().startsWith("master")) throw new Error("master names are reserved");
      const r = await daemonClient.request({
        type: "create",
        name,
        lifecycle: "resident",
        config: { cwd: WORKSPACE_DIR },
        launchEnv: { ...process.env },
      });
      if (!r.success) throw new Error(r.error || "create failed");
      return { agent: { name } };
    }
    case "stop_helper":
      return { cancelled: await masterConn.cancelRlmChild(String(body.target ?? "")) };
    case "watch_helper":
      await watchHelper(String(body.target ?? ""));
      return {};
    case "unwatch_helper":
      await unwatchHelper(String(body.target ?? ""));
      return {};
    case "watch_root":
      await ensureRootConn(String(body.target ?? ""));
      return {};
    case "unwatch_root":
      await unwatchRoot(String(body.target ?? ""));
      return {};
    case "root_prompt":
    case "root_steer":
    case "root_follow_up": {
      // Converse with another root session. Attach lazily — the composer can
      // target a root the user is not viewing. A prompt to an idle root wakes it.
      const { conn, activeSessionId } = await ensureRootConn(String(body.target ?? ""));
      const text = String(body.text ?? "");
      const call =
        body.op === "root_prompt"
          ? () => conn.prompt(text)
          : body.op === "root_steer"
            ? () => conn.steer(text)
            : () => conn.followUp(text);
      await withResumeRetry(call, activeSessionId);
      return {};
    }
    case "root_abort": {
      const entry = rootConns.get(String(body.target ?? ""));
      if (!entry) throw new Error("agent not attached");
      await entry.conn.abort();
      return {};
    }
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
    // autoRefine rides along so the Learned surfaces can render
    // "next review not before" without a second pull; null on old daemons.
    statusPayload()
      .then(({ autoRefine }) => {
        res.writeHead(200, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ ...learnedPayload(), autoRefine }));
      })
      .catch(() => {
        res.writeHead(200, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ ...learnedPayload(), autoRefine: null }));
      });
    return;
  }
  if (req.url === "/bridge/autonomous") {
    // Read-only unattended status (counters, limits, lastInjection) via
    // get_connection_state — no transcript write, unlike "/autonomous status".
    statusPayload()
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
  if (req.url === "/bridge/skills") {
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    return res.end(JSON.stringify(skillsPayload()));
  }
  if (req.url === "/bridge/extensions") {
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    return res.end(JSON.stringify(extensionsPayload()));
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
  if (req.url === "/bridge/crons") {
    // Scheduled re-entries for master's session (DaemonAgentConnection.listCronJobs
    // → cron_list, scoped to activeSessionId). Heartbeat-sourced jobs are dropped:
    // they already have their own rows via /bridge/heartbeats.
    if (!masterConn) {
      res.writeHead(200, { ...cors, "content-type": "application/json" });
      return res.end(JSON.stringify({ crons: [] }));
    }
    masterConn
      .listCronJobs()
      .then((jobs) => {
        const crons = (jobs ?? [])
          .filter((j) => (j.source ?? "cron") === "cron")
          .map((j) => ({
            id: j.id,
            status: j.status,
            ...(j.label ? { label: j.label } : {}),
            prompt: j.prompt ?? "",
            ...(j.schedule?.expression ? { schedule: { expression: j.schedule.expression } } : {}),
            ...(j.nextRunAt ? { nextRunAt: j.nextRunAt } : {}),
          }));
        res.writeHead(200, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ crons }));
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
    daemon = { connected: false, master: null, error: e?.message || String(e), capabilities: [] };
    console.error("[bridge] daemon connect failed:", daemon.error);
    broadcast({ type: "hello", daemon });
  });
});
