import type { HarnessData } from "./runtime/learned";

/* The sample harness.
 *
 * A workspace that has learned nothing shows four zeroes and no curve, which
 * demonstrates nothing — so the ⚡ surface stands in a small worked example:
 * four lessons an agent could plausibly have written for itself, and the eight
 * rounds that produced them. Every word here is written, not recorded. That is
 * why the surface says 示例 out loud and why all of it retires the instant one
 * real entry exists — the same bargain the Agents column makes with its sample
 * crew, and the one the ⚡ column already made with its single sample row.
 *
 * Written, but not invented. Three rules hold it to the real thing:
 *
 * 1. Shape. These are the records the runtime actually writes: entries carry
 *    an id, kind, title, content, path and version; rounds carry a summary, a
 *    source, and `changes` in the harness's own "${action} ${kind}:${id}" form.
 *    Everything the screen shows is derived from them the same way it is
 *    derived from real ones — nothing is hand-placed.
 * 2. Arithmetic. Five lessons were ever written and four are still standing,
 *    because round 4 rolls back round 3; that gap is the whole reading of the
 *    curve, so it has to come out of the rounds rather than be asserted. One
 *    round changed nothing, which is the state the real store is in today.
 * 3. Honesty about what is not known. `blind_review` carries no verdict at
 *    all — absent counters mean no round has judged it, and the example would
 *    teach the wrong lesson if every row came pre-scored.
 *
 * Strings are English source keys, translated at render like every other
 * string in the shell.
 */

const AT = {
  d1: "2026-08-29T09:12:00.000Z",
  d2: "2026-08-31T03:20:00.000Z",
  d3a: "2026-09-01T05:11:02.000Z",
  d3b: "2026-09-01T05:11:40.000Z",
  d4: "2026-09-01T14:02:00.000Z",
  d5: "2026-09-02T08:44:00.000Z",
  d6: "2026-09-03T03:32:30.000Z",
  d7: "2026-09-03T21:40:00.000Z",
};

export const SAMPLE_HARNESS: HarnessData = {
  entries: [
    {
      id: "report_conclusion_first",
      kind: "memory",
      owner: "master",
      title: "Lead with what changed",
      content: "End every turn with what changed first, then the detail.",
      path: "reporting",
      version: 2,
      helpful: 9,
      created_at: AT.d1,
      updated_at: AT.d7,
    },
    {
      id: "preview_no_server",
      kind: "prompt",
      owner: null,
      title: "Never start a web server",
      content: "Writing the file is what shows the work. Do not send anyone to a browser.",
      path: "preview",
      version: 1,
      helpful: 4,
      created_at: AT.d4,
      updated_at: AT.d4,
    },
    {
      id: "variants_before_building",
      kind: "prompt",
      owner: null,
      title: "Show variants before building",
      content: "For anything with a shape, put up a few versions and stop for a pick.",
      path: "alignment",
      version: 1,
      helpful: 2,
      harmful: 1,
      created_at: AT.d2,
      updated_at: AT.d2,
    },
    {
      // No verdict on purpose: absent is "nobody has judged it", not zero.
      id: "blind_review",
      kind: "skill",
      owner: "master",
      title: "Judge candidates blind",
      content: "Strip the authorship, score each candidate separately, take the majority.",
      path: "review",
      version: 1,
      created_at: AT.d5,
      updated_at: AT.d5,
    },
  ],
  // Newest first, the order the real pull returns.
  lessons: [
    {
      id: "eg_8",
      owner: "master",
      source: "auto",
      title: "Lead with what changed",
      trigger: "Say what changed before saying how it went.",
      changes: ["update memory:report_conclusion_first"],
      evidence: "Asked three times in one session to be told the outcome first.",
      outcome: "The first line of a turn is the conclusion.",
      created_at: AT.d7,
    },
    {
      id: "eg_7",
      owner: null,
      source: "manual",
      trigger: "Nothing here belongs in every workspace.",
      changes: [],
      evidence: "This round was one-off verification, with nothing reusable in it.",
      outcome: "",
      created_at: AT.d6,
    },
    {
      id: "eg_6",
      owner: "master",
      source: "agent",
      title: "Judge candidates blind",
      trigger: "Score candidates with the authorship stripped.",
      changes: ["create skill:blind_review"],
      evidence: "Scoring its own drafts, it picked its first attempt every time.",
      outcome: "A review that does not depend on who wrote it.",
      created_at: AT.d5,
    },
    {
      id: "eg_5",
      owner: null,
      source: "auto",
      title: "Never start a web server",
      trigger: "Writing the file is what shows the work.",
      changes: ["create prompt:preview_no_server"],
      evidence: "Wrote a page, then started a server and sent the user to localhost.",
      outcome: "No more localhost directions.",
      created_at: AT.d4,
    },
    {
      id: "eg_4",
      owner: "master",
      source: "manual",
      trigger: "Rollback refinement eg_3",
      changes: ["delete memory:row_short_titles"],
      evidence: "Rolled back.",
      outcome: "",
      created_at: AT.d3b,
    },
    {
      id: "eg_3",
      owner: "master",
      source: "auto",
      title: "Short titles in the list",
      trigger: "Use a short title per row instead of the whole summary.",
      changes: ["create memory:row_short_titles"],
      evidence: "Full summaries were being cut off mid-sentence in a narrow column.",
      outcome: "A row is recognisable from its first few words.",
      created_at: AT.d3a,
    },
    {
      id: "eg_2",
      owner: null,
      source: "manual",
      title: "Show variants before building",
      trigger: "Put up a few versions first, then build the one that was picked.",
      changes: ["create prompt:variants_before_building"],
      evidence: "Two jobs were thrown out half-built, both after a single proposal.",
      outcome: "The shape is agreed before the work starts.",
      created_at: AT.d2,
    },
    {
      id: "eg_1",
      owner: "master",
      source: "auto",
      title: "Lead with what changed",
      trigger: "Give the conclusion before the process.",
      changes: ["create memory:report_conclusion_first"],
      evidence: 'Asked twice: "so what actually changed?"',
      outcome: "A turn opens with its conclusion.",
      created_at: AT.d1,
    },
  ],
};
