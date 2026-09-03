import { useSyncExternalStore } from "react";

/** One picked model backs master when the daemon is not there. Picking
 *  "claude" chats through the local Claude Code CLI (the bridge spawns the
 *  user's own `claude -p` login); any other id is a NIM cloud model. One
 *  value ⇒ the two backends can never be active at once. */

declare const __NIM_MODEL__: string;

export const CLAUDE_PICK = "claude";

/** What the composer's model picker offers: Claude Code first, then the NIM
 *  models with the build's default on top. Labels drop the vendor prefix.
 *  Every id below is verified against the live NIM /v1/models catalog
 *  (2026-09) — the catalog rotates, so re-check before editing this list. */
export const MODEL_PICKS: ReadonlyArray<{ id: string; label: string }> = [
  { id: CLAUDE_PICK, label: "Claude Code" },
  ...Array.from(
    new Set([
      __NIM_MODEL__,
      "deepseek-ai/deepseek-v4-pro-0813",
      "moonshotai/kimi-k3",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
      "nvidia/nemotron-3-super-120b-a12b",
      "minimaxai/minimax-m3",
      "openai/gpt-oss-120b",
    ]),
  ).map((m) => ({ id: m, label: m.split("/").pop() ?? m })),
];

const KEY = "model.pick";

function load(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && MODEL_PICKS.some((p) => p.id === v)) return v;
  } catch {
    /* private mode */
  }
  return __NIM_MODEL__;
}

let pick: string = load();
const listeners = new Set<() => void>();

export function getModelPick(): string {
  return pick;
}

export function setModelPick(id: string) {
  if (id === pick || !MODEL_PICKS.some((p) => p.id === id)) return;
  pick = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* private mode */
  }
  for (const fn of listeners) fn();
}

export function getActiveProvider(): "claude" | "nim" {
  return pick === CLAUDE_PICK ? "claude" : "nim";
}

export function getNimModel(): string {
  return pick === CLAUDE_PICK ? __NIM_MODEL__ : pick;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function snapshot(): string {
  return pick;
}

/** Re-renders the component when the picked model changes. */
export function useModelPick(): string {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
