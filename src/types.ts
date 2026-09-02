export type Theme = "light" | "dark";

export type AgentState = "idle" | "working";

export type CenterView = "timeline" | "learned";
export type ColumnView = "agents" | "files";

/** One rendered row in the master timeline. */
export type TimelineItem =
  | { kind: "divider"; id: string; text: string }
  | { kind: "user"; id: string; text: string; at: string }
  | { kind: "master"; id: string; text: string; at: string; streaming?: boolean }
  | { kind: "tool"; id: string; name: string; status: "running" | "done" | "error"; at: string };

/** GoalState subset we render (see docs/daemon-integration.md). */
export interface GoalInfo {
  active: boolean;
  status: string;
  objective?: string;
  tokenBudget?: number;
  tokensUsed?: number;
  continuationsUsed?: number;
}

/** RLM child snapshot subset we render. */
export interface ChildInfo {
  id: string;
  label: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  repliedSinceTask?: boolean;
}

export interface BridgeState {
  connected: boolean;
  error?: string | null;
}

export interface AppState {
  theme: Theme;
  master: AgentState;
  timeline: TimelineItem[];
  view: CenterView;
  column: ColumnView;
  bridge: BridgeState | null;
  goal: GoalInfo | null;
  children: ChildInfo[];
  /** Last error surfaced to the strip, if any. */
  error?: string;
}
