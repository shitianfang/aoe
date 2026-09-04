import { Fragment, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { LessonResult, TimelineItem } from "../types";
import { LessonCard } from "./LessonCard";
import { FirstRun } from "./FirstRun";
import { BotAvatar } from "./BotAvatar";
import { ToolText } from "./ToolText";
import { Markdown } from "../markdown";
import { useT } from "../i18n";

/** "lesson kept · summary · [view]" — view expands the full card inline. */
function LessonRow(props: { result: LessonResult; at: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="lwrap">
      <div className="ev good">
        <span className="ic" />
        <strong>{t("lesson kept · {summary}", { summary: props.result.summary ?? props.result.id })}</strong>
        <span className="rt">
          <a className="lk" onClick={() => setOpen((v) => !v)}>
            {open ? t("hide") : t("view")}
          </a>
          {` · ${props.at}`}
        </span>
      </div>
      {open ? <LessonCard result={props.result} at={props.at} /> : null}
    </div>
  );
}

/** The end of the reasoning, on one collapsed line. Enough to overfill the
 *  two-line window it is read through at any pane width — the window keeps its
 *  bottom edge, so what is on screen is always the newest sentence. Paragraph
 *  breaks go with it: this is a ticker, not a document. */
function tailOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 600 ? flat.slice(-600) : flat;
}

/** What it is doing while it has no words yet: a breathing diamond in the same
 *  square language a running step speaks, the label, and the reasoning as it
 *  streams. Replaced by the answer the moment the first word of it arrives —
 *  this is scaffolding, never history. */
function Thinking(props: { text?: string; note?: string; tail?: boolean }) {
  const t = useT();
  const words = props.text ? tailOf(props.text) : (props.note ?? "");
  return (
    <div className={`think${props.tail ? " tail" : ""}`}>
      <span className="ic" />
      <span className="tw">{t("thinking")}</span>
      {words ? (
        <span className="tx">
          <span>{words}</span>
        </span>
      ) : null}
    </div>
  );
}

export function Timeline(props: {
  items: TimelineItem[];
  /** Master timeline only. `opts` lets a showcase card ask for the send it
   *  needs — long-running mode is a real switch, not a hidden preamble. */
  onExample?: (text: string, opts?: { longRun?: boolean }) => void;
  /** Set in a root pane: assistant rows get this root's avatar, not master's chip. */
  botSeed?: string;
  /** The agent this timeline belongs to is mid-turn. Present = a breathing tail
   *  row, but only when nothing already on the transcript is live; `note` is
   *  the runtime's own working message when it sent one. */
  live?: { note?: string };
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  // Expanded collapsed-history blocks, by item id. Local state: folding is a
  // view concern and re-collapsing on data changes would be hostile.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Keep the newest activity in view while master streams. The live tail row
  // is part of "newest" — but as a primitive, not the object it is passed as,
  // or every render of the app would yank the transcript back down.
  const liveKey = props.live ? (props.live.note ?? "") : null;
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [props.items, liveKey]);

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
          {t("{count} earlier turns · show", { count: item.count })}
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
        // Same step row as a helper's pane: state in the diamond, no repeated
        // status word. The time stays — master's timeline spans a whole
        // session, and when a step ran is the thing you scan it for.
        <div
          className={`ev step${item.status === "running" ? " run" : item.status === "error" ? " bad" : ""}`}
          key={item.id}
        >
          <span className="ic" />
          <strong>
            <ToolText text={item.name} />
          </strong>
          {item.status !== "running" && <span className="rt">{item.at}</span>}
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
    if (item.kind === "agent") {
      // Another agent talked into this conversation — its avatar, its words,
      // the sender named in small type above the text.
      return (
        <div className="msg" key={item.id}>
          <BotAvatar seed={item.from} />
          <div className="body">
            <span className="afrom">{item.from}</span>
            <Markdown text={item.text} />
          </div>
          <span className="when">{item.at}</span>
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
        {props.botSeed ? <BotAvatar seed={props.botSeed} /> : <span className="chip master" />}
        <div className="body">
          {item.streaming && item.text === "" ? (
            <Thinking text={item.thinking} />
          ) : (
            <Markdown text={item.text} trailing={item.streaming ? <span className="cursor" /> : undefined} />
          )}
        </div>
        <span className="when">{item.streaming ? "" : item.at}</span>
      </div>
    );
  };

  // Fresh timeline = dividers only. Real rows of any kind retire the examples.
  const fresh =
    props.onExample !== undefined &&
    props.items.every((i) => i.kind === "divider" || i.kind === "collapsed");

  // Between the send and the first event of the turn — and again in the gap
  // between a tool finishing and the next thing starting — the transcript has
  // nothing moving on it, and a run that takes a minute is indistinguishable
  // from one that died. One breathing line at the tail answers that, and only
  // then: a streaming row and a running tool are already breathing on their
  // own, and two pulses saying the same thing is noise.
  const tailLive =
    props.live !== undefined &&
    !props.items.some(
      (i) => (i.kind === "master" && i.streaming) || (i.kind === "tool" && i.status === "running"),
    );

  return (
    <div className="transcript" ref={ref}>
      {props.items.map(row)}
      {tailLive ? <Thinking note={props.live?.note} tail /> : null}
      {fresh && props.onExample ? <FirstRun onExample={props.onExample} /> : null}
    </div>
  );
}
