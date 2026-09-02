import type { ChildInfo } from "./types";

export const HUES = ["cyan", "amber", "violet"] as const;

export function chipHue(index: number): (typeof HUES)[number] {
  return HUES[index % HUES.length];
}

/** sessionName is the helper's name; label is its collapsed task prompt. */
export function helperName(c: ChildInfo): string {
  return c.sessionName || "helper";
}

export function chipGlyph(c: ChildInfo): string {
  return helperName(c).slice(0, 1).toUpperCase();
}

/** Status word for the agents column / target popup (runtime words → product words). */
export function statusWord(c: ChildInfo): { label: string; cls: string } {
  if (c.status === "running" || c.status === "queued") return { label: "running", cls: "st run" };
  if (c.status === "done") {
    return c.repliedSinceTask ? { label: "replied", cls: "st" } : { label: "needs you", cls: "st need" };
  }
  if (c.status === "error") return { label: "failed", cls: "st need" };
  return { label: "stopped", cls: "st" };
}

export function reachable(c: ChildInfo): boolean {
  return Boolean(c.activeSessionId);
}
