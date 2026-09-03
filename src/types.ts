export type Theme = "light" | "dark";

export type AgentState = "idle" | "working";

export type CenterView = "timeline" | "learned" | "preview";
export type ColumnView = "agents" | "files";

/** One rendered row in the master timeline. */
export type TimelineItem =
  | { kind: "divider"; id: string; text: string; ts?: number }
  | { kind: "user"; id: string; text: string; at: string }
  | { kind: "master"; id: string; text: string; at: string; streaming?: boolean }
  | { kind: "tool"; id: string; name: string; status: "running" | "done" | "error"; at: string; ts?: number };

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

/** Thinned rows of a watched helper's live session (bridge helper_event,
 *  keyed by activeSessionId on the wire, by child id in AppState). */
export interface HelperMsgRow {
  kind: "msg";
  role: "user" | "assistant" | "custom";
  text: string;
  /** ISO timestamp when the message carried one. */
  at?: string | null;
}
export interface HelperToolRow {
  kind: "tool";
  /** toolCallId — lets an _end update the row its _start appended. */
  id?: string;
  name: string;
  status: "running" | "done" | "error";
}
export type HelperTranscriptRow = HelperMsgRow | HelperToolRow;
/** What the bridge broadcasts: append msg/tool, replace-all on resync. */
export type HelperFeedEvent = HelperTranscriptRow | { kind: "resync"; messages: HelperMsgRow[] };

/** One row in the Files column, derived from timeline tool events. */
export interface FileActivity {
  path: string;
  name: string;
  who: string;
  at: string;
}

/** Preview pipeline (client-inferred, bridge /bridge/preview): one version is
 *  snapshot per file per turn-with-changes; `live` = written this turn. */
export interface PreviewVersion {
  label: string;
  /** ISO timestamp of the snapshot. */
  at: string;
}
export interface PreviewFile {
  path: string;
  name: string;
  live: boolean;
  versions: PreviewVersion[];
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
  /** Live transcript per child id (watch_helper feed; resync replaces, msg/tool append). */
  helperTranscripts: Record<string, HelperTranscriptRow[]>;
  /** Child runtime's setWorkingMessage copy per child id ("" = cleared). */
  helperWorking: Record<string, string>;
  files: FileActivity[];
  previewFiles: PreviewFile[];
  /** Selected file in the Preview view; null = most recently changed. */
  previewPath: string | null;
  heartbeats: HeartbeatInfo[];
  autonomous: AutonomousInfo | null;
  target: ComposerTarget;
  delivery: DeliveryMode;
  /** Runtime's own "what am I doing" line (setWorkingMessage), shown while working. */
  working?: string;
  /** Last error surfaced to the strip, if any. */
  error?: string;
}
