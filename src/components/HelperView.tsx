import { useRef, useState } from "react";
import type { ChildInfo, HelperEvent, HelperTranscriptRow } from "../types";
import { helperName, reachable } from "../helperDisplay";
import { BotAvatar } from "./BotAvatar";

function hhmm(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function stateLine(c: ChildInfo): JSX.Element {
  if (c.status === "queued") return <>queued · not yet started</>;
  if (c.status === "running") {
    return (
      <>
        <span className="run">running</span> · {c.repliedSinceTask ? "replied" : "not yet replied"}
      </>
    );
  }
  if (c.status === "done") {
    if (c.repliedSinceTask) return <>finished · replied</>;
    return (
      <>
        finished · <span className="need">no reply yet</span> ·{" "}
        {reachable(c) ? "still reachable" : "ran inline, not reachable"}
      </>
    );
  }
  if (c.status === "error") {
    return (
      <>
        <span className="need">failed</span>
        {c.error ? <> · {c.error}</> : null}
      </>
    );
  }
  return <>stopped</>;
}

function stripLine(c: ChildInfo): string {
  const base = "own cost billed to master";
  if (c.status === "running" || c.status === "queued") return `${base} · running`;
  if (c.status === "done") return reachable(c) ? `${base} · finished` : `${base} · ran inline, not reachable`;
  if (c.status === "error") return `${base} · failed`;
  return `${base} · stopped`;
}

export function HelperView(props: {
  child: ChildInfo;
  events: HelperEvent[];
  /** Thinned rows from the helper's live session (watch_helper feed). */
  transcript: HelperTranscriptRow[];
  /** Helper runtime's own setWorkingMessage copy, while present. */
  working?: string;
  onStop: (childId: string) => void;
  onRemove: (childId: string) => void;
  onSend: (child: ChildInfo, text: string) => void;
}) {
  const c = props.child;
  const name = helperName(c);
  const running = c.status === "running" || c.status === "queued";
  const canMessage = reachable(c);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const t = text.trim();
    if (!t || !canMessage) return;
    setText("");
    props.onSend(c, t);
  };

  return (
    <div className="view">
      <div className="ahead">
        <div className="r1">
          <BotAvatar seed={name} />
          <span className="nm">{name}</span>
          <span className="rel">helper of master</span>
          <span className="act">
            {running ? (
              <button className="btn" onClick={() => props.onStop(c.id)}>
                stop helper
              </button>
            ) : (
              <button className="btn" onClick={() => props.onRemove(c.id)}>
                remove helper
              </button>
            )}
          </span>
        </div>
        <div className="r2">{stateLine(c)}</div>
        {c.label && <div className="r3">Task — “{c.label}”</div>}
      </div>
      <div className="transcript hevents">
        {/* Live transcript from the helper's own session (second attach on the
            daemon socket). Only helpers with an activeSessionId are watchable. */}
        {!reachable(c) ? (
          <div className="div">not reachable — ran inline or removed</div>
        ) : props.transcript.length === 0 ? (
          <div className="div">transcript · nothing yet</div>
        ) : (
          props.transcript.map((row, i) =>
            row.kind === "tool" ? (
              <div className={row.status === "error" ? "ev bad" : "ev"} key={`tr${i}`}>
                <span className="ic" />
                <strong>{row.name === "ipython" ? "python" : row.name}</strong>
                <span className={row.status === "done" ? "rt ok" : "rt"}>{row.status}</span>
              </div>
            ) : row.role === "assistant" ? (
              <div className="msg" key={`tr${i}`}>
                <BotAvatar seed={name} />
                <span className="body">
                  {row.text}
                  {row.at ? <span className="when">{hhmm(row.at)}</span> : null}
                </span>
              </div>
            ) : (
              // user rows are the task/steer text sent into the helper;
              // custom rows are agent messages it received
              <div className="msg user" key={`tr${i}`}>
                <span className="chip ghost">M</span>
                <span className="body">
                  {row.text}
                  {row.at ? <span className="when">{hhmm(row.at)}</span> : null}
                </span>
              </div>
            ),
          )
        )}
        {props.working ? <div className="div">{props.working.toLowerCase()}</div> : null}
        <div className="div">observed</div>
        {props.events.length === 0 ? (
          <div className="div">nothing observed yet</div>
        ) : (
          props.events.map((e) => (
            <div className={e.tone ? `ev ${e.tone}` : "ev"} key={e.id}>
              <span className="ic" />
              <strong>{e.text}</strong>
              <span className="rt">{e.rt}</span>
            </div>
          ))
        )}
      </div>
      <div className="strip">{stripLine(c)}</div>
      <div className="composer">
        <div className="cbox">
          <input
            ref={inputRef}
            value={text}
            placeholder={canMessage ? `Message ${name}…` : `${name} ran inline — not reachable`}
            disabled={!canMessage}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <div className="crow">
            <div className="dmode">
              <span className="static">delivered now</span>
            </div>
            <span className="to">to {name}</span>
            <button className="send" onClick={submit} disabled={!canMessage}>
              SEND
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
