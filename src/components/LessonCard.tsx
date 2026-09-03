import { useState } from "react";
import type { LessonResult } from "../types";
import { lessonSourceText } from "../helperDisplay";
import { bridgeCmd } from "../runtime/bridge";

/** Expanded view of one kept lesson (RefinementResult). Everything shown is
 *  real mechanism: rationale is the harness's own evidence text, expected is
 *  never verified by the system, and roll back / apply everywhere are the two
 *  operations the runtime actually offers (rollbackId / global refine). */
export function LessonCard(props: { result: LessonResult; at?: string }) {
  const r = props.result;
  const [rollback, setRollback] = useState<"idle" | "pending" | "done">("idle");
  const [globalRun, setGlobalRun] = useState<"idle" | "pending" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);

  const scopeLabel = r.scope === "global" ? "kept everywhere" : "kept for this workspace";
  // Machine source field (schema 27) — older lessons carry none; say nothing then.
  const sourceLabel = lessonSourceText(r.source);

  const doRollback = async () => {
    setRollback("pending");
    setErr(null);
    try {
      await bridgeCmd("refine_rollback", undefined, { target: r.id });
      setRollback("done");
    } catch (e) {
      setRollback("idle");
      setErr(e instanceof Error ? e.message : "roll back failed");
    }
  };

  const doGlobal = async () => {
    setGlobalRun("pending");
    setErr(null);
    try {
      // A global refine is a new review seeded with this lesson's summary —
      // the result may differ from what was kept locally.
      await bridgeCmd("refine_global", r.summary || undefined);
      setGlobalRun("done");
    } catch (e) {
      setGlobalRun("idle");
      setErr(e instanceof Error ? e.message : "apply everywhere failed");
    }
  };

  return (
    <div className="lesson">
      <div className="lh">
        <span className="id">{r.id}</span>
        <span>
          {props.at ? `${props.at} · ` : ""}
          {scopeLabel}
          {sourceLabel ? ` · from ${sourceLabel}` : ""}
          {r.rollbackOf ? ` · rolls back ${r.rollbackOf}` : ""}
        </span>
      </div>
      <div className="lb">
        <span className="ll">summary</span>
        <span className="lv">
          <b>{r.summary ?? r.id}</b>
        </span>
        {r.rationale ? (
          <>
            <span className="ll">evidence</span>
            <span className="lv">{r.rationale}</span>
          </>
        ) : null}
        <span className="ll">edits</span>
        <span className="lv">
          {(r.appliedEdits ?? []).length === 0
            ? "none recorded"
            : (r.appliedEdits ?? []).map((e) => (
                <span className="edit" key={e.id}>
                  {e.kind} · {e.title}
                  {/* real results may omit `applied`; only an explicit false means failure */}
                  {e.applied === false ? (
                    <span className="dim"> — not applied{e.error ? ` · ${e.error}` : ""}</span>
                  ) : null}
                  {e.before ? <span className="dl del">− {e.before}</span> : null}
                  {e.after ? <span className="dl add">+ {e.after}</span> : null}
                  {!e.before && !e.after && e.content ? <span className="dl add">+ {e.content}</span> : null}
                </span>
              ))}
        </span>
        {r.expectedOutcome ? (
          <>
            <span className="ll">expected</span>
            <span className="lv">
              {r.expectedOutcome} <span className="dim">(not checked by the system)</span>
            </span>
          </>
        ) : null}
      </div>
      <div className="lf">
        <button className="btn" onClick={doRollback} disabled={rollback !== "idle"}>
          {rollback === "done" ? "rolled back" : rollback === "pending" ? "rolling back…" : `roll back ${r.id}`}
        </button>
        {r.scope !== "global" ? (
          <button className="btn" onClick={doGlobal} disabled={globalRun !== "idle"}>
            {globalRun === "done" ? "kept everywhere" : globalRun === "pending" ? "reviewing…" : "apply everywhere"}
          </button>
        ) : null}
        <span className="note">{err ? <span className="err">{err}</span> : "runs a new review — result may differ"}</span>
      </div>
    </div>
  );
}
