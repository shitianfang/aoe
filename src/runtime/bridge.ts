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
  | { type: "event"; event: Record<string, unknown> };

// Packaged app: Electron main hosts the daemon bridge and hands its port over
// via the page query. Dev: same-origin Vite proxy.
const pbridge = new URLSearchParams(window.location.search).get("pbridge");
const BRIDGE_BASE = pbridge ? `http://127.0.0.1:${pbridge}` : "";

export function openBridge(onMessage: (m: BridgeMessage) => void): { close: () => void } {
  const es = new EventSource(`${BRIDGE_BASE}/bridge/events`);
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
  const res = await fetch(`${BRIDGE_BASE}/bridge/cmd`, {
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

export interface WorkspaceInfo {
  name: string;
  pinned: boolean;
  state: "running" | "idle" | "off";
}

export async function fetchWorkspaces(): Promise<{ current: string; workspaces: WorkspaceInfo[] }> {
  const r = await fetch(`${BRIDGE_BASE}/bridge/workspaces`);
  if (!r.ok) throw new Error(`workspaces failed (${r.status})`);
  return r.json();
}

export async function switchWorkspace(name: string): Promise<void> {
  const r = await fetch(`${BRIDGE_BASE}/bridge/workspace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) throw new Error(data.error || `switch failed (${r.status})`);
}

/** Absolute-ify a /bridge/* path for the current host (dev proxy or packaged). */
export function bridgeUrl(p: string): string {
  return `${BRIDGE_BASE}${p}`;
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
