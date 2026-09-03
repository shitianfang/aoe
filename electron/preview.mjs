/**
 * Preview pipeline (client-inferred v1 + declared previews, HANDOFF §6.4).
 *
 * Two sources feed one index:
 *  - inferred: previewable files (html/md/png/pdf) the master writes inside the
 *    current workspace, from edit/write tool events and the bridge's fs scan;
 *    snapshots are taken at agent_end when content actually changed.
 *  - declared: `preview_published` session events (daemon capability
 *    `preview_events`) — the agent explicitly published a work product;
 *    snapshots are taken immediately and tagged `declared`, with the label.
 *
 * Both sources resolve to the same workspace-relative key, and a snapshot is
 * only added when the content hash differs from the last version — so a file
 * that is declared and then also seen by the agent_end scan in the same turn
 * yields exactly one version (dedupe by resolved path + content hash).
 * A declared file outside the workspace keeps its absolute path as the key.
 *
 * Version snapshots are copied to ~/.prime/desktop/.previews/<workspace>/ and
 * recorded in an index.json next to the snapshots.
 *
 * `onUpdate(changedKeys)` fires whenever a snapshot was added — the keys are
 * what the client auto-opens Preview on, so it must be the real change set and
 * never fire on a turn that wrote nothing.
 *
 * The bridge owns transport; this module owns state:
 *   observe(sessionEvent)  feed tool_execution_* and agent_end events
 *   flush()                snapshot what is pending, outside an agent_end
 *   declare(preview)       feed a preview_published event's `preview` payload
 *   list()                 -> [{ path, name, live, declared?, label?, versions }]
 *   read(path, v)          -> { buffer, contentType } for one version ("" = live)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const PREVIEWABLE = /\.(html?|md|png|pdf)$/i;
const WRITE_TOOLS = new Set(["edit", "write"]);
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".pdf": "application/pdf",
};

export function createPreviewStore({ workspaceDir, snapshotsRoot, onUpdate }) {
  const root =
    snapshotsRoot ||
    path.join(os.homedir(), ".prime", "desktop", ".previews", path.basename(workspaceDir));
  const indexFile = path.join(root, "index.json");
  /** { files: { "<rel path or declared abs path>":
   *      { declared?, label?, versions: [{v, at, hash, file, declared?}] } } } */
  let index = loadIndex();
  /** Workspace-relative paths written by tools since the last agent_end. */
  const touched = new Set();
  /** Keys that gained a version in the most recent flush — what `live` means
   *  once the turn has ended and `touched` is empty again. */
  let lastFlush = new Set();

  function loadIndex() {
    try {
      const parsed = JSON.parse(fs.readFileSync(indexFile, "utf8"));
      if (parsed && typeof parsed === "object" && parsed.files) return parsed;
    } catch {
      /* first run or unreadable index */
    }
    return { files: {} };
  }

  function saveIndex() {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
  }

  /** Resolve a tool-arg path to a workspace-relative previewable path, else null. */
  function toRel(p) {
    if (typeof p !== "string" || p.length === 0) return null;
    const rel = path.relative(workspaceDir, path.resolve(workspaceDir, p));
    if (rel.length === 0 || rel.startsWith("..") || path.isAbsolute(rel)) return null;
    return PREVIEWABLE.test(rel) ? rel : null;
  }

  /** Mark a (possibly relative) path as changed this turn; used by the
   *  bridge's fs scan — real writes happen inside the python kernel and never
   *  surface as edit/write tool events. */
  function touch(p) {
    const rel = toRel(p);
    if (rel) touched.add(rel);
  }

  function observe(event) {
    if (!event || typeof event !== "object") return;
    if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
      if (!WRITE_TOOLS.has(String(event.toolName ?? "").toLowerCase())) return;
      const args = event.args && typeof event.args === "object" ? event.args : null;
      const rel = toRel(args?.path ?? args?.file_path);
      if (rel) touched.add(rel);
    } else if (event.type === "agent_end") {
      flush();
    }
  }

  /** Take the pending snapshots now. A turn end is the usual trigger, but the
   *  bridge also calls this for an agent nothing is attached to, where the
   *  roster's running → idle edge is the only turn end it ever sees. */
  function flush() {
    const { changed, same } = snapshotTouched();
    touched.clear();
    lastFlush = new Set(changed);
    // A same-bytes round notifies too, with an empty `changed`: the client
    // re-pulls so the card can say the round moved nothing, but Preview only
    // opens itself for a real change.
    if ((changed.length > 0 || same.length > 0) && typeof onUpdate === "function") onUpdate(changed);
    return changed;
  }

  /** Changed-line count against the previous snapshot: the only "what moved"
   *  an inferred version can carry, and enough to tell a real round from a
   *  cosmetic one. Text only; binary versions get nothing. */
  function lineDelta(prev, buf) {
    if (!prev) return null;
    let before;
    try {
      before = fs.readFileSync(path.join(root, prev.file));
    } catch {
      return null;
    }
    if (before.includes(0) || buf.includes(0)) return null;
    const a = before.toString("utf8").split("\n");
    const b = buf.toString("utf8").split("\n");
    const counts = new Map();
    for (const l of a) counts.set(l, (counts.get(l) ?? 0) + 1);
    let add = 0;
    for (const l of b) {
      const n = counts.get(l) ?? 0;
      if (n > 0) counts.set(l, n - 1);
      else add += 1;
    }
    let del = 0;
    for (const n of counts.values()) del += n;
    return { add, del };
  }

  /** Add one version snapshot for `key` unless the content already matches the
   *  last version (the path+hash dedupe both sources share). */
  function snapshotKey(key, buf, { declared = false, label, at, quiet = false } = {}) {
    const hash = crypto.createHash("sha1").update(buf).digest("hex");
    const entry = (index.files[key] ??= { versions: [] });
    if (declared) entry.declared = true;
    if (label) entry.label = String(label);
    const last = entry.versions[entry.versions.length - 1];
    if (last && last.hash === hash) {
      // A catch-up pass is not a round: an app restart over an unchanged file
      // must not be counted as an iteration that moved nothing.
      if (quiet) return false;
      // A round that produced the same bytes is a fact about the run, not a
      // non-event: dropping it is what makes "it iterated and nothing changed"
      // look like the client hiding turns. Count it on the version it
      // re-affirms, and keep what that round CLAIMED apart from the label this
      // version was actually made with — overwriting `note` would put a
      // no-op's account on an earlier round's work.
      last.same = (last.same ?? 0) + 1;
      if (declared) {
        last.declared = true;
        if (label) last.saidAgain = String(label);
      }
      saveIndex();
      return "same";
    }
    const v = (last?.v ?? 0) + 1;
    const file = `${key.replace(/[\\/]/g, "__")}.v${v}${path.extname(key)}`;
    try {
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, file), buf);
    } catch {
      return false;
    }
    const delta = lineDelta(last, buf);
    entry.versions.push({
      v,
      at: at || new Date().toISOString(),
      hash,
      file,
      ...(delta ? { add: delta.add, del: delta.del } : {}),
      ...(declared ? { declared: true } : {}),
      // The label belongs to this version, not just to the file: it is the
      // agent's account of what this round changed, and the client shows it
      // on the card. entry.label stays the latest, for the file heading.
      ...(label ? { note: String(label) } : {}),
    });
    saveIndex();
    return true;
  }

  /** Snapshot every touched file whose content differs from its last version;
   *  returns the keys that actually gained one. */
  function snapshotTouched() {
    const changed = [];
    const same = [];
    for (const rel of touched) {
      let buf;
      try {
        buf = fs.readFileSync(path.join(workspaceDir, rel));
      } catch {
        continue; // deleted or unreadable — nothing to snapshot
      }
      const r = snapshotKey(rel, buf);
      if (r === true) changed.push(rel);
      else if (r === "same") same.push(rel);
    }
    return { changed, same };
  }

  /** Declared preview from a preview_published session event ({source, kind,
   *  path?, label?, timestamp?}). File kinds snapshot immediately — the agent
   *  said "this is done", no need to wait for agent_end. URL kinds carry no
   *  file content; the renderer notes them from the event itself. */
  function declare(p) {
    if (!p || typeof p !== "object" || p.kind !== "file") return false;
    const abs = typeof p.path === "string" && p.path.length > 0 ? p.path : null;
    if (!abs) return false;
    // Same key the inferred scan uses when the file is inside the workspace,
    // so both sources merge into one entry; outside files keep the abs path.
    const rel = (() => {
      const r = path.relative(workspaceDir, path.resolve(workspaceDir, abs));
      return r.length > 0 && !r.startsWith("..") && !path.isAbsolute(r) ? r : null;
    })();
    const key = rel ?? abs;
    let buf;
    try {
      buf = fs.readFileSync(rel ? path.join(workspaceDir, rel) : abs);
    } catch {
      return false; // declared but unreadable — nothing to snapshot
    }
    const changed = snapshotKey(key, buf, { declared: true, label: p.label, at: p.timestamp });
    if (changed === true) lastFlush = new Set([key]);
    // Same bytes as the last version: still worth a re-pull (the card now says
    // the round changed nothing), but nothing to open Preview for.
    if (changed && typeof onUpdate === "function") onUpdate(changed === true ? [key] : []);
    return changed !== false;
  }

  function list() {
    const files = Object.entries(index.files).map(([rel, entry]) => ({
      path: rel,
      name: path.basename(rel),
      live: touched.has(rel) || lastFlush.has(rel),
      ...(entry.declared ? { declared: true } : {}),
      ...(entry.label ? { label: entry.label } : {}),
      versions: entry.versions.map((s) => ({
        label: `v${s.v}`,
        at: s.at,
        ...(s.declared ? { declared: true } : {}),
        ...(s.note ? { note: s.note } : {}),
        ...(s.saidAgain ? { saidAgain: s.saidAgain } : {}),
        ...(s.same ? { same: s.same } : {}),
        ...(s.add !== undefined ? { add: s.add, del: s.del } : {}),
      })),
    }));
    for (const rel of touched) {
      if (!index.files[rel]) {
        files.push({ path: rel, name: path.basename(rel), live: true, versions: [] });
      }
    }
    // Most recently changed first.
    const latest = (f) => (f.live ? Infinity : Date.parse(f.versions[f.versions.length - 1]?.at ?? 0) || 0);
    files.sort((a, b) => latest(b) - latest(a));
    return files;
  }

  /** v: "v3" / "3" for a snapshot, "" or "live" for the current file content.
   *  Keys already in the index (incl. declared absolute paths) are served
   *  as-is; anything else must resolve to a previewable workspace file. */
  function read(p, v) {
    const key = index.files[p] ? p : toRel(p);
    if (!key) throw new Error("not a previewable workspace file");
    const contentType = CONTENT_TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream";
    if (!v || v === "live") {
      const live = path.isAbsolute(key) ? key : path.join(workspaceDir, key);
      return { buffer: fs.readFileSync(live), contentType };
    }
    const n = Number(String(v).replace(/^v/, ""));
    const snap = index.files[key]?.versions.find((s) => s.v === n);
    if (!snap) throw new Error(`no version ${v} for ${key}`);
    return { buffer: fs.readFileSync(path.join(root, snap.file)), contentType };
  }

  /** Re-check every file already in the index against its live bytes. The
   *  bridge rebuilds its mtime baseline at attach, so a change made while the
   *  app was closed — or while another workspace was open — is already baked
   *  into that baseline and no turn-end scan will ever report it. This store
   *  compares content, so it can still see it. Silent by design. */
  function reconcile() {
    for (const key of Object.keys(index.files)) {
      const live = path.isAbsolute(key) ? key : path.join(workspaceDir, key);
      try {
        snapshotKey(key, fs.readFileSync(live), { quiet: true });
      } catch {
        /* moved or deleted since its last version — keep the history */
      }
    }
  }

  return { observe, touch, flush, declare, list, read, reconcile };
}
