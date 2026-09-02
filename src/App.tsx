import { useCallback, useRef, useState } from "react";
import type { AppState, ColumnView, Theme, TimelineItem } from "./types";
import { TitleBar } from "./components/TitleBar";
import { Rail } from "./components/Rail";
import { AgentsColumn } from "./components/AgentsColumn";
import { FilesColumn } from "./components/FilesColumn";
import { Timeline } from "./components/Timeline";
import { LearnedView } from "./components/LearnedView";
import { Composer } from "./components/Composer";
import { Inspector } from "./components/Inspector";
import { runMasterTurn, clock } from "./runtime/master";
import type { ChatMessage } from "./runtime/nim";

let nextId = 1;
const id = () => `t${nextId++}`;

export function App() {
  const [state, setState] = useState<AppState>(() => ({
    theme: (document.documentElement.dataset.theme as Theme) ?? "light",
    master: "idle",
    view: "timeline",
    column: "agents",
    timeline: [{ kind: "divider", id: id(), text: `session started · ${clock()}` }],
  }));
  const [wsOpen, setWsOpen] = useState(false);
  const historyRef = useRef<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);

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

  const setColumn = useCallback((column: ColumnView) => {
    setState((s) => ({ ...s, column }));
  }, []);

  const setView = useCallback((view: AppState["view"]) => {
    setState((s) => ({ ...s, view }));
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(async (text: string) => {
    const userItem: TimelineItem = { kind: "user", id: id(), text, at: clock() };
    const masterId = id();
    historyRef.current.push({ role: "user", content: text });
    const abort = new AbortController();
    abortRef.current = abort;
    setState((s) => ({
      ...s,
      master: "working",
      view: "timeline",
      error: undefined,
      timeline: [
        ...s.timeline,
        userItem,
        { kind: "master", id: masterId, text: "", at: clock(), streaming: true },
      ],
    }));
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
          if (t.text === "") return null; // nothing arrived — drop the empty row
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

  return (
    <div className="app">
      <TitleBar
        theme={state.theme}
        wsOpen={wsOpen}
        onToggleWs={() => setWsOpen((v) => !v)}
        onToggleTheme={toggleTheme}
      />
      <div className="frame">
        <Rail column={state.column} onColumn={setColumn} onLogo={() => setWsOpen((v) => !v)} />
        {state.column === "agents" ? <AgentsColumn master={state.master} /> : <FilesColumn />}
        <div className="center">
          <div className="tabs">
            <button
              className={state.view === "timeline" ? "tab on" : "tab"}
              onClick={() => setView("timeline")}
            >
              master · timeline
            </button>
            <button
              className={state.view === "learned" ? "tab on" : "tab"}
              onClick={() => setView("learned")}
            >
              Learned
            </button>
          </div>
          {state.view === "timeline" ? (
            <>
              <Timeline items={state.timeline} />
              <Composer master={state.master} error={state.error} onSend={send} onStop={stop} />
            </>
          ) : (
            <LearnedView />
          )}
        </div>
        <Inspector master={state.master} />
      </div>
    </div>
  );
}
