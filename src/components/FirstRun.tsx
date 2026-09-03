import { useT } from "../i18n";

/**
 * The first thing a new user sees. Not a list of things to type — a list of
 * things to *watch*, one per capability the product already has: a small crew,
 * a wide fan-out, a real file, versions you can compare, and a run that keeps
 * itself going. Each card therefore carries two lines: the ask that gets sent,
 * and what will visibly happen when it does. Without that second line the
 * user clicks blind and the demo lands as "it typed some stuff".
 *
 * The asks are written to succeed in an empty workspace with nothing set up —
 * no repo to read, no network, no prior files. Anything that needs the
 * workspace to already contain something would open the product on a shrug.
 *
 * English is the dictionary key (see i18n.ts); the Chinese is written to be
 * clicked, not to be a translation.
 */
interface Example {
  /** Sent verbatim (translated) to master on click. */
  ask: string;
  /** What the click demonstrates, in the user's terms — never the mechanism. */
  shows: string;
  /** Sent with the composer's long-running switch flipped on first. */
  longRun?: boolean;
}

const EXAMPLES: Example[] = [
  {
    // Small crew. Three parts that genuinely do not depend on each other, so
    // the split is real work and not theatre, and master still has to merge.
    ask: "Three helpers, one each: a name, a palette, a tagline for a new app — then pick the best set.",
    shows: "a team of 3 · watch the left column",
  },
  {
    // Wide fan-out. One idea per helper is the cheapest naturally parallel
    // ask there is, and fourteen of them fill the Agents column visibly.
    ask: "Send fourteen helpers out, one idea each: things a desktop agent could do for me. Then rank them.",
    shows: "14 at once · the left column fills up",
  },
  {
    // Real file on disk. Single-file HTML because Preview renders it in a
    // sandboxed iframe with nothing to fetch; the write alone opens the pane.
    ask: "Write a single-file HTML day planner to today.html — style and script inline — then publish it.",
    shows: "a real file · Preview opens on its own",
  },
  {
    // Iteration you can see. Three passes over one file, each published, so
    // Preview has two declared snapshots to stand side by side.
    ask: "Make a poster in poster.html, then improve it three times — layout, colour, type — publishing each pass.",
    shows: "versions · Preview shows the change side by side",
  },
  {
    // Long-running. Open-ended on purpose: master has to choose a driver, and
    // whichever it picks then shows up in DRIVERS as the honest record.
    ask: "Keep an eye on this workspace while I'm away: log what changes, and what you'd do about it.",
    shows: "long-running on · it picks its own driver",
    longRun: true,
  },
];

export function FirstRun(props: {
  onExample: (text: string, opts?: { longRun?: boolean }) => void;
}) {
  const t = useT();
  return (
    <div className="firstrun">
      <div className="frh">{t("first time here — try one:")}</div>
      {EXAMPLES.map((x) => (
        <button
          key={x.ask}
          className="frx"
          onClick={() => props.onExample(t(x.ask), x.longRun ? { longRun: true } : undefined)}
        >
          <span className="ask">{t(x.ask)}</span>
          <span className="shows">{t(x.shows)}</span>
        </button>
      ))}
    </div>
  );
}
