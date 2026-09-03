/* The sample crew.
 *
 * A workspace where nothing has ever run shows a master on its own, which
 * demonstrates nothing — so the column stands in a crew of four, and opening
 * one shows the exchange it would have had. Every word here is written, not
 * recorded: no session, no daemon, nothing running. That is the whole reason
 * each surface says 示例 out loud, and why the rows retire the instant a real
 * helper exists.
 *
 * Written, but not invented. Two rules hold it to the real thing:
 *
 * 1. Shape. A helper says what it is about to do, takes its steps, then
 *    reports — and a tool row carries what the bridge really puts in it
 *    (`python · <first line of the code>`, cut at 60 characters). "python" on
 *    its own says nothing about the work, and a sample that shows less than
 *    the live pane teaches the wrong lesson. preview.publish is a call inside
 *    the REPL, not a tool of its own, so it appears the way it appears.
 * 2. Size. This is one whole job — audit, clean, compute, write, publish,
 *    check — carried by four helpers across an afternoon, because the crew is
 *    the product and two exchanged sentences do not show a crew doing work.
 *    The numbers reconcile: 48,912 rows less 316 duplicates is the 48,596
 *    orders that divide the revenue into the average order value.
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
    task: "audit the data in raw/",
    state: "done",
    at: "14:22",
    turns: [
      {
        kind: "reply",
        at: "14:16",
        text: "Nothing gets touched yet — what we can claim depends on what is actually in raw/.",
      },
      { kind: "tool", text: "python · [p.name for p in Path(\"raw\").iterdir()]", status: "done" },
      { kind: "tool", text: "python · df = pd.read_csv(\"raw/orders_2025q3.csv\")", status: "done" },
      {
        kind: "reply",
        at: "14:18",
        text: "Three files. `orders_2025q3.csv` is 48,912 rows covering July to September, with enough columns for revenue, order count and average order value. `refunds.csv` and `regions.xlsx` cover the rest.",
      },
      { kind: "tool", text: "python · df.isna().sum()[lambda s: s > 0]", status: "done" },
      { kind: "tool", text: "python · df.duplicated(\"order_id\").sum()", status: "done" },
      {
        kind: "reply",
        at: "14:20",
        text: "Two problems, both from the re-run export on 8/17: 1,204 rows have no `region` (2.5%), and 316 order ids appear twice. Neither is fatal — but any average computed before fixing them is wrong.",
      },
      { kind: "tool", text: "python · rf[\"ts\"].dt.tz, df[\"created_at\"].dt.tz", status: "done" },
      {
        kind: "reply",
        at: "14:21",
        text: "A third one, subtler: refunds are stamped UTC, orders are local. Joined as they are, any refund before 8am local falls back onto the day before — and at the turn of each month, into the month before.",
      },
      { kind: "tool", text: "python · Path(\"notes/data-audit.md\").write_text(audit)", status: "done" },
      {
        kind: "reply",
        at: "14:22",
        text: "It can be built. `notes/data-audit.md` now holds the three fixes and the definitions I would hold everyone to: revenue booked by local order time, refunds reported on their own line and never netted off.",
      },
    ],
  },
  {
    name: "analyst",
    task: "clean the data and compute the quarter",
    state: "done",
    at: "14:41",
    turns: [
      {
        kind: "reply",
        at: "14:24",
        text: "Fixes first, numbers second — the other order produces a plausible-looking wrong answer.",
      },
      { kind: "tool", text: "python · df = df.drop_duplicates(\"order_id\")", status: "done" },
      { kind: "tool", text: "python · df.region = df.region.fillna(store_map(df))", status: "done" },
      { kind: "tool", text: "python · rf.ts = rf.ts.dt.tz_convert(\"Asia/Shanghai\")", status: "done" },
      {
        kind: "reply",
        at: "14:29",
        text: "316 duplicates dropped. 1,187 of the missing regions came back from the store map in `regions.xlsx`; the last 17 belong to closed stores, so they get their own bucket rather than a guess.",
      },
      { kind: "tool", text: "python · q3 = quarter(df, rf)", status: "done" },
      { kind: "tool", text: "python · dump(q3, \"data/figures.json\")", status: "done" },
      {
        kind: "reply",
        at: "14:36",
        text: "Q3: revenue ¥8,412,660, up 11.3% on Q2. 48,596 orders, average order value ¥173.1 — down 2.4%. The quarter grew on volume, not on basket size.",
      },
      { kind: "tool", text: "python · save_chart(q3, \"data/revenue.png\", dpi=180)", status: "done" },
      { kind: "tool", text: "python · q3[\"by_region\"].sort_values(\"qoq\").head(3)", status: "done" },
      {
        kind: "reply",
        at: "14:39",
        text: "All of the growth is East and South China. Southwest has been negative two months running — 6.8% then 9.1% — and refunds there run 5.2% against 3.1% nationally. That is the one thing in this quarter worth acting on.",
      },
      { kind: "tool", text: "python · abs(q3[\"revenue\"] - df.amount.sum()) < 0.01", status: "done" },
      {
        kind: "reply",
        at: "14:41",
        text: "Cross-checked: the total rebuilt from `data/figures.json` matches the raw sum to the cent. Figures and charts are in `data/` — writer can quote them directly.",
      },
    ],
  },
  {
    name: "writer",
    task: "write it into a one-page report and publish",
    state: "running",
    turns: [
      {
        kind: "reply",
        at: "14:43",
        text: "One page, one file, no external assets — it has to open for whoever it gets forwarded to. The finding goes at the top.",
      },
      { kind: "tool", text: "python · figures = load_json(\"data/figures.json\")", status: "done" },
      { kind: "tool", text: "python · b64 = encode(\"data/revenue.png\")", status: "done" },
      { kind: "tool", text: "python · write(\"report/index.html\", page(figures, b64))", status: "done" },
      {
        kind: "reply",
        at: "14:52",
        text: "Draft is up: the one-line finding, four headline numbers, the regional table, the revenue chart, and the definitions at the foot so nobody re-litigates the numbers. The chart is inlined as base64, so it stays a single file.",
      },
      { kind: "tool", text: "python · await preview.publish(\"report/index.html\")", status: "done" },
      {
        kind: "reply",
        at: "14:53",
        text: "First version published — it should have opened on the right. Reading it back: the Southwest finding is buried in the regional table, which is the wrong place for the only actionable thing in here.",
      },
      { kind: "tool", text: "python · write(\"report/index.html\", restyle(html))", status: "done" },
      {
        kind: "reply",
        at: "15:01",
        text: "Second pass: Southwest is its own block under the headline, the table drops to supporting evidence, and the type scale is down to two sizes. Publishing so the two versions can sit side by side.",
      },
      { kind: "tool", text: "python · await preview.publish(\"report/index.html\")", status: "running" },
    ],
  },
  {
    name: "checker",
    task: "check the numbers in both versions",
    state: "queued",
    turns: [],
  },
];

export const sampleById = (id: string): SampleAgent | null =>
  SAMPLE_CREW.find((a) => `eg:${a.name}` === id) ?? null;

export const isSampleId = (id: string): boolean => id.startsWith("eg:");
