export type Theme = "light" | "dark";

export type AgentState = "idle" | "working";

export type CenterView = "timeline" | "learned";
export type ColumnView = "agents" | "files";

/** One rendered row in the master timeline. */
export type TimelineItem =
  | { kind: "divider"; id: string; text: string }
  | { kind: "user"; id: string; text: string; at: string }
  | { kind: "master"; id: string; text: string; at: string; streaming?: boolean };

export interface AppState {
  theme: Theme;
  master: AgentState;
  timeline: TimelineItem[];
  view: CenterView;
  column: ColumnView;
  /** Last error surfaced to the strip, if any. */
  error?: string;
}
