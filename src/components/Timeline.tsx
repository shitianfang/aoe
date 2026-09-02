import { useEffect, useRef } from "react";
import type { TimelineItem } from "../types";

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
