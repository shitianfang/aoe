import { Fragment, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
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
  // Expanded collapsed-history blocks, by item id. Local state: folding is a
  // view concern and re-collapsing on data changes would be hostile.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Keep the newest activity in view while master streams.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [props.items]);

  const row = (item: TimelineItem): ReactNode => {
    if (item.kind === "collapsed") {
      if (expanded[item.id]) {
        return <Fragment key={item.id}>{item.items.map(row)}</Fragment>;
      }
      return (
        <div
          className="div click"
          key={item.id}
          onClick={() => setExpanded((e) => ({ ...e, [item.id]: true }))}
        >
          {item.count} earlier turns · show
        </div>
      );
    }
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
    if (item.kind === "note") {
      return (
        <div className={`ev${item.tone === "bad" ? " bad" : ""}`} key={item.id}>
          <span className="ic" />
          <strong>{item.text}</strong>
          {item.rt ? <span className="rt">{item.rt}</span> : <span className="rt" />}
        </div>
      );
    }
    if (item.kind === "user") {
      return (
        <div className="msg user" key={item.id}>
          <span className="chip you">Y</span>
          <span className="body">{item.text}</span>
          <span className="when">{item.at}</span>
        </div>
      );
    }
    return (
      <div className="msg" key={item.id}>
        <span className="chip master" />
        <span className="body">
          {item.text}
          {item.streaming ? <span className="cursor" /> : null}
        </span>
        <span className="when">{item.streaming ? "" : item.at}</span>
      </div>
    );
  };

  return (
    <div className="transcript" ref={ref}>
      {props.items.map(row)}
    </div>
  );
}
