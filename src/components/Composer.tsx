import { useEffect, useRef, useState } from "react";
import type {
  AgentState,
  AutonomousInfo,
  BridgeState,
  ChildInfo,
  ComposerTarget,
  DeliveryMode,
  GoalInfo,
  HeartbeatInfo,
} from "../types";
import { chipGlyph, chipHue, helperName } from "../helperDisplay";

function popupStatus(c: ChildInfo): string {
  if (c.status === "running" || c.status === "queued") return "running";
  if (c.status === "done") return c.repliedSinceTask ? "replied" : "no reply";
  if (c.status === "error") return "failed";
  return "stopped";
}

function hhmm(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function Composer(props: {
  master: AgentState;
  goal: GoalInfo | null;
  autonomous: AutonomousInfo | null;
  heartbeats: HeartbeatInfo[];
  bridge: BridgeState | null;
  children: ChildInfo[];
  target: ComposerTarget;
  delivery: DeliveryMode;
  error?: string;
  onTarget: (t: ComposerTarget) => void;
  onDelivery: (d: DeliveryMode) => void;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const [popOpen, setPopOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = props.master === "working";
  const targetChild =
    props.target.kind === "helper"
      ? props.children.find((c) => c.id === (props.target as { childId: string }).childId)
      : undefined;
  const targetName = targetChild ? helperName(targetChild) : "master";

  // Hand focus back to the input whenever master finishes.
  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  // The NIM fallback has no steer/follow-up; while busy it can only stop.
  const canSendBusy = Boolean(props.bridge?.connected);
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    if (busy && !canSendBusy) return;
    setText("");
    props.onSend(t);
  };

  const strip = () => {
    if (props.error) return <span className="err">{props.error}</span>;
    const segs: Array<string | JSX.Element> = [];
    if (props.goal?.active) segs.push("objective");
    const auto = props.autonomous;
    if (auto?.enabled) {
      const max = auto.limits?.maxContinuations;
      segs.push(
        typeof max === "number"
          ? `unattended ${auto.continuationsUsed ?? 0} of ${max}`
          : "unattended on",
      );
      if (auto.lastGateFailure) segs.push("check failed");
    }
    const next = props.heartbeats
      .filter((h) => h.status === "active" && h.nextRunAt)
      .map((h) => h.nextRunAt as string)
      .sort()[0];
    const nextAt = hhmm(next);
    if (nextAt) segs.push(`next check-in ${nextAt}`);
    if (props.bridge && !props.bridge.connected) segs.push("runtime offline · model only");
    if (segs.length === 0) segs.push(busy ? "master running" : "master idle");
    return (
      <>
        {segs.map((s, i) => (
          <span key={i}>
            {i > 0 && " · "}
            {s}
          </span>
        ))}
      </>
    );
  };

  const pick = (t: ComposerTarget) => {
    props.onTarget(t);
    setPopOpen(false);
    inputRef.current?.focus();
  };

  return (
    <>
      <div className="strip">{strip()}</div>
      <div className="composer">
        <div className="inwrap">
          <input
            ref={inputRef}
            value={text}
            placeholder={`Message ${targetName}…`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <span className="to" onClick={() => setPopOpen((v) => !v)}>
            to {targetName} ▾
          </span>
        </div>
        {props.target.kind === "master" ? (
          <div className="dmode">
            <span className={props.delivery === "now" ? "on" : ""} onClick={() => props.onDelivery("now")}>
              now
            </span>
            <span
              className={props.delivery === "after" ? "on" : ""}
              onClick={() => props.onDelivery("after")}
            >
              after it finishes
            </span>
          </div>
        ) : (
          <div className="dmode">
            <span className="static">delivered now</span>
          </div>
        )}
        {busy ? (
          <button className="send" onClick={canSendBusy && text.trim() ? submit : props.onStop}>
            {canSendBusy && text.trim() ? "SEND" : "STOP"}
          </button>
        ) : (
          <button className="send" onClick={submit}>
            SEND
          </button>
        )}
        {popOpen && (
          <div className="topop">
            <button className="tr" onClick={() => pick({ kind: "master" })}>
              <span className="chip master sm" />
              master
            </button>
            {props.children.map((c, i) => (
              <button className="tr" key={c.id} onClick={() => pick({ kind: "helper", childId: c.id })}>
                <span className={`chip ${chipHue(i)} sm`}>{chipGlyph(c)}</span>
                {helperName(c)}
                <span className="st">{popupStatus(c)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
