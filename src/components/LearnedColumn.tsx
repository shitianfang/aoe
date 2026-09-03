import { useEffect, useState } from "react";
import type { LearnedSel } from "../types";
import { lessonRowTitle, lessonSourceText } from "../helperDisplay";
import { getLang, useT } from "../i18n";
import { fetchLessons, type LessonRecord } from "../runtime/learned";

/** Today's lessons keep just the clock; older ones a short date. */
function shortWhen(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const locale = getLang() === "zh" ? "zh-CN" : undefined;
  return sameDay
    ? d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

/** The Learned home (rail ⚡): every kept lesson, grouped by who it belongs
 *  to. A row is the lesson's short title with the time trailing, plus a muted
 *  owner/source suffix — the full record (summary and all) opens as a center
 *  pane when clicked (App owns that). */
export function LearnedColumn(props: {
  selected: LearnedSel | null;
  /** Bumped when a new lesson lands — re-pulls the list. */
  epoch: number;
  /** Other root agents currently in the roster — their own lessons ride along. */
  roots: string[];
  onSelect: (s: LearnedSel | null) => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<LessonRecord[] | null>(null);
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

  const local = (rows ?? []).filter((r) => r.owner !== null);
  const everywhere = (rows ?? []).filter((r) => r.owner === null);

  const row = (r: LessonRecord) => {
    const on = props.selected !== null && props.selected.id === r.id && props.selected.owner === r.owner;
    const src = lessonSourceText(r.source);
    // No avatars here — attribution is the muted "owner · source" suffix.
    const meta = [r.owner, src].filter((part): part is string => part !== null);
    return (
      <button
        key={`${r.owner ?? "*"}-${r.id}`}
        className={on ? "lsn on" : "lsn"}
        title={r.trigger ?? ""}
        onClick={() => props.onSelect(on ? null : { owner: r.owner, id: r.id })}
      >
        <span className="ttl">
          <span className="tx">{lessonRowTitle(r) ?? t("lesson")}</span>
          <span className="tm">{shortWhen(r.created_at)}</span>
        </span>
        {meta.length > 0 && <span className="meta">{meta.join(" · ")}</span>}
      </button>
    );
  };

  return (
    <aside className="col2">
      <div className="sec">{t("Learned")}</div>
      <div className="lhint">{t("what agents pick up while working — later work uses it.")}</div>
      {rows !== null && rows.length === 0 && (
        <div className="colnote">
          {t("nothing learned yet.")}
          <br />
          {t("agents keep small improvements as they work — they appear here on their own.")}
        </div>
      )}
      {local.length > 0 && (
        <>
          <div className="sec sub">{t("for one agent")}</div>
          {local.map(row)}
        </>
      )}
      {everywhere.length > 0 && (
        <>
          <div className="sec sub">{t("for every workspace")}</div>
          {everywhere.map(row)}
        </>
      )}
    </aside>
  );
}
