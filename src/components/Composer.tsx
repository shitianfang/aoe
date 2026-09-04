import { Fragment, useEffect, useRef, useState } from "react";
import type {
  AgentState,
  AutonomousInfo,
  BridgeState,
  ChildInfo,
  ComposerTarget,
  HeartbeatInfo,
  RootAgent,
} from "../types";
import { helperName } from "../helperDisplay";
import { BotAvatar } from "./BotAvatar";
import { t, useT } from "../i18n";
import {
  GATEWAY_MODELS,
  MODEL_PICKS,
  isGatewayPick,
  setModelPick,
  useModelPick,
} from "../runtime/providers";
import {
  fetchGatewayUsage,
  fetchModels,
  fetchNimUsage,
  setDaemonModel,
  type DaemonModel,
  type GatewayUsage,
  type NimUsage,
} from "../runtime/bridge";

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
  // The model list. It is a popover rather than a <select> because the
  // composer sits at the bottom of the window: a native select's own popup
  // drops downward over the message box, and on a short window it has nowhere
  // to go at all. This one opens upward, into the transcript.
  const [mpopOpen, setMpopOpen] = useState(false);
  const mpickRef = useRef<HTMLSpanElement>(null);
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

  // NIM's minute budget. NVIDIA returns no rate-limit header and has no usage
  // endpoint, so the bridge counts what it proxies and this polls that count —
  // there is nothing to subscribe to. Only the composer that shows a picker
  // asks (a pane composer would just duplicate master's number).
  const [nim, setNim] = useState<NimUsage | null>(null);
  const showsPicker = !noModel && !(!connected && modelRoot);
  useEffect(() => {
    if (!showsPicker) return;
    let live = true;
    const tick = () =>
      fetchNimUsage()
        .then((u) => live && setNim(u))
        // Bridge down or too old to answer: show nothing rather than a stale
        // number, which would read as "you have budget left" at the worst time.
        .catch(() => live && setNim(null));
    tick();
    const h = window.setInterval(tick, 5000);
    return () => {
      live = false;
      window.clearInterval(h);
    };
  }, [showsPicker]);

  // What is left on the gateway key. Vercel does report the account, so this
  // is Vercel's own number rather than one we keep; the bridge caches it, and
  // only the composer sitting on a gateway model asks at all.
  const [gw, setGw] = useState<GatewayUsage | null>(null);
  const onGateway = !connected && isGatewayPick(offlinePick);
  useEffect(() => {
    if (!showsPicker || !onGateway) return;
    let live = true;
    const tick = () =>
      fetchGatewayUsage()
        .then((u) => live && setGw(u))
        // Bridge down or too old to answer: say nothing rather than a stale
        // balance, which is the number you least want to be wrong about.
        .catch(() => live && setGw(null));
    tick();
    const h = window.setInterval(tick, 30_000);
    return () => {
      live = false;
      window.clearInterval(h);
    };
  }, [showsPicker, onGateway]);

  // A popover that stays open after you click away is a stuck menu; the model
  // list closes on an outside click and on Escape, like any other.
  useEffect(() => {
    if (!mpopOpen) return;
    const away = (e: MouseEvent) => {
      if (!mpickRef.current?.contains(e.target as Node)) setMpopOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMpopOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [mpopOpen]);

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

  /** One row of the model list. */
  type PickRow = { key: string; label: string; on: boolean; pick: () => void };

  /** The picker: a label that opens a grouped list upward. One spot, two
   *  backends — offline it picks the model-only fallback (the gateway or NIM);
   *  connected it switches the runtime's own model through the daemon. It sits
   *  on the strip above the box; a pane composer omits it (the model is the
   *  runtime's, one setting, shown once). */
  const modelPop = (
    label: string,
    groups: Array<{ name: string; rows: PickRow[] }>,
    disabled?: boolean,
  ) => (
    <span className="mpickw" ref={mpickRef}>
      <button
        className="mpick"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={mpopOpen}
        aria-label={t("model")}
        title={label}
        onClick={() => setMpopOpen((v) => !v)}
      >
        <span className="nm">{label}</span>
        {/* Pointing at where the list will appear, which is up. */}
        <span className="car">▴</span>
      </button>
      {mpopOpen && !disabled && (
        <div className="topop mpop" role="listbox">
          {groups
            .filter((g) => g.rows.length > 0)
            .map((g) => (
              <Fragment key={g.name}>
                <div className="h">{g.name}</div>
                {g.rows.map((r) => (
                  <button
                    className={r.on ? "tr on" : "tr"}
                    role="option"
                    aria-selected={r.on}
                    key={r.key}
                    onClick={() => {
                      r.pick();
                      setMpopOpen(false);
                    }}
                  >
                    {r.label}
                  </button>
                ))}
              </Fragment>
            ))}
        </div>
      )}
    </span>
  );

  const modelPick = () => {
    if (noModel) return null;
    if (!connected) {
      // The model-only fallback backs master alone — there are no root
      // sessions without the runtime.
      if (modelRoot) return null;
      const label = MODEL_PICKS.find((p) => p.id === offlinePick)?.label ?? offlinePick;
      const rows = (picks: ReadonlyArray<{ id: string; label: string }>): PickRow[] =>
        picks.map((p) => ({
          key: p.id,
          label: p.label,
          on: p.id === offlinePick,
          pick: () => setModelPick(p.id),
        }));
      // Two backends in one list, named: Kimi K3 appears under both, and which
      // key is paying for it is the whole difference.
      return modelPop(label, [
        { name: "AI Gateway", rows: rows(GATEWAY_MODELS) },
        { name: "NIM", rows: rows(MODEL_PICKS.filter((p) => !isGatewayPick(p.id))) },
      ]);
    }
    // The picker stays mounted while the catalog is in flight. Unmounting it
    // made the control disappear and the strip reflow every time the subject
    // changed — the pick is unknown for that moment, which is what the empty
    // label says; the control itself is not.
    const loading = !daemonModels || daemonModels.models.length === 0;
    const cur = daemonModels?.current ?? null;
    const models = daemonModels?.models ?? [];
    // Grouped by provider, in the order the daemon listed them, so switching
    // model and switching provider are visibly the same act.
    const groups = Array.from(new Set(models.map((m) => m.provider))).map((provider) => ({
      name: provider,
      rows: models
        .filter((m) => m.provider === provider)
        .map((m) => ({
          key: `${m.provider}::${m.id}`,
          label: m.name,
          on: cur?.provider === m.provider && cur?.id === m.id,
          pick: () => {
            setDaemonModels((st) => (st ? { ...st, current: m } : st));
            setDaemonModel(m, modelRoot).catch(() =>
              // Rejected (e.g. mid-run) — re-pull the truth.
              fetchModels(modelRoot).then(setDaemonModels).catch(() => undefined),
            );
          },
        })),
    }));
    return modelPop(cur?.name ?? "—", groups, loading);
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
    // No "objective" chip here. It was the bare word with no value attached —
    // it said a goal exists without saying what it is, while the Inspector's
    // goal panel says both. Every other segment on this strip reports
    // something happening right now; that one only reported a setting.
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

  /** The minute's NIM budget, beside the picker. One number and, only when it
   *  matters, one coloured square — the words live in the tooltip, like every
   *  other status in this shell. Hidden while the subject is on a gateway
   *  model: that traffic never touches the NIM key. */
  const nimMeter = () => {
    if (!nim || !showsPicker) return null;
    const onNim = connected
      ? daemonModels?.current?.provider === "nvidia-nim"
      : !isGatewayPick(offlinePick);
    if (!onNim) return null;
    // A 429 is worth shouting about only while it is still true; NIM's window
    // is a minute and it recovers on its own.
    const throttled = nim.throttledMsAgo !== null && nim.throttledMsAgo < 20_000;
    const near = nim.used >= nim.limit * 0.75;
    const title = throttled
      ? t("NVIDIA just answered 429. {used} of ~{limit} requests this minute; {inflight} in flight — about five at once is where it starts refusing.", {
          used: nim.used,
          limit: nim.limit,
          inflight: nim.inflight,
        })
      : t("NIM: {used} of ~{limit} requests this minute. The free tier's ceiling is per key and shared by every model, so this counts the runtime's calls as well as this window's.", {
          used: nim.used,
          limit: nim.limit,
        });
    return (
      <span className={`nimq${throttled ? " hot" : near ? " warm" : ""}`} title={title}>
        {(throttled || near) && <i className="sq" />}
        {nim.used}/{nim.limit} RPM
      </span>
    );
  };

  /** What is left on the gateway key, in the same spot and the same shape as
   *  the NIM meter — but a balance, not a count, because Vercel answers for
   *  the account. Shown only while the pick actually spends it. */
  const gatewayMeter = () => {
    if (!onGateway || !gw) return null;
    if (!gw.configured) {
      return (
        <span className="nimq warm nokey" title={t("The bridge holds no AI Gateway key. Put AI_GATEWAY_API_KEY in .env (a source checkout) or gatewayApiKey in config.json (an installed app) — never in the page.")}>
          <i className="sq" />
          {t("NO GATEWAY KEY")}
        </span>
      );
    }
    if (gw.balance === null) return null;
    const spent = gw.totalUsed ?? 0;
    return (
      <span
        className={`nimq${gw.balance <= 0 ? " hot" : gw.balance < 1 ? " warm" : ""}`}
        title={t("Vercel AI Gateway: ${balance} of credit left, ${spent} spent. One key covers all four models, and the free tier reaches only some of them.", {
          balance: gw.balance.toFixed(2),
          spent: spent.toFixed(2),
        })}
      >
        {gw.balance < 1 && <i className="sq" />}
        ${gw.balance.toFixed(2)}
      </span>
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
        {nimMeter()}
        {gatewayMeter()}
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
