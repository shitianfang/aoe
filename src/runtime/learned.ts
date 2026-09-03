import { bridgeUrl } from "./bridge";

/** One kept lesson (a harness refinement), merged across owners:
 *  master's own, each roster root's own, and the shared everywhere scope. */
export interface LessonRecord {
  id: string;
  /** Owning agent for a local lesson ("master" or a root name); null when the
   *  lesson is kept everywhere (global harness). */
  owner: string | null;
  /** The lesson's own one-line summary (harness `trigger`). */
  trigger?: string;
  /** Refiner-emitted short display title; absent on lessons kept before it existed. */
  title?: string;
  /** Machine origin (schema 27): "auto" | "manual" | "agent"; absent on older rows. */
  source?: string;
  changes?: string[];
  evidence?: string;
  outcome?: string;
  created_at?: string;
}

/** One thing the agent now knows: a persisted harness artifact. This is the
 *  state the lessons above are edits TO — the memory's own text, the prompt
 *  note's own text. The bridge has always shipped it inside the same payload;
 *  it just had nowhere to go in the UI. */
export interface HarnessEntry {
  id: string;
  kind: EntryKind;
  /** Owning agent, or null for the everywhere scope — same rule as a lesson. */
  owner: string | null;
  title?: string;
  /** The artifact itself. The answer to "what did it actually learn". */
  content?: string;
  /** Free grouping path the refiner picks ("e2e", "review/style", …). */
  path?: string;
  /** "refine" when a refinement wrote it. */
  source?: string;
  created_at?: string;
  updated_at?: string;
  /** Bumped on every update — 1 means it has never been revised. */
  version?: number;
}

export type EntryKind = "prompt" | "memory" | "skill" | "subagent";
/** Fixed order, everywhere: legend, bar, groups. Never sorted by count — a
 *  composition that reorders itself cannot be compared to yesterday's. */
export const ENTRY_KINDS: EntryKind[] = ["memory", "prompt", "skill", "subagent"];

interface HarnessState {
  refinements?: Array<Omit<LessonRecord, "owner">>;
  /** kind → id → entry, exactly as the harness file stores it. */
  entries?: Partial<Record<EntryKind, Record<string, Omit<HarnessEntry, "owner">>>>;
}
interface LearnedPayload {
  local?: HarnessState | null;
  global?: HarnessState | null;
}

/** Everything one pull found, both altitudes: what it knows, and how it got
 *  there. They come from the same file, so they are always consistent. */
export interface HarnessData {
  lessons: LessonRecord[];
  entries: HarnessEntry[];
}

/** `"create memory:some_id"` — the only structured thing a stored round keeps
 *  about its edits (core writes `${action} ${kind}:${id}`). Everything the
 *  overview counts is parsed back out of these strings. */
export interface ChangeRef {
  action: "create" | "update" | "delete";
  kind: EntryKind;
  id: string;
}

const CHANGE_RE = /^(create|update|delete)\s+(prompt|memory|skill|subagent):(.*)$/i;

export function parseChange(change: string): ChangeRef | null {
  const m = CHANGE_RE.exec(change.trim());
  if (m === null) return null;
  return {
    action: m[1].toLowerCase() as ChangeRef["action"],
    kind: m[2].toLowerCase() as EntryKind,
    id: m[3].trim(),
  };
}

/** The id a rollback round undid. Core writes the rollback's summary as
 *  "Rollback refinement <id>" (rollbackProposal) and stores no structured
 *  link, so the id has to come back out of the sentence. */
export function rolledBackTarget(r: LessonRecord): string | null {
  const m = /roll ?back\s+refinement\s+(\S+)/i.exec(r.trigger ?? "");
  return m === null ? null : m[1].replace(/[.,;:]$/, "");
}

/** Ids of every round that a later rollback undid. A reversed round stays in
 *  the log — dropping it would make the history lie about what happened — but
 *  it reads as spent rather than as something the agent still believes. */
export function undoneIds(lessons: LessonRecord[]): Set<string> {
  const out = new Set<string>();
  for (const l of lessons) {
    const target = rolledBackTarget(l);
    if (target !== null) out.add(target);
  }
  return out;
}

/** A round that applied no edits at all. The review thought there was something
 *  to learn and the refiner concluded there was not — worth showing as its own
 *  state, not as a lesson. `undefined` changes is an older record, not a no-op. */
export function isNoop(r: LessonRecord): boolean {
  return r.changes !== undefined && r.changes.length === 0;
}

/** What the overview panel counts. All of it comes out of one pull — no extra
 *  bridge calls, no core change. */
export interface HarnessStats {
  /** Entries alive right now, by kind, in ENTRY_KINDS order. */
  byKind: Array<{ kind: EntryKind; n: number }>;
  entries: number;
  /** Rounds that ran, ever. */
  rounds: number;
  /** …of which: undid an earlier round / applied nothing / applied something. */
  rollbacks: number;
  noops: number;
  kept: number;
  /** Rounds by who asked, in a fixed order. */
  bySource: Array<{ source: "auto" | "manual" | "agent" | "unknown"; n: number }>;
  /** One bucket per local day that has at least one round, oldest first, with
   *  empty days filled in so the strip reads as a calendar, not a list. */
  days: Array<{ day: string; n: number; kept: number }>;
  /** One point per round, oldest first: how many lessons had ever been written
   *  by then, and how many were still standing. The gap between the two is the
   *  part that did not survive — which is the only honest thing this data can
   *  say about whether the learning is worth anything. */
  curve: Array<{ k: number; written: number; alive: number; at: string; label: string }>;
  /** Newest round timestamp, or "" when nothing has run. */
  last: string;
}

/** Local YYYY-MM-DD — buckets must follow the reader's midnight, not UTC's. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function harnessStats(data: HarnessData): HarnessStats {
  const byKind = ENTRY_KINDS.map((kind) => ({
    kind,
    n: data.entries.filter((e) => e.kind === kind).length,
  }));
  const rollbacks = data.lessons.filter(isRollback).length;
  const noops = data.lessons.filter(isNoop).length;

  const sources = { auto: 0, manual: 0, agent: 0, unknown: 0 };
  for (const l of data.lessons) {
    const k = l.source === "auto" || l.source === "manual" || l.source === "agent" ? l.source : "unknown";
    sources[k] += 1;
  }

  // Bucket by day, then fill the gaps: a strip with the quiet days missing
  // would compress a week of silence into nothing and read as steady work.
  const hit = new Map<string, { n: number; kept: number }>();
  for (const l of data.lessons) {
    const k = dayKey(l.created_at ?? "");
    if (k === "") continue;
    const cur = hit.get(k) ?? { n: 0, kept: 0 };
    cur.n += 1;
    if (!isNoop(l) && !isRollback(l)) cur.kept += 1;
    hit.set(k, cur);
  }
  const keys = [...hit.keys()].sort();
  const days: HarnessStats["days"] = [];
  if (keys.length > 0) {
    const at = new Date(`${keys[0]}T00:00:00`);
    const end = new Date(`${keys[keys.length - 1]}T00:00:00`);
    // Guard the walk: a corrupt future timestamp must not spin this forever.
    for (let i = 0; at <= end && i < 400; i += 1) {
      const k = dayKey(at.toISOString());
      const v = hit.get(k) ?? { n: 0, kept: 0 };
      days.push({ day: k, n: v.n, kept: v.kept });
      at.setDate(at.getDate() + 1);
    }
  }

  // Replay the rounds oldest-first, applying each round's edits to a live set.
  // create/update put an id in, delete takes it out; `written` only ever grows.
  const alive = new Set<string>();
  const everWritten = new Set<string>();
  const curve: HarnessStats["curve"] = [];
  const oldestFirst = [...data.lessons].reverse();
  oldestFirst.forEach((l, i) => {
    for (const c of l.changes ?? []) {
      const ref = parseChange(c);
      if (ref === null) continue;
      if (ref.action === "delete") alive.delete(ref.id);
      else {
        alive.add(ref.id);
        everWritten.add(ref.id);
      }
    }
    curve.push({
      k: i + 1,
      written: everWritten.size,
      alive: alive.size,
      at: l.created_at ?? "",
      label: l.title ?? "",
    });
  });

  return {
    byKind,
    curve,
    entries: data.entries.length,
    rounds: data.lessons.length,
    rollbacks,
    noops,
    kept: data.lessons.length - rollbacks - noops,
    bySource: (["auto", "manual", "agent", "unknown"] as const).map((source) => ({
      source,
      n: sources[source],
    })),
    days,
    last: data.lessons[0]?.created_at ?? "",
  };
}

/** A rollback is itself recorded as a refinement; those rows cannot be rolled back again. */
export function isRollback(r: LessonRecord): boolean {
  return /roll ?back/i.test(r.trigger ?? "") || (r.changes ?? []).some((c) => /roll ?back/i.test(c));
}

async function pullOne(url: string): Promise<LearnedPayload | null> {
  try {
    return (await (await fetch(bridgeUrl(url))).json()) as LearnedPayload;
  } catch {
    return null; // bridge offline or root unknown — quiet, no rows
  }
}

/** kind → id → entry, flattened and stamped with its owner. */
function entriesOf(state: HarnessState | null | undefined, owner: string | null): HarnessEntry[] {
  const out: HarnessEntry[] = [];
  for (const kind of ENTRY_KINDS) {
    for (const e of Object.values(state?.entries?.[kind] ?? {})) out.push({ ...e, kind, owner });
  }
  return out;
}

/** Merge master + every roster root + the everywhere scope, newest first. */
async function pull(roots: string[]): Promise<HarnessData> {
  const [master, ...perRoot] = await Promise.all([
    pullOne("/bridge/learned"),
    ...roots.map((name) => pullOne(`/bridge/learned?root=${encodeURIComponent(name)}`)),
  ]);
  const lessons: LessonRecord[] = [];
  const entries: HarnessEntry[] = [];
  for (const r of master?.local?.refinements ?? []) lessons.push({ ...r, owner: "master" });
  for (const r of master?.global?.refinements ?? []) lessons.push({ ...r, owner: null });
  entries.push(...entriesOf(master?.local, "master"), ...entriesOf(master?.global, null));
  roots.forEach((name, i) => {
    for (const r of perRoot[i]?.local?.refinements ?? []) lessons.push({ ...r, owner: name });
    entries.push(...entriesOf(perRoot[i]?.local, name));
  });
  lessons.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  // Newest first by last touch, so a revised memory rises the way a new one does.
  entries.sort((a, b) =>
    (b.updated_at ?? b.created_at ?? "").localeCompare(a.updated_at ?? a.created_at ?? ""),
  );
  return { lessons, entries };
}

/** One shared pull per (epoch, roster) — the column, the detail pane and the
 *  rail's unread check all read the same promise instead of hammering the
 *  bridge. Root lessons can change without a bridge event (their refine runs
 *  on their own session), so entries also expire after a few seconds. */
let cache: { key: string; at: number; promise: Promise<HarnessData> } | null = null;
const MAX_AGE_MS = 10_000;

export function fetchHarness(epoch: number, roots: string[]): Promise<HarnessData> {
  const key = `${epoch}|${[...roots].sort().join(",")}`;
  if (!cache || cache.key !== key || Date.now() - cache.at > MAX_AGE_MS) {
    cache = { key, at: Date.now(), promise: pull(roots) };
  }
  return cache.promise;
}

/** Lessons only — for callers that never look at the entries. */
export function fetchLessons(epoch: number, roots: string[]): Promise<LessonRecord[]> {
  return fetchHarness(epoch, roots).then((d) => d.lessons);
}
