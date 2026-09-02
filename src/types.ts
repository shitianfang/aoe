export type Theme = "light" | "dark";

export type AgentState = "idle" | "working";

export type CenterView = "timeline" | "learned" | "preview";
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

/** RlmChildAgentSnapshot subset we render. */
export interface ChildInfo {
  id: string;
  label: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  repliedSinceTask?: boolean;
  activeSessionId?: string;
  sessionName?: string;
  answerPreview?: string;
  recap?: string;
  error?: string;
}

/** One line in a helper's observed-events list (from master's timeline + child updates). */
export interface HelperEvent {
  id: string;
  tone: "" | "cyan" | "amber" | "violet" | "good" | "bad";
  text: string;
  rt: string;
}

/** One row in the Files column, derived from timeline tool events. */
export interface FileActivity {
  path: string;
  name: string;
  who: string;
  at: string;
}

/** Preview pipeline state; the publish pipeline does not exist yet, so the
 *  provider returns null and the view shows an honest empty state. */
export interface PreviewVersion {
  label: string;
  at: string;
}
export interface PreviewState {
  fileName: string;
  live: boolean;
  versions: PreviewVersion[];
  between: Array<{ id: string; text: string; rt: string; tone: "" | "good" | "bad" }>;
}

export interface BridgeState {
  connected: boolean;
  error?: string | null;
  workspace?: string | null;
}

/** AgentCronJob subset we render in Re-entry. */
export interface HeartbeatInfo {
  id: string;
  status: string;
  source?: string;
  label?: string;
  prompt: string;
  deliveryMode?: string;
  schedule?: { expression?: string };
  nextRunAt?: string;
}

/** AgentAutonomousStatus subset (read from autonomous_status custom messages). */
export interface AutonomousInfo {
  enabled: boolean;
  continuationsUsed?: number;
  turnsUsed?: number;
  tokensUsed?: number;
  limits?: { maxContinuations?: number; maxTurns?: number; maxTokens?: number; timeoutMs?: number };
  lastGateFailure?: { command?: string; attempt?: number };
}

/** Composer target: master, or a helper (addressed by child id). */
export type ComposerTarget = { kind: "master" } | { kind: "helper"; childId: string };

export type DeliveryMode = "now" | "after";

export interface AppState {
  theme: Theme;
  master: AgentState;
  timeline: TimelineItem[];
  view: CenterView;
  column: ColumnView;
  /** Selected agent in the left column: null = master (timeline), else child id. */
  selectedAgent: string | null;
  bridge: BridgeState | null;
  goal: GoalInfo | null;
  children: ChildInfo[];
  helperEvents: Record<string, HelperEvent[]>;
  files: FileActivity[];
  preview: PreviewState | null;
  heartbeats: HeartbeatInfo[];
  autonomous: AutonomousInfo | null;
  target: ComposerTarget;
  delivery: DeliveryMode;
  /** Last error surfaced to the strip, if any. */
  error?: string;
}
