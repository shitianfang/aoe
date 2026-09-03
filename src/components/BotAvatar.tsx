import { hashSeed, IDENTITY_HUES } from "../helperDisplay";

/** One head for everyone — a tidy column; identity lives in eyes, antenna, color. */
const HEAD = { x: 5, y: 8, w: 14, h: 9 } as const;

type EyeStyle = "dot" | "star" | "diamond" | "sleepy" | "happy" | "wide";
const EYES: EyeStyle[] = ["dot", "star", "diamond", "sleepy", "happy", "wide"];

function eye(style: EyeStyle, cx: number, cy: number) {
  switch (style) {
    case "dot":
      return <circle cx={cx} cy={cy} r={1.6} fill="currentColor" stroke="none" />;
    case "star":
      return (
        <path
          d={`M ${cx} ${cy - 2.1} Q ${cx + 0.5} ${cy - 0.5} ${cx + 2.1} ${cy} Q ${cx + 0.5} ${cy + 0.5} ${cx} ${cy + 2.1} Q ${cx - 0.5} ${cy + 0.5} ${cx - 2.1} ${cy} Q ${cx - 0.5} ${cy - 0.5} ${cx} ${cy - 2.1} Z`}
          fill="currentColor"
          stroke="none"
        />
      );
    case "diamond":
      return (
        <rect
          x={cx - 1.4}
          y={cy - 1.4}
          width={2.8}
          height={2.8}
          fill="currentColor"
          stroke="none"
          transform={`rotate(45 ${cx} ${cy})`}
        />
      );
    case "sleepy":
      return <rect x={cx - 1.7} y={cy - 0.6} width={3.4} height={1.3} fill="currentColor" stroke="none" />;
    case "happy":
      return (
        <path
          d={`M ${cx - 1.9} ${cy + 1} Q ${cx} ${cy - 2.2} ${cx + 1.9} ${cy + 1}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        />
      );
    case "wide":
      return <circle cx={cx} cy={cy} r={2} fill="none" stroke="currentColor" strokeWidth={1.3} />;
  }
}

/** Deterministic generative bot face: same name → same eyes, antenna, color.
 *  Master keeps its fixed white-block face (.chip.master) — this is for everyone else. */
export function BotAvatar(props: { seed: string; sm?: boolean }) {
  const h = hashSeed(props.seed);
  const eyeStyle = EYES[Math.floor(h / 7) % EYES.length];
  const antenna = Math.floor(h / 41) % 3; // 0 none · 1 stub · 2 stub+tip
  const hue = IDENTITY_HUES[Math.floor(h / 13) % IDENTITY_HUES.length];

  const cx = HEAD.x + HEAD.w / 2;
  const eyeY = HEAD.y + HEAD.h * 0.48;
  const eyeDx = 3.4;
  const cls = `chip bot ${hue}${props.sm ? " sm" : ""}`;

  return (
    <span className={cls}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x={HEAD.x} y={HEAD.y} width={HEAD.w} height={HEAD.h} fill="none" stroke="currentColor" strokeWidth={2} />
        {antenna > 0 && (
          <rect x={cx - 0.6} y={HEAD.y - 3} width={1.2} height={3} fill="currentColor" stroke="none" />
        )}
        {antenna === 2 && (
          <rect x={cx - 1.1} y={HEAD.y - 5} width={2.2} height={2.2} fill="currentColor" stroke="none" />
        )}
        {eye(eyeStyle, cx - eyeDx, eyeY)}
        {eye(eyeStyle, cx + eyeDx, eyeY)}
      </svg>
    </span>
  );
}
