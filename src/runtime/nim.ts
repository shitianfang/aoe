/**
 * Chat with NVIDIA NIM (OpenAI-compatible). Requests go through the local
 * proxy (/api/nim), which attaches the API key server-side — the key never
 * reaches this bundle.
 */

declare const __NIM_MODEL__: string;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function streamChat(
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/nim/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: __NIM_MODEL__,
      messages,
      temperature: 0.5,
      max_tokens: 2048,
      stream: true,
      // DeepSeek on NIM is a reasoning model; keep replies immediate.
      chat_template_kwargs: { thinking: false },
    }),
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
      if (payload === "[DONE]") continue;
      try {
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
