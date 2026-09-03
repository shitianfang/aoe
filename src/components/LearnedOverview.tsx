import { useState } from "react";
import type { AutoRefineInfo } from "../types";
import { getLang, useT } from "../i18n";
import { ENTRY_KINDS, harnessStats, hasVerdicts, type HarnessData, type HarnessStats } from "../runtime/learned";
import { SAMPLE_HARNESS } from "../sampleHarness";
import { LearnedCurve } from "./LearnedCurve";

/** Days the activity strip covers. Fixed, so the strip means the same thing
 *  every time it is opened — a window that grows with the data would make a
 *  quiet week and a busy week look alike. */
const WINDOW_DAYS = 21;

function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  const locale = getLang() === "zh" ? "zh-CN" : undefined;
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function clock(ms: number): string {
  const locale = getLang() === "zh" ? "zh-CN" : undefined;
  return new Date(ms).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

/** The ⚡ pane with nothing picked: what this mechanism has actually done.
 *  Four numbers, the composition in words, and one strip for rhythm — the only
 *  question a chart answers here that a number cannot is "is it still going".
 *  Four nominal kinds at n≈10 do not earn a stacked bar, and the categorical
 *  hues in this shell already mean "which agent", so the counts stay as text. */
export function LearnedOverview(props: {
  data: HarnessData;
  stats: HarnessStats;
  autoRefine: AutoRefineInfo | null;
  online: boolean;
  onToggleAuto: (enabled: boolean) => Promise<void>;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  // A workspace that has learned nothing shows four zeroes and no curve, which
  // demonstrates nothing. Stand in the worked example instead — dimmed, said out
  // loud, and gone the instant one real entry exists.
  const eg = props.data.entries.length === 0;
  const s = eg ? harnessStats(SAMPLE_HARNESS) : props.stats;
  const entries = eg ? SAMPLE_HARNESS.entries : props.data.entries;

  // Right-align the window on the last round so the newest column is always
  // the rightmost one, and pad the left with quiet days.
  const tail = s.days.slice(-WINDOW_DAYS);
  const pad = Math.max(0, WINDOW_DAYS - tail.length);
  const back = (day: string, n: number) => {
    const d = new Date(`${day}T00:00:00`);
    d.setDate(d.getDate() - n);
    const p = (v: number) => String(v).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const first = tail.length > 0 ? tail[0].day : "";
  const strip = [
    // Pad days carry their real date so the axis can label the window's start,
    // not just the first day that happened to have a round in it.
    ...Array.from({ length: pad }, (_, i) => ({ day: first === "" ? "" : back(first, pad - i), n: 0, kept: 0 })),
    ...tail,
  ];
  const peak = Math.max(1, ...strip.map((d) => d.n));
  // Today's column is still filling up. Drawn, but paler — a bar that will
  // grow before midnight must not read like a settled measurement.
  const now = new Date();
  const pad2 = (v: number) => String(v).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  const ar = props.autoRefine;
  const toggle = (enabled: boolean) => {
    setPending(true);
    props
      .onToggleAuto(enabled)
      .catch(() => undefined) // write failed — the checkbox simply stays put
      .finally(() => setPending(false));
  };

  const tile = (n: number, label: string) => (
    <div className="t">
      <div className={n === 0 ? "n q" : "n"}>{n}</div>
      <div className="k">{label}</div>
    </div>
  );

  return (
    <div className="ovw">
      <div className="ohead">{t("what agents pick up while working — later work uses it.")}</div>
      {/* Said before the numbers, not after: everything under this line is
          written copy, and a reader must know that before reading it. */}
      {eg && (
        <div className="egnote">
          {t("example · real records replace this")}
          <br />
          {t("nothing has been learned in this workspace yet.")}
        </div>
      )}

      <div className={eg ? "egblock" : undefined}>
      <div className="kpi">
        {tile(s.entries, t("kept now"))}
        {tile(s.rounds, t("rounds run"))}
        {tile(s.rollbacks, t("undone"))}
        {tile(s.noops, t("changed nothing"))}
      </div>

      <div className="kinds">
        {ENTRY_KINDS.map((kind) => {
          const n = s.byKind.find((b) => b.kind === kind)?.n ?? 0;
          return (
            <span className={n === 0 ? "kd z" : "kd"} key={kind}>
              {t(kind)}
              <span className="c">{n}</span>
            </span>
          );
        })}
      </div>

      {/* Is any of it doing anything. Hidden until a round running the counters
          has judged at least one entry — a row of zeroes would read as "none of
          it works" when it actually means "nobody has looked". */}
      {hasVerdicts(entries) && (
        <div className="kinds vd">
          <span className="kd">
            {t("helped")}
            <span className="c">{s.verdicts.helped}</span>
          </span>
          <span className={s.verdicts.hindered === 0 ? "kd z" : "kd"}>
            {t("got in the way")}
            <span className="c">{s.verdicts.hindered}</span>
          </span>
          <span className={s.verdicts.unjudged === 0 ? "kd z" : "kd"}>
            {t("not judged yet")}
            <span className="c">{s.verdicts.unjudged}</span>
          </span>
        </div>
      )}

      {/* The one chart. Its reading is the gap: learning that did not last. */}
      <LearnedCurve stats={s} />

      </div>

      {/* The auto side's one real control, with the rhythm it runs at. Hidden —
          never faked — when the daemon predates the status block. */}
      {ar !== null && (
        <div className="orule">
          <label className="lauto">
            <input
              type="checkbox"
              checked={ar.enabled}
              disabled={pending || !props.online}
              onChange={(e) => toggle(e.target.checked)}
            />
            <span>{t("let agents learn on their own")}</span>
          </label>
          {ar.enabled && (
            <div className="dim">
              {t("about every {n} turns, or when it tidies its context — at most once per {m} minutes.", {
                n: ar.turnInterval ?? 25,
                m: Math.round((ar.cooldownMs ?? 20 * 60_000) / 60_000),
              })}
              {ar.lastReviewAt !== undefined && (
                <>
                  <br />
                  {t("last auto review {at}", { at: clock(ar.lastReviewAt) })}
                  {ar.cooldownMs !== undefined &&
                    ` · ${t("next auto learn no earlier than {at}", {
                      at: clock(ar.lastReviewAt + ar.cooldownMs),
                    })}`}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
