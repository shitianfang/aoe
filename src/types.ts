export type Theme = "light" | "dark";

export type AgentState = "idle" | "working";

/** One rendered row in the master timeline. */
export type TimelineItem =
  | { kind: "divider"; id: string; text: string }
  | { kind: "user"; id: string; text: string; at: string }
  | { kind: "master"; id: string; text: string; at: string; streaming?: boolean };

export interface AppState {
  theme: Theme;
  master: AgentState;
  timeline: TimelineItem[];
  /** Last error surfaced to the strip, if any. */
  error?: string;
}
