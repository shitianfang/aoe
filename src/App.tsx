import { useCallback, useRef, useState } from "react";
import type { AppState, Theme, TimelineItem } from "./types";
import { TitleBar } from "./components/TitleBar";
import { Rail } from "./components/Rail";
import { AgentsColumn } from "./components/AgentsColumn";
import { Timeline } from "./components/Timeline";
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
    timeline: [{ kind: "divider", id: id(), text: `session started · ${clock()}` }],
  }));
  const historyRef = useRef<ChatMessage[]>([]);

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

  const send = useCallback(async (text: string) => {
    const userItem: TimelineItem = { kind: "user", id: id(), text, at: clock() };
    const masterId = id();
    historyRef.current.push({ role: "user", content: text });
    setState((s) => ({
      ...s,
      master: "working",
      error: undefined,
      timeline: [
        ...s.timeline,
        userItem,
        { kind: "master", id: masterId, text: "", at: clock(), streaming: true },
      ],
    }));
    try {
      const reply = await runMasterTurn(historyRef.current, (delta) => {
        setState((s) => ({
          ...s,
          timeline: s.timeline.map((t) =>
            t.id === masterId && t.kind === "master" ? { ...t, text: t.text + delta } : t,
          ),
        }));
      });
      historyRef.current.push({ role: "assistant", content: reply });
      setState((s) => ({
        ...s,
        master: "idle",
        timeline: s.timeline.map((t) =>
          t.id === masterId && t.kind === "master" ? { ...t, streaming: false } : t,
        ),
      }));
    } catch (e) {
      setState((s) => ({
        ...s,
        master: "idle",
        error: e instanceof Error ? e.message : "model request failed",
        timeline: s.timeline.filter((t) => !(t.id === masterId && t.kind === "master" && t.text === "")),
      }));
    }
  }, []);

  return (
    <div className="app">
      <TitleBar theme={state.theme} onToggleTheme={toggleTheme} />
      <div className="frame">
        <Rail />
        <AgentsColumn master={state.master} />
        <div className="center">
          <div className="tabs">
            <div className="tab on">master · timeline</div>
          </div>
          <Timeline items={state.timeline} />
          <Composer master={state.master} error={state.error} onSend={send} />
        </div>
        <Inspector master={state.master} />
      </div>
    </div>
  );
}
