import { useEffect, useState } from "react";
import { bridgeUrl } from "../runtime/bridge";

interface HarnessRefinement {
  id: string;
  trigger?: string;
  changes?: string[];
  created_at?: string;
}
interface HarnessEntry {
  id: string;
  kind: string;
  title?: string;
  version?: number;
  updated_at?: string;
}
interface HarnessState {
  refinements?: HarnessRefinement[];
  entries?: Record<string, Record<string, HarnessEntry>>;
}

function flatEntries(state: HarnessState | null, scope: string) {
  const out: Array<HarnessEntry & { scope: string }> = [];
  for (const byId of Object.values(state?.entries ?? {})) {
    for (const e of Object.values(byId)) out.push({ ...e, scope });
  }
  return out;
}

function when(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function LearnedView() {
  const [data, setData] = useState<{ local: HarnessState | null; global: HarnessState | null } | null>(null);

  useEffect(() => {
    fetch(bridgeUrl("/bridge/learned"))
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ local: null, global: null }));
  }, []);

  const refinements = [
    ...(data?.local?.refinements ?? []).map((r) => ({ ...r, scope: "this workspace" })),
    ...(data?.global?.refinements ?? []).map((r) => ({ ...r, scope: "everywhere" })),
  ].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const entries = [...flatEntries(data?.local ?? null, "this ws"), ...flatEntries(data?.global ?? null, "everywhere")];

  return (
    <div className="learn">
      <div className="sec">History</div>
      {refinements.length === 0 ? (
        <div className="colnote" style={{ padding: "0 0 18px" }}>
          no lessons yet. When master keeps a lesson it appears here — with its evidence, edits, and a
          one-step roll back.
        </div>
      ) : (
        refinements.map((r) => (
          <div className="lrow" key={`${r.scope}-${r.id}`}>
            <span className="id">{r.id.slice(0, 6)}</span>
            <span className="tm">{when(r.created_at)}</span>
            <span className="tx">
              {r.trigger ?? "lesson"} · <span className={r.scope === "everywhere" ? "scope g" : "scope"}>{r.scope}</span>
              {r.changes?.length ? ` · ${r.changes.length} edits` : ""}
            </span>
          </div>
        ))
      )}
      <div className="sec" style={{ paddingTop: 22 }}>
        Entries
      </div>
      {entries.length === 0 ? (
        <div className="colnote" style={{ padding: 0 }}>
          base instructions are never edited — lessons are appended, and undone one lesson at a time.
        </div>
      ) : (
        entries.map((e) => (
          <div className="lrow" key={`${e.scope}-${e.kind}-${e.id}`}>
            <span className="tm">{e.kind}</span>
            <span className="id">{e.title ?? e.id}</span>
            <span className="tx">
              <span className={e.scope === "everywhere" ? "scope g" : "scope"}>{e.scope}</span>
              {typeof e.version === "number" ? ` · v${e.version}` : ""}
            </span>
            <span className="tm">{when(e.updated_at)}</span>
          </div>
        ))
      )}
    </div>
  );
}
