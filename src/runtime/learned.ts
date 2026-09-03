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
