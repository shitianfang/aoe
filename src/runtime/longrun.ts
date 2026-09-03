/* Long-running mode: the composer switch that hands master the decision.
 *
 * The three ways a session keeps itself going all have kernel APIs — goal
 * (goal.create), scheduled wake-ups (rlm_heartbeat.create) and unattended
 * (autonomous.enable, added to the fork alongside the other two). This module
 * only writes the instruction that asks master to pick one; the client never
 * guesses which, and never turns anything on behind the user's back.
 *
 * Both skills guard themselves with "only when the user or system/developer
 * instructions explicitly ask" — this preamble IS that explicit ask, sent in
 * the user's own turn, so the switch satisfies the guardrail rather than
 * routing around it. Whatever master starts then shows up in DRIVERS on its
 * own (goal_update / heartbeats_changed / autonomous_status), so the panel
 * stays the honest record of what is driving the run.
 */

/** Default token budget handed to goal.create when the user named none. An
 *  objective with no budget only stops on completion or error, and that is not
 *  a thing to switch on from a checkbox. */
const DEFAULT_GOAL_BUDGET = 400_000;

export const LONG_RUN_PREAMBLE = `[long-running mode]
The user switched on long-running mode for this request: they are explicitly asking you to keep this work going without them. Before you start, set up exactly ONE of the following from the Python REPL — whichever actually fits the work:

- await goal.create(objective, token_budget=${DEFAULT_GOAL_BUDGET}) — for work that should be pursued across many turns until it is achieved. Always pass a token_budget; use the number above unless the user named one.
- await rlm_heartbeat.create(instruction, interval="30m") — for work that should be revisited on a schedule rather than run continuously.
- await autonomous.enable(turns=..., tokens=..., time=..., continuations=...) — for a single long task that must not stop early at the first ambiguity.

Pick one, and say in a single short line which you picked and why. Do not set up more than one. If one of them is already active for this session, keep it, say so, and move on. If a call is unavailable in this session, pick one of the others. Then do the work.

The user's request follows.`;

/** The text actually sent to the runtime: the ask, then the user's message.
 *  The timeline still shows the user's own words plus a note row saying the
 *  mode was applied — the preamble is never passed off as something they typed. */
export function withLongRun(text: string): string {
  return `${LONG_RUN_PREAMBLE}\n\n${text}`;
}

/** Undo withLongRun for a replayed transcript. The runtime stores the message
 *  as it was sent, preamble included, so an attach or restart would otherwise
 *  redisplay the whole ask as something the user typed. Returns the user's own
 *  words plus whether the preamble was there. */
export function stripLongRun(text: string): { text: string; longRun: boolean } {
  const head = `${LONG_RUN_PREAMBLE}\n\n`;
  if (!text.startsWith(head)) return { text, longRun: false };
  return { text: text.slice(head.length), longRun: true };
}
