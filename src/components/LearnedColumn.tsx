import { useEffect, useState } from "react";
import type { AutoRefineInfo, LearnedSel } from "../types";
import { lessonRowSourceText, lessonRowTitle } from "../helperDisplay";
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

/** The self-evolution home (rail ⚡): every kept lesson, grouped by who it
 *  belongs to. A row is the lesson's short title with the time trailing, plus
 *  a muted owner/source suffix — the full record (summary and all) opens as a
 *  center pane when clicked (App owns that). At the top sits the one switch
 *  for the mechanism's auto side: settings.json autoRefine.enabled, a GLOBAL
 *  setting (one value for every agent and workspace) — which is why it lives
 *  here and not per agent in the Inspector. */
export function LearnedColumn(props: {
  selected: LearnedSel | null;
  /** Bumped when a new lesson lands — re-pulls the list. */
  epoch: number;
  /** Other root agents currently in the roster — their own lessons ride along. */
  roots: string[];
  /** Master's auto-refine block (schema 27) — the checkbox's current truth;
   *  null on old daemons or before attach: the checkbox stays hidden then
   *  rather than showing a state nobody verified. */
  autoRefine: AutoRefineInfo | null;
  online: boolean;
  onSelect: (s: LearnedSel | null) => void;
  /** Writes the global setting through the bridge; resolves once every live
   *  agent has been told to re-read it. */
  onToggleAuto: (enabled: boolean) => Promise<void>;
}) {
  const t = useT();
  const [rows, setRows] = useState<LessonRecord[] | null>(null);
  const [togglePending, setTogglePending] = useState(false);
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
    const src = lessonRowSourceText(r.source);
    // A review that applied nothing is still a record, but it is not something
    // the agent learned — say so in the row so nobody opens it to find out.
    const nil = r.changes !== undefined && r.changes.length === 0 ? t("no change") : null;
    // No avatars here — attribution is the muted "owner · source" suffix.
    const meta = [r.owner, src, nil].filter((part): part is string => part !== null);
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

  const ar = props.autoRefine;
  const toggleAuto = (enabled: boolean) => {
    setTogglePending(true);
    props
      .onToggleAuto(enabled)
      .catch(() => undefined) // write failed — the checkbox simply stays put
      .finally(() => setTogglePending(false));
  };

  return (
    <aside className="col2">
      <div className="sec">{t("Self-evolution")}</div>
      <div className="lhint">{t("what agents pick up while working — later work uses it.")}</div>
      {/* The auto side's one real control. Hidden (not faked) when the daemon
          predates the status block or the bridge is detached. */}
      {ar !== null && (
        <>
          <label className="lauto">
            <input
              type="checkbox"
              checked={ar.enabled}
              disabled={togglePending || !props.online}
              onChange={(e) => toggleAuto(e.target.checked)}
            />
            <span>{t("let agents learn on their own")}</span>
          </label>
          {ar.enabled && (
            <div className="lhint">
              {t(
                "about every {n} turns, or when it tidies its context — at most once per {m} minutes.",
                {
                  n: ar.turnInterval ?? 25,
                  m: Math.round((ar.cooldownMs ?? 20 * 60_000) / 60_000),
                },
              )}
            </div>
          )}
        </>
      )}
      {rows !== null && rows.length === 0 && (
        <>
          <div className="colnote">
            {t("nothing learned yet.")}
            <br />
            {t("agents keep small improvements as they work — they appear here on their own.")}
          </div>
          {/* One dimmed sample so the first open shows what a lesson looks
              like; the first real record takes its place. */}
          <div className="lsn eg">
            <span className="ttl">
              <span className="tx">{t("keep reports under three sentences")}</span>
            </span>
            <span className="meta">{t("example · real records replace this")}</span>
          </div>
        </>
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
