import { streamChat, type ChatMessage } from "./nim";
import { streamChat as streamGatewayChat } from "./gateway";
import { streamClaudeTurn } from "./claude";
import { getActiveProvider, getClaudeModel } from "./providers";
import type { ClaudeSubagent } from "../types";

/**
 * The resident commander of a workspace. For now it is a plain conversation
 * with whichever model the composer's picker selects (a Claude Code model, a
 * gateway one or a NIM one); the daemon-backed prime-agent runtime slots in
 * behind the same surface later.
 */

const SYSTEM_PROMPT = [
  "You are master, the resident agent of this workspace in AOE.",
  "You work for a knowledge worker. Be concise and concrete; plain prose, no markdown headers.",
  "When a task is long-running, say what you are doing first in one short line.",
].join(" ");

export function clock(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export async function runMasterTurn(
  history: ChatMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  onTool?: (label: string) => void,
  onSubagent?: (sa: ClaudeSubagent) => void,
): Promise<string> {
  if (getActiveProvider() === "claude") {
    const lastUser = [...history].reverse().find((m) => m.role === "user");
    return streamClaudeTurn(
      lastUser?.content ?? "",
      SYSTEM_PROMPT,
      onDelta,
      onTool,
      onSubagent,
      signal,
      getClaudeModel(),
    );
  }
  const turn = [{ role: "system" as const, content: SYSTEM_PROMPT }, ...history];
  // Both cloud backends speak the same OpenAI shape; which key pays for the
  // turn is the whole difference, and that is settled by the pick.
  if (getActiveProvider() === "gateway") return streamGatewayChat(turn, onDelta, signal);
  return streamChat(turn, onDelta, signal);
}
