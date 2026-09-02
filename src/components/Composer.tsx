import { useEffect, useRef, useState } from "react";
import type { AgentState, BridgeState, GoalInfo } from "../types";

export function Composer(props: {
  master: AgentState;
  goal: GoalInfo | null;
  bridge: BridgeState | null;
  error?: string;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = props.master === "working";

  // Hand focus back to the input whenever master finishes.
  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    props.onSend(t);
  };

  const strip = () => {
    if (props.error) return <span className="err">{props.error}</span>;
    const parts: string[] = [];
    parts.push(props.goal?.active ? "objective" : "no objective");
    parts.push(busy ? "master working" : "master idle");
    if (props.bridge && !props.bridge.connected) parts.push("runtime offline · model only");
    return <>{parts.join(" · ")}</>;
  };

  return (
    <>
      <div className="strip">{strip()}</div>
      <div className="composer">
        <div className="inwrap">
          <input
            ref={inputRef}
            value={text}
            placeholder="Message master…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <span className="to">to master</span>
        </div>
        {busy ? (
          <button className="send" onClick={props.onStop}>
            STOP
          </button>
        ) : (
          <button className="send" onClick={submit}>
            SEND
          </button>
        )}
      </div>
    </>
  );
}
