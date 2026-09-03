import type { ChildInfo } from "./types";
import { t } from "./i18n";

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
  if (c.status === "idle") return "idle"; // foreign crew: roster words pass through
  if (c.status === "inactive") return "inactive";
  if (c.status === "done") {
    if (c.repliedSinceTask) return "replied";
    // An inline helper is gone the moment it finishes — its answer went to
    // master and nobody is waiting on you; "needs you" would be a false alarm.
    return reachable(c) ? "needs you" : "finished";
  }
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
    case "finished":
      return { cls: "sti halt", glyph: "", word };
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
 *  set one, else a stable bit of flavor for the state it's in. The pick is
 *  seeded in English so the same agent keeps the same tag in either language. */
export function flavorTag(name: string, word: string, working?: string): string {
  if (working) return working; // the runtime's own words — never translated
  switch (word) {
    case "running":
      return t(pick(RUN_TAGS, name));
    case "needs you":
      return t("waiting on you");
    case "replied":
      return t("left you a note");
    case "finished":
      return t("wrapped up");
    case "failed":
      return t("tripped on something");
    case "stopped":
      return t("clocked out");
    case "inactive":
      return t("off duty");
    default:
      return t(pick(IDLE_TAGS, name));
  }
}

export function reachable(c: ChildInfo): boolean {
  return Boolean(c.activeSessionId);
}

/** Unattended injection reason → product words (HANDOFF §4: check, unattended). */
export function injectionReasonText(reason: "gate_failed" | "missing_terminal_evidence"): string {
  return reason === "gate_failed" ? t("after a failed check") : t("no evidence in the turn");
}

/** Row title for a lesson: the refiner's own title when present, else the
 *  summary cut at its first clause/sentence break. Null when neither exists —
 *  caller shows its generic "lesson" word then.
 *
 *  No character cap. A fixed 28-char cut left rows reading "把汇报控制在三句
 *  话以…", which answers nothing; the row clamps to two lines in CSS instead,
 *  and CSS adapts to the column's dragged width, which a constant cannot. */
export function lessonRowTitle(lesson: { title?: string; trigger?: string }): string | null {
  if (lesson.title !== undefined && lesson.title !== "") return lesson.title;
  const s = (lesson.trigger ?? "").replace(/\s+/g, " ").trim();
  if (s === "") return null;
  const brk = s.match(/[。,,;;、—!?!?]|\.(?=\s|$)/u);
  const clause = (brk?.index !== undefined && brk.index > 0 ? s.slice(0, brk.index) : s).trim();
  return clause === "" ? null : clause;
}

/** Lesson source → product words ("who asked for this lesson"). Detail panes
 *  keep the precise three-way wording (manual / auto / the agent itself). */
export function lessonSourceText(source: string | undefined): string | null {
  if (source === "auto") return t("auto");
  if (source === "manual") return t("manual");
  if (source === "agent") return t("the agent");
  return null; // unknown/older record — say nothing rather than guess
}

/** One harness `changes` entry — the machine string `"create memory:some_id"` —
 *  split into product words plus the bare id. The pane says what the edit did;
 *  the id stays as mono machine text beside it, unlabelled. */
export function lessonChangeText(change: string): { what: string; id: string | null } {
  const m = /^(create|update|delete)\s+(prompt|memory|skill|subagent):(.*)$/i.exec(change.trim());
  if (m === null) return { what: change, id: null }; // unknown shape — show it verbatim
  const kind = { prompt: t("prompt"), memory: t("memory"), skill: t("skill"), subagent: t("subagent") }[
    m[2].toLowerCase() as "prompt" | "memory" | "skill" | "subagent"
  ];
  const what = { create: "added a {kind}", update: "updated a {kind}", delete: "removed a {kind}" }[
    m[1].toLowerCase() as "create" | "update" | "delete"
  ];
  const id = m[3].trim();
  return { what: t(what, { kind }), id: id === "" ? null : id };
}

/** Row-suffix variant: 主动/自动 only — an agent-invoked lesson was not asked
 *  for by you either, so it reads as 自动 in the terse suffix; the detail pane
 *  still says precisely who. */
export function lessonRowSourceText(source: string | undefined): string | null {
  if (source === "auto" || source === "agent") return t("auto");
  if (source === "manual") return t("manual");
  return null;
}

/** Epoch ms → HH:MM for compact status rows. */
export function hhmmEpoch(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
