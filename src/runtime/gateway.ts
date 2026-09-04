/**
 * Chat through Vercel AI Gateway (OpenAI-compatible). One key reaches
 * Anthropic, Moonshot, DeepSeek and StepFun; it lives in the bridge and is
 * attached there, so requests go to the local proxy (/api/gw) and this bundle
 * never holds a key — the same arrangement NIM has, for the same reason.
 */

import { getGatewayModel } from "./providers";
import type { ChatMessage } from "./nim";

// Packaged app: Electron main hosts the proxy on 127.0.0.1 and passes its port
// via the page query. Dev: same-origin Vite proxy.
const bridgePort = new URLSearchParams(window.location.search).get("bridge");
const API_BASE = bridgePort ? `http://127.0.0.1:${bridgePort}` : "";

/** The gateway answers a refusal with a sentence worth reading — a model your
 *  plan cannot reach, or a rate limit — where NIM answers with a bare status.
 *  Pull it out so the composer can show it instead of a number. */
async function failure(res: Response): Promise<Error> {
  let detail = "";
  try {
    const body = await res.json();
    detail = body?.error?.message ?? body?.message ?? "";
  } catch {
    /* not JSON — the status is all there is */
  }
  return new Error(detail || `model request failed (${res.status})`);
}

export async function streamChat(
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(`${API_BASE}/api/gw/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: getGatewayModel(),
      messages,
      temperature: 0.5,
      // Room for a reasoning model to think and still answer: Step and Kimi
      // spend this budget on reasoning tokens first, and a tight ceiling comes
      // back as an empty reply rather than a short one.
      max_tokens: 4096,
      stream: true,
    }),
    signal,
  });
  if (!res.ok || !res.body) throw await failure(res);

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
      if (payload === "[DONE]") continue;
      try {
        // A reasoning model streams its thinking as `delta.reasoning` beside
        // the answer; only the answer is shown, as with NIM's thinking:false.
        const delta: string = JSON.parse(payload).choices?.[0]?.delta?.content ?? "";
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        // partial frame — ignored, completed on next chunk
      }
    }
  }
  return full;
}
