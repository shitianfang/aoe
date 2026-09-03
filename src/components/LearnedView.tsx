import { useEffect, useState } from "react";
import type { LearnedSel } from "../types";
import { lessonChangeText, lessonSourceText } from "../helperDisplay";
import { bridgeCmd } from "../runtime/bridge";
import { getLang, useT } from "../i18n";
import { BotAvatar } from "./BotAvatar";
import { fetchLessons, isRollback, type LessonRecord } from "../runtime/learned";

function when(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const locale = getLang() === "zh" ? "zh-CN" : undefined;
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Learned pane: the full record of the lesson picked in the ⚡ column. It
 *  answers three things in this order — what the agent now knows, what that
 *  actually changed, and (folded away) why the refiner kept it. The refiner
 *  writes its rationale and expected-outcome for itself, in paragraphs; left
 *  unfolded they are two thirds of the pane and nobody reads them, so they sit
 *  behind one toggle and the checkable part — the edits — comes first. */
export function LearnedView(props: {
  sel: LearnedSel | null;
  /** Bumped when a new lesson lands — re-pulls the records. */
  epoch: number;
  /** Roster roots — their lessons ride the same merged pull as the column's. */
  roots: string[];
  /** A rollback / apply changed the record — ask App to bump the epoch. */
  onChanged: () => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<LessonRecord[] | null>(null);
  const [rolled, setRolled] = useState<Record<string, "pending" | "done">>({});
  const [globalRun, setGlobalRun] = useState<"idle" | "pending" | "done">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const rootsKey = props.roots.join("\n");
  useEffect(() => {
    let live = true;
    fetchLessons(props.epoch, rootsKey === "" ? [] : rootsKey.split("\n")).then((r) => {
      if (live) setRows(r);
    });
    return () => {
      live = false;
    };
  }, [props.epoch, rootsKey]);

  // Action state is per lesson — never carried across a selection. The fold
  // resets too: every lesson opens on its short answer.
  const selKey = props.sel ? `${props.sel.owner ?? "*"}-${props.sel.id}` : "";
  useEffect(() => {
    setGlobalRun("idle");
    setErr(null);
    setOpen(false);
  }, [selKey]);

  const sel = props.sel
    ? rows?.find((r) => r.id === props.sel?.id && r.owner === props.sel?.owner) ?? null
    : null;

  const rollBack = async (r: LessonRecord) => {
    setRolled((m) => ({ ...m, [selKey]: "pending" }));
    setErr(null);
    try {
      // A root's lesson lives in its own harness — undo it through the root's
      // own connection; master's and everywhere lessons go through master's.
      if (r.owner !== null && r.owner !== "master") {
        await bridgeCmd("root_refine_rollback", undefined, { target: r.owner, id: r.id });
      } else {
        await bridgeCmd("refine_rollback", undefined, { target: r.id });
      }
      setRolled((m) => ({ ...m, [selKey]: "done" }));
      props.onChanged();
    } catch (e) {
      setRolled((m) => {
        const { [selKey]: _drop, ...rest } = m;
        return rest;
      });
      setErr(e instanceof Error ? e.message : t("roll back failed"));
    }
  };

  const applyEverywhere = async (r: LessonRecord) => {
    setGlobalRun("pending");
    setErr(null);
    try {
      // Seeds a new global review with this lesson's summary; what gets kept
      // is decided by that review, not copied verbatim.
      await bridgeCmd("refine_global", r.trigger || undefined);
      setGlobalRun("done");
      props.onChanged();
    } catch (e) {
      setGlobalRun("idle");
      setErr(e instanceof Error ? e.message : t("apply everywhere failed"));
    }
  };

  if (!props.sel) {
    return (
      <div className="learn">
        <div className="colnote" style={{ padding: 0 }}>
          {t("pick a lesson on the left to see its full record.")}
        </div>
      </div>
    );
  }
  if (rows === null) {
    return (
      <div className="learn">
        <div className="colnote" style={{ padding: 0 }}>
          {t("loading…")}
        </div>
      </div>
    );
  }
  if (!sel) {
    return (
      <div className="learn">
        <div className="colnote" style={{ padding: 0 }}>
          {t("this lesson is no longer in the record.")}
        </div>
      </div>
    );
  }

  const src = lessonSourceText(sel.source);
  const state = rolled[selKey];
  const changes = sel.changes;
  // `[]` is the harness saying this round applied nothing; `undefined` is an
  // older record that never wrote the field. Only the first is a real no-op —
  // and a no-op has nothing to undo, so it gets no buttons either.
  const nothingChanged = changes !== undefined && changes.length === 0;
  const reason = sel.evidence !== undefined && sel.evidence !== "" ? sel.evidence : null;
  const outcome = sel.outcome !== undefined && sel.outcome !== "" ? sel.outcome : null;

  return (
    <div className="learn">
      <div className="edetail" style={{ marginTop: 0 }}>
        <div className="eh">
          {sel.owner === null ? (
            <span className="id">{t("for every workspace")}</span>
          ) : (
            <>
              {sel.owner === "master" ? <span className="chip master sm" /> : <BotAvatar seed={sel.owner} sm />}
              <span className="id">{sel.owner}</span>
            </>
          )}
          <span className="tm">
            {when(sel.created_at)}
            {src !== null ? ` · ${t("from {source}", { source: src })}` : ""}
          </span>
        </div>
        {/* The headline of the pane: the lesson's own summary. Spacing lives
            in .hfull now — the metadata row above stays small on purpose. */}
        <div className="hfull">{sel.trigger ?? t("lesson")}</div>
        {nothingChanged ? (
          <div className="hnone">{t("nothing was changed — the review kept everything as it was.")}</div>
        ) : (changes ?? []).length > 0 ? (
          <div className="hkv">
            <span className="hk">{t("what changed")}</span>
            <span className="hv">
              {(changes ?? []).map((c, i) => {
                const p = lessonChangeText(c);
                return (
                  <span className="chg" key={i}>
                    {p.what}
                    {p.id !== null && <span className="cid">{p.id}</span>}
                  </span>
                );
              })}
            </span>
          </div>
        ) : null}
        {/* The fold is labelled with what it hides, so a closed pane still says
            what you would be opening. The first section reuses that label
            rather than repeating it one line lower. */}
        {(reason !== null || outcome !== null) && (
          <>
            <button className="more" onClick={() => setOpen(!open)} aria-expanded={open}>
              {reason !== null ? t("why it was kept") : t("expected")}
              <span className="cv">{open ? "▴" : "▾"}</span>
            </button>
            {open && (
              <>
                {reason !== null && (
                  <div className="hkv">
                    <span className="hv">{reason}</span>
                  </div>
                )}
                {outcome !== null && (
                  <div className="hkv">
                    {reason !== null && <span className="hk">{t("expected")}</span>}
                    <span className="hv">
                      {outcome} <span className="dim">{t("(not checked by the system)")}</span>
                    </span>
                  </div>
                )}
              </>
            )}
          </>
        )}
        {!nothingChanged && (
          <div className="lf" style={{ paddingLeft: 0, paddingRight: 0 }}>
            {isRollback(sel) ? null : state === "done" ? (
              <span className="note">{t("rolled back")}</span>
            ) : (
              <button className="btn" disabled={state === "pending"} onClick={() => rollBack(sel)}>
                {state === "pending" ? t("rolling back…") : t("roll back")}
              </button>
            )}
            {sel.owner !== null && (
              <button className="btn" onClick={() => applyEverywhere(sel)} disabled={globalRun !== "idle"}>
                {globalRun === "done"
                  ? t("kept everywhere")
                  : globalRun === "pending"
                    ? t("reviewing…")
                    : t("apply everywhere")}
              </button>
            )}
            {sel.owner !== null && <span className="note">{t("runs a new review — result may differ")}</span>}
          </div>
        )}
      </div>
      {err !== null && (
        <div className="colnote" style={{ padding: "10px 0 0", color: "var(--red)" }}>
          {err}
        </div>
      )}
    </div>
  );
}
