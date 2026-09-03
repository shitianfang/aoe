import { useEffect, useRef, useState } from "react";
import type { LessonResult, TimelineItem } from "../types";
import { LessonCard } from "./LessonCard";

/** "lesson kept · summary · [view]" — view expands the full card inline. */
function LessonRow(props: { result: LessonResult; at: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lwrap">
      <div className="ev good">
        <span className="ic" />
        <strong>lesson kept · {props.result.summary ?? props.result.id}</strong>
        <span className="rt">
          <a className="lk" onClick={() => setOpen((v) => !v)}>
            {open ? "hide" : "view"}
          </a>
          {` · ${props.at}`}
        </span>
      </div>
      {open ? <LessonCard result={props.result} at={props.at} /> : null}
    </div>
  );
}

export function Timeline(props: { items: TimelineItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the newest activity in view while master streams.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [props.items]);

  return (
    <div className="transcript" ref={ref}>
      {props.items.map((item) => {
        if (item.kind === "divider") {
          return (
            <div className="div" key={item.id}>
              {item.text}
            </div>
          );
        }
        if (item.kind === "tool") {
          return (
            <div className={`ev${item.status === "error" ? " bad" : ""}`} key={item.id}>
              <span className="ic" />
              <strong>{item.name}</strong>
              <span className={item.status === "done" ? "rt ok" : "rt"}>
                {item.status === "running" ? "running…" : `${item.status} · ${item.at}`}
              </span>
            </div>
          );
        }
        if (item.kind === "lesson") {
          return <LessonRow key={item.id} result={item.result} at={item.at} />;
        }
        if (item.kind === "user") {
          return (
            <div className="msg user" key={item.id}>
              <span className="chip ghost">Y</span>
              <span className="body">
                {item.text}
                <span className="when">{item.at}</span>
              </span>
            </div>
          );
        }
        return (
          <div className="msg" key={item.id}>
            <span className="chip master" />
            <span className="body">
              {item.text}
              {item.streaming ? <span className="cursor" /> : <span className="when">{item.at}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
