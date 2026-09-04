import { useSyncExternalStore } from "react";

/** One picked model backs master when the daemon is not there. A `claude-*`
 *  id chats through the local Claude Code CLI (the bridge spawns the user's
 *  own `claude -p` login and passes the id to its --model flag); a `gw:` id
 *  goes to Vercel AI Gateway; any other id is a NIM cloud model. One value ⇒
 *  no two backends can ever be active at once. */

declare const __NIM_MODEL__: string;

/** The Claude Code models offered. `claude -p --model` takes a model's full
 *  name, so these ids go through verbatim; the first is the default pick. */
export const CLAUDE_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "claude-opus-5", label: "Claude Opus 5" },
  { id: "claude-fable-5", label: "Claude Fable 5" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];

export const CLAUDE_PICK = CLAUDE_MODELS[0].id;

/** What was stored back when the picker had one undifferentiated "Claude
 *  Code" row — it now means the default Claude model. */
const LEGACY_CLAUDE = "claude";

export function isClaudePick(id: string): boolean {
  return id === LEGACY_CLAUDE || id.startsWith("claude-");
}

/** The NIM models offered, with the build's default on top. Labels drop the
 *  vendor prefix. Every id is verified against the live NIM /v1/models catalog
 *  (2026-09-03) — the catalog rotates, so re-check before editing this list.
 *  `openai/gpt-oss-120b` was dropped after NIM retired it (410 Gone, end of
 *  life 2026-09-03); the surviving `gpt-oss-20b` is not worth a row. The
 *  default is Pro rather than Flash: they sit a point apart on general
 *  intelligence, but Pro leads coding and agentic work by a wide margin, and
 *  the two smallest models measurably fail to follow the client system
 *  prompt. */
const NIM_MODELS: ReadonlyArray<{ id: string; label: string }> = Array.from(
  new Set([
    __NIM_MODEL__,
    "deepseek-ai/deepseek-v4-pro-0813",
    "deepseek-ai/deepseek-v4-flash-0731",
    "moonshotai/kimi-k3",
    "minimaxai/minimax-m3",
    "nvidia/nemotron-3-super-120b-a12b",
    "nvidia/nemotron-3.5-lightning-30b-a3b",
  ]),
).map((m) => ({ id: m, label: m.split("/").pop() ?? m }));

/** Vercel AI Gateway: one key, four vendors, reached through the bridge's /gw
 *  proxy — the key stays in the bridge, so this list is the whole of what the
 *  bundle knows. The ids are the gateway's own `creator/model` slugs, checked
 *  against its live /v1/models catalog (2026-09-04).
 *
 *  They are stored behind a `gw:` prefix because a bare slug is ambiguous:
 *  `deepseek/deepseek-v4-flash` here and `deepseek-ai/deepseek-v4-flash-0731`
 *  on NIM are two routes to near enough the same model, and a remembered pick
 *  has to say which backend it meant. */
export const GATEWAY_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "gw:anthropic/claude-opus-5", label: "Claude Opus 5" },
  { id: "gw:moonshotai/kimi-k3", label: "Kimi K3" },
  { id: "gw:deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { id: "gw:stepfun/step-3.7-flash", label: "Step 3.7 Flash" },
];

const GW_PREFIX = "gw:";

export function isGatewayPick(id: string): boolean {
  return id.startsWith(GW_PREFIX);
}

/** Everything the composer's picker offers, in the order it groups them:
 *  Claude Code, then the gateway, then NIM. */
export const MODEL_PICKS: ReadonlyArray<{ id: string; label: string }> = [
  ...CLAUDE_MODELS,
  ...GATEWAY_MODELS,
  ...NIM_MODELS,
];

const KEY = "model.pick";

function load(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v === LEGACY_CLAUDE) return CLAUDE_PICK; // picked before models were listed
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

export function getActiveProvider(): "claude" | "gateway" | "nim" {
  if (isClaudePick(pick)) return "claude";
  return isGatewayPick(pick) ? "gateway" : "nim";
}

/** The model the Claude Code CLI is asked for (only meaningful while the
 *  active provider is claude). */
export function getClaudeModel(): string {
  return isClaudePick(pick) && pick !== LEGACY_CLAUDE ? pick : CLAUDE_PICK;
}

export function getNimModel(): string {
  return getActiveProvider() === "nim" ? pick : __NIM_MODEL__;
}

/** The slug sent to the gateway, with the storage prefix off (only meaningful
 *  while the active provider is gateway). */
export function getGatewayModel(): string {
  const id = isGatewayPick(pick) ? pick : GATEWAY_MODELS[0].id;
  return id.slice(GW_PREFIX.length);
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
