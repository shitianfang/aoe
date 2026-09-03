import type { ChildInfo } from "./types";

/** Clean identity hues (semantic green/red stay reserved for state). */
export const IDENTITY_HUES = ["cyan", "amber", "violet", "blue", "rose"] as const;

/** FNV-1a — stable per-name look for avatars, hues, and flavor tags. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function chipHue(name: string): (typeof IDENTITY_HUES)[number] {
  return IDENTITY_HUES[Math.floor(hashSeed(name) / 13) % IDENTITY_HUES.length];
}

/** sessionName is the helper's name; label is its collapsed task prompt. */
export function helperName(c: ChildInfo): string {
  return c.sessionName || "helper";
}

/** Status word for a helper (runtime words → product words). */
export function statusWord(c: ChildInfo): string {
  if (c.status === "running" || c.status === "queued") return "running";
  if (c.status === "done") return c.repliedSinceTask ? "replied" : "needs you";
  if (c.status === "error") return "failed";
  return "stopped";
}

/** Word → the tiny square-language status icon (glyph "" = CSS-drawn box). */
export function statusIcon(word: string): { cls: string; glyph: string; word: string } {
  switch (word) {
    case "running":
      return { cls: "sti run", glyph: "", word };
    case "needs you":
      return { cls: "sti need", glyph: "", word };
    case "replied":
      return { cls: "sti ok", glyph: "✓", word };
    case "failed":
      return { cls: "sti bad", glyph: "✕", word };
    case "stopped":
      return { cls: "sti halt", glyph: "", word };
    case "inactive":
      return { cls: "sti off", glyph: "", word };
    default:
      return { cls: "sti idle", glyph: "", word: "idle" };
  }
}

const IDLE_TAGS = [
  "daydreaming",
  "sulking in the lobby",
  "sipping coffee",
  "watching the clock",
  "waiting for a ping",
  "counting pixels",
];
const RUN_TAGS = ["heads down", "cooking", "in the zone", "making sparks"];

function pick(pool: string[], seed: string): string {
  return pool[hashSeed(seed) % pool.length];
}

/** The little self-tag under an agent's name: its own working line when it
 *  set one, else a stable bit of flavor for the state it's in. */
export function flavorTag(name: string, word: string, working?: string): string {
  if (working) return working;
  switch (word) {
    case "running":
      return pick(RUN_TAGS, name);
    case "needs you":
      return "waiting on you";
    case "replied":
      return "left you a note";
    case "failed":
      return "tripped on something";
    case "stopped":
      return "clocked out";
    case "inactive":
      return "off duty";
    default:
      return pick(IDLE_TAGS, name);
  }
}

export function reachable(c: ChildInfo): boolean {
  return Boolean(c.activeSessionId);
}

/** Unattended injection reason → product words (HANDOFF §4: check, unattended). */
export function injectionReasonText(reason: "gate_failed" | "missing_terminal_evidence"): string {
  return reason === "gate_failed" ? "after a failed check" : "no evidence in the turn";
}

/** Lesson source → product words ("who asked for this lesson"). */
export function lessonSourceText(source: string | undefined): string | null {
  if (source === "auto") return "auto";
  if (source === "manual") return "you asked";
  if (source === "agent") return "the agent";
  return null; // unknown/older record — say nothing rather than guess
}

/** Epoch ms → HH:MM for compact status rows. */
export function hhmmEpoch(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
