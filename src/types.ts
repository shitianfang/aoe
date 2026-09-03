export type Theme = "light" | "dark";

export type AgentState = "idle" | "working";

export type CenterView = "timeline" | "learned" | "preview" | "empty";
export type ColumnView = "agents" | "files" | "learned" | "skills" | "extensions";

/** One read-only row in the Skills / Extensions columns
 *  (GET /bridge/skills, GET /bridge/extensions). */
export interface CatalogItem {
  name: string;
  /** One line of small text: a skill's summary, an extension's kind. */
  detail?: string;
}

/** Selected lesson in the Learned column (detail opens in a center pane):
 *  owner is the agent a local lesson belongs to ("master" or a root name),
 *  null for a lesson kept everywhere (global harness). */
export interface LearnedSel {
  owner: string | null;
  id: string;
}

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

/** Machine-readable origin of a lesson (RefinementResult.source, schema 27).
 *  Absent on lessons recorded before the field existed. */
export type LessonSource = "auto" | "manual" | "agent";

/** RefinementResult subset we render (refine_complete { result }). */
export interface LessonResult {
  id: string;
  summary?: string;
  rationale?: string;
  expectedOutcome?: string;
  appliedEdits?: LessonEdit[];
  rollbackOf?: string;
  scope?: string;
  source?: LessonSource;
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
  /** A message another agent sent into this conversation (e.g. a helper's
   *  reply to master) — rendered as a normal message row with its avatar. */
  | { kind: "agent"; id: string; from: string; text: string; at: string; ts?: number }
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

/** One sub-agent of another root, straight from the daemon roster — a
 *  read-only row in the Agents column (no session to select or message). */
export interface RootKid {
  name: string;
  state: "running" | "idle" | "inactive";
  /** The daemon marked this crew member failed (roster statusLabel). */
  failed?: boolean;
  /** Live session id — present while attachable; without it the row is a
   *  read-only stub (recycled/inline crew has no session to open). */
  activeSessionId?: string;
}

/** Another root session on this daemon ("Other" in the Agents column,
 *  GET /bridge/agents or the live roster push) — selectable and conversable
 *  via the root_* bridge ops. A root with kids is an agent team. */
export interface RootAgent {
  name: string;
  state: "running" | "idle" | "inactive";
  /** Present only on roster-push daemons; master's own helpers keep riding
   *  snapshot.children instead. */
  kids?: RootKid[];
}

/** How much of a watched root's transcript we hold: "partial" = attached
 *  mid-run with an empty first snapshot (session_resynced backfills). */
export type RootLoad = "partial" | "full";

/** One Task subagent of the claude-path master (id = the Task tool_use id). */
export interface ClaudeSubagent {
  id: string;
  label: string;
  status: "running" | "done";
}

/** RlmChildAgentSnapshot subset we render. Foreign entries (another root's
 *  crew, promoted from the roster) reuse the shape: id "fk:<activeSessionId>",
 *  roster words "idle"/"inactive" for status, foreign + parentName set. */
export interface ChildInfo {
  id: string;
  label: string;
  status: "queued" | "running" | "done" | "error" | "cancelled" | "idle" | "inactive";
  /** Another root's crew member — its root drives it; no stop/remove here. */
  foreign?: true;
  /** The root this foreign crew member belongs to. */
  parentName?: string;
  repliedSinceTask?: boolean;
  activeSessionId?: string;
  sessionName?: string;
  answerPreview?: string;
  recap?: string;
  error?: string;
  /** Epoch ms when the helper reached its terminal status (schema 27);
   *  absent on older daemons and on helpers rehydrated after a restart. */
  completedAt?: number;
  /** Tokens this helper used, billed to master (context tree). */
  tokenCount?: number;
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

/** Preview pipeline (bridge /bridge/preview): one version is snapshot per file
 *  per turn-with-changes; `live` = written this turn. Declared entries come
 *  from preview_published events (daemon capability preview_events) and carry
 *  the agent's label; inferred entries stay the fallback. */
export interface PreviewVersion {
  label: string;
  /** ISO timestamp of the snapshot. */
  at: string;
  /** This version was explicitly published by the agent. */
  declared?: boolean;
}
export interface PreviewFile {
  path: string;
  name: string;
  live: boolean;
  /** The agent explicitly published this file at least once. */
  declared?: boolean;
  /** Publish label (declared entries only). */
  label?: string;
  versions: PreviewVersion[];
}

export interface BridgeState {
  connected: boolean;
  error?: string | null;
  workspace?: string | null;
  /** Daemon emits preview_published events (server capability preview_events);
   *  false/absent = old daemon, Preview falls back to inference only. */
  previewEvents?: boolean;
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
  /** Which session this check-in belongs to: "master" for this workspace's
   *  master, else the root session's name (bridge-stamped). Absent when the
   *  bridge cannot tell — such rows are shown nowhere rather than guessed. */
  subject?: string;
}

/** AgentAutonomousStatus subset (autonomous_status custom messages, the attach
 *  snapshot's state.autonomous, and GET /bridge/autonomous). */
export interface AutonomousInfo {
  enabled: boolean;
  continuationsUsed?: number;
  turnsUsed?: number;
  tokensUsed?: number;
  /** epoch ms when unattended was switched on; absent while it is off. The
   *  only clock the runtime gives us — elapsed time is derived from it. */
  startedAt?: number;
  limits?: { maxContinuations?: number; maxTurns?: number; maxTokens?: number; timeoutMs?: number };
  lastGateFailure?: { command?: string; attempt?: number };
  /** Why the last unattended continuation was injected (schema 27):
   *  "gate_failed" = after a failed check, "missing_terminal_evidence" =
   *  a turn ended without evidence. Absent before the first continuation. */
  lastInjection?: { reason: "gate_failed" | "missing_terminal_evidence"; at: number };
}

/** Auto-refine scheduling status (connection state autoRefine block, schema 27).
 *  lastReviewAt + cooldownMs bound the next possible auto lesson review. */
export interface AutoRefineInfo {
  enabled: boolean;
  turnInterval?: number;
  compact?: boolean;
  cooldownMs?: number;
  /** Epoch ms of the last auto-refine review; absent before the first one. */
  lastReviewAt?: number;
}

/** AgentCronJob subset for the schedule rows in Re-entry (GET /bridge/crons).
 *  Heartbeat-sourced jobs are filtered out by the bridge — they have their own rows. */
export interface CronInfo {
  id: string;
  status: string;
  label?: string;
  prompt: string;
  schedule?: { expression?: string };
  nextRunAt?: string;
}

/** What one center pane can show. In single-pane layout this is implied by
 *  view/selectedAgent/selectedRoot; the split layout names the second pane's
 *  content explicitly. */
export type PaneView =
  | { kind: "timeline" }
  | { kind: "learned" }
  | { kind: "preview" }
  | { kind: "helper"; childId: string }
  | { kind: "root"; name: string }
  /** No tab open (the master tab was closed); single-pane only. */
  | { kind: "empty" };

/** Split layout for the center area (two panes max — the mockup's freedom,
 *  bounded). The canonical view fields (view/selectedAgent/selectedRoot)
 *  always describe the FOCUSED pane, so every existing action — tabs, agent
 *  column, composer view-jumps — drives the focused pane for free; `other` is
 *  the second pane, `focusSide` says which side the focused pane sits on.
 *  null = default single-pane layout. */
export interface SplitState {
  other: PaneView;
  focusSide: "left" | "right";
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
  /** Second center pane (user split via tab drag); null = single pane. */
  split: SplitState | null;
  /** Open tabs per pane side (single-pane layout uses left, right stays
   *  empty). The focused side's ACTIVE tab is what view/selectedAgent/
   *  selectedRoot describe; the other side's active tab is split.other. */
  tabsL: PaneView[];
  tabsR: PaneView[];
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
  /** Per-root goal state (root_snapshot state.goal + root goal_update events).
   *  A key present (even null) means the root's connection state has arrived —
   *  the Inspector shows "loading" until then, never empty panels. */
  rootGoals: Record<string, GoalInfo | null>;
  /** Per-root unattended status (root_snapshot state + status re-pulls). */
  rootAutonomous: Record<string, AutonomousInfo | null>;
  /** Master's auto-refine rhythm (attach snapshot state.autoRefine, schema 27);
   *  null on old daemons — the related controls stay hidden then. */
  autoRefine: AutoRefineInfo | null;
  /** Per-root auto-refine rhythm (root_snapshot state + status re-pulls). */
  rootAutoRefine: Record<string, AutoRefineInfo | null>;
  bridge: BridgeState | null;
  goal: GoalInfo | null;
  children: ChildInfo[];
  /** Claude-path Task subagents: read-only cards under master in the Agents
   *  column — visible while they run, never addressable (no session to talk
   *  to). Cleared at the start of each new turn. */
  claudeAgents: ClaudeSubagent[];
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
  /** Long-running mode, per subject ("master" or a root's name): the next
   *  message to that subject asks it to set up one of the three drivers
   *  itself. Arming it for one agent must not arm it for the others. Never
   *  turns anything on here — only the agent does that. */
  longRun: Record<string, boolean>;
  /** Runtime's own "what am I doing" line (setWorkingMessage), shown while working. */
  working?: string;
  /** Last error surfaced to the strip, if any. */
  error?: string;
}
