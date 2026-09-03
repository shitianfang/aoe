import { useSyncExternalStore } from "react";

/** Which model extension answers master when the daemon is not there: the
 *  Claude Code CLI through the local bridge, or NVIDIA NIM in the cloud.
 *  Exactly one is active, or none — a single field, so they cannot overlap. */
export type ProviderId = "nim" | "claude";

declare const __NIM_MODEL__: string;

/** The models offered in the picker — the build's default first. */
export const NIM_MODELS: readonly string[] = Array.from(
  new Set([
    __NIM_MODEL__,
    "deepseek-ai/deepseek-r1",
    "meta/llama-3.3-70b-instruct",
    "qwen/qwen2.5-coder-32b-instruct",
    "moonshotai/kimi-k2-instruct",
  ]),
);

interface ProviderState {
  active: ProviderId | null;
  nimModel: string;
}

const ACTIVE_KEY = "provider.active";
const MODEL_KEY = "provider.nimModel";

function load(): ProviderState {
  let active: ProviderId | null = "nim";
  let nimModel = __NIM_MODEL__;
  try {
    const a = localStorage.getItem(ACTIVE_KEY);
    if (a === "nim" || a === "claude") active = a;
    else if (a === "none") active = null;
    const m = localStorage.getItem(MODEL_KEY);
    if (m && NIM_MODELS.includes(m)) nimModel = m;
  } catch {
    /* private mode */
  }
  return { active, nimModel };
}

let state: ProviderState = load();
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function getActiveProvider(): ProviderId | null {
  return state.active;
}

export function getNimModel(): string {
  return state.nimModel;
}

/** One active id ⇒ enabling one extension turns the other off by construction. */
export function setActiveProvider(id: ProviderId | null) {
  if (id === state.active) return;
  state = { ...state, active: id };
  try {
    localStorage.setItem(ACTIVE_KEY, id ?? "none");
  } catch {
    /* private mode */
  }
  emit();
}

export function setNimModel(m: string) {
  if (m === state.nimModel) return;
  state = { ...state, nimModel: m };
  try {
    localStorage.setItem(MODEL_KEY, m);
  } catch {
    /* private mode */
  }
  emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function snapshot(): ProviderState {
  return state;
}

/** Re-renders the component when the active extension or NIM model changes. */
export function useProviders(): ProviderState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
