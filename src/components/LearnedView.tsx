import { useCallback, useEffect, useState } from "react";
import type { LearnedSel } from "../types";
import { lessonSourceText } from "../helperDisplay";
import { bridgeCmd, bridgeUrl } from "../runtime/bridge";
import { getLang, useT } from "../i18n";

export interface HarnessRefinement {
  id: string;
  trigger?: string;
  /** Machine origin (schema 27): "auto" | "manual" | "agent"; absent on older rows. */
  source?: string;
  changes?: string[];
  evidence?: string;
  outcome?: string;
  created_at?: string;
}
export interface HarnessEntry {
  id: string;
  kind: string;
  title?: string;
  content?: string;
  version?: number;
  updated_at?: string;
  source?: string;
}
export interface HarnessState {
  refinements?: HarnessRefinement[];
  entries?: Record<string, Record<string, HarnessEntry>>;
}
export type Scope = LearnedSel["scope"];
export interface LearnedData {
  local: HarnessState | null;
  global: HarnessState | null;
}

export function flatEntries(state: HarnessState | null, scope: Scope) {
  const out: Array<HarnessEntry & { scope: Scope }> = [];
  for (const [kind, byId] of Object.entries(state?.entries ?? {})) {
    for (const e of Object.values(byId)) out.push({ ...e, kind, scope });
  }
  return out;
}

export function fetchLearned(): Promise<LearnedData> {
  return fetch(bridgeUrl("/bridge/learned"))
    .then((r) => r.json())
    .catch(() => ({ local: null, global: null }));
}

function when(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const locale = getLang() === "zh" ? "zh-CN" : undefined;
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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

/** Learned pane: the entry the Learned column selected (detail), else the
 *  lesson history. The catalog itself lives in the left column. */
export function LearnedView(props: {
  sel: LearnedSel | null;
  /** Bumped when a new lesson lands — re-pulls the harness state. */
  epoch: number;
  onSelect: (s: LearnedSel | null) => void;
}) {
  const t = useT();
  const [data, setData] = useState<LearnedData | null>(null);
  const [rolled, setRolled] = useState<Record<string, "pending" | "done">>({});
  /** Expanded history rows; the newest row defaults open. */
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [globalRun, setGlobalRun] = useState<"idle" | "pending" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchLearned().then(setData);
  }, []);
  useEffect(refresh, [refresh, props.epoch]);

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
      setErr(e instanceof Error ? e.message : t("roll back failed"));
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
      setErr(ex instanceof Error ? ex.message : t("apply everywhere failed"));
    }
  };

  const refinements = [
    ...(data?.local?.refinements ?? []).map((r) => ({ ...r, scope: "this workspace" as Scope })),
    ...(data?.global?.refinements ?? []).map((r) => ({ ...r, scope: "everywhere" as Scope })),
  ].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const entries = [...flatEntries(data?.local ?? null, "this workspace"), ...flatEntries(data?.global ?? null, "everywhere")];

  const sel = props.sel
    ? entries.find((e) => e.scope === props.sel?.scope && e.kind === props.sel?.kind && e.id === props.sel?.id) ?? null
    : null;
  const selChangedBy = sel
    ? lastChangedBy(
        (sel.scope === "everywhere" ? data?.global?.refinements : data?.local?.refinements) ?? [],
        sel,
      )
    : null;

  if (sel) {
    return (
      <div className="learn">
        <div className="sec">
          <a className="lk" onClick={() => props.onSelect(null)}>
            {t("← history")}
          </a>
        </div>
        <div className="edetail" style={{ marginTop: 0 }}>
          <div className="eh">
            <span className="id">
              {t(sel.kind)} · {sel.title ?? sel.id}
            </span>
            <span className="tm">
              <span className={sel.scope === "everywhere" ? "scope g" : "scope"}>{t(sel.scope)}</span>
              {typeof sel.version === "number" ? ` · v${sel.version}` : ""}
              {sel.updated_at ? ` · ${t("updated {when}", { when: when(sel.updated_at) })}` : ""}
              {selChangedBy
                ? ` · ${t("last changed by {id}", { id: selChangedBy.id.slice(0, 6) })}`
                : ` · ${t("no lesson recorded this change")}`}
            </span>
          </div>
          {sel.content ? (
            <pre className="econtent">{sel.content}</pre>
          ) : (
            <div className="colnote" style={{ padding: "8px 0 0" }}>
              {t("no content stored for this entry.")}
            </div>
          )}
          {sel.scope !== "everywhere" ? (
            <div className="lf" style={{ paddingLeft: 0, paddingRight: 0 }}>
              <button className="btn" onClick={() => applyEverywhere(sel)} disabled={globalRun !== "idle"}>
                {globalRun === "done" ? t("kept everywhere") : globalRun === "pending" ? t("reviewing…") : t("apply everywhere")}
              </button>
              <span className="note">{t("runs a new review — result may differ")}</span>
            </div>
          ) : null}
        </div>
        {err ? (
          <div className="colnote" style={{ padding: "10px 0 0", color: "var(--red)" }}>
            {err}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="learn">
      <div className="sec">{t("History")}</div>
      {refinements.length === 0 ? (
        <div className="colnote" style={{ padding: "0 0 18px" }}>
          {t(
            "no lessons yet. When master keeps a lesson it appears here — with its evidence, edits, and a one-step roll back.",
          )}
        </div>
      ) : (
        refinements.map((r, i) => {
          const key = `${r.scope}-${r.id}`;
          const state = rolled[key];
          // Rows expand to the full record; the newest one starts open.
          const isOpen = open[key] ?? i === 0;
          return (
            <div key={key}>
              <div
                className={isOpen ? "lrow click on" : "lrow click"}
                onClick={() => setOpen((m) => ({ ...m, [key]: !isOpen }))}
              >
                <span className="id">{r.id.slice(0, 6)}</span>
                <span className="tm">{when(r.created_at)}</span>
                <span className="tx">
                  {r.trigger ?? t("lesson")} ·{" "}
                  <span className={r.scope === "everywhere" ? "scope g" : "scope"}>{t(r.scope)}</span>
                  {/* machine source field, never inferred from the trigger text */}
                  {lessonSourceText(r.source) ? ` · ${t("from {source}", { source: lessonSourceText(r.source) as string })}` : ""}
                  {r.changes?.length ? ` · ${t("{n} edits", { n: r.changes.length })}` : ""}
                </span>
                <span className="op">
                  <span className="tm">{isOpen ? "▾" : "▸"}</span>
                </span>
              </div>
              {isOpen && (
                <div className="edetail" style={{ marginTop: 0, marginBottom: 10 }}>
                  {r.trigger ? <div className="hfull">{r.trigger}</div> : null}
                  {r.evidence ? (
                    <div className="hkv">
                      <span className="hk">{t("evidence")}</span>
                      <span className="hv">{r.evidence}</span>
                    </div>
                  ) : null}
                  {(r.changes ?? []).length > 0 ? (
                    <div className="hkv">
                      <span className="hk">{t("edits")}</span>
                      <span className="hv">
                        {(r.changes ?? []).map((c, j) => (
                          <span className="hline" key={j}>
                            {c}
                          </span>
                        ))}
                      </span>
                    </div>
                  ) : null}
                  {r.outcome ? (
                    <div className="hkv">
                      <span className="hk">{t("expected")}</span>
                      <span className="hv">{r.outcome}</span>
                    </div>
                  ) : null}
                  {isRollback(r) ? null : (
                    <div className="lf" style={{ paddingLeft: 0, paddingRight: 0 }}>
                      {state === "done" ? (
                        <span className="note">{t("rolled back")}</span>
                      ) : (
                        <button
                          className="btn"
                          disabled={state === "pending"}
                          onClick={() => rollBack(key, r.id)}
                        >
                          {state === "pending" ? t("rolling back…") : t("roll back")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
      {err ? (
        <div className="colnote" style={{ padding: "10px 0 0", color: "var(--red)" }}>
          {err}
        </div>
      ) : null}
    </div>
  );
}
