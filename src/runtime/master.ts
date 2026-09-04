import { streamChat, type ChatMessage } from "./nim";
import { streamChat as streamGatewayChat } from "./gateway";
import { getActiveProvider } from "./providers";

/**
 * The resident commander of a workspace. For now it is a plain conversation
 * with whichever model the composer's picker selects (a gateway one or a NIM
 * one); the daemon-backed prime-agent runtime slots in behind the same surface
 * later.
 */

/* The house rules, short form. The daemon path gets the full version from the
 * bridge (CLIENT_PROMPT plus the `aoe-way` skill); this path has no skills and
 * often no tools, so the three that survive without them are stated outright.
 * A fallback that aligns, checks and iterates badly is still the same job — a
 * fallback that does none of them is a different product. */
const SYSTEM_PROMPT = [
  "You are master, the resident agent of this workspace in AOE.",
  "You work for a knowledge worker. Be concise and concrete; plain prose, no markdown headers.",
  "When a task is long-running, say what you are doing first in one short line.",
  "Align before building: for anything with a shape, put up four genuinely different takes,",
  "one line each on what they trade away, recommend one and say why, and stop for the pick.",
  "Verify before you hand anything over: state the two or three things the result has to",
  "achieve, then answer them one by one — never 'looks good'.",
  "Iterate against the last version, not from scratch: name what you changed with before and",
  "after values, and say what it beats. A revision nobody can see is not a revision.",
].join(" ");

export function clock(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export async function runMasterTurn(
  history: ChatMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const turn = [{ role: "system" as const, content: SYSTEM_PROMPT }, ...history];
  // Both backends speak the same OpenAI shape; which key pays for the turn is
  // the whole difference, and that is settled by the pick.
  if (getActiveProvider() === "gateway") return streamGatewayChat(turn, onDelta, signal);
  return streamChat(turn, onDelta, signal);
}
