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
  /** Machine origin (schema 27): "auto" | "manual" | "agent"; absent on older rows. */
  source?: string;
  changes?: string[];
  evidence?: string;
  outcome?: string;
  created_at?: string;
}

interface HarnessState {
  refinements?: Array<Omit<LessonRecord, "owner">>;
}
interface LearnedPayload {
  local?: HarnessState | null;
  global?: HarnessState | null;
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

/** Merge master + every roster root + the everywhere scope, newest first. */
async function pull(roots: string[]): Promise<LessonRecord[]> {
  const [master, ...perRoot] = await Promise.all([
    pullOne("/bridge/learned"),
    ...roots.map((name) => pullOne(`/bridge/learned?root=${encodeURIComponent(name)}`)),
  ]);
  const out: LessonRecord[] = [];
  for (const r of master?.local?.refinements ?? []) out.push({ ...r, owner: "master" });
  for (const r of master?.global?.refinements ?? []) out.push({ ...r, owner: null });
  roots.forEach((name, i) => {
    for (const r of perRoot[i]?.local?.refinements ?? []) out.push({ ...r, owner: name });
  });
  out.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  return out;
}

/** One shared pull per (epoch, roster) — the column, the detail pane and the
 *  rail's unread check all read the same promise instead of hammering the
 *  bridge. Root lessons can change without a bridge event (their refine runs
 *  on their own session), so entries also expire after a few seconds. */
let cache: { key: string; at: number; promise: Promise<LessonRecord[]> } | null = null;
const MAX_AGE_MS = 10_000;

export function fetchLessons(epoch: number, roots: string[]): Promise<LessonRecord[]> {
  const key = `${epoch}|${[...roots].sort().join(",")}`;
  if (!cache || cache.key !== key || Date.now() - cache.at > MAX_AGE_MS) {
    cache = { key, at: Date.now(), promise: pull(roots) };
  }
  return cache.promise;
}
