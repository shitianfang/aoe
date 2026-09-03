import { useT } from "../i18n";

/**
 * The first thing a new user sees. Three cards, not a menu — one per thing
 * this product does that a chat box does not: it runs a crew, it leaves real
 * work behind and improves it in passes, and it keeps going without you.
 *
 * Each card leads with what it IS and what you will watch happen; the ask
 * itself sits underneath in lighter type, because nobody scans a paragraph to
 * decide what to click. The asks are written to succeed in an empty workspace
 * with nothing set up — no repo to read, no network, no prior files.
 *
 * English is the dictionary key (see i18n.ts); the Chinese is written to be
 * clicked, not to be a translation.
 */

/* Icons are drawn, never emoji: the same square language the status dots use.
   Right angles, currentColor, one stroke weight — they read as part of the
   shell rather than as pasted-in pictures. */
const ICONS: Record<string, JSX.Element> = {
  // one filled square leading three outlined ones — a master and its helpers
  crew: (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <rect x="0.5" y="0.5" width="5" height="5" fill="currentColor" stroke="none" />
      <rect x="8.5" y="0.5" width="5" height="5" />
      <rect x="0.5" y="8.5" width="5" height="5" />
      <rect x="8.5" y="8.5" width="5" height="5" />
    </svg>
  ),
  // three bars climbing — successive versions of the same thing
  passes: (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <rect x="0.5" y="9.5" width="3" height="4" fill="currentColor" stroke="none" />
      <rect x="5.5" y="5.5" width="3" height="8" fill="currentColor" stroke="none" />
      <rect x="10.5" y="1.5" width="3" height="12" fill="currentColor" stroke="none" />
    </svg>
  ),
  // a run that has started and carries on past the edge
  keeps: (
    <svg viewBox="0 0 14 14" aria-hidden="true">
      <rect x="0.5" y="4.5" width="5" height="5" fill="currentColor" stroke="none" />
      <path d="M7.5 7h2M11 7h2.5" />
    </svg>
  ),
};

interface Example {
  icon: keyof typeof ICONS;
  /** What this is, in four or five words. */
  title: string;
  /** What you will watch happen when you click it. */
  shows: string;
  /** Sent verbatim (translated) to master on click. */
  ask: string;
  /** Sent with the composer's long-running switch flipped on first. */
  longRun?: boolean;
}

const EXAMPLES: Example[] = [
  {
    icon: "crew",
    title: "One AI, a whole crew",
    shows: "the left column fills up",
    // One idea per helper is the cheapest naturally parallel ask there is, so
    // the fan-out is real work rather than theatre, and master still merges.
    ask: "Send twelve helpers out, one idea each: things a desktop agent could do for me. Then rank them.",
  },
  {
    icon: "passes",
    title: "Builds it, then makes it better",
    shows: "Preview opens itself, versions side by side",
    // Single-file HTML because Preview renders it in a sandboxed iframe with
    // nothing to fetch; publishing each pass gives it snapshots to compare.
    ask: "Make a poster in poster.html — one file, style inline. Then improve it three times: layout, colour, type. Publish each pass.",
  },
  {
    icon: "keeps",
    title: "Keeps working while you are away",
    shows: "it picks its own driver",
    // Open-ended on purpose: master has to choose a driver, and whichever it
    // picks shows up in the Inspector as the honest record of the run.
    ask: "Keep an eye on this workspace while I'm away: log what changes, and what you'd do about it.",
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
          key={x.title}
          className="frx"
          onClick={() => props.onExample(t(x.ask), x.longRun ? { longRun: true } : undefined)}
        >
          <span className="ic">{ICONS[x.icon]}</span>
          <span className="tx">
            <span className="ttl">
              {t(x.title)}
              <span className="shows">{t(x.shows)}</span>
            </span>
            <span className="ask">{t(x.ask)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
