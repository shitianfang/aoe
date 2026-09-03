import { useEffect, useState } from "react";
import type { LearnedSel } from "../types";
import { lessonSourceText } from "../helperDisplay";
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

/** Learned pane: the full record of the lesson picked in the ⚡ column —
 *  its summary, why it was kept, what changed, and the two real operations
 *  (roll back / apply everywhere). The column is the catalog; this is depth. */
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

  // Action state is per lesson — never carried across a selection.
  const selKey = props.sel ? `${props.sel.owner ?? "*"}-${props.sel.id}` : "";
  useEffect(() => {
    setGlobalRun("idle");
    setErr(null);
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
        <div className="hfull" style={{ marginTop: 8 }}>
          {sel.trigger ?? t("lesson")}
        </div>
        {sel.evidence !== undefined && sel.evidence !== "" && (
          <div className="hkv">
            <span className="hk">{t("why it was kept")}</span>
            <span className="hv">{sel.evidence}</span>
          </div>
        )}
        {(sel.changes ?? []).length > 0 && (
          <div className="hkv">
            <span className="hk">{t("what changed")}</span>
            <span className="hv">
              {(sel.changes ?? []).map((c, i) => (
                <span className="hline" key={i}>
                  {c}
                </span>
              ))}
            </span>
          </div>
        )}
        {sel.outcome !== undefined && sel.outcome !== "" && (
          <div className="hkv">
            <span className="hk">{t("expected")}</span>
            <span className="hv">
              {sel.outcome} <span className="dim">{t("(not checked by the system)")}</span>
            </span>
          </div>
        )}
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
      </div>
      {err !== null && (
        <div className="colnote" style={{ padding: "10px 0 0", color: "var(--red)" }}>
          {err}
        </div>
      )}
    </div>
  );
}
