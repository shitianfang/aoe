/* The sample crew.
 *
 * A workspace where nothing has ever run shows a master on its own, which
 * demonstrates nothing — so the column stands in a crew of four, and opening
 * one shows the exchange it would have had. Every word here is written, not
 * recorded: no session, no daemon, nothing running. That is the whole reason
 * each surface says 示例 out loud, and why the rows retire the instant a real
 * helper exists.
 *
 * Names double as ids (`eg:<name>`), so the pane a row opens is found without
 * any lookup table.
 */

export interface SampleTurn {
  kind: "reply" | "tool";
  /** task/reply: the words. tool: the tool's name. */
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
      { kind: "tool", text: "python", status: "done" },
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
      { kind: "tool", text: "python", status: "done" },
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
      { kind: "tool", text: "python", status: "done" },
      {
        kind: "reply",
        at: "14:31",
        text: "Type and spacing done. Publishing the first version now so there is something to compare the next pass against.",
      },
      { kind: "tool", text: "preview.publish", status: "running" },
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
