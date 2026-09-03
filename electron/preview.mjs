/**
 * Preview pipeline (client-inferred v1, HANDOFF §6.4).
 *
 * Watches for previewable files (html/md/png/pdf) the master writes inside the
 * current workspace, inferred from edit/write tool events the bridge forwards.
 * When a turn ends (agent_end) and a touched file's content actually changed,
 * a version snapshot is copied to ~/.prime/desktop/.previews/<workspace>/ and
 * recorded in an index.json next to the snapshots.
 *
 * The bridge owns transport; this module owns state:
 *   observe(sessionEvent)  feed tool_execution_* and agent_end events
 *   list()                 -> [{ path, name, live, versions: [{label, at}] }]
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
  /** { files: { "<rel path>": { versions: [{v, at, hash, file}] } } } */
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
      const hash = crypto.createHash("sha1").update(buf).digest("hex");
      const entry = (index.files[rel] ??= { versions: [] });
      const last = entry.versions[entry.versions.length - 1];
      if (last && last.hash === hash) continue;
      const v = (last?.v ?? 0) + 1;
      const file = `${rel.replace(/[\\/]/g, "__")}.v${v}${path.extname(rel)}`;
      try {
        fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(path.join(root, file), buf);
      } catch {
        continue;
      }
      entry.versions.push({ v, at: new Date().toISOString(), hash, file });
      changed = true;
    }
    if (changed) saveIndex();
    return changed;
  }

  function list() {
    const files = Object.entries(index.files).map(([rel, entry]) => ({
      path: rel,
      name: path.basename(rel),
      live: touched.has(rel),
      versions: entry.versions.map((s) => ({ label: `v${s.v}`, at: s.at })),
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

  /** v: "v3" / "3" for a snapshot, "" or "live" for the current file content. */
  function read(p, v) {
    const rel = toRel(p);
    if (!rel) throw new Error("not a previewable workspace file");
    const contentType = CONTENT_TYPES[path.extname(rel).toLowerCase()] ?? "application/octet-stream";
    if (!v || v === "live") {
      return { buffer: fs.readFileSync(path.join(workspaceDir, rel)), contentType };
    }
    const n = Number(String(v).replace(/^v/, ""));
    const snap = index.files[rel]?.versions.find((s) => s.v === n);
    if (!snap) throw new Error(`no version ${v} for ${rel}`);
    return { buffer: fs.readFileSync(path.join(root, snap.file)), contentType };
  }

  return { observe, list, read };
}
