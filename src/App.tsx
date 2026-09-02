import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState, ChildInfo, ColumnView, GoalInfo, Theme, TimelineItem } from "./types";
import { TitleBar } from "./components/TitleBar";
import { Rail } from "./components/Rail";
import { AgentsColumn } from "./components/AgentsColumn";
import { FilesColumn } from "./components/FilesColumn";
import { Timeline } from "./components/Timeline";
import { LearnedView } from "./components/LearnedView";
import { Composer } from "./components/Composer";
import { Inspector } from "./components/Inspector";
import { runMasterTurn, clock } from "./runtime/master";
import { openBridge, bridgeCmd, extractText, type BridgeMessage } from "./runtime/bridge";
import type { ChatMessage } from "./runtime/nim";

let nextId = 1;
const id = () => `t${nextId++}`;

export function App() {
  const [state, setState] = useState<AppState>(() => ({
    theme: (document.documentElement.dataset.theme as Theme) ?? "light",
    master: "idle",
    view: "timeline",
    column: "agents",
    bridge: null,
    goal: null,
    children: [],
    timeline: [{ kind: "divider", id: id(), text: `session started · ${clock()}` }],
  }));
  const [wsOpen, setWsOpen] = useState(false);
  const historyRef = useRef<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  // Streaming assistant row fed by daemon message events, keyed by message id when present.
  const daemonMsgRef = useRef<{ itemId: string; key: unknown } | null>(null);
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

    const onEvent = (event: Record<string, unknown>) => {
      const t = event.type as string;
      if (t === "agent_start" || t === "turn_start") {
        setState((s) => ({ ...s, master: "working" }));
      } else if (t === "agent_end") {
        daemonMsgRef.current = null;
        setState((s) => ({
          ...s,
          master: "idle",
          timeline: s.timeline.map((x) => (x.kind === "master" && x.streaming ? { ...x, streaming: false } : x)),
        }));
      } else if (t === "goal_update") {
        setState((s) => ({ ...s, goal: (event.goal as GoalInfo) ?? null }));
      } else if (t === "rlm_child_update") {
        const child = event.child as ChildInfo & { id: string };
        if (!child?.id) return;
        setState((s) => {
          const others = s.children.filter((c) => c.id !== child.id);
          return { ...s, children: [...others, child] };
        });
      } else if (t === "message_start" || t === "message_update" || t === "message_end") {
        const message = event.message as { role?: string; id?: unknown; customType?: string } | undefined;
        if (!message || message.role !== "assistant") return;
        const text = extractText(message);
        const key = message.id ?? "assistant";
        if (!daemonMsgRef.current || daemonMsgRef.current.key !== key) {
          const itemId = id();
          daemonMsgRef.current = { itemId, key };
          push({ kind: "master", id: itemId, text, at: clock(), streaming: true });
        } else {
          const itemId = daemonMsgRef.current.itemId;
          setState((s) => ({
            ...s,
            timeline: s.timeline.map((x) =>
              x.id === itemId && x.kind === "master"
                ? { ...x, text, streaming: t !== "message_end" }
                : x,
            ),
          }));
          if (t === "message_end") daemonMsgRef.current = null;
        }
      } else if (t === "tool_execution_start") {
        push({
          kind: "tool",
          id: `tool-${String(event.toolCallId ?? id())}`,
          name: String(event.toolName ?? "tool"),
          status: "running",
          at: clock(),
        });
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
        push({ kind: "divider", id: id(), text: `context compacted · ${clock()}` });
      }
    };

    const bridge = openBridge((m: BridgeMessage) => {
      if (m.type === "hello") {
        bridgeRef.current = m.daemon.connected;
        setState((s) => ({
          ...s,
          bridge: { connected: m.daemon.connected, error: m.daemon.error ?? null },
        }));
      } else if (m.type === "snapshot") {
        setState((s) => ({
          ...s,
          goal: (m.state.goal as GoalInfo) ?? null,
          children: (m.children as ChildInfo[]) ?? [],
        }));
      } else if (m.type === "event") {
        onEvent(m.event);
      }
    });
    return () => bridge.close();
  }, []);

  const setColumn = useCallback((column: ColumnView) => setState((s) => ({ ...s, column })), []);
  const setView = useCallback((view: AppState["view"]) => setState((s) => ({ ...s, view })), []);

  const stop = useCallback(() => {
    if (bridgeRef.current) {
      bridgeCmd("abort").catch(() => undefined);
    } else {
      abortRef.current?.abort();
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
      const userItem: TimelineItem = { kind: "user", id: id(), text, at: clock() };
      if (bridgeRef.current) {
        setState((s) => ({
          ...s,
          master: "working",
          view: "timeline",
          error: undefined,
          timeline: [...s.timeline, userItem],
        }));
        try {
          await bridgeCmd("prompt", text);
        } catch (e) {
          setState((s) => ({
            ...s,
            master: "idle",
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
        error: undefined,
        timeline: [...s.timeline, userItem, { kind: "master", id: masterId, text: "", at: clock(), streaming: true }],
      }));
      await sendViaNim(text, masterId);
    },
    [sendViaNim],
  );

  return (
    <div className="app">
      <TitleBar
        theme={state.theme}
        bridge={state.bridge}
        wsOpen={wsOpen}
        onToggleWs={() => setWsOpen((v) => !v)}
        onToggleTheme={toggleTheme}
      />
      <div className="frame">
        <Rail column={state.column} onColumn={setColumn} onLogo={() => setWsOpen((v) => !v)} />
        {state.column === "agents" ? (
          <AgentsColumn master={state.master} children={state.children} />
        ) : (
          <FilesColumn />
        )}
        <div className="center">
          <div className="tabs">
            <button className={state.view === "timeline" ? "tab on" : "tab"} onClick={() => setView("timeline")}>
              master · timeline
            </button>
            <button className={state.view === "learned" ? "tab on" : "tab"} onClick={() => setView("learned")}>
              Learned
            </button>
          </div>
          {state.view === "timeline" ? (
            <>
              <Timeline items={state.timeline} />
              <Composer
                master={state.master}
                goal={state.goal}
                bridge={state.bridge}
                error={state.error}
                onSend={send}
                onStop={stop}
              />
            </>
          ) : (
            <LearnedView />
          )}
        </div>
        <Inspector master={state.master} goal={state.goal} bridge={state.bridge} />
      </div>
    </div>
  );
}
