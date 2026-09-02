import { useState } from "react";
import type { AgentState } from "../types";

export function Composer(props: {
  master: AgentState;
  error?: string;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const busy = props.master === "working";

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    props.onSend(t);
  };

  return (
    <>
      <div className="strip">
        {props.error ? (
          <span className="err">{props.error}</span>
        ) : busy ? (
          <>
            master <b>working</b>
          </>
        ) : (
          <>master idle · no objective</>
        )}
      </div>
      <div className="composer">
        <div className="inwrap">
          <input
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
