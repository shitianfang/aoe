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
  RootAgent,
  Theme,
  TimelineItem,
} from "./types";
import { SettingsPopup, WorkspacePopup } from "./components/Overlays";
import { Rail } from "./components/Rail";
import { AgentsColumn } from "./components/AgentsColumn";
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
  // Last live timeline append; long silences get one dashed time rule.
  const lastAtRef = useRef(Date.now());
  const [setOpen, setSetOpen] = useState(false);

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
        return {
          ...s,
          others,
          selectedRoot: has(s.selectedRoot) ? s.selectedRoot : null,
          target: s.target.kind === "root" && !has(s.target.name) ? { kind: "master" } : s.target,
        };
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
        setState((s) => ({ ...s, previewFiles }));
      }, 300);
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
      } else if (t === "refine_complete") {
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
          const bridgeState = { connected: m.daemon.connected, error: m.daemon.error ?? null, workspace: ws };
          if (!switched) return { ...s, bridge: bridgeState };
          // A workspace is its own master, helpers, other roots, files, history.
          daemonMsgRef.current = null;
          historyRef.current = [];
          histSeededRef.current = false;
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
          };
        });
        if (m.daemon.connected) {
          refreshHeartbeats();
          refreshPreview();
          refreshOthers();
        }
      } else if (m.type === "heartbeats_changed") {
        refreshHeartbeats();
      } else if (m.type === "preview_update") {
        refreshPreview();
      } else if (m.type === "file_activity") {
        // fs truth from the bridge's per-turn scan (writes happen inside the kernel)
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
          return {
            ...s,
            goal: (m.state.goal as GoalInfo) ?? null,
            children,
            timeline: history.length > 0 ? [...s.timeline, ...history] : s.timeline,
            selectedAgent: has(s.selectedAgent) ? s.selectedAgent : null,
            target:
              s.target.kind === "helper" && !has(s.target.childId) ? { kind: "master" } : s.target,
          };
        });
      } else if (m.type === "event") {
        onEvent(m.event);
      }
    });
    return () => bridge.close();
  }, [refreshOthers]);

  const setColumn = useCallback((column: ColumnView) => setState((s) => ({ ...s, column })), []);
  const setView = useCallback((view: AppState["view"]) => setState((s) => ({ ...s, view })), []);
  // Selecting an agent in the column never changes the composer target —
  // helpers and other roots alike; the target moves only via the to ▾ popup.
  const selectAgent = useCallback(
    (childId: string | null) =>
      setState((s) => ({ ...s, selectedAgent: childId, selectedRoot: null, view: "timeline" })),
    [],
  );
  const selectRoot = useCallback(
    (name: string) =>
      setState((s) => ({ ...s, selectedRoot: name, selectedAgent: null, view: "timeline" })),
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
        return { ...s, view: "preview", selectedAgent: null, previewPath: match?.path ?? s.previewPath };
      }),
    [],
  );
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
        // Another root session: prompt when idle (wakes it — normal daemon
        // behavior), steer when running. Jump the view to it, like master's send.
        const name = current.target.name;
        const busy = (current.rootStates[name] ?? "idle") === "working";
        const op = busy ? "root_steer" : "root_prompt";
        setState((s) => ({
          ...s,
          view: "timeline",
          selectedAgent: null,
          selectedRoot: name,
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
        return;
      }
      if (bridgeRef.current) {
        const busy = current.master === "working";
        const op = busy ? "steer" : "prompt";
        setState((s) => ({
          ...s,
          master: "working",
          view: "timeline",
          selectedAgent: null,
          selectedRoot: null,
          error: undefined,
          timeline: [...s.timeline, userItem],
        }));
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
      setState((s) => ({
        ...s,
        master: "working",
        view: "timeline",
        selectedAgent: null,
        selectedRoot: null,
        error: undefined,
        timeline: [...s.timeline, userItem, { kind: "master", id: masterId, text: "", at: clock(), streaming: true }],
      }));
      await sendViaNim(text, masterId);
    },
    [sendViaNim, sendToHelper],
  );

  const selectedChild = state.selectedAgent
    ? state.children.find((c) => c.id === state.selectedAgent) ?? null
    : null;
  const needsYou = state.children.filter((c) => c.status === "done" && !c.repliedSinceTask).length;

  // Watch the selected helper's live session while its view is open (a second
  // attach on the same daemon socket). Attach can fail when the helper ran
  // inline or was deleted — no retry; the view then shows observed events only.
  const watchTarget = selectedChild?.activeSessionId ?? null;
  useEffect(() => {
    if (!watchTarget) return;
    bridgeCmd("watch_helper", undefined, { target: watchTarget }).catch(() => undefined);
    return () => {
      bridgeCmd("unwatch_helper", undefined, { target: watchTarget }).catch(() => undefined);
    };
  }, [watchTarget]);

  // Watch the selected other root while its view is open (another attach on
  // the same daemon socket, mirroring watch_helper). Detaches on switch-away;
  // an attach failure means the root is gone — fall back to master honestly.
  const watchRoot = state.selectedRoot;
  useEffect(() => {
    if (!watchRoot) return;
    bridgeCmd("watch_root", undefined, { target: watchRoot }).catch(() => {
      refreshOthers();
      setState((s) => (s.selectedRoot === watchRoot ? { ...s, selectedRoot: null } : s));
    });
    return () => {
      bridgeCmd("unwatch_root", undefined, { target: watchRoot }).catch(() => undefined);
    };
  }, [watchRoot, refreshOthers]);

  // A root's run state: its own event stream once attached, else the roster word.
  const rootStateOf = (name: string): AgentState =>
    state.rootStates[name] ??
    (state.others.find((a) => a.name === name)?.state === "running" ? "working" : "idle");
  // Busy-ness the composer acts on — the current target's, not the view's.
  const targetState: AgentState =
    state.target.kind === "root" ? rootStateOf(state.target.name) : state.master;

  const composer = (viewRoot?: { name: string; state: AgentState; working?: string }) => (
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
      viewRoot={viewRoot}
      onTarget={setTarget}
      onSend={send}
      onStop={stop}
    />
  );

  const center = () => {
    if (state.view === "learned") return <LearnedView />;
    if (state.view === "preview") {
      return (
        <PreviewView
          files={state.previewFiles}
          selectedPath={state.previewPath}
          timeline={state.timeline}
          onSelect={selectPreviewFile}
        />
      );
    }
    if (selectedChild) {
      return (
        <HelperView
          child={selectedChild}
          index={state.children.indexOf(selectedChild)}
          events={state.helperEvents[selectedChild.id] ?? []}
          transcript={state.helperTranscripts[selectedChild.id] ?? []}
          working={state.helperWorking[selectedChild.id] || undefined}
          onStop={stopHelperById}
          onRemove={removeHelperById}
          onSend={sendToHelper}
        />
      );
    }
    if (state.selectedRoot) {
      // Another root session's timeline — same replay/fold shape as master's.
      const name = state.selectedRoot;
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
        <div className="view">
          <div className="ahead">
            <div className="r1">
              <span className="chip ghost">{name.slice(0, 1).toUpperCase()}</span>
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
          {composer({ name, state: rs, working: state.rootWorking[name] || undefined })}
        </div>
      );
    }
    return (
      <div className="view">
        <Timeline items={state.timeline} />
        {composer()}
      </div>
    );
  };

  const timelineTabOn = state.view === "timeline" && !selectedChild && !state.selectedRoot;
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
          bridge={state.bridge}
          onColumn={setColumn}
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
            onSelect={selectAgent}
            onSelectRoot={selectRoot}
            onRefreshOthers={refreshOthers}
          />
        ) : (
          <FilesColumn files={state.files} onOpenPreview={openPreview} />
        )}
        <div className="center">
          <div className="tabs">
            <button className={timelineTabOn ? "tab on" : "tab"} onClick={() => selectAgent(null)}>
              master · timeline
            </button>
            <button className={state.view === "learned" ? "tab on" : "tab"} onClick={() => setView("learned")}>
              Learned
            </button>
            <button className={state.view === "preview" ? "tab on" : "tab"} onClick={() => setView("preview")}>
              Preview
            </button>
          </div>
          {center()}
        </div>
        <Inspector
          master={state.master}
          goal={state.goal}
          bridge={state.bridge}
          heartbeats={state.heartbeats}
          autonomous={state.autonomous}
          onOpenLearn={() => setView("learned")}
        />
      </div>
    </div>
  );
}
