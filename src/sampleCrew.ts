/* The sample crew.
 *
 * A workspace where nothing has ever run shows a master on its own, which
 * demonstrates nothing — so the column stands in a crew of four, and opening
 * one shows the exchange it would have had. Every word here is written, not
 * recorded: no session, no daemon, nothing running. That is the whole reason
 * each surface says 示例 out loud, and why the rows retire the instant a real
 * helper exists.
 *
 * Written, but not invented: each pane is the shape a watched helper really
 * produces — it says what it is about to do, takes its steps, then reports.
 * Tool rows carry what the bridge puts in them (`python · <first line of the
 * code>`, capped at 60 characters), because "python" on its own says nothing
 * about the work, and a sample that shows less than the real thing teaches the
 * wrong lesson. preview.publish is a call inside the REPL, not a tool of its
 * own, so it appears the way it would actually appear.
 *
 * Names double as ids (`eg:<name>`), so the pane a row opens is found without
 * any lookup table.
 */

export interface SampleTurn {
  kind: "reply" | "tool";
  /** task/reply: the words. tool: the tool's name, detail and all. */
  text: string;
  /** tool rows only. */
  status?: "done" | "running";
  at?: string;
}

export interface SampleAgent {
  name: string;
  /** The prompt master spawned it with — the column's task line. */
  task: string;
  /** Drives the status square; one of each so the column shows every state. */
  state: "done" | "running" | "queued";
  at?: string;
  turns: SampleTurn[];
}

export const SAMPLE_CREW: SampleAgent[] = [
  {
    name: "scout",
    task: "read the workspace and list what is here",
    state: "done",
    at: "14:22",
    turns: [
      { kind: "reply", at: "14:20", text: "Reading the whole workspace first, so nothing gets rewritten twice." },
      { kind: "tool", text: 'python · sorted(p.name for p in Path(".").iterdir())', status: "done" },
      { kind: "tool", text: 'python · print(Path("notes.md").read_text())', status: "done" },
      {
        kind: "reply",
        at: "14:22",
        text: "Four files, all at the top level. `notes.md` is the only one with real content — a page outline. Nothing references anything else, so this can be rebuilt from scratch without breaking a link.",
      },
    ],
  },
  {
    name: "drafter",
    task: "write the page structure into today.html",
    state: "done",
    at: "14:26",
    turns: [
      { kind: "reply", at: "14:23", text: "Building from scout's outline: one file, no build step, opens anywhere." },
      { kind: "tool", text: 'python · outline = parse(Path("notes.md").read_text())', status: "done" },
      { kind: "tool", text: 'python · Path("today.html").write_text(render(outline))', status: "done" },
      {
        kind: "reply",
        at: "14:26",
        text: "`today.html` written — one file, no external assets. Header, a three-block day view, and a footer. Style is a placeholder; I left the class names for stylist to work against.",
      },
    ],
  },
  {
    name: "stylist",
    task: "restyle it and publish a version",
    state: "running",
    turns: [
      { kind: "reply", at: "14:28", text: "Type and spacing this pass. Colour is the pass after it." },
      { kind: "tool", text: 'python · Path("today.html").write_text(styled(html))', status: "done" },
      {
        kind: "reply",
        at: "14:31",
        text: "Type and spacing done. Publishing the first version now so there is something to compare the next pass against.",
      },
      {
        kind: "tool",
        text: 'python · await preview.publish("today.html")',
        status: "running",
      },
    ],
  },
  {
    name: "checker",
    task: "compare the last two versions and report",
    state: "queued",
    turns: [],
  },
];

export const sampleById = (id: string): SampleAgent | null =>
  SAMPLE_CREW.find((a) => `eg:${a.name}` === id) ?? null;

export const isSampleId = (id: string): boolean => id.startsWith("eg:");
