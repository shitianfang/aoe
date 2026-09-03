import { useEffect, useRef, useState } from "react";
import type {
  AgentState,
  AutonomousInfo,
  BridgeState,
  ChildInfo,
  ComposerTarget,
  GoalInfo,
  HeartbeatInfo,
  RootAgent,
} from "../types";
import { helperName } from "../helperDisplay";
import { BotAvatar } from "./BotAvatar";

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
  /** Run state of the current composer target (a root target has its own). */
  targetState: AgentState;
  goal: GoalInfo | null;
  autonomous: AutonomousInfo | null;
  heartbeats: HeartbeatInfo[];
  bridge: BridgeState | null;
  children: ChildInfo[];
  /** Other root sessions — third group in the to ▾ popup. */
  others: RootAgent[];
  target: ComposerTarget;
  working?: string;
  error?: string;
  /** Set when the center shows another root's timeline; the strip then
   *  reflects that root's state (where known), not master's. */
  viewRoot?: { name: string; state: AgentState; working?: string };
  /** Pane-bound mode: this composer lives in a root's pane and always messages
   *  that root — the to ▾ popup is hidden, the label is fixed. */
  fixedRoot?: string;
  onTarget: (t: ComposerTarget) => void;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const [popOpen, setPopOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Busy-ness of whatever the message goes to — steer vs prompt, SEND vs STOP.
  const busy = props.targetState === "working";
  const targetChild =
    props.target.kind === "helper"
      ? props.children.find((c) => c.id === (props.target as { childId: string }).childId)
      : undefined;
  const targetName =
    props.fixedRoot ??
    (props.target.kind === "root"
      ? props.target.name
      : targetChild
        ? helperName(targetChild)
        : "master");

  // Hand focus back to the input whenever the target finishes.
  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  // The NIM fallback has no steer; while busy it can only stop.
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
    if (props.viewRoot) {
      // Viewing another root: its state where known, nothing invented.
      const segs: string[] = [
        `${props.viewRoot.name} ${props.viewRoot.state === "working" ? "running" : "idle"}`,
      ];
      if (props.viewRoot.state === "working" && props.viewRoot.working) {
        segs.push(props.viewRoot.working.toLowerCase());
      }
      if (props.bridge && !props.bridge.connected) segs.push("runtime offline · model only");
      return <>{segs.join(" · ")}</>;
    }
    const masterBusy = props.master === "working";
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
    const helpersRunning = props.children.some((c) => c.status === "running" || c.status === "queued");
    if (masterBusy && props.working) segs.push(props.working.toLowerCase());
    else if (!masterBusy && helpersRunning) segs.push("waiting on helpers");
    if (segs.length === 0) segs.push(masterBusy ? "master running" : "master idle");
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
        <div className="cbox">
          <input
            ref={inputRef}
            value={text}
            placeholder={`Message ${targetName}…`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <div className="crow">
            {!props.fixedRoot && props.target.kind === "helper" && (
              <div className="dmode">
                <span className="static">delivered now</span>
              </div>
            )}
            {props.fixedRoot ? (
              <span className="to fixed">to {targetName}</span>
            ) : (
              <span className="to" onClick={() => setPopOpen((v) => !v)}>
                to {targetName} ▾
              </span>
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
          </div>
          {popOpen && !props.fixedRoot && (
            <div className="topop">
              <button className="tr" onClick={() => pick({ kind: "master" })}>
                <span className="chip master sm" />
                master
              </button>
              {props.children.map((c) => (
                <button className="tr sub" key={c.id} onClick={() => pick({ kind: "helper", childId: c.id })}>
                  <BotAvatar seed={helperName(c)} sm />
                  {helperName(c)}
                  <span className="st">{popupStatus(c)}</span>
                </button>
              ))}
              {props.others.length > 0 && <div className="h">other agents</div>}
              {props.others.map((a) => (
                <button className="tr" key={a.name} onClick={() => pick({ kind: "root", name: a.name })}>
                  <BotAvatar seed={a.name} sm />
                  {a.name}
                  <span className="st">{a.state}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
