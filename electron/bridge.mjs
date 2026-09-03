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
 *                               |"root_steer"|"root_follow_up"|"root_abort"
 *                               |"root_heartbeat_set"|"root_heartbeat_update"
 *                               |"root_refine"|"root_refine_rollback"
 *                               |"root_set_model"|"set_auto_refine",
 *                             text?, target? }
 *   GET  /bridge/crons    { crons } — master's scheduled re-entries (cron_list,
 *                         heartbeat-sourced jobs excluded; those are /bridge/heartbeats)
 *   GET  /bridge/autonomous { autonomous, autoRefine } — read-only status blocks
 *                         (get_connection_state; null on pre-schema-27 daemons)
 *   GET  /bridge/root-status?name= { attached, goal, autonomous, autoRefine } —
 *                         same read-only pull for a watched root session
 *   GET  /bridge/model    { current, models } — master's model + switchable catalog
 *                         (cmd op "set_model" { text: modelId, provider } switches;
 *                          ?root=<name> reads a root's, "root_set_model" switches it)
 *   GET  /bridge/skills   { items: [{ name, detail? }] } — read-only skill catalog
 *   GET  /bridge/extensions { items: [{ name, detail? }] } — providers, MCP, extensions
 *   GET  /bridge/health   { connected, master, capabilities }
 *   GET  /bridge/nim      { used, limit, inflight, resetInMs, throttledMsAgo } —
 *                         NIM requests in the trailing minute, counted here
 *                         because NVIDIA returns no rate-limit header at all
 *   ALL  /nim/*           proxy to integrate.api.nvidia.com, and the one place
 *                         every NIM request (daemon's and renderer's) passes
 *   POST /bridge/claude   { text, sessionId?, system?, model? } → SSE
 *                         {type:"delta"|"tool"|"subagent"|"done"|"error"}
 *                         — runs the local `claude -p` CLI (user's own login) as a
 *                         real agent: tools enabled in the workspace directory
 *
 * Runs standalone in dev (`npm run bridge`) and inside Electron main later.
 * The renderer never touches the daemon socket directly.
 */
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { createPreviewStore } from "./preview.mjs";

const PORT = Number(process.env.PRIME_BRIDGE_PORT || 3117);
// The agent runtime ships in this repo at core/, so a source checkout needs no
// configuration. Packaged builds do not bundle core/ — they set PRIME_AGENT_DIR
// to a built prime-agent checkout on the target machine, which also lets a
// source checkout point at upstream instead of the vendored fork.
const VENDORED_CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "core");
const PRIME_AGENT_DIR = process.env.PRIME_AGENT_DIR || VENDORED_CORE;
const SDK_PATH = path.join(PRIME_AGENT_DIR, "packages/coding-agent/dist/index.js");
const CLI = path.join(PRIME_AGENT_DIR, "prime-agent.sh");
// Workspaces are directories under one root; "default" is the pinned one.
// Top-level session names are globally unique, so each workspace's resident
// master gets its own session name while the UI always shows "master".
const WORKSPACE_ROOT =
  process.env.PRIME_WORKSPACE_ROOT || path.join(os.homedir(), ".prime", "desktop");
const DEFAULT_WS = "default";
const WS_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;
// Where the last opened workspace is remembered. Dot-prefixed, so the
// workspace listing (which skips dotted entries) never shows it as one.
const STATE_FILE = path.join(WORKSPACE_ROOT, ".desktop.json");

/** The workspace to open on a cold start: an explicit env override wins, then
 *  the one last opened, then the pinned default. A remembered name is only
 *  honoured while its directory is still there — a workspace deleted from disk
 *  would otherwise strand the app in a folder that no longer exists. */
function initialWorkspace() {
  if (process.env.PRIME_WORKSPACE) return process.env.PRIME_WORKSPACE;
  try {
    const { lastWorkspace } = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (
      typeof lastWorkspace === "string" &&
      WS_NAME_RE.test(lastWorkspace) &&
      fs.existsSync(path.join(WORKSPACE_ROOT, lastWorkspace))
    ) {
      return lastWorkspace;
    }
  } catch {
    /* no state yet, or unreadable — the default is the right answer */
  }
  return DEFAULT_WS;
}

/** The pinned workspace used to be called "general". Carry an existing one
 *  over rather than stranding its contents under a name that is no longer
 *  special — only when the new name is free, so a real "default" always wins. */
function renameLegacyDefault() {
  try {
    const from = path.join(WORKSPACE_ROOT, "general");
    const to = path.join(WORKSPACE_ROOT, DEFAULT_WS);
    if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
  } catch {
    /* best-effort: a failed rename leaves "general" as an ordinary workspace */
  }
}
renameLegacyDefault();

/** Remember the workspace for the next cold start. Best-effort: failing to
 *  write it must never break a switch the user asked for. */
function rememberWorkspace(name) {
  try {
    fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastWorkspace: name }, null, 2));
  } catch {
    /* read-only home, or a race with another client — not worth failing over */
  }
}

let currentWorkspace = initialWorkspace();
let WORKSPACE_DIR = path.join(WORKSPACE_ROOT, currentWorkspace);
/** AOE_DEBUG_TURNS=1 logs every turn end the roster reports. */
const DEBUG_TURNS = process.env.AOE_DEBUG_TURNS === "1";
const masterNameFor = (ws) => (ws === DEFAULT_WS ? "master" : `master@${ws}`);

/** What this client does that a bare terminal doesn't — appended to the system
 *  prompt of every session the app creates. Without it an agent that just
 *  wrote an html page starts a web server and points the user at localhost,
 *  which is the wrong answer in a window that previews the file itself. */
const CLIENT_PROMPT = `You are attached to AOE, a desktop client for this agent.

The client watches your working directory. Every .html, .md, .png and .pdf file you write there is rendered in its Preview pane, which opens itself beside the conversation when your turn ends and keeps every published version as a card, newest first. The user watches the work; they do not read a description of it.

1. Write inside your working directory. A file left elsewhere is invisible to the client unless you publish it by absolute path.
2. Align before building. For anything with a shape — a page, a layout, a document, a plan — the first turn writes four genuinely different takes as four files, publishes each, gives one line per take on what it trades away, and stops for the user to pick. That turn plans; it does not build. Skip the four only when the request already pins the shape down, and say in one line that you skipped them.
3. Write files as you go, so every turn end updates Preview. Never start a web server, and never send the user to a browser or a file manager — writing the file is what shows it.
4. Publish with a label that states the change as measured values: \`await preview.publish("poster.html", label="第 2 版 · 版心 980→680px,标题 34→56px(盲评 2:1 选新版,一眼可见)")\`. The card prints that label, so before→after numbers and the blind A/B result are how the user learns what this round decided. "配色更好" tells them nothing.
5. Open each turn with the decision, not the mechanics: what you chose, what it beats in the previous version, and the evidence — a score, a measurement, a count. The client shows that line between two versions, and shows no tool steps at all.
6. Before your first file write, read the \`aoe-way\` skill and work by it: the variant rules, the round contract — read the previous version and edit it rather than regenerate it, name three to five properties with before→after values, and verify the diff before publishing — the blind A/B review protocol, and what to report so the user can check you instead of trusting you.
7. Close each turn with what changed, what you would do next, and anything you added that was not asked for but is needed.`;

/** Skills the app itself ships (repo `skills/`, next to `electron/`). They are
 *  handed to each session on top of the runtime's own, so the method lives with
 *  the client and stays out of the user's agent home. */
const APP_SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "skills");

/** Session config for everything the app creates: the workspace as cwd, the
 *  client prompt, and the client's own skills. */
/** Where this workspace's version snapshots live — the same path
 *  createPreviewStore() writes to. Handed to the agent in its prompt: without
 *  it, an agent asked to compare its last two versions reconstructs them from
 *  memory and then blind-reviews the reconstruction, which is how a round of
 *  "iteration" ends up byte-identical to two rounds ago. */
const previewsRootFor = (cwd) =>
  path.join(os.homedir(), ".prime", "desktop", ".previews", path.basename(cwd));

const sessionConfig = (cwd) => ({
  cwd,
  appendSystemPrompt: [
    `${CLIENT_PROMPT}

Your published versions are on disk, kept by the client at \`${previewsRootFor(cwd)}\`: \`index.json\` lists every file's versions with their labels, and each version is a full copy beside it (\`<file>.v<N>.<ext>\`). Read those files when you need the previous version — to diff against it, to hand a real pair to a reviewer, or to go back to one. Never reconstruct an earlier version from memory: what you remember and what the user is looking at are not the same document.`,
  ],
  ...(fs.existsSync(APP_SKILLS_DIR) ? { skills: [APP_SKILLS_DIR] } : {}),
});

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
    autoRefine: r.data?.autoRefine ?? autoRefineSetting(),
  };
}

/** Same read-only pull for a watched root session (rootConns via watch_root).
 *  Roots are full sessions: goal/autonomous/autoRefine ride the connection
 *  state exactly like master's (schema 27). attached:false — not watched yet
 *  or the pull failed — tells the renderer to keep showing "loading". */
async function rootStatusPayload(name) {
  const empty = { attached: false, goal: null, autonomous: null, autoRefine: null };
  const entry = rootConns.get(name);
  if (!entry || !daemonClient) return empty;
  const r = await daemonClient
    .request({ type: "get_connection_state", activeSessionId: entry.activeSessionId })
    .catch(() => null);
  if (!r?.success) return empty;
  return {
    attached: true,
    goal: r.data?.goal ?? null,
    autonomous: r.data?.autonomous ?? null,
    autoRefine: r.data?.autoRefine ?? autoRefineSetting(),
  };
}

function learnedPayload(sessionUuid = masterUuid) {
  // Local harness lives under the session's artifact dir, keyed by session uuid
  // (state.sessionDir is the sessions root, not this session's artifacts).
  const local = sessionUuid
    ? readHarness(
        path.join(
          os.homedir(),
          ".prime",
          "agent",
          "session-artifacts",
          sessionUuid,
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

/** The auto-refine block the renderer's self-evolution switch binds to.
 *  A daemon that predates schema 27 reports nothing for it in its connection
 *  state, but the setting is a file this bridge already writes — read it back
 *  so the switch appears and tells the truth (core default: on) instead of
 *  being hidden on every older daemon. A session-reported block always wins. */
function autoRefineSetting() {
  const cur = readJsonFile(path.join(AGENT_HOME, "settings.json")) ?? {};
  const ar = cur.autoRefine && typeof cur.autoRefine === "object" ? cur.autoRefine : {};
  return {
    enabled: ar.enabled !== false,
    ...(typeof ar.turnInterval === "number" ? { turnInterval: ar.turnInterval } : {}),
    ...(typeof ar.cooldownMs === "number" ? { cooldownMs: ar.cooldownMs } : {}),
  };
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
  onUpdate: (changed) => broadcast({ type: "preview_update", changed }),
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

/** Turn end for `who`: scan the workspace, hand what changed to the preview
 *  store and name the writer in Files. The scan is the only sighting of a file
 *  the kernel wrote, so every attached agent's agent_end runs it — a root's
 *  build has to reach Preview the way master's does, not wait for master's
 *  next turn to notice it. */
function scanTurnEnd(who) {
  for (const rel of diffWorkspace()) {
    preview.touch(rel);
    broadcast({
      type: "file_activity",
      file: { path: rel, name: rel.split("/").pop(), at: new Date().toISOString(), who },
    });
  }
  preview.flush();
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
      // Some models pad tool-only turns with bare whitespace — not a message.
      const text = String(contentText(m.content) ?? "").trim();
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
 *  read-only in the Agents column. Served from the live roster cache when the
 *  daemon pushes roster_update; the list request is the older-daemon fallback. */
async function agentsPayload() {
  if (rosterLive) return { agents: rosterAgents() };
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

/* ---- live agent roster (capability agent_roster) ----
 * One roster_subscribe on the control connection replaces the renderer's 30s
 * /bridge/agents polling: the daemon pushes roster_update on every membership
 * or status change, and entries cover subagents too — so another root's
 * helpers ("agent team") render without attaching to anything. Master's own
 * helpers keep riding snapshot.children, which is richer (selectable ids,
 * terminal detail); its subagent roster rows resolve to no listed root and
 * drop out naturally. */
/** @type {Map<string, any>} */ const rosterEntries = new Map();
let rosterLive = false;
/** Non-null while a subscribe is in flight; buffers pushes racing the reply. */
/** @type {any[]|null} */ let rosterPending = null;
let rosterListening = false;
let rosterEmitScheduled = false;
/** A subscribe is in flight; a hello arriving now re-runs it once it lands. */
let rosterSubscribing = false;
let rosterResubscribe = false;

function displayName(s) {
  return s.sessionName || String(s.firstMessage ?? "").slice(0, 40) || "unnamed";
}

/** Thin renderer shape: roots with their kids joined by parent session id. */
function rosterAgents() {
  const roots = [];
  const byParentKey = new Map();
  for (const e of rosterEntries.values()) {
    const s = e.summary ?? {};
    if (s.runtimeKind === "subagent" || (s.rlmDepth ?? 0) !== 0) continue;
    if (String(s.sessionName ?? "").startsWith("master")) continue;
    const rec = { name: displayName(s), state: e.status ?? "inactive", kids: [] };
    roots.push(rec);
    if (s.sessionId) byParentKey.set(s.sessionId, rec);
    if (s.activeSessionId) byParentKey.set(s.activeSessionId, rec);
  }
  for (const e of rosterEntries.values()) {
    const s = e.summary ?? {};
    if (s.runtimeKind !== "subagent") continue;
    const parent = byParentKey.get(s.parentSessionId) ?? byParentKey.get(s.parentActiveSessionId);
    if (!parent) continue;
    parent.kids.push({
      name: displayName(s),
      state: e.status ?? "inactive",
      ...(e.statusLabel === "failed" ? { failed: true } : {}),
      // Live session id makes the row openable/messageable in the renderer;
      // passivated entries have none and stay read-only stubs.
      ...(s.activeSessionId ? { activeSessionId: s.activeSessionId } : {}),
    });
  }
  for (const r of roots) if (r.kids.length === 0) delete r.kids;
  return roots;
}

/** Coalesce a burst of roster pushes into one SSE frame. The daemon spreads
 *  one logical change over a few ticks, so a microtask isn't wide enough —
 *  a short timer folds them without adding visible latency. */
function broadcastRoster() {
  if (rosterEmitScheduled) return;
  rosterEmitScheduled = true;
  setTimeout(() => {
    rosterEmitScheduled = false;
    broadcast({ type: "roster", agents: rosterAgents() });
  }, 16);
}

function applyRosterUpdate(m) {
  // Status before this frame, kept across a resync (which clears the map, so
  // reading the old status off rosterEntries after the fact finds nothing).
  const was = new Map();
  for (const [id, e] of rosterEntries) was.set(id, e?.status);
  const ended = [];
  if (m.resync) rosterEntries.clear();
  for (const e of m.changed ?? []) {
    rosterEntries.set(e.agentId, e);
    if (was.get(e.agentId) === "running" && e.status !== "running") ended.push(e.summary ?? {});
  }
  for (const id of m.removed ?? []) {
    if (was.get(id) === "running") ended.push(rosterEntries.get(id)?.summary ?? {});
    rosterEntries.delete(id);
  }
  // The roster's running → not-running edge is the only turn end the bridge
  // sees for an agent nothing is attached to — and a background build is
  // exactly the one whose result the user did not watch happen. An attached
  // agent gets here too; its agent_end scan already ran, so this finds
  // nothing and stays silent.
  for (const s of ended) {
    const name = displayName(s);
    if (DEBUG_TURNS) console.log("[bridge] roster turn end:", name);
    scanTurnEnd(name.startsWith("master") ? "master" : name);
  }
}

async function subscribeRoster() {
  if (!daemonClient?.supportsServerCapability?.("agent_roster")) return;
  if (!rosterListening) {
    rosterListening = true;
    daemonClient.onMessage((m) => {
      if (m?.type === "roster_update") {
        if (rosterPending) rosterPending.push(m);
        else {
          applyRosterUpdate(m);
          broadcastRoster();
        }
      } else if (m?.type === "daemon_hello") {
        // Transport reconnected under us; the server-side subscription died
        // with the old connection. Resubscribe on the fresh one — also when
        // the last attempt never landed, or one failed subscribe would strand
        // the renderer on 30s polling for the rest of the session.
        rosterLive = false;
        subscribeRoster().catch(() => undefined);
      }
    });
  }
  // A hello can land mid-subscribe; queue that retry instead of re-entering
  // and clobbering the buffer this call is still filling.
  if (rosterSubscribing) {
    rosterResubscribe = true;
    return;
  }
  rosterSubscribing = true;
  try {
    do {
      rosterResubscribe = false;
      rosterPending = [];
      try {
        const r = await daemonClient.request({ type: "roster_subscribe" });
        if (r?.success) {
          rosterEntries.clear();
          for (const e of r.data?.roster ?? []) rosterEntries.set(e.agentId, e);
          for (const m of rosterPending) applyRosterUpdate(m);
          rosterLive = true;
          broadcastRoster();
        } // else: renderer polling stays as the fallback
      } catch (e) {
        console.error("[bridge] roster subscribe failed:", e?.message);
      } finally {
        rosterPending = null;
      }
    } while (rosterResubscribe);
  } finally {
    rosterSubscribing = false;
  }
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
  // Roster push is independent of the master attach; don't let either block
  // the other, and a subscribe failure only means polling stays.
  subscribeRoster().catch((e) => console.error("[bridge] roster subscribe failed:", e?.message));
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
      config: sessionConfig(WORKSPACE_DIR),
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
        scanTurnEnd("master");
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
  // The baseline above hides anything written while we were detached; the
  // preview store compares content, so let it catch up before the first turn.
  preview.reconcile();
  lastSnapshot = {
    type: "snapshot",
    state: {
      goal: snapshot.state?.goal ?? null,
      heartbeat: snapshot.state?.heartbeat ?? null,
      sessionDir: snapshot.state?.sessionDir ?? null,
      // schema 27 status blocks; null on older daemons (renderer omits).
      autonomous: snapshot.state?.autonomous ?? null,
      autoRefine: snapshot.state?.autoRefine ?? autoRefineSetting(),
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
  rememberWorkspace(name); // the app reopens where you left off
  WORKSPACE_DIR = path.join(WORKSPACE_ROOT, name);
  sessionDir = null;
  masterSessionId = null;
  daemon = { connected: false, master: null, error: null, workspace: name, capabilities: serverCaps };
  preview = createPreviewStore({
    workspaceDir: WORKSPACE_DIR,
    onUpdate: (changed) => broadcast({ type: "preview_update", changed }),
  });
  await attachMaster();
}

/** GET /bridge/model[?root=<name>] — the subject's current model plus the
 *  switchable catalog, filtered to providers that are actually configured
 *  (have credentials). The subject is master, or a root session by name:
 *  roots are full sessions and carry their own model, so each one answers for
 *  itself. An unwatched root has no connection here — empty catalog, and the
 *  renderer shows no picker rather than master's model under its name. */
async function modelPayload(rootName = null) {
  const entry = rootName ? rootConns.get(rootName) : null;
  // Two halves with different owners. What you may switch TO is the catalog
  // models.json and auth.json describe — one list for the whole daemon, so any
  // attached connection answers for it. What the subject is currently ON is
  // session state, and only that half needs the subject's own connection: a
  // root has one after watch_root, master always. Tying the catalog to the
  // root's connection as well made the picker race the attach and vanish for
  // every agent but master.
  const sessionId = rootName ? entry?.activeSessionId : masterSessionId;
  const conn = (rootName ? entry?.conn : masterConn) ?? masterConn;
  if (!daemonClient || !conn) return { current: null, models: [] };
  const slim = (m) => ({ id: m.id, name: m.name || m.id, provider: m.provider });
  const [stateR, catalog] = await Promise.all([
    sessionId
      ? daemonClient
          .request({ type: "get_connection_state", activeSessionId: sessionId })
          .catch(() => null)
      : null,
    conn.getModelCatalog().catch(() => null),
  ]);
  const current = stateR?.success && stateR.data?.model ? slim(stateR.data.model) : null;
  const configured = new Set(catalog?.configuredProviders ?? []);
  const models = (catalog?.models ?? [])
    .filter((m) => configured.has(m.provider))
    .map(slim)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { current, models };
}

async function workspacesPayload() {
  fs.mkdirSync(path.join(WORKSPACE_ROOT, DEFAULT_WS), { recursive: true });
  const dirs = fs
    .readdirSync(WORKSPACE_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort((a, b) => (a === DEFAULT_WS ? -1 : b === DEFAULT_WS ? 1 : a.localeCompare(b)));
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
    return { name: ws, pinned: ws === DEFAULT_WS, state };
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
        // First line of code as detail (ipython) — "python" alone says nothing.
        const raw = String(inner.toolName ?? "tool");
        const base = raw === "ipython" ? "python" : raw;
        const code = typeof inner.args?.code === "string" ? inner.args.code.trim().split("\n")[0].slice(0, 60) : "";
        broadcast({
          type: "helper_event",
          sessionId: target,
          event: {
            kind: "tool",
            id: String(inner.toolCallId ?? ""),
            name: code ? `${base} · ${code}` : base,
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
    config: sessionConfig(s.cwd || WORKSPACE_DIR),
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
  if (existing) {
    // A watch for a root we already hold means the page reloaded (its unwatch
    // never arrived). Re-attach so the fresh page gets its root_snapshot —
    // returning the old entry silently would leave it on "loading history…".
    await unwatchRoot(name);
  }
  if (!sdkRef) throw new Error("daemon not connected");
  const activeSessionId = await resolveRoot(name);
  const conn = await sdkRef.DaemonAgentConnection.attach(daemonClient, activeSessionId, {
    closeClientOnDispose: false,
    sendClientEnv: false,
    directTransport: false,
  });
  const entry = { conn, activeSessionId, uuid: null };
  rootConns.set(name, entry);
  // The connection-state blocks the Inspector binds to (goal / unattended /
  // auto-refine) ride each snapshot — same schema-27 fields as master's.
  const stateOf = (s) =>
    s
      ? {
          goal: s.goal ?? null,
          autonomous: s.autonomous ?? null,
          autoRefine: s.autoRefine ?? autoRefineSetting(),
        }
      : undefined;
  const resync = (messages, { partial = false, running, state } = {}) =>
    broadcast({
      type: "root_snapshot",
      root: name,
      messages: slimHistory(messages),
      partial,
      ...(running === undefined ? {} : { running }),
      ...(state ? { state } : {}),
    });
  conn.subscribe((event) => {
    if (event?.type === "session_event") {
      const inner = event.event;
      if (inner?.type === "agent_end") {
        // Same fs truth as master's turn end: a root writing an html file is a
        // work product, and Preview is where the user sees it.
        scanTurnEnd(name);
        preview.observe(inner);
        // agent_end carries the full message history — the renderer only needs the mark
        broadcast({ type: "root_event", root: name, event: { type: "agent_end" } });
        return;
      }
      if (inner?.type === "preview_published") preview.declare(inner.preview);
      preview.observe(inner);
      broadcast({ type: "root_event", root: name, event: inner });
    } else if (event?.type === "session_resynced") {
      // Canonical transcript after a mid-run attach; replace wholesale.
      resync(event.snapshot?.messages, {
        running: Boolean(event.snapshot?.state?.isStreaming),
        state: stateOf(event.snapshot?.state),
      });
    } else if (event?.type === "extension_ui_request") {
      const req = event.request;
      if (req?.method === "setWorkingMessage") {
        broadcast({ type: "root_working", root: name, text: req.payload?.message ?? "" });
      }
    }
  });
  const snapshot = await conn.getInitialSnapshot().catch(() => null);
  // Session uuid = the root's own harness dir under session-artifacts
  // (GET /bridge/learned?root=).
  entry.uuid = snapshot?.state?.sessionId ?? null;
  const running = Boolean(snapshot?.state?.isStreaming);
  const messages = snapshot?.messages ?? [];
  resync(messages, {
    partial: messages.length === 0 && running,
    running,
    state: stateOf(snapshot?.state),
  });
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

/** Global heartbeat rows flattened for the renderer, each stamped with the
 *  session it belongs to: subject "master" (this workspace's master) or a
 *  root session's name. Rows whose session identity is unknown carry no
 *  subject — the renderer shows them nowhere rather than guessing. */
async function heartbeatsPayload() {
  const entries = (await masterConn.listHeartbeats()) ?? [];
  // Fallback identity for jobs whose worker is down: session uuid → name.
  let nameByUuid = new Map();
  if (entries.some((e) => e?.job && !e.sessionName)) {
    const listed = await daemonClient.request({ type: "list", all: true }).catch(() => null);
    if (listed?.success) {
      nameByUuid = new Map(
        (listed.data.sessions || [])
          .filter((s) => s.sessionId && s.sessionName)
          .map((s) => [s.sessionId, s.sessionName]),
      );
    }
  }
  const masterName = masterNameFor(currentWorkspace);
  return entries.map((e) => {
    const job = e?.job ?? e;
    const sessionName = e?.sessionName ?? (job?.sessionId ? nameByUuid.get(job.sessionId) : undefined);
    const subject = sessionName === masterName ? "master" : sessionName;
    return { ...job, ...(subject ? { subject } : {}) };
  });
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
    case "set_model": {
      // Switch master's model at the runtime (persists into the session).
      const model = await masterConn.setModel(String(body.provider ?? ""), String(body.text ?? ""));
      return { model: { id: model.id, name: model.name || model.id, provider: model.provider } };
    }
    case "refine":
      return { result: await masterConn.refine({ instructions: refineInstructions(body.text) }) };
    case "refine_rollback":
      // Undo one lesson; recorded by the harness as a new refinement.
      return { result: await masterConn.refine({ rollbackId: String(body.target ?? "") }) };
    case "refine_global":
      // Runs a new global review — the kept lesson may differ from the local one.
      return {
        result: await masterConn.refine({
          global: true,
          instructions: refineInstructions(body.text ? String(body.text) : ""),
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
        config: sessionConfig(WORKSPACE_DIR),
        launchEnv: { ...process.env },
      });
      if (!r.success) throw new Error(r.error || "create failed");
      return { agent: { name } };
    }
    case "delete_agent": {
      // Removing a root agent for good. Two steps, because the daemon refuses
      // to delete a session that is still live: close the worker first (kill
      // is a clean close, not a crash), then drop the saved file so the roster
      // stops listing it. A master is the workspace itself — never deletable
      // from here; that is what the workspace menu is for.
      const name = String(body.text ?? "").trim();
      if (!name) throw new Error("no agent named");
      if (name.toLowerCase().startsWith("master")) throw new Error("master belongs to the workspace");
      const listed = await daemonClient.request({ type: "list", all: true });
      if (!listed.success) throw new Error(listed.error || "list failed");
      const s = (listed.data.sessions || []).find(
        (x) => x.sessionName === name && (x.rlmDepth ?? 0) === 0,
      );
      if (!s) throw new Error("no such agent");
      await unwatchRoot(name); // our own attach would keep the worker alive
      // Only a LIVE session can be killed, and only activeSessionId names one.
      // `id` is the saved session's uuid — passing it asks the daemon to kill
      // something it has never heard of, which is how an inactive agent ended
      // up undeletable instead of simply skipping the kill.
      if (s.activeSessionId) {
        const killed = await daemonClient.request({
          type: "kill",
          activeSessionId: s.activeSessionId,
        });
        if (!killed.success) throw new Error(killed.error || "could not stop the agent");
      }
      // No saved file means it only ever lived in memory — the kill was the
      // whole job, and asking to delete nothing would fail for no reason.
      if (s.sessionFile) {
        const gone = await daemonClient.request({
          type: "delete_saved_session",
          sessionPath: s.sessionFile,
        });
        if (!gone.success) throw new Error(gone.error || "delete failed");
      }
      return { deleted: name };
    }
    case "delete_workspace": {
      // A workspace IS its directory, so removing it from the list means
      // removing the folder and everything an agent wrote in it. Its resident
      // master goes too — leaving the session behind would put the workspace
      // back in the roster the next time anything listed it.
      const name = String(body.text ?? "").trim();
      if (!WS_NAME_RE.test(name)) throw new Error("invalid workspace name");
      // The default is recreated on demand, so deleting it only looks like it worked.
      if (name === DEFAULT_WS) throw new Error("the default workspace stays");
      if (name === currentWorkspace) throw new Error("open another workspace first");
      const listed = await daemonClient.request({ type: "list", all: true });
      if (!listed.success) throw new Error(listed.error || "list failed");
      const s = (listed.data.sessions || []).find(
        (x) => x.sessionName === masterNameFor(name) && (x.rlmDepth ?? 0) === 0,
      );
      if (s?.activeSessionId) {
        const killed = await daemonClient.request({
          type: "kill",
          activeSessionId: s.activeSessionId,
        });
        if (!killed.success) throw new Error(killed.error || "could not stop its master");
      }
      if (s?.sessionFile) {
        const gone = await daemonClient.request({
          type: "delete_saved_session",
          sessionPath: s.sessionFile,
        });
        if (!gone.success) throw new Error(gone.error || "delete failed");
      }
      // Resolve and fence the path: only ever a direct child of the root, so a
      // crafted name can never point rm at somewhere else.
      const dir = path.resolve(WORKSPACE_ROOT, name);
      if (path.dirname(dir) !== path.resolve(WORKSPACE_ROOT)) throw new Error("invalid workspace name");
      fs.rmSync(dir, { recursive: true, force: true });
      return { deleted: name };
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
    case "root_heartbeat_set": {
      // Check-ins are per session: set them through the root's own connection
      // (heartbeat_set is scoped to its activeSessionId; one user heartbeat
      // per session — a new one replaces the old, runtime rule).
      const { conn } = await ensureRootConn(String(body.target ?? ""));
      return {
        job: await conn.setHeartbeat(
          String(body.schedule ?? ""),
          String(body.text ?? ""),
          body.mode ? String(body.mode) : undefined,
        ),
      };
    }
    case "root_heartbeat_update": {
      // action "pause" | "resume" | "clear" — the root's own heartbeat only
      const { conn } = await ensureRootConn(String(body.target ?? ""));
      return { job: (await conn.updateHeartbeat(String(body.action ?? ""))) ?? null };
    }
    case "root_set_model": {
      // A root is a full session with its own model — same runtime call as
      // master's set_model, aimed at that session's connection. (The runtime
      // also writes the switched-to model as the default for sessions created
      // afterwards; that is its own behaviour, not something done here.)
      const { conn } = await ensureRootConn(String(body.target ?? ""));
      const model = await conn.setModel(String(body.provider ?? ""), String(body.text ?? ""));
      return { model: { id: model.id, name: model.name || model.id, provider: model.provider } };
    }
    case "root_refine": {
      // Learn-now for another root: a real /refine on the root's own session
      // and harness (no focus text = just the house style). Mirrors master's
      // "refine" op; can take minutes (the SDK allows 10).
      const { conn } = await ensureRootConn(String(body.target ?? ""));
      return { result: await conn.refine({ instructions: refineInstructions(body.text ? String(body.text) : "") }) };
    }
    case "set_auto_refine": {
      // The auto-refine switch is a GLOBAL setting: settings.json autoRefine
      // (core settings-manager getAutoRefineSettings; enabled defaults true).
      // Sessions cache settings at start — the daemon's `reload` command is
      // the real pickup path (session.reload → settingsManager.reload), so
      // after the write every live root worker is reloaded (helpers never
      // auto-refine: the session gates on rlmDepth 0).
      if (!daemonClient) throw new Error("daemon not connected");
      const enabled = Boolean(body.enabled);
      const file = path.join(AGENT_HOME, "settings.json");
      const cur = readJsonFile(file) ?? {};
      cur.autoRefine = {
        ...(cur.autoRefine && typeof cur.autoRefine === "object" ? cur.autoRefine : {}),
        enabled,
      };
      fs.mkdirSync(AGENT_HOME, { recursive: true });
      // Atomic replace, like the core's own settings writes.
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(cur, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(tmp, file);
      let reloaded = 0;
      let live = 0;
      const listed = await daemonClient.request({ type: "list", all: true }).catch(() => null);
      const sessions = listed?.success ? listed.data.sessions || [] : [];
      for (const s of sessions) {
        if ((s.rlmDepth ?? 0) !== 0 || !s.activeSessionId) continue;
        live++;
        const r = await daemonClient
          .request({ type: "reload", activeSessionId: s.activeSessionId })
          .catch(() => null);
        if (r?.success) reloaded++;
      }
      // Read back from master's connection state — session truth, not the file.
      const { autoRefine } = await statusPayload().catch(() => ({ autoRefine: null }));
      return { enabled: autoRefine?.enabled ?? enabled, reloaded, live };
    }
    case "root_refine_rollback": {
      // Undo one of a root's own lessons through the root's own connection
      // (its harness, not master's); recorded there as a new refinement.
      const { conn } = await ensureRootConn(String(body.target ?? ""));
      return { result: await conn.refine({ rollbackId: String(body.id ?? "") }) };
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

/** POST /bridge/claude — one agent turn through the locally installed official
 *  `claude` CLI. The child inherits process.env so the user's own login is
 *  used; no credential is ever read or forwarded here. `claude -p` is a full
 *  agent runner, so master gets real tool use in the workspace directory.
 *  Streams SSE frames: {type:"delta",text} per chunk, {type:"tool",name,detail}
 *  when a tool runs, {type:"subagent",id,label,status} for Task subagent
 *  lifecycles, then {type:"done",sessionId}, or {type:"error",message}. */
function handleClaude(body, req, res, cors) {
  const text = String(body.text ?? "");
  const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : null;
  const system = typeof body.system === "string" && body.system ? body.system : null;
  // The composer's Claude pick. Shape-checked before it reaches argv: only a
  // model name, never a flag or a path. An unusable value is dropped and the
  // CLI keeps its own configured default.
  const model =
    typeof body.model === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(body.model)
      ? body.model
      : null;

  res.writeHead(200, {
    ...cors,
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const emit = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  const args = ["-p", text, "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
  // Master is the user's local workspace agent: edits auto-accepted, commands
  // and web lookups allowed — deliberately, that is its job. cwd bounds it to
  // the workspace directory below.
  args.push("--permission-mode", "acceptEdits", "--allowedTools", "Bash,WebSearch,WebFetch");
  // WORKSPACE_DIR is mutable (workspace switch) — read it per request.
  const cwd = fs.existsSync(WORKSPACE_DIR) ? WORKSPACE_DIR : os.homedir();
  // The workspace folder is the boundary: cwd pins the CLI there, its own
  // permission model auto-denies file access outside the working directory in
  // -p mode, and the system prompt states the boundary outright.
  const bounded = `${system ? `${system} ` : ""}Your workspace is ${cwd}. Work only inside this folder; never read or modify anything outside it.`;
  args.push("--append-system-prompt", bounded);
  if (model) args.push("--model", model);
  if (sessionId) args.push("--resume", sessionId);
  const child = spawn("claude", args, { cwd, env: process.env });

  let stdoutBuf = "";
  let stderrTail = "";
  let sawDelta = false;
  let ended = false;
  /** Running Task subagents by tool_use id — they get lifecycle frames so the
   *  renderer can show a read-only card while they run. */
  const subagents = new Map();
  const end = (payload) => {
    if (ended) return;
    ended = true;
    emit(payload);
    res.end();
  };

  const handleLine = (line) => {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return; // not NDJSON — ignore
    }
    if (
      obj.type === "stream_event" &&
      obj.event?.type === "content_block_delta" &&
      obj.event?.delta?.type === "text_delta"
    ) {
      // A subagent's own prose must not leak into master's bubble.
      if (obj.parent_tool_use_id) return;
      sawDelta = true;
      emit({ type: "delta", text: obj.event.delta.text });
      return;
    }
    if (obj.type === "assistant") {
      // Tool calls ride complete assistant messages; text already streamed as
      // deltas above. detail = the human-readable heart of the input.
      const content = obj.message?.content;
      for (const b of Array.isArray(content) ? content : []) {
        if (b?.type !== "tool_use") continue;
        const i = b.input ?? {};
        const detail = String(
          i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.query ?? i.url ?? i.description ?? "",
        ).slice(0, 80);
        emit({ type: "tool", name: b.name, detail });
        // Master's own Task launches become subagent cards; nested ones don't.
        if (!obj.parent_tool_use_id && (b.name === "Task" || b.name === "Agent") && b.id) {
          subagents.set(b.id, detail || b.name);
          emit({ type: "subagent", id: b.id, label: detail || b.name, status: "running" });
        }
      }
      return;
    }
    if (obj.type === "user") {
      // A tool_result answering a tracked Task id means that subagent is done.
      const content = obj.message?.content;
      for (const b of Array.isArray(content) ? content : []) {
        if (b?.type === "tool_result" && subagents.has(b.tool_use_id)) {
          emit({ type: "subagent", id: b.tool_use_id, label: subagents.get(b.tool_use_id), status: "done" });
          subagents.delete(b.tool_use_id);
        }
      }
      return;
    }
    if (obj.type === "result") {
      for (const [sid, label] of subagents) {
        emit({ type: "subagent", id: sid, label, status: "done" });
      }
      subagents.clear();
      // Fallback for CLIs without partial messages: the final text only rides
      // the result. When deltas already streamed, forwarding it would double-emit.
      if (!sawDelta && typeof obj.result === "string" && obj.result) {
        emit({ type: "delta", text: obj.result });
      }
      end({ type: "done", sessionId: obj.session_id ?? null });
      child.kill("SIGTERM"); // in case it lingers after the result
    }
    // Everything else (system/init, assistant, user, other stream_events) is
    // ignored — assistant message text already arrived as text_delta frames.
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk;
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop(); // keep the trailing partial line
    for (const line of lines) if (line.trim()) handleLine(line);
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrTail = (stderrTail + chunk).slice(-2000);
  });
  child.on("error", (e) => {
    end({ type: "error", message: `claude spawn failed: ${e?.message || e}` });
  });
  child.on("close", (code) => {
    if (stdoutBuf.trim()) handleLine(stdoutBuf); // flush a final unterminated line
    if (ended) return;
    end({
      type: "error",
      message: `claude exited with code ${code}${stderrTail ? `: ${stderrTail.trim()}` : ""}`,
    });
  });
  // Client gone (tab closed, abort): stop paying for the run.
  res.on("close", () => {
    ended = true;
    child.kill("SIGTERM");
  });
}

/* ── NIM traffic funnels through here ──────────────────────────────────────
 *
 *  NVIDIA publishes no way to read your own budget: verified 2026-09-03, a NIM
 *  response carries no `X-RateLimit-*` header on 200 OR on 429 (the 429 body is
 *  the whole story — `{"status":429,"title":"Too Many Requests"}`), and
 *  /v1/usage, /v1/limits, /v1/account and /v1/credits are all 404. So the only
 *  honest readout is one we count ourselves, and counting only works if every
 *  request passes one point. That is what this is: the daemon reaches NIM
 *  through `baseUrl` in ~/.prime/agent/models.json and the renderer through the
 *  Vite (dev) or Electron main (packaged) proxy — both now aimed at /nim here
 *  rather than at api.nvidia.com, so one counter sees all of it.
 *
 *  The ceiling is a constant because NVIDIA will not tell us: the free tier is
 *  ~40 requests/minute per key, shared across every model. Measured on this key
 *  the same day: 25 back-to-back requests (~19 RPM) all passed, while 20 at once
 *  took 13 × 429 — concurrency runs out well before the minute does, at about 5
 *  in flight. `inflight` is reported for that reason; a fan-out of helpers trips
 *  it long before `used` looks alarming. */
const NIM_UPSTREAM = "https://integrate.api.nvidia.com";
const NIM_LIMIT = Number(process.env.NIM_RPM || 40);
const NIM_WINDOW_MS = 60_000;
/** Start times of the requests forwarded in the trailing window. */
const nimHits = [];
let nimInflight = 0;
let nimThrottledAt = 0;

/** Only used for a request that arrives without one of its own — the daemon
 *  and the Vite proxy both send their own Authorization, and the renderer must
 *  never hold a key at all. auth.json is where the runtime already keeps it. */
function nimKey() {
  if (process.env.NIM_API_KEY) return process.env.NIM_API_KEY;
  const auth = readJsonFile(path.join(AGENT_HOME, "auth.json"));
  return auth?.["nvidia-nim"]?.key || "";
}

function nimUsage() {
  const now = Date.now();
  while (nimHits.length && now - nimHits[0] > NIM_WINDOW_MS) nimHits.shift();
  return {
    used: nimHits.length,
    limit: NIM_LIMIT,
    inflight: nimInflight,
    // How long until the oldest request ages out and a slot comes back.
    resetInMs: nimHits.length ? NIM_WINDOW_MS - (now - nimHits[0]) : 0,
    // null unless a 429 came back recently — what makes the readout go red.
    throttledMsAgo: nimThrottledAt ? now - nimThrottledAt : null,
  };
}

/** Forward /nim/<path> to NIM, counting it. Streams straight through, so an
 *  SSE completion is untouched. */
function handleNim(req, res, cors) {
  const now = Date.now();
  while (nimHits.length && now - nimHits[0] > NIM_WINDOW_MS) nimHits.shift();
  nimHits.push(now);
  nimInflight++;
  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    nimInflight--;
  };
  const up = https.request(
    NIM_UPSTREAM + req.url.slice("/nim".length),
    {
      method: req.method,
      headers: {
        "content-type": req.headers["content-type"] || "application/json",
        accept: req.headers.accept || "*/*",
        authorization: req.headers.authorization || `Bearer ${nimKey()}`,
      },
    },
    (upRes) => {
      if (upRes.statusCode === 429) nimThrottledAt = Date.now();
      res.writeHead(upRes.statusCode || 502, { ...upRes.headers, ...cors });
      upRes.pipe(res);
      upRes.on("end", done);
      upRes.on("close", done);
    },
  );
  up.on("error", (e) => {
    done();
    if (res.headersSent) return res.end();
    res.writeHead(502, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ error: `bridge: NIM unreachable (${e?.message || e})` }));
  });
  // Client hung up mid-stream: stop paying for the rest of it.
  res.on("close", () => {
    done();
    up.destroy();
  });
  req.pipe(up);
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
  if (req.url && req.url.split("?")[0] === "/bridge/learned") {
    // autoRefine rides along; null on old daemons. ?root=<name> scopes the
    // local harness to that root session: a watched root's uuid is captured at
    // attach; an unwatched one is resolved read-only from the daemon list, so
    // the ⚡ column sees every roster root's lessons without attaching.
    const rootName = new URL(req.url, "http://localhost").searchParams.get("root");
    (async () => {
      let uuid = rootName ? rootConns.get(rootName)?.uuid ?? null : masterUuid;
      if (rootName && !uuid && daemonClient) {
        const listed = await daemonClient.request({ type: "list", all: true }).catch(() => null);
        const s = listed?.success
          ? (listed.data.sessions || []).find(
              (x) => (x.rlmDepth ?? 0) === 0 && x.sessionName === rootName,
            )
          : null;
        uuid = s?.sessionId ?? null;
      }
      const { autoRefine } = await (rootName ? rootStatusPayload(rootName) : statusPayload()).catch(
        () => ({ autoRefine: null }),
      );
      res.writeHead(200, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ ...learnedPayload(uuid), autoRefine }));
    })().catch(() => {
      res.writeHead(200, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ local: null, global: null, autoRefine: null }));
    });
    return;
  }
  if (req.url && req.url.split("?")[0] === "/bridge/root-status") {
    const name = new URL(req.url, "http://localhost").searchParams.get("name") ?? "";
    rootStatusPayload(name)
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
  if (req.url && req.url.split("?")[0] === "/bridge/model") {
    modelPayload(new URL(req.url, "http://localhost").searchParams.get("root"))
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
  if (req.url === "/bridge/nim") {
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    return res.end(JSON.stringify(nimUsage()));
  }
  if (req.url && req.url.startsWith("/nim/")) {
    return handleNim(req, res, cors);
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
    // The daemon's heartbeat catalog is global; each entry carries the live
    // session's name ({ job, sessionName? }). Flatten to job rows stamped
    // with a `subject` — "master" for this workspace's master, else the root
    // session's name — so the Inspector can bind rows to the selected agent.
    // A session whose worker is down has no live name; fall back to mapping
    // the job's session uuid through the roster.
    heartbeatsPayload()
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
    if (rosterLive) {
      res.write(`data: ${JSON.stringify({ type: "roster", agents: rosterAgents() })}\n\n`);
    }
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }
  if (req.url === "/bridge/claude" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        handleClaude(JSON.parse(raw || "{}"), req, res, cors);
      } catch (e) {
        res.writeHead(400, { ...cors, "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }));
      }
    });
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
