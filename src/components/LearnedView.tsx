import { useCallback, useEffect, useState } from "react";
import { bridgeCmd, bridgeUrl } from "../runtime/bridge";

interface HarnessRefinement {
  id: string;
  trigger?: string;
  changes?: string[];
  evidence?: string;
  outcome?: string;
  created_at?: string;
}
interface HarnessEntry {
  id: string;
  kind: string;
  title?: string;
  content?: string;
  version?: number;
  updated_at?: string;
  source?: string;
}
interface HarnessState {
  refinements?: HarnessRefinement[];
  entries?: Record<string, Record<string, HarnessEntry>>;
}
type Scope = "this workspace" | "everywhere";

function flatEntries(state: HarnessState | null, scope: Scope) {
  const out: Array<HarnessEntry & { scope: Scope }> = [];
  for (const [kind, byId] of Object.entries(state?.entries ?? {})) {
    for (const e of Object.values(byId)) out.push({ ...e, kind, scope });
  }
  return out;
}

function when(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** A rollback is itself recorded as a refinement; those rows cannot be rolled back again. */
function isRollback(r: HarnessRefinement): boolean {
  return /roll ?back/i.test(r.trigger ?? "") || (r.changes ?? []).some((c) => /roll ?back/i.test(c));
}

/** Most recent refinement (same scope) whose recorded changes mention this entry. */
function lastChangedBy(refs: HarnessRefinement[], e: HarnessEntry): HarnessRefinement | null {
  const hits = refs.filter((r) =>
    (r.changes ?? []).some((c) => c.includes(e.id) || (e.title !== undefined && e.title !== "" && c.includes(e.title))),
  );
  hits.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  return hits[0] ?? null;
}

export function LearnedView() {
  const [data, setData] = useState<{ local: HarnessState | null; global: HarnessState | null } | null>(null);
  const [selected, setSelected] = useState<{ scope: Scope; kind: string; id: string } | null>(null);
  const [rolled, setRolled] = useState<Record<string, "pending" | "done">>({});
  const [globalRun, setGlobalRun] = useState<"idle" | "pending" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch(bridgeUrl("/bridge/learned"))
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ local: null, global: null }));
  }, []);
  useEffect(refresh, [refresh]);

  const rollBack = async (key: string, refinementId: string) => {
    setRolled((m) => ({ ...m, [key]: "pending" }));
    setErr(null);
    try {
      await bridgeCmd("refine_rollback", undefined, { target: refinementId });
      setRolled((m) => ({ ...m, [key]: "done" }));
      refresh();
    } catch (e) {
      setRolled((m) => {
        const { [key]: _drop, ...rest } = m;
        return rest;
      });
      setErr(e instanceof Error ? e.message : "roll back failed");
    }
  };

  const applyEverywhere = async (e: HarnessEntry) => {
    setGlobalRun("pending");
    setErr(null);
    try {
      // Seeds a new global review with this entry's meaning; what gets kept
      // is decided by that review, not copied verbatim.
      await bridgeCmd("refine_global", `Keep the lesson behind the ${e.kind} "${e.title ?? e.id}" everywhere.`);
      setGlobalRun("done");
      refresh();
    } catch (ex) {
      setGlobalRun("idle");
      setErr(ex instanceof Error ? ex.message : "apply everywhere failed");
    }
  };

  const refinements = [
    ...(data?.local?.refinements ?? []).map((r) => ({ ...r, scope: "this workspace" as Scope })),
    ...(data?.global?.refinements ?? []).map((r) => ({ ...r, scope: "everywhere" as Scope })),
  ].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const entries = [...flatEntries(data?.local ?? null, "this workspace"), ...flatEntries(data?.global ?? null, "everywhere")];

  const sel = selected
    ? entries.find((e) => e.scope === selected.scope && e.kind === selected.kind && e.id === selected.id) ?? null
    : null;
  const selChangedBy = sel
    ? lastChangedBy(
        (sel.scope === "everywhere" ? data?.global?.refinements : data?.local?.refinements) ?? [],
        sel,
      )
    : null;

  return (
    <div className="learn">
      <div className="sec">History</div>
      {refinements.length === 0 ? (
        <div className="colnote" style={{ padding: "0 0 18px" }}>
          no lessons yet. When master keeps a lesson it appears here — with its evidence, edits, and a
          one-step roll back.
        </div>
      ) : (
        refinements.map((r) => {
          const key = `${r.scope}-${r.id}`;
          const state = rolled[key];
          return (
            <div className="lrow" key={key}>
              <span className="id">{r.id.slice(0, 6)}</span>
              <span className="tm">{when(r.created_at)}</span>
              <span className="tx">
                {r.trigger ?? "lesson"} · <span className={r.scope === "everywhere" ? "scope g" : "scope"}>{r.scope}</span>
                {r.changes?.length ? ` · ${r.changes.length} edits` : ""}
              </span>
              <span className="op">
                {isRollback(r) ? null : state === "done" ? (
                  <span className="tm">rolled back</span>
                ) : (
                  <a className="lk" onClick={() => state !== "pending" && rollBack(key, r.id)}>
                    {state === "pending" ? "rolling back…" : "roll back"}
                  </a>
                )}
              </span>
            </div>
          );
        })
      )}
      <div className="sec" style={{ paddingTop: 22 }}>
        Entries
      </div>
      {entries.length === 0 ? (
        <div className="colnote" style={{ padding: 0 }}>
          base instructions are never edited — lessons are appended, and undone one lesson at a time.
        </div>
      ) : (
        entries.map((e) => {
          const on = sel !== null && sel.scope === e.scope && sel.kind === e.kind && sel.id === e.id;
          return (
            <div
              className={on ? "lrow click on" : "lrow click"}
              key={`${e.scope}-${e.kind}-${e.id}`}
              onClick={() => setSelected(on ? null : { scope: e.scope, kind: e.kind, id: e.id })}
            >
              <span className="tm">{e.kind}</span>
              <span className="id">{e.title ?? e.id}</span>
              <span className="tx">
                <span className={e.scope === "everywhere" ? "scope g" : "scope"}>{e.scope}</span>
                {typeof e.version === "number" ? ` · v${e.version}` : ""}
              </span>
              <span className="tm">{when(e.updated_at)}</span>
            </div>
          );
        })
      )}
      {sel ? (
        <div className="edetail">
          <div className="eh">
            <span className="id">
              {sel.kind} · {sel.title ?? sel.id}
            </span>
            <span className="tm">
              <span className={sel.scope === "everywhere" ? "scope g" : "scope"}>{sel.scope}</span>
              {typeof sel.version === "number" ? ` · v${sel.version}` : ""}
              {sel.updated_at ? ` · updated ${when(sel.updated_at)}` : ""}
              {selChangedBy
                ? ` · last changed by ${selChangedBy.id.slice(0, 6)}`
                : " · no lesson recorded this change"}
            </span>
          </div>
          {sel.content ? (
            <pre className="econtent">
              {sel.content.slice(0, 500)}
              {sel.content.length > 500 ? "…" : ""}
            </pre>
          ) : (
            <div className="colnote" style={{ padding: "8px 0 0" }}>
              no content stored for this entry.
            </div>
          )}
          {sel.scope !== "everywhere" ? (
            <div className="lf" style={{ paddingLeft: 0, paddingRight: 0 }}>
              <button className="btn" onClick={() => applyEverywhere(sel)} disabled={globalRun !== "idle"}>
                {globalRun === "done" ? "kept everywhere" : globalRun === "pending" ? "reviewing…" : "apply everywhere"}
              </button>
              <span className="note">runs a new review — result may differ</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {err ? (
        <div className="colnote" style={{ padding: "10px 0 0", color: "var(--red)" }}>
          {err}
        </div>
      ) : null}
    </div>
  );
}
