import { useState } from "react";
import type { AutoRefineInfo } from "../types";
import { getLang, useT } from "../i18n";
import { ENTRY_KINDS, harnessStats, hasVerdicts, type HarnessData, type HarnessStats } from "../runtime/learned";
import { SAMPLE_HARNESS } from "../sampleHarness";
import { LearnedCurve } from "./LearnedCurve";

function clock(ms: number): string {
  const locale = getLang() === "zh" ? "zh-CN" : undefined;
  return new Date(ms).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

/** The ⚡ pane with nothing picked: what this mechanism has actually done, in
 *  three bands — the counts, the composition in words, and the one chart.
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

  const ar = props.autoRefine;
  const toggle = (enabled: boolean) => {
    setPending(true);
    props
      .onToggleAuto(enabled)
      .catch(() => undefined) // write failed — the checkbox simply stays put
      .finally(() => setPending(false));
  };

  // `mark` is the tile's place in the group: "grp" opens the second group,
  // "sub" is a subset of the tile before it — drawn smaller, so the two totals
  // are what the eye lands on first.
  const tile = (n: number, label: string, mark?: "grp" | "sub") => (
    <div className={mark === undefined ? "t" : `t ${mark}`}>
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
      {/* Two groups, not four peers: what it knows now, then how it got there.
          The last two are subsets of "rounds run" and read as its subordinates. */}
      <div className="kpi">
        {tile(s.entries, t("kept now"))}
        {tile(s.rounds, t("rounds run"), "grp")}
        {tile(s.rollbacks, t("undone"), "sub")}
        {tile(s.noops, t("changed nothing"), "sub")}
      </div>

      {/* Both rows below count the same population — the entries kept right now.
          Stacked bare they read as one list of seven categories, so each says
          what it counts. */}
      <div className="brk">
        <div className="bl">{t("kept, by kind")}</div>
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
      </div>

      {/* Is any of it doing anything. Hidden until a round running the counters
          has judged at least one entry — a row of zeroes would read as "none of
          it works" when it actually means "nobody has looked". */}
      {hasVerdicts(entries) && (
        <div className="brk">
          <div className="bl">{t("is it helping")}</div>
          <div className="kinds">
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
