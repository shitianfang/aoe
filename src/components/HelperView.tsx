import { useRef, useState } from "react";
import type { ChildInfo, HelperEvent, HelperTranscriptRow } from "../types";
import { helperName, hhmmEpoch, reachable } from "../helperDisplay";
import { BotAvatar } from "./BotAvatar";
import { t, useT } from "../i18n";

function hhmm(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function stateLine(c: ChildInfo): JSX.Element {
  // Real terminal timestamp (schema 27); absent on older daemons or on
  // helpers rehydrated after a restart — then the word stands alone.
  const done = typeof c.completedAt === "number" ? ` ${hhmmEpoch(c.completedAt)}` : "";
  if (c.status === "queued") return <>{t("queued · not yet started")}</>;
  if (c.foreign) {
    // Another root's crew member: roster words, no reply bookkeeping of ours.
    if (c.status === "running") return <span className="run">{t("running")}</span>;
    if (c.status === "error") return <span className="need">{t("failed")}</span>;
    return <>{t(c.status === "inactive" ? "inactive" : "idle")}</>;
  }
  if (c.status === "running") {
    return (
      <>
        <span className="run">{t("running")}</span> ·{" "}
        {t(c.repliedSinceTask ? "replied" : "not yet replied")}
      </>
    );
  }
  if (c.status === "done") {
    if (c.repliedSinceTask) return <>{t("finished{done}", { done })} · {t("replied")}</>;
    if (!reachable(c)) {
      // Ran inline and is gone — its answer went to master, nothing waits on
      // the user, so no red flag here.
      return (
        <>
          {t("finished{done}", { done })} ·{" "}
          {t(c.answerPreview ? "answered master · ran inline" : "ran inline, not reachable")}
        </>
      );
    }
    return (
      <>
        {t("finished{done}", { done })} · <span className="need">{t("no reply yet")}</span> ·{" "}
        {t("still reachable")}
      </>
    );
  }
  if (c.status === "error") {
    return (
      <>
        <span className="need">{t("failed{done}", { done })}</span>
        {c.error ? <> · {c.error}</> : null}
      </>
    );
  }
  return <>{t("stopped{done}", { done })}</>;
}

function stripLine(c: ChildInfo): string {
  if (c.foreign) return t("on {name}'s team", { name: c.parentName ?? "?" });
  const base = t("own cost billed to master");
  if (c.status === "running" || c.status === "queued") return `${base} · ${t("running")}`;
  if (c.status === "done")
    return `${base} · ${t(reachable(c) ? "finished" : "ran inline, not reachable")}`;
  if (c.status === "error") return `${base} · ${t("failed")}`;
  return `${base} · ${t("stopped")}`;
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
  const t = useT();
  const c = props.child;
  const name = helperName(c);
  const running = c.status === "running" || c.status === "queued";
  const canMessage = reachable(c);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const msg = text.trim();
    if (!msg || !canMessage) return;
    setText("");
    props.onSend(c, msg);
  };

  return (
    <div className="view">
      <div className="ahead">
        <div className="r1">
          <BotAvatar seed={name} />
          <span className="nm">{name}</span>
          <span className="rel">{t("helper")} · {stateLine(c)}</span>
          {/* Stop/remove act on master's own family; a foreign crew member
              is its root's to manage — no buttons here. */}
          {!c.foreign && (
            <span className="act">
              {running ? (
                <button className="btn" onClick={() => props.onStop(c.id)}>
                  {t("stop helper")}
                </button>
              ) : (
                <button className="btn" onClick={() => props.onRemove(c.id)}>
                  {t("remove helper")}
                </button>
              )}
            </span>
          )}
        </div>
        {/* Unreachable helpers show the task as a message row in the record
            below — no duplicate header line. */}
        {c.label && reachable(c) && (
          <div className="r3">{t("Task — “{label}”", { label: c.label })}</div>
        )}
      </div>
      <div className="transcript hevents">
        {/* Live transcript from the helper's own session (second attach on the
            daemon socket). Only helpers with an activeSessionId are watchable. */}
        {!reachable(c) ? (
          // The live session is gone, but the exchange itself is known: the
          // task master sent in, and (when the daemon kept it) the answer.
          <>
            {c.label ? (
              <div className="msg user">
                <span className="chip ghost">M</span>
                <span className="body">
                  <span className="afrom">master</span>
                  {c.label}
                </span>
              </div>
            ) : (
              <div className="div">{t("not reachable — ran inline or removed")}</div>
            )}
            {c.answerPreview ? (
              <div className="msg">
                <BotAvatar seed={name} />
                <span className="body">
                  <span className="afrom">{name}</span>
                  {c.answerPreview}
                </span>
              </div>
            ) : null}
          </>
        ) : props.transcript.length === 0 ? (
          <div className="div">{t("transcript · nothing yet")}</div>
        ) : (
          props.transcript.map((row, i) =>
            row.kind === "tool" ? (
              <div className={row.status === "error" ? "ev bad" : "ev"} key={`tr${i}`}>
                <span className="ic" />
                <strong>{row.name === "ipython" ? "python" : row.name}</strong>
                <span className={row.status === "done" ? "rt ok" : "rt"}>{t(row.status)}</span>
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
        {/* The observed feed earns its header only when something was observed. */}
        {props.events.length > 0 && (
          <>
            <div className="div">{t("observed")}</div>
            {props.events.map((e) => (
              <div className={e.tone ? `ev ${e.tone}` : "ev"} key={e.id}>
                <span className="ic" />
                <strong>{e.text}</strong>
                <span className="rt">{e.rt}</span>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="strip">{stripLine(c)}</div>
      <div className="composer">
        <div className="cbox">
          <input
            ref={inputRef}
            value={text}
            placeholder={
              canMessage
                ? t("Message {name}…", { name })
                : t("{name} ran inline — not reachable", { name })
            }
            disabled={!canMessage}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <div className="crow">
            <div className="dmode">
              <span className="static">{t("delivered now")}</span>
            </div>
            <span className="to">{t("to {name}", { name })}</span>
            <button className="send" onClick={submit} disabled={!canMessage}>
              {t("SEND")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
