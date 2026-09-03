/**
 * One agent turn through the Claude Code CLI. Requests go through the local
 * bridge (/bridge/claude), which runs the user's own `claude -p` login with
 * tools enabled — there is no key handling in this bundle. The bridge returns
 * a session id; sending it back resumes the same conversation
 * (`claude --resume`), so no history array. Tool activity arrives as frames
 * and surfaces through onTool (e.g. "Bash · npm test").
 */

import { bridgeUrl } from "./bridge";
import type { ClaudeSubagent } from "../types";

let sessionId: string | null = null;

export async function streamClaudeTurn(
  text: string,
  system: string,
  onDelta: (t: string) => void,
  onTool?: (label: string) => void,
  onSubagent?: (sa: ClaudeSubagent) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(bridgeUrl("/bridge/claude"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, sessionId: sessionId ?? undefined, system }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`model request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.trim();
      if (!data.startsWith("data:")) continue;
      const payload = data.slice(5).trim();
      let frame: {
        type?: string;
        text?: string;
        sessionId?: string;
        message?: string;
        name?: string;
        detail?: string;
        id?: string;
        label?: string;
        status?: string;
      };
      try {
        frame = JSON.parse(payload);
      } catch {
        continue; // partial frame — ignored, completed on next chunk
      }
      if (frame.type === "delta" && frame.text) {
        full += frame.text;
        onDelta(frame.text);
      } else if (frame.type === "tool" && frame.name) {
        onTool?.(frame.detail ? `${frame.name} · ${frame.detail}` : frame.name);
      } else if (frame.type === "subagent" && frame.id) {
        onSubagent?.({
          id: frame.id,
          label: frame.label || "subagent",
          status: frame.status === "done" ? "done" : "running",
        });
      } else if (frame.type === "done") {
        if (frame.sessionId) sessionId = frame.sessionId;
      } else if (frame.type === "error") {
        throw new Error(frame.message || "claude request failed");
      }
    }
  }
  return full;
}
