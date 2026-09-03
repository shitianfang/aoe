import { streamChat, type ChatMessage } from "./nim";
import { streamClaudeTurn } from "./claude";
import { getActiveProvider } from "./providers";
import { t as tr } from "../i18n";

/**
 * The resident commander of a workspace. For now it is a plain conversation
 * with whichever model extension is enabled (Claude Code or NIM); the
 * daemon-backed prime-agent runtime slots in behind the same surface later.
 */

const SYSTEM_PROMPT = [
  "You are master, the resident agent of this workspace in Prime Agent.",
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
): Promise<string> {
  const active = getActiveProvider();
  if (active === "claude") {
    const lastUser = [...history].reverse().find((m) => m.role === "user");
    return streamClaudeTurn(lastUser?.content ?? "", SYSTEM_PROMPT, onDelta, signal);
  }
  if (active === "nim") {
    return streamChat([{ role: "system", content: SYSTEM_PROMPT }, ...history], onDelta, signal);
  }
  throw new Error(tr("no model extension is enabled"));
}
