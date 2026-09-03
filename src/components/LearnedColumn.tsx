import { useEffect, useState } from "react";
import type { LearnedSel } from "../types";
import { lessonRowSourceText, lessonRowTitle } from "../helperDisplay";
import { getLang, useT } from "../i18n";
import {
  fetchHarness,
  isNoop,
  isRollback,
  parseChange,
  undoneIds,
  type HarnessData,
  type HarnessEntry,
  type LessonRecord,
} from "../runtime/learned";

/** Today's records keep just the clock; older ones a short date. */
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

/** The self-evolution home (rail ⚡). Two altitudes of one mechanism, behind a
 *  switch: what the agent knows RIGHT NOW (the harness entries — a memory's own
 *  text, a prompt note's own text) and the rounds that got it there. The first
 *  is the answer to "what did it actually learn"; it never had a home in this
 *  UI before, so the column could only ever show verdicts about edits.
 *  The auto-learn switch and the cadence line moved to the overview pane —
 *  they are status, and this column is a list. */
export function LearnedColumn(props: {
  selected: LearnedSel | null;
  /** Bumped when a new lesson lands — re-pulls the list. */
  epoch: number;
  /** Other root agents currently in the roster — their own records ride along. */
  roots: string[];
  onSelect: (s: LearnedSel | null) => void;
}) {
  const t = useT();
  const [data, setData] = useState<HarnessData | null>(null);
  const [mode, setMode] = useState<"know" | "log">("know");
  const rootsKey = props.roots.join("\n");
  useEffect(() => {
    let live = true;
    fetchHarness(props.epoch, rootsKey === "" ? [] : rootsKey.split("\n")).then((d) => {
      if (live) setData(d);
    });
    return () => {
      live = false;
    };
  }, [props.epoch, rootsKey]);

  const entries = data?.entries ?? [];
  const lessons = data?.lessons ?? [];
  const undone = undoneIds(lessons);
  /** An edit names an entry id; the readable form is that entry's own title.
   *  A delete has no entry left to name, so it falls back to the kind word. */
  const editLabel = (change: string): { mark: string; text: string } | null => {
    const c = parseChange(change);
    if (c === null) return null;
    const mark = c.action === "create" ? "+" : c.action === "delete" ? "−" : "~";
    const hit = entries.find((e) => e.id === c.id);
    return { mark, text: hit?.title || (c.action === "delete" ? t(c.kind) : c.id) };
  };

  const on = (sel: LearnedSel, what: "lesson" | "entry") =>
    props.selected !== null &&
    props.selected.id === sel.id &&
    props.selected.owner === sel.owner &&
    (props.selected.what ?? "lesson") === what;

  /** An entry row leads with the artifact's own words — the list itself answers
   *  "what is this", instead of making you open every row to find out. */
  const entryRow = (e: HarnessEntry) => {
    const sel: LearnedSel = { owner: e.owner, id: e.id, what: "entry" };
    const hit = on(sel, "entry");
    // Absent counters are not zero — they mean no round has judged this entry —
    // so the row says nothing rather than reporting a zero it cannot stand behind.
    // The row's meta line is one line that ellipsises, so it carries only what
    // earns a place at column width: what kind, whose, and the verdict. The
    // revision count is a detail and lives in the pane.
    const meta = [
      t(e.kind),
      e.owner,
      (e.helpful ?? 0) > 0 ? t("helped ×{n}", { n: e.helpful ?? 0 }) : null,
      (e.harmful ?? 0) > 0 ? t("got in the way ×{n}", { n: e.harmful ?? 0 }) : null,
    ].filter((p): p is string => p !== null && p !== "");
    return (
      <button
        key={`e-${e.owner ?? "*"}-${e.id}`}
        className={hit ? "lsn on" : "lsn"}
        onClick={() => props.onSelect(hit ? null : sel)}
      >
        <span className="ttl">
          <span className="tx">{e.title || e.id}</span>
          <span className="tm">{shortWhen(e.updated_at ?? e.created_at)}</span>
        </span>
        {e.content !== undefined && e.content !== "" && <span className="pv">{e.content}</span>}
        {meta.length > 0 && <span className="meta">{meta.join(" · ")}</span>}
      </button>
    );
  };

  /** A round's own summary, except where the harness writes machine text:
   *  a rollback's summary is "Rollback refinement refine_2026…", and a round
   *  that applied nothing has a summary about why it applied nothing. */
  const roundTitle = (r: LessonRecord): string => {
    if (isRollback(r)) return t("undid an earlier lesson");
    if (isNoop(r)) return t("looked, found nothing to change");
    return lessonRowTitle(r) ?? t("lesson");
  };

  const lessonRow = (r: LessonRecord) => {
    const sel: LearnedSel = { owner: r.owner, id: r.id, what: "lesson" };
    const hit = on(sel, "lesson");
    const src = lessonRowSourceText(r.source);
    const spent = undone.has(r.id);
    // No avatars here — attribution is the muted "owner · source" suffix.
    const meta = [
      r.owner,
      src === null ? null : t("from {source}", { source: src }),
      spent ? t("undone") : null,
    ].filter((part): part is string => part !== null);
    // What the round actually touched, by name. A summary sentence alone never
    // says which lesson moved; these do, and they are the same words the
    // "knows now" list shows.
    const edits = (r.changes ?? []).map(editLabel).filter((e): e is { mark: string; text: string } => e !== null);
    return (
      <button
        key={`l-${r.owner ?? "*"}-${r.id}`}
        className={`lsn${hit ? " on" : ""}${spent ? " spent" : ""}`}
        title={r.trigger ?? ""}
        onClick={() => props.onSelect(hit ? null : sel)}
      >
        <span className="ttl">
          <span className="tx">{roundTitle(r)}</span>
          <span className="tm">{shortWhen(r.created_at)}</span>
        </span>
        {edits.length > 0 && (
          <span className="chg">
            {edits.map((e, i) => (
              <span className="cg" key={i}>
                <i>{e.mark}</i>
                {e.text}
              </span>
            ))}
          </span>
        )}
        {meta.length > 0 && <span className="meta">{meta.join(" · ")}</span>}
      </button>
    );
  };

  /** Both lists split the same way: what belongs to one agent, and what every
   *  workspace gets. Owner null is the global harness. */
  const split = <T extends { owner: string | null }>(rows: T[]) => ({
    mine: rows.filter((r) => r.owner !== null),
    all: rows.filter((r) => r.owner === null),
  });
  const groups = mode === "know" ? split(entries) : split(lessons);
  const render = mode === "know" ? (r: unknown) => entryRow(r as HarnessEntry) : (r: unknown) => lessonRow(r as LessonRecord);
  const total = mode === "know" ? entries.length : lessons.length;

  return (
    <aside className="col2">
      <div className="sec">{t("Self-evolution")}</div>
      <div className="segs">
        <button className={mode === "know" ? "on" : ""} onClick={() => setMode("know")}>
          {t("knows now")} {entries.length}
        </button>
        <button className={mode === "know" ? "" : "on"} onClick={() => setMode("log")}>
          {t("learning log")} {lessons.length}
        </button>
      </div>
      {data !== null && total === 0 && (
        <>
          <div className="colnote">
            {mode === "know" ? t("nothing learned yet.") : t("it has not run a round yet.")}
            <br />
            {t("agents keep small improvements as they work — they appear here on their own.")}
          </div>
          {/* One dimmed sample so the first open shows what a record looks
              like; the first real one takes its place. */}
          <div className="lsn eg">
            <span className="ttl">
              <span className="tx">{t("keep reports under three sentences")}</span>
            </span>
            <span className="meta">{t("example · real records replace this")}</span>
          </div>
        </>
      )}
      {groups.mine.length > 0 && (
        <>
          <div className="sec sub">{t("for one agent")}</div>
          {groups.mine.map(render)}
        </>
      )}
      {groups.all.length > 0 && (
        <>
          <div className="sec sub">{t("for every workspace")}</div>
          {groups.all.map(render)}
        </>
      )}
    </aside>
  );
}
