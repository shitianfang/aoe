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
 * The bridge owns transport; this module owns state:
 *   observe(sessionEvent)  feed tool_execution_* and agent_end events
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
      const changed = snapshotTouched();
      touched.clear();
      if (changed && typeof onUpdate === "function") onUpdate();
    }
  }

  /** Add one version snapshot for `key` unless the content already matches the
   *  last version (the path+hash dedupe both sources share). */
  function snapshotKey(key, buf, { declared = false, label, at } = {}) {
    const hash = crypto.createHash("sha1").update(buf).digest("hex");
    const entry = (index.files[key] ??= { versions: [] });
    if (declared) entry.declared = true;
    if (label) entry.label = String(label);
    const last = entry.versions[entry.versions.length - 1];
    if (last && last.hash === hash) {
      // Same content re-declared: keep one version, tag it declared.
      if (declared && !last.declared) {
        last.declared = true;
        saveIndex();
        return true;
      }
      return false;
    }
    const v = (last?.v ?? 0) + 1;
    const file = `${key.replace(/[\\/]/g, "__")}.v${v}${path.extname(key)}`;
    try {
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, file), buf);
    } catch {
      return false;
    }
    entry.versions.push({
      v,
      at: at || new Date().toISOString(),
      hash,
      file,
      ...(declared ? { declared: true } : {}),
    });
    saveIndex();
    return true;
  }

  /** Snapshot every touched file whose content differs from its last version. */
  function snapshotTouched() {
    let changed = false;
    for (const rel of touched) {
      let buf;
      try {
        buf = fs.readFileSync(path.join(workspaceDir, rel));
      } catch {
        continue; // deleted or unreadable — nothing to snapshot
      }
      if (snapshotKey(rel, buf)) changed = true;
    }
    return changed;
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
    if (changed && typeof onUpdate === "function") onUpdate();
    return changed;
  }

  function list() {
    const files = Object.entries(index.files).map(([rel, entry]) => ({
      path: rel,
      name: path.basename(rel),
      live: touched.has(rel),
      ...(entry.declared ? { declared: true } : {}),
      ...(entry.label ? { label: entry.label } : {}),
      versions: entry.versions.map((s) => ({
        label: `v${s.v}`,
        at: s.at,
        ...(s.declared ? { declared: true } : {}),
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

  return { observe, touch, declare, list, read };
}
