/**
 * Client for the local daemon bridge (electron/bridge.mjs).
 * Dev: same-origin via the Vite proxy (/bridge/*). Packaged: same bridge,
 * hosted by Electron main.
 */

export interface BridgeHello {
  connected: boolean;
  master: { name: string; activeSessionId: string } | null;
  error?: string | null;
  workspace?: string | null;
}

export type BridgeMessage =
  | { type: "hello"; daemon: BridgeHello }
  | { type: "snapshot"; state: { goal: unknown; heartbeat: unknown }; children: unknown[]; messages: unknown[] }
  | { type: "event"; event: Record<string, unknown> }
  | { type: "heartbeats_changed" }
  | { type: "preview_update" };

export function openBridge(onMessage: (m: BridgeMessage) => void): { close: () => void } {
  const es = new EventSource("/bridge/events");
  es.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data));
    } catch {
      /* malformed frame */
    }
  };
  return { close: () => es.close() };
}

export async function bridgeCmd(
  op: string,
  text?: string,
  extra?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch("/bridge/cmd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op, text, ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `bridge command failed (${res.status})`);
  }
  return data as Record<string, unknown>;
}

export function steer(text: string): Promise<Record<string, unknown>> {
  return bridgeCmd("steer", text);
}

export function followUp(text: string): Promise<Record<string, unknown>> {
  return bridgeCmd("follow_up", text);
}

/** Message a helper (always steer-queued by the runtime); resolves to the receipt. */
export async function sendAgentMessage(
  targetActiveSessionId: string,
  text: string,
): Promise<"delivered" | "queued"> {
  const data = await bridgeCmd("agent_message", text, { target: targetActiveSessionId });
  const receipt = data.receipt as { deliveryStatus?: string } | undefined;
  return receipt?.deliveryStatus === "delivered" ? "delivered" : "queued";
}

export function stopHelper(childId: string): Promise<Record<string, unknown>> {
  return bridgeCmd("stop_helper", undefined, { target: childId });
}

export function removeHelper(childId: string): Promise<Record<string, unknown>> {
  return bridgeCmd("remove_helper", undefined, { target: childId });
}

/** Pull readable text out of an AgentMessage-shaped object. */
export function extractText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && typeof (b as { text?: string }).text === "string" ? (b as { text: string }).text : ""))
      .join("");
  }
  return "";
}
