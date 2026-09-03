import { Fragment, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { LessonResult, TimelineItem } from "../types";
import { LessonCard } from "./LessonCard";
import { BotAvatar } from "./BotAvatar";
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

/** First-open example asks (master timeline only). English keys, ZH in the
 *  dictionary; each sends as-is on click and the block leaves for good once
 *  any real conversation exists. */
const EXAMPLES = [
  "Put together a small team: one helper researches this workspace, another drafts a summary, then report back to me.",
  "Tidy the files in this workspace into folders by topic, and tell me what moved.",
  "Check in with me every morning at 9 with a one-line plan for the day.",
];

export function Timeline(props: {
  items: TimelineItem[];
  onExample?: (text: string) => void;
  /** Set in a root pane: assistant rows get this root's avatar, not master's chip. */
  botSeed?: string;
}) {
  const t = useT();
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
        <div className={`ev${item.status === "error" ? " bad" : ""}`} key={item.id}>
          <span className="ic" />
          <strong>{item.name}</strong>
          <span className={item.status === "done" ? "rt ok" : "rt"}>
            {item.status === "running" ? t("running…") : `${t(item.status)} · ${item.at}`}
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
    if (item.kind === "agent") {
      // Another agent talked into this conversation — its avatar, its words,
      // the sender named in small type above the text.
      return (
        <div className="msg" key={item.id}>
          <BotAvatar seed={item.from} />
          <span className="body">
            <span className="afrom">{item.from}</span>
            {item.text}
          </span>
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
        <span className="body">
          {item.text}
          {item.streaming ? <span className="cursor" /> : null}
        </span>
        <span className="when">{item.streaming ? "" : item.at}</span>
      </div>
    );
  };

  // Fresh timeline = dividers only. Real rows of any kind retire the examples.
  const fresh =
    props.onExample !== undefined &&
    props.items.every((i) => i.kind === "divider" || i.kind === "collapsed");

  return (
    <div className="transcript" ref={ref}>
      {props.items.map(row)}
      {fresh && (
        <div className="firstrun">
          <div className="frh">{t("first time here — try one:")}</div>
          {EXAMPLES.map((x) => (
            <button key={x} className="frx" onClick={() => props.onExample?.(t(x))}>
              {t(x)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
