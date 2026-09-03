import { useT } from "../i18n";
import type { HarnessStats } from "../runtime/learned";

/** Plot box. Small on purpose — this sits inside a pane, not on a dashboard. */
const W = 344;
const H = 92;
const PAD_R = 78; // room for the two end labels
const PAD_B = 16; // room for the x labels
const PAD_T = 8; // headroom, so the top line does not hug the edge

/** Written-versus-surviving, one point per round.
 *
 *  Both series are real and neither is trivial: `written` counts every lesson
 *  the agent ever committed, `alive` counts the ones still standing after every
 *  rollback and delete. The gap between them is the whole message — effort that
 *  did not survive contact with you — which is the honest version of the
 *  "ours versus baseline" shape, using numbers this runtime actually records.
 *
 *  Drawn as step segments, never smoothed: the value changes at a round, not
 *  between rounds, and a curve through them would invent readings that were
 *  never taken. No grid, no axis box, no legend box — the lines are labelled at
 *  their ends, so identity never rests on colour alone. */
export function LearnedCurve(props: { stats: HarnessStats }) {
  const t = useT();
  const pts = props.stats.curve;
  if (pts.length < 2) return null; // one round is not a trend

  const top = Math.max(1, ...pts.map((p) => p.written));
  const x = (k: number) => ((k - 1) / (pts.length - 1)) * (W - PAD_R);
  const y = (v: number) => PAD_T + (H - PAD_B - PAD_T) * (1 - v / top);

  /** Step path: hold the previous value across, then jump at the round. */
  const step = (pick: (p: (typeof pts)[number]) => number) => {
    let d = `M ${x(pts[0].k)} ${y(pick(pts[0]))}`;
    for (let i = 1; i < pts.length; i += 1) {
      d += ` H ${x(pts[i].k)} V ${y(pick(pts[i]))}`;
    }
    return d;
  };

  const last = pts[pts.length - 1];
  const endX = x(last.k);
  // `written` can never be below `alive`, so its label is always the upper one.
  // When the two lines finish close together the labels would collide, so they
  // are pushed apart around their midpoint and kept inside the box.
  const yW = y(last.written);
  const yA = y(last.alive);
  const NEED = 13;
  let lw = yW;
  let la = yA;
  if (la - lw < NEED) {
    const mid = (lw + la) / 2;
    lw = mid - NEED / 2;
    la = mid + NEED / 2;
  }
  // Keep the pair inside the box without collapsing the gap again.
  if (lw < 6) {
    la += 6 - lw;
    lw = 6;
  }
  const floor = H - PAD_B - 2;
  if (la > floor) {
    lw -= la - floor;
    la = floor;
  }

  return (
    <div className="curve">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t("written versus still standing")}>
        {/* baseline only — a grid here would be scaffolding left up after the build */}
        <line x1="0" y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} className="ax" />
        <path d={step((p) => p.written)} className="ln written" />
        <path d={step((p) => p.alive)} className="ln alive" />
        {pts.map((p) => (
          <circle key={p.k} cx={x(p.k)} cy={y(p.alive)} r="1.6" className="pt">
            <title>{`${p.label || t("lesson")} · ${t("kept now")} ${p.alive} / ${p.written}`}</title>
          </circle>
        ))}
        {/* short leaders, so a pushed-apart label still points at its line */}
        <line x1={endX} y1={yW} x2={endX + 4} y2={lw} className="ld" />
        <line x1={endX} y1={yA} x2={endX + 4} y2={la} className="ld on" />
        <text x={endX + 7} y={lw + 3} className="lb">
          {t("written")} {last.written}
        </text>
        <text x={endX + 7} y={la + 3} className="lb on">
          {t("still standing")} {last.alive}
        </text>
        <text x="0" y={H - 4} className="tk">
          1
        </text>
        <text x={W - PAD_R} y={H - 4} textAnchor="end" className="tk">
          {t("{n} rounds", { n: pts.length })}
        </text>
      </svg>
    </div>
  );
}
