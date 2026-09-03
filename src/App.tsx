import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentState,
  AppState,
  AutonomousInfo,
  ChildInfo,
  ColumnView,
  ComposerTarget,
  FileActivity,
  GoalInfo,
  HeartbeatInfo,
  HelperEvent,
  HelperToolRow,
  HistoryMessage,
  LessonResult,
  PaneView,
  RootAgent,
  Theme,
  TimelineItem,
} from "./types";
import { SettingsPopup, WorkspacePopup } from "./components/Overlays";
import { Rail } from "./components/Rail";
import { AgentsColumn } from "./components/AgentsColumn";
import { BotAvatar } from "./components/BotAvatar";
import { helperName } from "./helperDisplay";
import { FilesColumn } from "./components/FilesColumn";
import { Timeline } from "./components/Timeline";
import { LearnedView } from "./components/LearnedView";
import { PreviewView } from "./components/PreviewView";
import { HelperView } from "./components/HelperView";
import { Composer } from "./components/Composer";
import { Inspector } from "./components/Inspector";
import { runMasterTurn, clock } from "./runtime/master";
import {
  openBridge,
  bridgeCmd,
  steer,
  sendAgentMessage,
  stopHelper,
  removeHelper,
  extractText,
  bridgeUrl,
  type BridgeMessage,
} from "./runtime/bridge";
import { fetchPreviewFiles } from "./runtime/preview";
import type { ChatMessage } from "./runtime/nim";

let nextId = 1;
const id = () => `t${nextId++}`;

function filePathFromArgs(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const a = args as { path?: unknown; file_path?: unknown };
  const p = typeof a.path === "string" ? a.path : typeof a.file_path === "string" ? a.file_path : null;
  return p && p.length > 0 ? p : null;
}

function upsertFile(files: FileActivity[], path: string, who: string): FileActivity[] {
  const name = path.split(/[\\/]/).pop() ?? path;
  const row: FileActivity = { path, name, who, at: clock() };
  return [row, ...files.filter((f) => f.path !== path)];
}

/* ---- center split layout helpers ----
 * The canonical fields (view/selectedAgent/selectedRoot) describe the FOCUSED
 * pane; split.other is the second pane. See SplitState in types.ts. */

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

/** The focused pane's content, mirroring center()'s render precedence
 *  (learned/preview sit on top of a lingering agent selection). */
function currentPane(s: AppState): PaneView {
  if (s.view === "learned") return { kind: "learned" };
  if (s.view === "preview") return { kind: "preview" };
  if (s.selectedAgent && s.children.some((c) => c.id === s.selectedAgent))
    return { kind: "helper", childId: s.selectedAgent };
  if (s.selectedRoot) return { kind: "root", name: s.selectedRoot };
  return { kind: "timeline" };
}

/** State patch that makes `p` the focused pane's content. learned/preview keep
 *  the agent selection underneath, exactly like the plain setView did. */
function panePatch(p: PaneView): Partial<AppState> {
  if (p.kind === "learned") return { view: "learned" };
  if (p.kind === "preview") return { view: "preview" };
  if (p.kind === "helper") return { view: "timeline", selectedAgent: p.childId, selectedRoot: null };
  if (p.kind === "root") return { view: "timeline", selectedAgent: null, selectedRoot: p.name };
  return { view: "timeline", selectedAgent: null, selectedRoot: null };
}

function sameView(a: PaneView, b: PaneView): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "helper" && b.kind === "helper") return a.childId === b.childId;
  if (a.kind === "root" && b.kind === "root") return a.name === b.name;
  return true;
}

/** Show `v` in the focused pane. If the OTHER pane already shows it, don't
 *  duplicate — move focus to that pane instead (net render unchanged). */
function showFocused(s: AppState, v: PaneView): AppState {
  if (s.split && sameView(v, s.split.other)) {
    return {
      ...s,
      ...panePatch(v),
      split: { other: currentPane(s), focusSide: s.split.focusSide === "left" ? "right" : "left" },
    };
  }
  return { ...s, ...panePatch(v) };
}

/** Drop stale pane content after a roster update (only the roster that is
 *  fresh — flags say which), and never keep two panes showing the same thing:
 *  a stale pane falls back to the master timeline, a duplicate collapses the
 *  split back to single pane. */
function reconcileSplit(s: AppState, fresh: { children?: boolean; roots?: boolean } = {}): AppState {
  if (!s.split) return s;
  const o = s.split.other;
  let other: PaneView = o;
  if (fresh.children && o.kind === "helper" && !s.children.some((c) => c.id === o.childId)) {
    other = { kind: "timeline" };
  } else if (fresh.roots && o.kind === "root" && !s.others.some((a) => a.name === o.name)) {
    other = { kind: "timeline" };
  }
  if (sameView(other, currentPane(s))) return { ...s, split: null };
  if (other !== o) return { ...s, split: { ...s.split, other } };
  return s;
}

/** Persisted-layout shape guard (localStorage may hold anything). */
function sanePane(p: unknown): PaneView | null {
  if (!p || typeof p !== "object") return null;
  const v = p as { kind?: unknown; childId?: unknown; name?: unknown };
  if (v.kind === "timeline" || v.kind === "learned" || v.kind === "preview") return { kind: v.kind };
  if (v.kind === "helper" && typeof v.childId === "string") return { kind: "helper", childId: v.childId };
  if (v.kind === "root" && typeof v.name === "string") return { kind: "root", name: v.name };
  return null;
}

/** Restore a saved split layout (per-workspace key). Stale helper/root panes
 *  are tolerated here and reconciled once the real rosters arrive. */
function restoreSplit(key: string): Partial<AppState> {
  const raw = loadJson<{ left?: unknown; right?: unknown; focus?: unknown } | null>(key, null);
  const left = sanePane(raw?.left);
  const right = sanePane(raw?.right);
  if (!left || !right || sameView(left, right)) return {};
  const focusSide = raw?.focus === "right" ? ("right" as const) : ("left" as const);
  const focused = focusSide === "left" ? left : right;
  const other = focusSide === "left" ? right : left;
  return { ...panePatch(focused), split: { other, focusSide } };
}

function hhmm(at?: number): string {
  if (at === undefined) return "";
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Rules (dashed dividers) mark only long silences, not every event. */
const GAP_MS = 30 * 60 * 1000;

/** Snapshot history → timeline rows: user/assistant as normal rows (never
 *  streaming), agent messages as quiet note chips, dividers only on gaps. */
function historyToItems(messages: HistoryMessage[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  let last: number | undefined;
  for (const m of messages) {
    if (m.at !== undefined) {
      if (last !== undefined && m.at - last > GAP_MS) {
        out.push({ kind: "divider", id: id(), text: hhmm(m.at) });
      }
      last = m.at;
    }
    if (m.role === "user") out.push({ kind: "user", id: id(), text: m.text, at: hhmm(m.at) });
    else if (m.role === "assistant") out.push({ kind: "master", id: id(), text: m.text, at: hhmm(m.at) });
    else out.push({ kind: "note", id: id(), text: `msg ← ${m.from ?? "agent"}`, rt: hhmm(m.at) });
  }
  return out;
}

/** Long histories open on the recent tail; the rest folds into one divider. */
const HISTORY_OPEN = 30;
function foldHistory(items: TimelineItem[]): TimelineItem[] {
  if (items.length <= HISTORY_OPEN) return items;
  const older = items.slice(0, items.length - HISTORY_OPEN);
  return [
    { kind: "collapsed", id: id(), count: older.length, items: older },
    ...items.slice(-HISTORY_OPEN),
  ];
}

/** Append the helper events implied by a child snapshot transition.
 *  answerPreview streams token-by-token, so reply text is never taken from it —
 *  the actual reply arrives as an agent_message custom. */
function childTransitionEvents(prev: ChildInfo | undefined, next: ChildInfo): HelperEvent[] {
  const out: HelperEvent[] = [];
  if (!prev) {
    out.push({ id: id(), tone: "", text: "started by master", rt: clock() });
  }
  if (prev && !prev.repliedSinceTask && next.repliedSinceTask) {
    out.push({ id: id(), tone: "good", text: "replied", rt: clock() });
  }
  if (prev && prev.status !== next.status) {
    if (next.status === "done" && !next.repliedSinceTask) {
      out.push({ id: id(), tone: "bad", text: "finished without replying", rt: clock() });
    } else if (next.status === "done") {
      out.push({ id: id(), tone: "", text: "finished", rt: clock() });
    } else if (next.status === "error") {
      out.push({ id: id(), tone: "bad", text: next.error ? `failed · ${next.error}` : "failed", rt: clock() });
    } else if (next.status === "cancelled") {
      out.push({ id: id(), tone: "", text: "stopped", rt: clock() });
    }
  }
  return out;
}

export function App() {
  const [state, setState] = useState<AppState>(() => ({
    theme: (document.documentElement.dataset.theme as Theme) ?? "light",
    master: "idle",
    view: "timeline",
    column: "agents",
    selectedAgent: null,
    selectedRoot: null,
    split: null,
    others: [],
    rootTimelines: {},
    rootLoad: {},
    rootStates: {},
    rootWorking: {},
    bridge: null,
    goal: null,
    children: [],
    helperEvents: {},
    helperTranscripts: {},
    helperWorking: {},
    files: [],
    previewFiles: [],
    previewPath: null,
    heartbeats: [],
    autonomous: null,
    target: { kind: "master" },
    timeline: [{ kind: "divider", id: id(), text: `session started · ${clock()}` }],
  }));
  const [wsOpen, setWsOpen] = useState(false);
  // Bumped when the bridge-pulled rows the inspector owns (scheduled re-entries,
  // lessons) may have moved: attach, heartbeats_changed, refine_complete.
  const [inspectorKey, setInspectorKey] = useState(0);
  // send() reads fresh state without re-binding the callback per keystroke.
  const stateRef = useRef(state);
  stateRef.current = state;
  const historyRef = useRef<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  // Streaming assistant row fed by daemon message events, keyed by message id when present.
  const daemonMsgRef = useRef<{ itemId: string; key: unknown } | null>(null);
  // One turn can push ~90 message_update events — coalesce them to ~50ms flushes.
  const pendingRef = useRef<{ itemId: string; text: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  // Per-root equivalents of the two refs above, keyed by root session name.
  const rootMsgRef = useRef<Record<string, { itemId: string; key: unknown }>>({});
  const rootPendingRef = useRef<
    Record<string, { itemId: string; text: string; timer: ReturnType<typeof setTimeout> }>
  >({});
  const bridgeRef = useRef(false);
  // Snapshots repeat on bridge reconnect (same workspace) — seed history once.
  const histSeededRef = useRef(false);
  // Paths declared via preview_published this turn (event path/source, may be
  // absolute). Dedupes the inferred file_activity fallback against the
  // declared source within one turn window; cleared at agent_end.
  const declaredRef = useRef<Set<string>>(new Set());
  // Declared path waiting to be selected once the preview list re-pull lands.
  const pendingPreviewRef = useRef<string | null>(null);
  // Last live timeline append; long silences get one dashed time rule.
  const lastAtRef = useRef(Date.now());
  const [setOpen, setSetOpen] = useState(false);
  // The tab being dragged (drag data is unreadable during dragover) + the
  // half of the center that would be taken on drop.
  const dragViewRef = useRef<PaneView | null>(null);
  const [dropHint, setDropHint] = useState<"left" | "right" | null>(null);
  // Per-workspace persistence key for the split layout; set at hello so the
  // save effect never writes before the restore ran.
  const splitKeyRef = useRef<string | null>(null);

  const toggleTheme = useCallback(() => {
    setState((s) => {
      const theme: Theme = s.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = theme;
      try {
        localStorage.setItem("theme", theme);
      } catch {
        /* private mode */
      }
      return { ...s, theme };
    });
  }, []);

  /** Re-pull the other-roots roster; a root gone from it falls back to master
   *  (honest empty state — no invented rows, no stale selection or target). */
  const refreshOthers = useCallback(async () => {
    try {
      const r = await fetch(bridgeUrl("/bridge/agents")).then((x) => x.json());
      const others: RootAgent[] = Array.isArray(r.agents) ? (r.agents as RootAgent[]) : [];
      setState((s) => {
        const has = (n: string | null) => n !== null && others.some((a) => a.name === n);
        return reconcileSplit(
          {
            ...s,
            others,
            selectedRoot: has(s.selectedRoot) ? s.selectedRoot : null,
            target: s.target.kind === "root" && !has(s.target.name) ? { kind: "master" } : s.target,
          },
          { roots: true },
        );
      });
    } catch {
      /* bridge offline */
    }
  }, []);
  useEffect(() => {
    const t = setInterval(refreshOthers, 30_000);
    return () => clearInterval(t);
  }, [refreshOthers]);

  /* ---- daemon bridge ingestion ---- */
  useEffect(() => {
    const push = (item: TimelineItem) =>
      setState((s) => {
        // A dashed rule only after a long silence — never per event.
        const now = Date.now();
        const gap = now - lastAtRef.current > GAP_MS;
        lastAtRef.current = now;
        return {
          ...s,
          timeline: [
            ...s.timeline,
            ...(gap ? [{ kind: "divider", id: id(), text: clock() } as TimelineItem] : []),
            item,
          ],
        };
      });

    let hbTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshHeartbeats = () => {
      // heartbeats_changed is a global no-payload signal — throttle the re-pull.
      if (hbTimer) return;
      hbTimer = setTimeout(async () => {
        hbTimer = null;
        try {
          const r = await fetch(bridgeUrl("/bridge/heartbeats")).then((x) => x.json());
          const jobs: HeartbeatInfo[] = (r.heartbeats ?? [])
            .map((h: { job?: HeartbeatInfo }) => h.job ?? (h as HeartbeatInfo))
            .filter((j: HeartbeatInfo) => j.status === "active" || j.status === "paused");
          setState((s) => ({ ...s, heartbeats: jobs }));
        } catch {
          /* bridge offline */
        }
      }, 400);
    };

    let pvTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshPreview = () => {
      // preview_update fires once per turn with changes — cheap throttled re-pull.
      if (pvTimer) return;
      pvTimer = setTimeout(async () => {
        pvTimer = null;
        const previewFiles = await fetchPreviewFiles().catch(() => []);
        setState((s) => {
          // A declared preview selects its entry once the list carries it
          // (the event path may be absolute; index keys are workspace-relative).
          const pend = pendingPreviewRef.current;
          let previewPath = s.previewPath;
          if (pend) {
            const base = pend.split(/[\\/]/).pop();
            const match = previewFiles.find(
              (f) => f.path === pend || pend.endsWith(`/${f.path}`) || f.name === base,
            );
            if (match) {
              previewPath = match.path;
              pendingPreviewRef.current = null;
            }
          }
          return { ...s, previewFiles, previewPath };
        });
      }, 300);
    };

    /** Was this (possibly relative) path declared via preview.publish this turn? */
    const declaredThisTurn = (p: string) => {
      for (const d of declaredRef.current) {
        if (d === p || d.endsWith(`/${p}`) || p.endsWith(`/${d}`)) return true;
      }
      return false;
    };

    const mergeChild = (child: ChildInfo) => {
      setState((s) => {
        const prev = s.children.find((c) => c.id === child.id);
        // Child fields fill in progressively; some pull paths omit
        // activeSessionId — merge by id, never drop a cached session id.
        const merged = {
          ...prev,
          ...child,
          activeSessionId: child.activeSessionId ?? prev?.activeSessionId,
        };
        const events = childTransitionEvents(prev, merged);
        return {
          ...s,
          children: [...s.children.filter((c) => c.id !== child.id), merged],
          helperEvents:
            events.length > 0
              ? { ...s.helperEvents, [child.id]: [...(s.helperEvents[child.id] ?? []), ...events] }
              : s.helperEvents,
        };
      });
    };

    const onEvent = (event: Record<string, unknown>) => {
      const t = event.type as string;
      if (t === "agent_start" || t === "turn_start") {
        setState((s) => ({ ...s, master: "working" }));
      } else if (t === "agent_end") {
        daemonMsgRef.current = null;
        declaredRef.current.clear(); // turn window for declared-vs-inferred dedupe
        if (pendingRef.current) {
          clearTimeout(pendingRef.current.timer);
          pendingRef.current = null;
        }
        setState((s) => ({
          ...s,
          master: "idle",
          working: undefined,
          timeline: s.timeline
            .map((x) => (x.kind === "master" && x.streaming ? { ...x, streaming: false } : x))
            // A settled master row with no text is noise (orphan timestamp).
            .filter((x) => !(x.kind === "master" && !x.streaming && x.text === "")),
        }));
      } else if (t === "goal_update") {
        setState((s) => ({ ...s, goal: (event.goal as GoalInfo) ?? null }));
      } else if (t === "rlm_child_update") {
        const child = event.child as ChildInfo;
        if (!child?.id) return;
        mergeChild(child);
      } else if (t === "message_start" || t === "message_update" || t === "message_end") {
        const message = event.message as
          | { role?: string; id?: unknown; customType?: string; details?: unknown }
          | undefined;
        if (!message) return;
        if (message.role === "custom") {
          if (t !== "message_end") return;
          if (message.customType === "autonomous_status") {
            setState((s) => ({ ...s, autonomous: (message.details as AutonomousInfo) ?? null }));
          } else if (message.customType === "agent_message") {
            // details.message is the bare text; content is the model-facing envelope.
            const d = message.details as
              | {
                  from?: { sessionName?: string; activeSessionId?: string; clientId?: string };
                  message?: string;
                }
              | undefined;
            const from = d?.from;
            const fromName = from?.sessionName ?? "agent";
            setState((s) => {
              const child = s.children.find(
                (c) =>
                  (from?.activeSessionId !== undefined && c.activeSessionId === from.activeSessionId) ||
                  c.sessionName === fromName,
              );
              // Roster can lag the first reply — keep the text in the timeline
              // row itself so nothing is lost when there is no helper row yet.
              const brief = (d?.message ?? "").slice(0, 60);
              const note: TimelineItem = {
                kind: "note",
                id: id(),
                text: child || !brief ? `msg ← ${fromName}` : `msg ← ${fromName} · “${brief}”`,
                rt: clock(),
              };
              if (!child) return { ...s, timeline: [...s.timeline, note] };
              s = { ...s, timeline: [...s.timeline, note] };
              const excerpt = (d?.message ?? "").slice(0, 80);
              const ev: HelperEvent = {
                id: id(),
                tone: "",
                text: excerpt ? `msg → master · “${excerpt}”` : "msg → master",
                rt: clock(),
              };
              return {
                ...s,
                helperEvents: { ...s.helperEvents, [child.id]: [...(s.helperEvents[child.id] ?? []), ev] },
              };
            });
          } else if (message.customType === "prime-agent.refinement") {
            // covered by refine_complete; ignore the transcript echo
          }
          return;
        }
        if (message.role !== "assistant") return;
        const text = extractText(message);
        // Reasoning-only updates carry no text; never render an empty bubble.
        if (text === "" && !daemonMsgRef.current) return;
        const key = message.id ?? "assistant";
        const applyText = (itemId: string, value: string, streaming: boolean) =>
          setState((s) => ({
            ...s,
            timeline: s.timeline.map((x) =>
              x.id === itemId && x.kind === "master" ? { ...x, text: value, streaming } : x,
            ),
          }));
        if (!daemonMsgRef.current || daemonMsgRef.current.key !== key) {
          const itemId = id();
          daemonMsgRef.current = { itemId, key };
          push({ kind: "master", id: itemId, text, at: clock(), streaming: true });
        } else {
          const itemId = daemonMsgRef.current.itemId;
          if (t === "message_end") {
            if (pendingRef.current) {
              clearTimeout(pendingRef.current.timer);
              pendingRef.current = null;
            }
            applyText(itemId, text, false);
            daemonMsgRef.current = null;
          } else if (pendingRef.current?.itemId === itemId) {
            pendingRef.current.text = text;
          } else {
            if (pendingRef.current) clearTimeout(pendingRef.current.timer);
            pendingRef.current = {
              itemId,
              text,
              timer: setTimeout(() => {
                const p = pendingRef.current;
                pendingRef.current = null;
                if (p) applyText(p.itemId, p.text, true);
              }, 50),
            };
          }
        }
      } else if (t === "tool_execution_start") {
        const raw = String(event.toolName ?? "tool");
        const toolName = raw === "ipython" ? "python" : raw;
        const path = filePathFromArgs(event.args);
        const label = path ? `${toolName} · ${path.split(/[\\/]/).pop()}` : toolName;
        const writes = toolName === "edit" || toolName === "write";
        if (path && writes) refreshPreview(); // live marker moves mid-turn
        setState((s) => ({
          ...s,
          files: path && writes ? upsertFile(s.files, path, "master") : s.files,
          timeline: [
            ...s.timeline,
            {
              kind: "tool",
              id: `tool-${String(event.toolCallId ?? id())}`,
              name: label,
              status: "running",
              at: clock(),
              ts: Date.now(),
            },
          ],
        }));
      } else if (t === "tool_execution_end") {
        const toolId = `tool-${String(event.toolCallId ?? "")}`;
        setState((s) => ({
          ...s,
          timeline: s.timeline.map((x) =>
            x.id === toolId && x.kind === "tool" ? { ...x, status: event.isError ? "error" : "done" } : x,
          ),
        }));
      } else if (t === "preview_published") {
        // Declared preview (daemon capability preview_events) — the primary
        // source for the Preview view. The bridge already snapshot the file;
        // here: one timeline chip, a Files row, and select the preview entry.
        const p = event.preview as
          | { source?: string; kind?: string; path?: string; label?: string }
          | undefined;
        if (!p) return;
        const resolved = p.path ?? p.source ?? "";
        const base = resolved.split(/[\\/]/).pop() || "file";
        push({ kind: "note", id: id(), text: `published · ${p.label || base}`, rt: clock(), ts: Date.now() });
        if (resolved) {
          declaredRef.current.add(resolved);
          if (p.kind === "file") {
            pendingPreviewRef.current = resolved;
            setState((s) => ({ ...s, files: upsertFile(s.files, resolved, "master") }));
            refreshPreview();
          }
        }
      } else if (t === "refine_complete") {
        setInspectorKey((n) => n + 1); // the learned summary in DRIVERS re-pulls
        const result = event.result as LessonResult | undefined;
        if (result?.id) {
          push({ kind: "lesson", id: id(), result, at: clock(), ts: Date.now() });
        } else {
          push({ kind: "note", id: id(), text: "lesson kept", rt: clock(), ts: Date.now() });
        }
      } else if (t === "refine_failed") {
        const raw = event.error;
        const msg =
          typeof raw === "string" ? raw : (raw as { message?: string } | undefined)?.message ?? "unknown error";
        push({
          kind: "note",
          id: id(),
          text: `lesson attempt failed · ${msg.slice(0, 80)}`,
          tone: "bad",
          rt: clock(),
          ts: Date.now(),
        });
      } else if (t === "compaction_end") {
        // compaction is not shown (HANDOFF §4)
      }
    };

    /* ---- other-root event stream (watch_root feed) ---- */
    const patchRootItems = (root: string, fn: (items: TimelineItem[]) => TimelineItem[]) =>
      setState((s) => ({
        ...s,
        rootTimelines: { ...s.rootTimelines, [root]: fn(s.rootTimelines[root] ?? []) },
      }));
    const clearRootStream = (root: string) => {
      delete rootMsgRef.current[root];
      const p = rootPendingRef.current[root];
      if (p) {
        clearTimeout(p.timer);
        delete rootPendingRef.current[root];
      }
    };

    /** Mirror of onEvent for another root's session, scoped to that root's own
     *  timeline and run state (no goal/lesson/preview side effects — those
     *  panels stay master's). */
    const onRootEvent = (root: string, event: Record<string, unknown>) => {
      const t = event.type as string;
      if (t === "agent_start" || t === "turn_start") {
        setState((s) => ({ ...s, rootStates: { ...s.rootStates, [root]: "working" } }));
      } else if (t === "agent_end") {
        clearRootStream(root);
        setState((s) => ({
          ...s,
          rootStates: { ...s.rootStates, [root]: "idle" },
          rootWorking: { ...s.rootWorking, [root]: "" },
          rootTimelines: {
            ...s.rootTimelines,
            [root]: (s.rootTimelines[root] ?? [])
              .map((x) => (x.kind === "master" && x.streaming ? { ...x, streaming: false } : x))
              .filter((x) => !(x.kind === "master" && !x.streaming && x.text === "")),
          },
        }));
      } else if (t === "message_start" || t === "message_update" || t === "message_end") {
        const message = event.message as { role?: string; id?: unknown } | undefined;
        if (!message || message.role !== "assistant") return;
        const text = extractText(message);
        const cur = rootMsgRef.current[root];
        if (text === "" && !cur) return;
        const key = message.id ?? "assistant";
        const applyText = (itemId: string, value: string, streaming: boolean) =>
          patchRootItems(root, (items) =>
            items.map((x) => (x.id === itemId && x.kind === "master" ? { ...x, text: value, streaming } : x)),
          );
        if (!cur || cur.key !== key) {
          const itemId = id();
          rootMsgRef.current[root] = { itemId, key };
          patchRootItems(root, (items) => [
            ...items,
            { kind: "master", id: itemId, text, at: clock(), streaming: true },
          ]);
        } else if (t === "message_end") {
          const p = rootPendingRef.current[root];
          if (p) {
            clearTimeout(p.timer);
            delete rootPendingRef.current[root];
          }
          applyText(cur.itemId, text, false);
          delete rootMsgRef.current[root];
        } else {
          const p = rootPendingRef.current[root];
          if (p?.itemId === cur.itemId) {
            p.text = text;
          } else {
            if (p) clearTimeout(p.timer);
            rootPendingRef.current[root] = {
              itemId: cur.itemId,
              text,
              timer: setTimeout(() => {
                const q = rootPendingRef.current[root];
                delete rootPendingRef.current[root];
                if (q) applyText(q.itemId, q.text, true);
              }, 50),
            };
          }
        }
      } else if (t === "tool_execution_start") {
        const raw = String(event.toolName ?? "tool");
        const toolName = raw === "ipython" ? "python" : raw;
        const path = filePathFromArgs(event.args);
        const label = path ? `${toolName} · ${path.split(/[\\/]/).pop()}` : toolName;
        patchRootItems(root, (items) => [
          ...items,
          {
            kind: "tool",
            id: `rtool-${root}-${String(event.toolCallId ?? id())}`,
            name: label,
            status: "running",
            at: clock(),
            ts: Date.now(),
          },
        ]);
      } else if (t === "tool_execution_end") {
        const toolId = `rtool-${root}-${String(event.toolCallId ?? "")}`;
        patchRootItems(root, (items) =>
          items.map((x) =>
            x.id === toolId && x.kind === "tool" ? { ...x, status: event.isError ? "error" : "done" } : x,
          ),
        );
      }
    };

    const bridge = openBridge((m: BridgeMessage) => {
      if (m.type === "hello") {
        bridgeRef.current = m.daemon.connected;
        const ws = m.daemon.workspace ?? null;
        setState((s) => {
          const switched = ws !== null && s.bridge?.workspace != null && ws !== s.bridge.workspace;
          const bridgeState = {
            connected: m.daemon.connected,
            error: m.daemon.error ?? null,
            workspace: ws,
            // Capability detection: the daemon says whether it emits
            // preview_published (declared previews); absent = inference only.
            previewEvents: (m.daemon.capabilities ?? []).includes("preview_events"),
          };
          // Split layout is per workspace; restore once per key so a
          // reconnect hello never clobbers the user's in-session layout.
          const splitKey = `center-split:${ws ?? "general"}`;
          if (!switched) {
            if (splitKeyRef.current === splitKey) return { ...s, bridge: bridgeState };
            splitKeyRef.current = splitKey;
            return { ...s, bridge: bridgeState, ...restoreSplit(splitKey) };
          }
          splitKeyRef.current = splitKey;
          // A workspace is its own master, helpers, other roots, files, history.
          daemonMsgRef.current = null;
          historyRef.current = [];
          histSeededRef.current = false;
          declaredRef.current.clear();
          pendingPreviewRef.current = null;
          rootMsgRef.current = {};
          for (const p of Object.values(rootPendingRef.current)) clearTimeout(p.timer);
          rootPendingRef.current = {};
          return {
            ...s,
            bridge: bridgeState,
            master: "idle",
            view: "timeline",
            selectedAgent: null,
            selectedRoot: null,
            split: null,
            others: [],
            rootTimelines: {},
            rootLoad: {},
            rootStates: {},
            rootWorking: {},
            goal: null,
            children: [],
            helperEvents: {},
            helperTranscripts: {},
            helperWorking: {},
            files: [],
            previewFiles: [],
            previewPath: null,
            heartbeats: [],
            autonomous: null,
            target: { kind: "master" },
            error: undefined,
            timeline: [{ kind: "divider", id: id(), text: `workspace ${ws} · ${clock()}` }],
            ...restoreSplit(splitKey),
          };
        });
        if (m.daemon.connected) {
          refreshHeartbeats();
          refreshPreview();
          refreshOthers();
          setInspectorKey((n) => n + 1);
        }
      } else if (m.type === "heartbeats_changed") {
        refreshHeartbeats();
        // Scheduled jobs live in the same store; the signal is the closest
        // push the daemon gives for them.
        setInspectorKey((n) => n + 1);
      } else if (m.type === "preview_update") {
        refreshPreview();
      } else if (m.type === "file_activity") {
        // fs truth from the bridge's per-turn scan (writes happen inside the
        // kernel). A file already declared via preview.publish this turn has
        // its row — don't double-count the inferred sighting.
        if (declaredThisTurn(m.file.path)) return;
        setState((s) => ({ ...s, files: upsertFile(s.files, m.file.path, "master") }));
      } else if (m.type === "working_message") {
        setState((s) => ({ ...s, working: m.text || undefined }));
      } else if (m.type === "helper_event") {
        // Live transcript of a watched helper session, keyed on the wire by
        // activeSessionId. resync replaces the child's rows; msg/tool append,
        // except a tool_execution_end updating the row its _start appended.
        setState((s) => {
          const child = s.children.find((c) => c.activeSessionId === m.sessionId);
          if (!child) return s;
          const ev = m.event;
          if (ev.kind === "resync") {
            return { ...s, helperTranscripts: { ...s.helperTranscripts, [child.id]: ev.messages } };
          }
          const rows = s.helperTranscripts[child.id] ?? [];
          if (ev.kind === "tool" && ev.id) {
            const i = rows.findIndex((r) => r.kind === "tool" && r.id === ev.id);
            if (i >= 0) {
              const next = rows.slice();
              next[i] = { ...(next[i] as HelperToolRow), status: ev.status };
              return { ...s, helperTranscripts: { ...s.helperTranscripts, [child.id]: next } };
            }
          }
          return { ...s, helperTranscripts: { ...s.helperTranscripts, [child.id]: [...rows, ev] } };
        });
      } else if (m.type === "helper_working") {
        setState((s) => {
          const child = s.children.find((c) => c.activeSessionId === m.sessionId);
          if (!child) return s;
          return { ...s, helperWorking: { ...s.helperWorking, [child.id]: m.text } };
        });
      } else if (m.type === "root_snapshot") {
        // Canonical transcript for a watched root: same slim/replay/fold shape
        // as master's attach history. Replaces wholesale (resync semantics).
        const items = foldHistory(historyToItems((m.messages as HistoryMessage[]) ?? []));
        clearRootStream(m.root);
        setState((s) => ({
          ...s,
          rootTimelines: { ...s.rootTimelines, [m.root]: items },
          rootLoad: { ...s.rootLoad, [m.root]: m.partial ? "partial" : "full" },
          rootStates:
            m.running === undefined
              ? s.rootStates
              : { ...s.rootStates, [m.root]: m.running ? "working" : "idle" },
        }));
      } else if (m.type === "root_event") {
        onRootEvent(m.root, m.event);
      } else if (m.type === "root_working") {
        setState((s) => ({ ...s, rootWorking: { ...s.rootWorking, [m.root]: m.text } }));
      } else if (m.type === "snapshot") {
        // The snapshot roster is authoritative: helpers can vanish (the agent
        // may delete its own). Merge by id, keep cached session ids, drop the
        // vanished, and never leave a stale selection or composer target.
        const roster = (m.children as ChildInfo[]) ?? [];
        // Attach history rides along once per workspace: the timeline at this
        // point is a single divider (session started / workspace switch), and
        // the earlier turns follow it. A reconnect snapshot must not re-seed.
        const history = histSeededRef.current
          ? []
          : foldHistory(historyToItems((m.messages as HistoryMessage[]) ?? []));
        histSeededRef.current = true;
        setState((s) => {
          const children = roster.map((c) => {
            const prev = s.children.find((p) => p.id === c.id);
            return { ...prev, ...c, activeSessionId: c.activeSessionId ?? prev?.activeSessionId };
          });
          const has = (cid: string | null) => cid !== null && children.some((c) => c.id === cid);
          return reconcileSplit(
            {
              ...s,
              goal: (m.state.goal as GoalInfo) ?? null,
              children,
              timeline: history.length > 0 ? [...s.timeline, ...history] : s.timeline,
              selectedAgent: has(s.selectedAgent) ? s.selectedAgent : null,
              target:
                s.target.kind === "helper" && !has(s.target.childId) ? { kind: "master" } : s.target,
            },
            { children: true },
          );
        });
      } else if (m.type === "event") {
        onEvent(m.event);
      }
    });
    return () => bridge.close();
  }, [refreshOthers]);

  const setColumn = useCallback((column: ColumnView) => setState((s) => ({ ...s, column })), []);
  // Tabs and the Learned shortcut drive the FOCUSED pane (showFocused: if the
  // other pane already shows it, focus moves there instead of duplicating).
  const setView = useCallback(
    (view: AppState["view"]) =>
      setState((s) =>
        showFocused(s, view === "learned" ? { kind: "learned" } : view === "preview" ? { kind: "preview" } : { kind: "timeline" }),
      ),
    [],
  );
  // Selecting an agent in the column never changes the composer target —
  // helpers and other roots alike; the target moves only via the to ▾ popup.
  // It changes what the focused pane shows.
  const selectAgent = useCallback(
    (childId: string | null) =>
      setState((s) => showFocused(s, childId ? { kind: "helper", childId } : { kind: "timeline" })),
    [],
  );
  const selectRoot = useCallback(
    (name: string) => setState((s) => showFocused(s, { kind: "root", name })),
    [],
  );
  const setTarget = useCallback((target: ComposerTarget) => setState((s) => ({ ...s, target })), []);
  // From the Files column: match the tool-arg path (may be absolute) against
  // the workspace-relative preview index.
  const openPreview = useCallback(
    (file?: FileActivity) =>
      setState((s) => {
        const match = file
          ? s.previewFiles.find(
              (p) => p.path === file.path || file.path.endsWith(`/${p.path}`) || p.name === file.name,
            )
          : undefined;
        return {
          ...showFocused(s, { kind: "preview" }),
          selectedAgent: null,
          previewPath: match?.path ?? s.previewPath,
        };
      }),
    [],
  );
  // Clicking anywhere in the unfocused pane moves focus there (model swap:
  // canonical fields take that pane's content, `other` takes the old one).
  const focusPane = useCallback(
    (side: "left" | "right") =>
      setState((s) => {
        if (!s.split || s.split.focusSide === side) return s;
        return { ...s, ...panePatch(s.split.other), split: { other: currentPane(s), focusSide: side } };
      }),
    [],
  );
  /** Close one pane's tab. Split: that pane goes away, the other stays (and
   *  takes focus if the closed one had it). Single pane: back to the master
   *  timeline (the timeline tab itself has no ×). */
  const closePane = useCallback((side: "left" | "right" | null) => {
    setState((s) => {
      if (!s.split || side === null) {
        if (currentPane(s).kind === "timeline") return s;
        return { ...s, ...panePatch({ kind: "timeline" }), split: null };
      }
      const keep = side === s.split.focusSide ? s.split.other : currentPane(s);
      return { ...s, ...panePatch(keep), split: null };
    });
  }, []);
  /** Rail ⚡: open Learned in the focused pane; click again to close it. */
  const toggleLearned = useCallback(() => {
    setState((s) => {
      if (currentPane(s).kind === "learned") {
        if (!s.split) return { ...s, ...panePatch({ kind: "timeline" }) };
        return { ...s, ...panePatch(s.split.other), split: null };
      }
      if (s.split?.other.kind === "learned") return { ...s, split: null };
      return showFocused(s, { kind: "learned" });
    });
  }, []);
  /** A tab dropped on the left/right half of the center area. */
  const dropPane = useCallback((v: PaneView, side: "left" | "right") => {
    setState((s) => {
      const cur = currentPane(s);
      if (!s.split) {
        // Same view as the only pane — nothing to pair it with.
        if (sameView(v, cur)) return s;
        // Open the split: dropped view on the chosen side, focused.
        return { ...s, ...panePatch(v), split: { other: cur, focusSide: side } };
      }
      const other = s.split.other;
      const sideView = side === s.split.focusSide ? cur : other;
      const awayView = side === s.split.focusSide ? other : cur;
      if (sameView(v, sideView)) {
        // Already there — just focus that pane.
        if (side === s.split.focusSide) return s;
        return { ...s, ...panePatch(sideView), split: { other: cur, focusSide: side } };
      }
      if (sameView(v, awayView)) {
        // It lives on the other side — move it across (panes swap), focused.
        return { ...s, ...panePatch(v), split: { other: sideView, focusSide: side } };
      }
      // Replace whatever the drop side showed; the other pane stays.
      return { ...s, ...panePatch(v), split: { other: awayView, focusSide: side } };
    });
  }, []);
  const selectPreviewFile = useCallback(
    (previewPath: string) => setState((s) => ({ ...s, previewPath })),
    [],
  );

  const stop = useCallback(() => {
    const target = stateRef.current.target;
    if (target.kind === "root") {
      bridgeCmd("root_abort", undefined, { target: target.name }).catch(() => undefined);
      return;
    }
    if (bridgeRef.current) {
      bridgeCmd("abort").catch(() => undefined);
    } else {
      abortRef.current?.abort();
    }
  }, []);

  const stopHelperById = useCallback((childId: string) => {
    stopHelper(childId).catch((e) =>
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : "stop failed" })),
    );
  }, []);

  const removeHelperById = useCallback((childId: string) => {
    removeHelper(childId)
      .then(() =>
        setState((s) => ({
          ...s,
          children: s.children.filter((c) => c.id !== childId),
          selectedAgent: s.selectedAgent === childId ? null : s.selectedAgent,
          target:
            s.target.kind === "helper" && s.target.childId === childId ? { kind: "master" } : s.target,
        })),
      )
      .catch((e) => setState((s) => ({ ...s, error: e instanceof Error ? e.message : "remove failed" })));
  }, []);

  const sendToHelper = useCallback(async (child: ChildInfo, text: string) => {
    if (!child.activeSessionId) return;
    try {
      const status = await sendAgentMessage(child.activeSessionId, text);
      const ev: HelperEvent = {
        id: id(),
        tone: "",
        text: `msg ← you · “${text}”`,
        rt: status === "queued" ? "queued, lands at its next step" : `delivered · ${clock()}`,
      };
      setState((s) => ({
        ...s,
        error: undefined,
        helperEvents: { ...s.helperEvents, [child.id]: [...(s.helperEvents[child.id] ?? []), ev] },
      }));
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : "message failed" }));
    }
  }, []);

  /* ---- NIM fallback path (no daemon) ---- */
  const sendViaNim = useCallback(async (text: string, masterId: string) => {
    const abort = new AbortController();
    abortRef.current = abort;
    const settle = (patch: (t: TimelineItem) => TimelineItem | null, error?: string) =>
      setState((s) => ({
        ...s,
        master: "idle",
        error,
        timeline: s.timeline
          .map((t) => (t.id === masterId ? patch(t) : t))
          .filter((t): t is TimelineItem => t !== null),
      }));
    try {
      const reply = await runMasterTurn(
        historyRef.current,
        (delta) => {
          setState((s) => ({
            ...s,
            timeline: s.timeline.map((t) =>
              t.id === masterId && t.kind === "master" ? { ...t, text: t.text + delta } : t,
            ),
          }));
        },
        abort.signal,
      );
      historyRef.current.push({ role: "assistant", content: reply });
      settle((t) => (t.kind === "master" ? { ...t, streaming: false } : t));
    } catch (e) {
      const aborted = abort.signal.aborted;
      settle(
        (t) => {
          if (t.kind !== "master") return t;
          if (t.text === "") return null;
          historyRef.current.push({ role: "assistant", content: t.text });
          return { ...t, streaming: false };
        },
        aborted ? undefined : e instanceof Error ? e.message : "model request failed",
      );
      if (aborted) {
        setState((s) => ({
          ...s,
          timeline: [...s.timeline, { kind: "divider", id: id(), text: `stopped by you · ${clock()}` }],
        }));
      }
    } finally {
      abortRef.current = null;
    }
  }, []);

  /** Message another root: prompt when idle (wakes it — normal daemon
   *  behavior), steer when running. Shared by the root pane's own composer
   *  and the to ▾ target path. */
  const postRoot = useCallback(async (name: string, text: string) => {
    const busy = (stateRef.current.rootStates[name] ?? "idle") === "working";
    const op = busy ? "root_steer" : "root_prompt";
    const userItem: TimelineItem = { kind: "user", id: id(), text, at: clock() };
    setState((s) => ({
      ...s,
      error: undefined,
      rootStates: busy ? s.rootStates : { ...s.rootStates, [name]: "working" },
      rootTimelines: {
        ...s.rootTimelines,
        [name]: [...(s.rootTimelines[name] ?? []), userItem],
      },
    }));
    try {
      await bridgeCmd(op, text, { target: name });
    } catch (e) {
      setState((s) => ({
        ...s,
        error: e instanceof Error ? e.message : "bridge command failed",
      }));
    }
  }, []);
  const stopRoot = useCallback((name: string) => {
    bridgeCmd("root_abort", undefined, { target: name }).catch(() => undefined);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const current = stateRef.current;
      if (current.target.kind === "helper") {
        const child = current.children.find(
          (c) => c.id === (current.target as { childId: string }).childId,
        );
        if (child) await sendToHelper(child, text);
        return;
      }
      const userItem: TimelineItem = { kind: "user", id: id(), text, at: clock() };
      if (current.target.kind === "root") {
        // Another root session via the to ▾ target: jump the view to it, like
        // master's send, then post through the shared pane-send path.
        const name = current.target.name;
        setState((s) => showFocused(s, { kind: "root", name }));
        await postRoot(name, text);
        return;
      }
      if (bridgeRef.current) {
        const busy = current.master === "working";
        const op = busy ? "steer" : "prompt";
        setState((s) => {
          const jumped = showFocused(s, { kind: "timeline" });
          return {
            ...jumped,
            master: "working",
            error: undefined,
            timeline: [...jumped.timeline, userItem],
          };
        });
        try {
          if (op === "steer") await steer(text);
          else await bridgeCmd("prompt", text);
        } catch (e) {
          setState((s) => ({
            ...s,
            error: e instanceof Error ? e.message : "bridge command failed",
          }));
        }
        return;
      }
      const masterId = id();
      historyRef.current.push({ role: "user", content: text });
      setState((s) => {
        const jumped = showFocused(s, { kind: "timeline" });
        return {
          ...jumped,
          master: "working",
          error: undefined,
          timeline: [
            ...jumped.timeline,
            userItem,
            { kind: "master", id: masterId, text: "", at: clock(), streaming: true },
          ],
        };
      });
      await sendViaNim(text, masterId);
    },
    [sendViaNim, sendToHelper, postRoot],
  );

  const selectedChild = state.selectedAgent
    ? state.children.find((c) => c.id === state.selectedAgent) ?? null
    : null;
  const needsYou = state.children.filter((c) => c.status === "done" && !c.repliedSinceTask).length;

  // Either pane can hold a helper or root view now — watch whatever is open.
  const otherPane = state.split?.other ?? null;
  const otherHelper =
    otherPane?.kind === "helper" ? state.children.find((c) => c.id === otherPane.childId) ?? null : null;

  // Watch open helpers' live sessions (second attaches on the same daemon
  // socket). Attach can fail when the helper ran inline or was deleted — no
  // retry; the view then shows observed events only.
  const helperWatchKey = [
    ...new Set(
      [selectedChild?.activeSessionId, otherHelper?.activeSessionId].filter((x): x is string => Boolean(x)),
    ),
  ]
    .sort()
    .join("\n");
  useEffect(() => {
    if (!helperWatchKey) return;
    const targets = helperWatchKey.split("\n");
    for (const t of targets) bridgeCmd("watch_helper", undefined, { target: t }).catch(() => undefined);
    return () => {
      for (const t of targets) bridgeCmd("unwatch_helper", undefined, { target: t }).catch(() => undefined);
    };
  }, [helperWatchKey]);

  // Watch open other roots (another attach, mirroring watch_helper). Detaches
  // on switch-away; an attach failure means the root is gone — fall back to
  // master honestly (the roster re-pull also reconciles a stale pane).
  const rootWatchKey = [
    ...new Set(
      [state.selectedRoot, otherPane?.kind === "root" ? otherPane.name : null].filter(
        (x): x is string => Boolean(x),
      ),
    ),
  ]
    .sort()
    .join("\n");
  useEffect(() => {
    if (!rootWatchKey) return;
    const names = rootWatchKey.split("\n");
    for (const name of names) {
      bridgeCmd("watch_root", undefined, { target: name }).catch(() => {
        refreshOthers();
        setState((s) => reconcileSplit(s.selectedRoot === name ? { ...s, selectedRoot: null } : s));
      });
    }
    return () => {
      for (const name of names) bridgeCmd("unwatch_root", undefined, { target: name }).catch(() => undefined);
    };
  }, [rootWatchKey, refreshOthers]);

  // Persist the split layout per workspace; single pane clears the key (reset
  // included). Guarded by splitKeyRef so nothing writes before the restore.
  const split = state.split;
  const splitSave = split
    ? (() => {
        const focused = currentPane(state);
        const left = split.focusSide === "left" ? focused : split.other;
        const right = split.focusSide === "left" ? split.other : focused;
        return JSON.stringify({ left, right, focus: split.focusSide });
      })()
    : null;
  useEffect(() => {
    const key = splitKeyRef.current;
    if (!key) return;
    if (splitSave === null) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* private mode */
      }
      return;
    }
    saveJson(key, JSON.parse(splitSave));
  }, [splitSave]);

  // An agent writing files this turn auto-opens Preview in the second pane
  // (right of the focused one), without stealing focus. Each new live snapshot
  // signature triggers once — closing the pane doesn't reopen it for the same
  // write, the next write brings it back.
  const liveSig = state.previewFiles
    .filter((f) => f.live)
    .map((f) => `${f.path}:${f.versions.length}`)
    .sort()
    .join("|");
  const autoPreviewRef = useRef("");
  useEffect(() => {
    if (!liveSig || liveSig === autoPreviewRef.current) return;
    autoPreviewRef.current = liveSig;
    setState((s) => {
      if (currentPane(s).kind === "preview" || s.split?.other.kind === "preview") return s;
      if (!s.split) return { ...s, split: { other: { kind: "preview" }, focusSide: "left" } };
      return { ...s, split: { ...s.split, other: { kind: "preview" } } };
    });
  }, [liveSig]);

  // A root's run state: its own event stream once attached, else the roster word.
  const rootStateOf = (name: string): AgentState =>
    state.rootStates[name] ??
    (state.others.find((a) => a.name === name)?.state === "running" ? "working" : "idle");
  // Busy-ness the composer acts on — the current target's, not the view's.
  const targetState: AgentState =
    state.target.kind === "root" ? rootStateOf(state.target.name) : state.master;

  const composer = () => (
    <Composer
      master={state.master}
      targetState={targetState}
      goal={state.goal}
      autonomous={state.autonomous}
      heartbeats={state.heartbeats}
      bridge={state.bridge}
      children={state.children}
      others={state.others}
      target={state.target}
      working={state.working}
      error={state.error}
      onTarget={setTarget}
      onSend={send}
      onStop={stop}
    />
  );

  // A root pane's own composer: fixed to that root — the chat input follows
  // the pane, wherever the to ▾ target of the master composer points.
  const rootComposer = (name: string) => (
    <Composer
      master={state.master}
      targetState={rootStateOf(name)}
      goal={state.goal}
      autonomous={state.autonomous}
      heartbeats={state.heartbeats}
      bridge={state.bridge}
      children={state.children}
      others={state.others}
      target={state.target}
      working={state.working}
      error={state.error}
      viewRoot={{ name, state: rootStateOf(name), working: state.rootWorking[name] || undefined }}
      fixedRoot={name}
      onTarget={setTarget}
      onSend={(t) => postRoot(name, t)}
      onStop={() => stopRoot(name)}
    />
  );

  // Another root session's timeline — same replay/fold shape as master's;
  // header + transcript only (the composer is placed by the caller).
  const renderRootPane = (name: string) => {
    const other = state.others.find((a) => a.name === name);
    const items = state.rootTimelines[name] ?? [];
    const load = state.rootLoad[name];
    const rs = rootStateOf(name);
    // Honest empty states: attaching, mid-run catch-up, or truly nothing.
    const placeholder: TimelineItem = {
      kind: "divider",
      id: `rload-${name}`,
      text:
        load === undefined
          ? "attaching · loading history…"
          : load === "partial"
            ? "attached mid-run · catching up…"
            : "no conversation yet",
    };
    return (
      <>
        <div className="ahead">
          <div className="r1">
            <BotAvatar seed={name} />
            <span className="nm">{name}</span>
            <span className="rel">root agent · runs on its own</span>
          </div>
          <div className="r2">
            {rs === "working" ? (
              <span className="run">running</span>
            ) : other?.state === "inactive" && load === undefined ? (
              <>inactive · a message wakes it</>
            ) : (
              <>idle</>
            )}
          </div>
        </div>
        <Timeline items={items.length > 0 ? items : [placeholder]} />
      </>
    );
  };

  /** One pane's content (no composer — the composer stays singular). */
  const paneBody = (p: PaneView) => {
    if (p.kind === "learned") return <LearnedView />;
    if (p.kind === "preview") {
      return (
        <PreviewView
          files={state.previewFiles}
          selectedPath={state.previewPath}
          timeline={state.timeline}
          onSelect={selectPreviewFile}
        />
      );
    }
    if (p.kind === "helper") {
      const child = state.children.find((c) => c.id === p.childId) ?? null;
      if (!child) {
        // Restored pane whose helper is gone; the roster snapshot reconciles
        // it away — until then, say so instead of inventing content.
        return (
          <div className="transcript">
            <div className="div">helper no longer here</div>
          </div>
        );
      }
      return (
        <HelperView
          child={child}
          events={state.helperEvents[child.id] ?? []}
          transcript={state.helperTranscripts[child.id] ?? []}
          working={state.helperWorking[child.id] || undefined}
          onStop={stopHelperById}
          onRemove={removeHelperById}
          onSend={sendToHelper}
        />
      );
    }
    if (p.kind === "root") return renderRootPane(p.name);
    return <Timeline items={state.timeline} />;
  };

  const focusedPane = currentPane(state);

  const paneTitle = (p: PaneView): string => {
    if (p.kind === "learned") return "Learned";
    if (p.kind === "preview") return "Preview";
    if (p.kind === "helper") {
      const c = state.children.find((x) => x.id === p.childId);
      return c ? helperName(c) : "helper";
    }
    if (p.kind === "root") return p.name;
    return "master · timeline";
  };

  /** The chat input follows its pane: master timeline gets the to ▾ composer,
   *  a root pane gets one fixed to that root; helpers carry their own input. */
  const paneComposer = (p: PaneView) => {
    if (p.kind === "timeline") return composer();
    if (p.kind === "root") return rootComposer(p.name);
    return null;
  };

  const center = () => {
    if (state.split) {
      // Two panes, fixed 50/50, separated by the recessed gutter color; each
      // pane carries its own tab strip and (for conversations) its own input.
      const fs = state.split.focusSide;
      const leftP = fs === "left" ? focusedPane : state.split.other;
      const rightP = fs === "left" ? state.split.other : focusedPane;
      return (
        <div className="panes">
          {renderPane(leftP, "left", fs !== "left")}
          {renderPane(rightP, "right", fs !== "right")}
        </div>
      );
    }
    return renderPane(focusedPane, null, false);
  };

  /* ---- tab drag → split (drop on a half), tab bar drop = plain switch ---- */
  const tabDragStart = (v: PaneView) => (e: React.DragEvent) => {
    dragViewRef.current = v;
    e.dataTransfer.setData("text/plain", v.kind);
    e.dataTransfer.effectAllowed = "move";
  };
  const tabDragEnd = () => {
    dragViewRef.current = null;
    setDropHint(null);
  };
  const dropSide = (e: React.DragEvent<HTMLDivElement>): "left" | "right" => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? "left" : "right";
  };
  const bodyDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const v = dragViewRef.current;
    if (!v) return;
    const s = stateRef.current;
    // Single pane showing exactly this view: a drop would change nothing.
    if (!s.split && sameView(v, currentPane(s))) {
      setDropHint(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const side = dropSide(e);
    setDropHint((h) => (h === side ? h : side));
  };
  const bodyDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropHint(null);
  };
  const bodyDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const v = dragViewRef.current;
    dragViewRef.current = null;
    setDropHint(null);
    if (!v) return;
    e.preventDefault();
    dropPane(v, dropSide(e));
  };
  const tabsDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dragViewRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  /** A tab dropped on a pane's own strip moves the view into that pane. */
  const tabsDropOn = (side: "left" | "right" | null) => (e: React.DragEvent<HTMLDivElement>) => {
    const v = dragViewRef.current;
    dragViewRef.current = null;
    setDropHint(null);
    if (!v) return;
    e.preventDefault();
    e.stopPropagation();
    if (side) dropPane(v, side);
    else setState((s) => showFocused(s, v));
  };

  /** One pane's tab strip: the pane's view as its (active) tab, closable with
   *  ×. The strip follows the pane — there is no global tab bar. */
  const paneTabs = (p: PaneView, side: "left" | "right" | null) => {
    const closable = side !== null || p.kind !== "timeline";
    return (
      <div className="tabs" onDragOver={tabsDragOver} onDrop={tabsDropOn(side)}>
        <div className="tab on" draggable onDragStart={tabDragStart(p)} onDragEnd={tabDragEnd}>
          {paneTitle(p)}
          {closable && (
            <button
              className="tx"
              title="close"
              onClick={(e) => {
                e.stopPropagation();
                closePane(side);
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderPane = (p: PaneView, side: "left" | "right" | null, away: boolean) => (
    <div
      key={side ?? "solo"}
      className={away ? "pane away" : "pane"}
      onMouseDownCapture={side ? () => focusPane(side) : undefined}
    >
      {paneTabs(p, side)}
      <div className="pbody">{paneBody(p)}</div>
      {paneComposer(p)}
    </div>
  );

  return (
    <div className="app">
      {wsOpen && (
        <WorkspacePopup
          bridge={state.bridge}
          master={state.master}
          needsYou={needsYou}
          onClose={() => setWsOpen(false)}
        />
      )}
      {setOpen && (
        <SettingsPopup
          theme={state.theme}
          bridge={state.bridge}
          onToggleTheme={toggleTheme}
          onClose={() => setSetOpen(false)}
        />
      )}
      <div className="frame">
        <Rail
          column={state.column}
          workspace={state.bridge?.workspace || "general"}
          bridge={state.bridge}
          learnedOn={focusedPane.kind === "learned" || state.split?.other.kind === "learned" || false}
          onColumn={setColumn}
          onLearned={toggleLearned}
          onLogo={() => setWsOpen((v) => !v)}
          onSettings={() => setSetOpen((v) => !v)}
        />
        {state.column === "agents" ? (
          <AgentsColumn
            master={state.master}
            workspace={state.bridge?.workspace || "general"}
            children={state.children}
            others={state.others}
            selected={state.selectedAgent}
            selectedRoot={state.selectedRoot}
            rootStates={state.rootStates}
            working={state.working}
            helperWorking={state.helperWorking}
            rootWorking={state.rootWorking}
            onSelect={selectAgent}
            onSelectRoot={selectRoot}
            onRefreshOthers={refreshOthers}
          />
        ) : (
          <FilesColumn files={state.files} onOpenPreview={openPreview} />
        )}
        <div className="center">
          <div className="cbody" onDragOver={bodyDragOver} onDragLeave={bodyDragLeave} onDrop={bodyDrop}>
            {center()}
            {dropHint && <div className={`drophint ${dropHint}`} />}
          </div>
        </div>
        <Inspector
          master={state.master}
          goal={state.goal}
          bridge={state.bridge}
          heartbeats={state.heartbeats}
          autonomous={state.autonomous}
          refreshKey={inspectorKey}
          onOpenLearn={() => setView("learned")}
        />
      </div>
    </div>
  );
}
