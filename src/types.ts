export type Theme = "light" | "dark";

export type AgentState = "idle" | "working";

export type CenterView = "timeline" | "learned" | "preview";
export type ColumnView = "agents" | "files";

/** One harness edit inside a kept lesson (RefinementResult.appliedEdits[i]).
 *  Live results carry action/content for creates; applied may be absent. */
export interface LessonEdit {
  id: string;
  kind: string;
  title: string;
  applied?: boolean;
  action?: string;
  content?: string;
  before?: string;
  after?: string;
  error?: string;
}

/** RefinementResult subset we render (refine_complete { result }). */
export interface LessonResult {
  id: string;
  summary?: string;
  rationale?: string;
  expectedOutcome?: string;
  appliedEdits?: LessonEdit[];
  rollbackOf?: string;
  scope?: string;
}

/** One rendered row in the master timeline. */
export type TimelineItem =
  | { kind: "divider"; id: string; text: string; ts?: number }
  | { kind: "user"; id: string; text: string; at: string }
  | { kind: "master"; id: string; text: string; at: string; streaming?: boolean }
  | { kind: "tool"; id: string; name: string; status: "running" | "done" | "error"; at: string; ts?: number }
  | { kind: "lesson"; id: string; result: LessonResult; at: string; ts?: number }
  /** Quiet chip row for secondary events (agent messages, queue notes) — no rule line. */
  | { kind: "note"; id: string; text: string; rt?: string; tone?: "" | "bad"; ts?: number }
  /** Folded run of older history rows; renders as one "N earlier turns · show" divider. */
  | { kind: "collapsed"; id: string; count: number; items: TimelineItem[] };

/** Slim transcript entry replayed by the bridge in the attach snapshot. */
export interface HistoryMessage {
  role: "user" | "assistant" | "agent_message";
  text: string;
  /** epoch ms (message.timestamp) */
  at?: number;
  /** sender sessionName, agent_message only */
  from?: string;
}

/** GoalState subset we render (see docs/daemon-integration.md). */
export interface GoalInfo {
  active: boolean;
  status: string;
  objective?: string;
  tokenBudget?: number;
  tokensUsed?: number;
  continuationsUsed?: number;
}

/** Another root session on this daemon ("Other" in the Agents column,
 *  GET /bridge/agents) — selectable and conversable via the root_* bridge ops. */
export interface RootAgent {
  name: string;
  state: "running" | "idle" | "inactive";
}

/** How much of a watched root's transcript we hold: "partial" = attached
 *  mid-run with an empty first snapshot (session_resynced backfills). */
export type RootLoad = "partial" | "full";

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

/** Composer target: master, a helper (by child id), or another root (by name).
 *  Changed only via the to ▾ popup — selection in the Agents column never
 *  changes it. */
export type ComposerTarget =
  | { kind: "master" }
  | { kind: "helper"; childId: string }
  | { kind: "root"; name: string };

export interface AppState {
  theme: Theme;
  master: AgentState;
  timeline: TimelineItem[];
  view: CenterView;
  column: ColumnView;
  /** Selected agent in the left column: null = master (timeline), else child id. */
  selectedAgent: string | null;
  /** Selected other root in the left column (by session name); exclusive with selectedAgent. */
  selectedRoot: string | null;
  /** Other root sessions on this daemon (roster behind the "Other" rows). */
  others: RootAgent[];
  /** Per-root timeline (watch_root feed: snapshot replaces, events append). */
  rootTimelines: Record<string, TimelineItem[]>;
  /** Snapshot progress per root; absent = still attaching. */
  rootLoad: Record<string, RootLoad>;
  /** Live run state per root, from its own agent_start/agent_end stream. */
  rootStates: Record<string, AgentState>;
  /** Root runtime's setWorkingMessage copy per root ("" = cleared). */
  rootWorking: Record<string, string>;
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
  /** Runtime's own "what am I doing" line (setWorkingMessage), shown while working. */
  working?: string;
  /** Last error surfaced to the strip, if any. */
  error?: string;
}
