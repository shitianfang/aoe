import { hashSeed, IDENTITY_HUES } from "../helperDisplay";

/** Head geometry variants: some bots run fat, some thin. */
const HEADS = [
  { x: 4, y: 8.5, w: 16, h: 9 },
  { x: 6.5, y: 6.5, w: 11, h: 12 },
  { x: 6, y: 7.5, w: 12, h: 11 },
  { x: 4.5, y: 7, w: 15, h: 11.5 },
  { x: 6, y: 9, w: 12, h: 8 },
] as const;

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

/** Deterministic generative bot face: same name → same body, eyes, antenna, color.
 *  Master keeps its fixed white-block face (.chip.master) — this is for everyone else. */
export function BotAvatar(props: { seed: string; ghost?: boolean; sm?: boolean }) {
  const h = hashSeed(props.seed);
  const head = HEADS[h % HEADS.length];
  const eyeStyle = EYES[Math.floor(h / 7) % EYES.length];
  const antenna = Math.floor(h / 41) % 3; // 0 none · 1 stub · 2 stub+tip
  const hue = IDENTITY_HUES[Math.floor(h / 13) % IDENTITY_HUES.length];

  const cx = head.x + head.w / 2;
  const eyeY = head.y + head.h * 0.48;
  const eyeDx = Math.max(2.6, head.w * 0.24);
  const cls = `chip bot ${props.ghost ? "ghost" : hue}${props.sm ? " sm" : ""}`;

  return (
    <span className={cls}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x={head.x} y={head.y} width={head.w} height={head.h} fill="none" stroke="currentColor" strokeWidth={2} />
        {antenna > 0 && (
          <rect x={cx - 0.6} y={head.y - 3} width={1.2} height={3} fill="currentColor" stroke="none" />
        )}
        {antenna === 2 && (
          <rect x={cx - 1.1} y={head.y - 5} width={2.2} height={2.2} fill="currentColor" stroke="none" />
        )}
        {eye(eyeStyle, cx - eyeDx, eyeY)}
        {eye(eyeStyle, cx + eyeDx, eyeY)}
      </svg>
    </span>
  );
}
