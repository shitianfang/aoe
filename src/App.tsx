import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AppState,
  AutonomousInfo,
  ChildInfo,
  ColumnView,
  ComposerTarget,
  DeliveryMode,
  FileActivity,
  GoalInfo,
  HeartbeatInfo,
  HelperEvent,
  Theme,
  TimelineItem,
} from "./types";
import { TitleBar } from "./components/TitleBar";
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
  followUp,
  sendAgentMessage,
  stopHelper,
  removeHelper,
  extractText,
  type BridgeMessage,
} from "./runtime/bridge";
import { getPreviewState } from "./runtime/preview";
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
    bridge: null,
    goal: null,
    children: [],
    helperEvents: {},
    files: [],
    preview: getPreviewState(),
    heartbeats: [],
    autonomous: null,
    target: { kind: "master" },
    delivery: "now",
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
  const bridgeRef = useRef(false);

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

  /* ---- daemon bridge ingestion ---- */
  useEffect(() => {
    const push = (item: TimelineItem) => setState((s) => ({ ...s, timeline: [...s.timeline, item] }));

    let hbTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshHeartbeats = () => {
      // heartbeats_changed is a global no-payload signal — throttle the re-pull.
      if (hbTimer) return;
      hbTimer = setTimeout(async () => {
        hbTimer = null;
        try {
          const r = await fetch("/bridge/heartbeats").then((x) => x.json());
          const jobs: HeartbeatInfo[] = (r.heartbeats ?? [])
            .map((h: { job?: HeartbeatInfo }) => h.job ?? (h as HeartbeatInfo))
            .filter((j: HeartbeatInfo) => j.status === "active" || j.status === "paused");
          setState((s) => ({ ...s, heartbeats: jobs }));
        } catch {
          /* bridge offline */
        }
      }, 400);
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
          timeline: s.timeline.map((x) => (x.kind === "master" && x.streaming ? { ...x, streaming: false } : x)),
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
            push({ kind: "divider", id: id(), text: `msg ← ${fromName} · ${clock()}` });
            setState((s) => {
              const child = s.children.find(
                (c) =>
                  (from?.activeSessionId !== undefined && c.activeSessionId === from.activeSessionId) ||
                  c.sessionName === fromName,
              );
              if (!child) return s;
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
        const toolName = String(event.toolName ?? "tool");
        const path = filePathFromArgs(event.args);
        const label = path ? `${toolName} · ${path.split(/[\\/]/).pop()}` : toolName;
        setState((s) => ({
          ...s,
          files: path && toolName === "edit" ? upsertFile(s.files, path, "master") : s.files,
          timeline: [
            ...s.timeline,
            {
              kind: "tool",
              id: `tool-${String(event.toolCallId ?? id())}`,
              name: label,
              status: "running",
              at: clock(),
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
        const result = event.result as { id?: string; summary?: string } | undefined;
        push({ kind: "divider", id: id(), text: `lesson kept · ${result?.summary ?? result?.id ?? ""} · ${clock()}` });
      } else if (t === "compaction_end") {
        // compaction is not shown (HANDOFF §4)
      }
    };

    const bridge = openBridge((m: BridgeMessage) => {
      if (m.type === "hello") {
        bridgeRef.current = m.daemon.connected;
        setState((s) => ({
          ...s,
          bridge: {
            connected: m.daemon.connected,
            error: m.daemon.error ?? null,
            workspace: m.daemon.workspace ?? null,
          },
        }));
        if (m.daemon.connected) refreshHeartbeats();
      } else if ((m as { type: string }).type === "heartbeats_changed") {
        refreshHeartbeats();
      } else if (m.type === "snapshot") {
        // The snapshot roster is authoritative: helpers can vanish (the agent
        // may delete its own). Merge by id, keep cached session ids, drop the
        // vanished, and never leave a stale selection or composer target.
        const roster = (m.children as ChildInfo[]) ?? [];
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
  }, []);

  const setColumn = useCallback((column: ColumnView) => setState((s) => ({ ...s, column })), []);
  const setView = useCallback((view: AppState["view"]) => setState((s) => ({ ...s, view })), []);
  // Selecting an agent in the column never changes the composer target.
  const selectAgent = useCallback(
    (childId: string | null) => setState((s) => ({ ...s, selectedAgent: childId, view: "timeline" })),
    [],
  );
  const setTarget = useCallback((target: ComposerTarget) => setState((s) => ({ ...s, target })), []);
  const setDelivery = useCallback((delivery: DeliveryMode) => setState((s) => ({ ...s, delivery })), []);
  const openPreview = useCallback(
    () => setState((s) => ({ ...s, view: "preview", selectedAgent: null })),
    [],
  );

  const stop = useCallback(() => {
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
      if (bridgeRef.current) {
        const busy = current.master === "working";
        const op = busy ? (current.delivery === "after" ? "follow_up" : "steer") : "prompt";
        setState((s) => ({
          ...s,
          master: op === "prompt" ? "working" : s.master,
          view: "timeline",
          selectedAgent: null,
          error: undefined,
          timeline: [
            ...s.timeline,
            userItem,
            ...(op === "follow_up"
              ? [{ kind: "divider", id: id(), text: "queued · lands after it finishes" } as TimelineItem]
              : []),
          ],
        }));
        try {
          if (op === "steer") await steer(text);
          else if (op === "follow_up") await followUp(text);
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

  const center = () => {
    if (state.view === "learned") return <LearnedView />;
    if (state.view === "preview") return <PreviewView preview={state.preview} />;
    if (selectedChild) {
      return (
        <HelperView
          child={selectedChild}
          index={state.children.indexOf(selectedChild)}
          events={state.helperEvents[selectedChild.id] ?? []}
          onStop={stopHelperById}
          onRemove={removeHelperById}
          onSend={sendToHelper}
        />
      );
    }
    return (
      <div className="view">
        <Timeline items={state.timeline} />
        <Composer
          master={state.master}
          goal={state.goal}
          autonomous={state.autonomous}
          heartbeats={state.heartbeats}
          bridge={state.bridge}
          children={state.children}
          target={state.target}
          delivery={state.delivery}
          error={state.error}
          onTarget={setTarget}
          onDelivery={setDelivery}
          onSend={send}
          onStop={stop}
        />
      </div>
    );
  };

  const timelineTabOn = state.view === "timeline" && !selectedChild;
  return (
    <div className="app">
      <TitleBar
        theme={state.theme}
        bridge={state.bridge}
        master={state.master}
        needsYou={needsYou}
        wsOpen={wsOpen}
        onToggleWs={() => setWsOpen((v) => !v)}
        onToggleTheme={toggleTheme}
      />
      <div className="frame">
        <Rail column={state.column} onColumn={setColumn} onLogo={() => setWsOpen((v) => !v)} />
        {state.column === "agents" ? (
          <AgentsColumn
            master={state.master}
            children={state.children}
            selected={state.selectedAgent}
            onSelect={selectAgent}
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
