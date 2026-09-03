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
import { t, useT } from "../i18n";
import { MODEL_PICKS, isClaudePick, setModelPick, useModelPick } from "../runtime/providers";
import { fetchModels, setDaemonModel, type DaemonModel } from "../runtime/bridge";

function popupStatus(c: ChildInfo): string {
  if (c.status === "running" || c.status === "queued") return t("running");
  if (c.status === "done") return t(c.repliedSinceTask ? "replied" : "no reply");
  if (c.status === "error") return t("failed");
  return t("stopped");
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
  /** Bumped when a watch_root attach lands — the moment a root's own model
   *  becomes readable. Re-pulls the current pick; the catalog never needed it. */
  rootWatchEpoch?: number;
  /** Long-running mode: master (or the pane's root) is asked to set up one of
   *  the three drivers itself. Helpers have none of their own, so the switch
   *  is hidden when the target is one. */
  longRun: boolean;
  onLongRun: (v: boolean) => void;
  onTarget: (t: ComposerTarget) => void;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [popOpen, setPopOpen] = useState(false);
  const offlinePick = useModelPick();
  // Runtime model (daemon connected): current + switchable catalog. The same
  // picker spot as the offline one — connected it drives the daemon instead.
  const [daemonModels, setDaemonModels] = useState<{
    current: DaemonModel | null;
    models: DaemonModel[];
  } | null>(null);
  const connected = Boolean(props.bridge?.connected);
  const workspace = props.bridge?.workspace;
  // Whose model the picker drives — the agent this composer sends to. Roots
  // are full sessions and carry their own; helpers do not (their model is
  // fixed when master spawns them), so they get no picker at all.
  const modelRoot =
    props.fixedRoot ?? (props.target.kind === "root" ? props.target.name : undefined);
  const noModel = !props.fixedRoot && props.target.kind === "helper";
  /* The catalog no longer waits on anything — it is one list for the daemon.
     Which model the subject is ON is session state, and for a root that only
     becomes knowable once its watch attach lands; rootWatchEpoch is the bridge
     telling us it did, so this re-asks exactly then instead of guessing. */
  useEffect(() => {
    setDaemonModels(null); // never show the previous subject's model under this name
    if (!connected || noModel) return;
    let live = true;
    fetchModels(modelRoot)
      .then((v) => {
        if (live) setDaemonModels(v);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [connected, workspace, modelRoot, noModel, props.rootWatchEpoch]);
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
    const msg = text.trim();
    if (!msg) return;
    if (busy && !canSendBusy) return;
    setText("");
    props.onSend(msg);
  };

  /** One picker spot, two backends: offline it picks the model-only fallback
   *  (claude -p vs NIM); connected it switches the runtime's own model through
   *  the daemon. It sits on the strip above the box; a pane composer omits it
   *  (the model is the runtime's, one setting, shown once). */
  const modelPick = () => {
    if (noModel) return null;
    if (!connected) {
      // The model-only fallback backs master alone — there are no root
      // sessions without the runtime.
      if (modelRoot) return null;
      const label = MODEL_PICKS.find((p) => p.id === offlinePick)?.label ?? offlinePick;
      return (
        <select
          className="mpick"
          value={offlinePick}
          onChange={(e) => setModelPick(e.target.value)}
          aria-label={t("model")}
          title={label}
        >
          {/* Two backends in one list: name the groups so a Claude Code model
              is never mistaken for a cloud one. */}
          <optgroup label="Claude Code">
            {MODEL_PICKS.filter((p) => isClaudePick(p.id)).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="NIM">
            {MODEL_PICKS.filter((p) => !isClaudePick(p.id)).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </optgroup>
        </select>
      );
    }
    if (!daemonModels || daemonModels.models.length === 0) return null;
    const cur = daemonModels.current;
    return (
      <select
        className="mpick"
        value={cur ? `${cur.provider}::${cur.id}` : ""}
        aria-label={t("model")}
        title={cur?.name ?? ""}
        onChange={(e) => {
          const m = daemonModels.models.find((x) => `${x.provider}::${x.id}` === e.target.value);
          if (!m) return;
          setDaemonModels((st) => (st ? { ...st, current: m } : st));
          setDaemonModel(m, modelRoot).catch(() =>
            // Rejected (e.g. mid-run) — re-pull the truth.
            fetchModels(modelRoot).then(setDaemonModels).catch(() => undefined),
          );
        }}
      >
        {/* Not yet knowable (a root before its attach): an empty box beats
            implying the subject sits on whatever happens to sort first. */}
        {!cur && <option value="">—</option>}
        {cur &&
          !daemonModels.models.some((x) => x.provider === cur.provider && x.id === cur.id) && (
            <option value={`${cur.provider}::${cur.id}`}>{cur.name}</option>
          )}
        {daemonModels.models.map((m) => (
          <option key={`${m.provider}::${m.id}`} value={`${m.provider}::${m.id}`}>
            {m.name}
          </option>
        ))}
      </select>
    );
  };

  // The strip above the box: the model pick, then only what is actually
  // happening. The old "<name> idle / running" readout lived here and said
  // nothing the panes do not already show — the picker took its place.
  const strip = () => {
    if (props.error) return <span className="err">{props.error}</span>;
    if (props.viewRoot) {
      // Viewing another root: what it is doing, where known — nothing invented.
      const segs: string[] = [];
      if (props.viewRoot.state === "working" && props.viewRoot.working) {
        segs.push(props.viewRoot.working.toLowerCase());
      }
      if (props.bridge && !props.bridge.connected) segs.push(t("runtime offline · model only"));
      return <>{segs.join(" · ")}</>;
    }
    const masterBusy = props.master === "working";
    const segs: Array<string | JSX.Element> = [];
    if (props.goal?.active) segs.push(t("objective"));
    const auto = props.autonomous;
    if (auto?.enabled) {
      const max = auto.limits?.maxContinuations;
      segs.push(
        typeof max === "number"
          ? t("unattended {used} of {max}", { used: auto.continuationsUsed ?? 0, max })
          : t("unattended on"),
      );
      if (auto.lastGateFailure) segs.push(t("check failed"));
    }
    const next = props.heartbeats
      .filter((h) => h.status === "active" && h.nextRunAt)
      .map((h) => h.nextRunAt as string)
      .sort()[0];
    const nextAt = hhmm(next);
    if (nextAt) segs.push(t("next check-in {at}", { at: nextAt }));
    if (props.bridge && !props.bridge.connected) segs.push(t("runtime offline · model only"));
    const helpersRunning = props.children.some((c) => c.status === "running" || c.status === "queued");
    if (masterBusy && props.working) segs.push(props.working.toLowerCase());
    else if (!masterBusy && helpersRunning) segs.push(t("waiting on helpers"));
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
      <div className="strip">
        {modelPick()}
        <span className="segs" title={props.error}>
          {strip()}
        </span>
      </div>
      <div className="composer">
        <div className="cbox">
          <input
            ref={inputRef}
            value={text}
            placeholder={t("Message {name}…", { name: targetName })}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <div className="crow">
            {!props.fixedRoot && props.target.kind === "helper" ? (
              <div className="dmode">
                <span className="static">{t("delivered now")}</span>
              </div>
            ) : (
              props.bridge?.connected && (
                <button
                  className={props.longRun ? "lrun on" : "lrun"}
                  title={t("{name} sets up an objective, a wake-up schedule or unattended itself, and says which.", {
                    name: targetName,
                  })}
                  onClick={() => props.onLongRun(!props.longRun)}
                >
                  <span className="box">{props.longRun ? "✓" : ""}</span>
                  {t("long-running")}
                </button>
              )
            )}
            {props.fixedRoot ? (
              <span className="to fixed">{t("to {name}", { name: targetName })}</span>
            ) : (
              <span className="to" onClick={() => setPopOpen((v) => !v)}>
                {t("to {name}", { name: targetName })} ▾
              </span>
            )}
            {busy ? (
              <button className="send" onClick={canSendBusy && text.trim() ? submit : props.onStop}>
                {canSendBusy && text.trim() ? t("SEND") : t("STOP")}
              </button>
            ) : (
              <button className="send" onClick={submit}>
                {t("SEND")}
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
              {props.others.length > 0 && <div className="h">{t("other agents")}</div>}
              {props.others.map((a) => (
                <button className="tr" key={a.name} onClick={() => pick({ kind: "root", name: a.name })}>
                  <BotAvatar seed={a.name} sm />
                  {a.name}
                  <span className="st">{t(a.state)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
