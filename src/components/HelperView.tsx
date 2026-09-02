import { useRef, useState } from "react";
import type { ChildInfo, HelperEvent } from "../types";
import { chipGlyph, chipHue, helperName, reachable } from "../helperDisplay";

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
  index: number;
  events: HelperEvent[];
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
          <span className={`chip ${chipHue(props.index)}`}>{chipGlyph(c)}</span>
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
        <div className="inwrap">
          <input
            ref={inputRef}
            value={text}
            placeholder={canMessage ? `Message ${name}…` : `${name} ran inline — not reachable`}
            disabled={!canMessage}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <span className="to">to {name}</span>
        </div>
        <div className="dmode">
          <span className="static">delivered now</span>
        </div>
        <button className="send" onClick={submit} disabled={!canMessage}>
          SEND
        </button>
      </div>
    </div>
  );
}
