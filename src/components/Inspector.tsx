import { useCallback, useEffect, useState } from "react";
import type {
  AutoRefineInfo,
  AutonomousInfo,
  BridgeState,
  ChildInfo,
  CronInfo,
  GoalInfo,
  HeartbeatInfo,
} from "../types";
import { helperName, hhmmEpoch, injectionReasonText, reachable, statusWord } from "../helperDisplay";
import { bridgeCmd, bridgeUrl, fetchAutonomous, fetchRootStatus } from "../runtime/bridge";
import { BotAvatar } from "./BotAvatar";
import { getLang, t as tr, useT } from "../i18n";

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function hbWhen(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return hhmm(d);
}

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 41234 → "41k". Counters only — the runtime reports tokens, never money. */
function tk(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.max(0, Math.round(n)));
}

const asMinutes = (ms: number) => tr("{n}m", { n: Math.max(0, Math.round(ms / 60_000)) });

/** Runtime defaults for the unattended limits (core DEFAULT_AUTONOMOUS_LIMITS:
 *  12 turns, 80k tokens, 30 minutes, 3 continuations). Shown as prefill and
 *  substituted quietly when an edit does not parse — never a loud error. */
const UNATTENDED_DEFAULTS = { turns: "12", tokens: "80k", time: "30m", continued: "3" };

const countOr = (v: string, fallback: string) =>
  /^[1-9]\d*$/.test(v.trim()) ? v.trim() : fallback;
/** tokens: <n>[k|m]; time: <n>[s|m|h] (bare minutes) — the /autonomous on syntax. */
const suffixedOr = (v: string, suffixes: string, fallback: string) => {
  const s = v.trim().toLowerCase();
  return new RegExp(`^\\d+(\\.\\d+)?[${suffixes}]?$`).test(s) && Number.parseFloat(s) > 0
    ? s
    : fallback;
};

/** Check-in intervals the runtime accepts verbatim: "every Nm/Nh" parses as an
 *  interval schedule, "@daily" is a built-in cron alias (0 0 * * *). No other
 *  forms are offered — nothing for the user to type or learn. */
const CHECKIN_INTERVALS = [
  { id: "5m", schedule: "every 5m", label: "every 5m" },
  { id: "15m", schedule: "every 15m", label: "every 15m" },
  { id: "30m", schedule: "every 30m", label: "every 30m" },
  { id: "1h", schedule: "every 1h", label: "every 1h" },
  { id: "3h", schedule: "every 3h", label: "every 3h" },
  { id: "daily", schedule: "@daily", label: "daily" },
] as const;

function stamp(d: Date): string {
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? hhmm(d)
    : `${d.toLocaleDateString(getLang() === "zh" ? "zh-CN" : undefined, { month: "short", day: "numeric" })} ${hhmm(d)}`;
}

/** Honest helper panel: helpers have no objective / unattended / check-ins of
 *  their own — only their task, status, cost (billed to master), and reach. */
function HelperInspector(props: { child: ChildInfo }) {
  const t = useT();
  const c = props.child;
  const name = helperName(c);
  const word = statusWord(c);
  const terminal = c.status === "done" || c.status === "error" || c.status === "cancelled";
  return (
    <aside className="insp">
      <div className="subj">
        <BotAvatar seed={name} />
        <span className="nm">{name}</span>
        <span className="st">{t("helper")}</span>
      </div>
      <div className="panel">
        <div className="phead">
          <span>{t("Task")}</span>
        </div>
        {c.label && <div className="rule">“{c.label}”</div>}
        <div className="kv">
          <span className="k">{t("Status")}</span>
          <span className={word === "running" ? "v ok" : "v"}>{t(word)}</span>
        </div>
        {terminal && typeof c.completedAt === "number" && (
          <div className="kv">
            <span className="k">{t("finished")}</span>
            <span className="v faint">{hhmmEpoch(c.completedAt)}</span>
          </div>
        )}
        {c.model && (
          <div className="kv">
            <span className="k">{t("Model")}</span>
            {/* Read-only on purpose: a helper's model is chosen when it is
                spawned and cannot be switched mid-run. */}
            <span className="v faint" title={c.model}>
              {c.model.split("/").pop()}
            </span>
          </div>
        )}
        {typeof c.tokenCount === "number" && c.tokenCount > 0 && (
          <div className="kv">
            <span className="k">{t("Tokens")}</span>
            <span className="v faint">
              {tk(c.tokenCount)}{c.foreign ? "" : ` · ${t("billed to master")}`}
            </span>
          </div>
        )}
        {!c.foreign && (
          <div className="rule">
            {t(reachable(c) ? "still reachable" : "ran inline, not reachable")}
          </div>
        )}
      </div>
      <div className="panel">
        {/* Ownership must be honest: a foreign crew member answers to its own
            root, not to master. */}
        <div className="rule">
          {c.foreign
            ? t("on {name}'s team", { name: c.parentName ?? "?" })
            : t("runs for master — its objective, check-ins and model live on master")}
        </div>
      </div>
    </aside>
  );
}

export function Inspector(props: {
  goal: GoalInfo | null;
  bridge: BridgeState | null;
  heartbeats: HeartbeatInfo[];
  autonomous: AutonomousInfo | null;
  /** Selection the panel binds to (the focused pane's agent): a helper wins,
   *  else a root by name, else master. */
  selectedChild: ChildInfo | null;
  selectedRoot: string | null;
  /** The selected root's own state (null until its snapshot lands). */
  rootGoal: GoalInfo | null;
  rootAutonomous: AutonomousInfo | null;
  /** Auto-refine rhythm readout (schema 27; null on old daemons — the
   *  self-evolution panel then shows the learn-now control alone). */
  autoRefine: AutoRefineInfo | null;
  rootAutoRefine: AutoRefineInfo | null;
  /** The selected root's connection state has arrived — until then the panels
   *  say "loading", never "none". */
  rootLoaded: boolean;
  /** Bumped by App when the bridge state behind the pulled rows may have moved
   *  (attach, heartbeats_changed) — re-pulls the cron rows. */
  refreshKey?: number;
  /** Ask App to re-pull the selected root's status blocks (after a write). */
  onRootRefresh: (name: string) => void;
  /** Writes the GLOBAL auto-refine setting (settings.json autoRefine.enabled)
   *  — the same switch the ⚡ column carries, repeated here because this is
   *  where self-evolution is read. */
  onToggleAuto: (enabled: boolean) => Promise<void>;
}) {
  const t = useT();
  // Subject of every panel below: a helper (honest short panel), a root
  // session, or master. The helper case renders its own component.
  const child = props.selectedChild;
  const root = child ? null : props.selectedRoot;
  const subjectName = root ?? "master";
  const goal = root ? props.rootGoal : props.goal;
  const goalActive = Boolean(goal?.active);
  const auto = root ? props.rootAutonomous : props.autonomous;
  const online = Boolean(props.bridge?.connected);
  const loaded = root ? props.rootLoaded : true;
  // Check-ins are per session; rows are bridge-stamped with their subject.
  // Unstamped rows (identity unknown) are shown nowhere rather than guessed;
  // on old bridges without stamping, everything degrades to master's panel.
  const stamped = props.heartbeats.some((h) => h.subject !== undefined);
  const heartbeats = props.heartbeats.filter((h) =>
    root ? h.subject === root : stamped ? h.subject === "master" : true,
  );

  const [objText, setObjText] = useState("");
  const [objErr, setObjErr] = useState<string | null>(null);
  const [autoErr, setAutoErr] = useState<string | null>(null);
  const [limTurns, setLimTurns] = useState(UNATTENDED_DEFAULTS.turns);
  const [limTokens, setLimTokens] = useState(UNATTENDED_DEFAULTS.tokens);
  const [limTime, setLimTime] = useState(UNATTENDED_DEFAULTS.time);
  const [limCont, setLimCont] = useState(UNATTENDED_DEFAULTS.continued);
  const [hbEvery, setHbEvery] = useState<string>("30m");
  const [hbText, setHbText] = useState("");
  const [hbErr, setHbErr] = useState<string | null>(null);
  // Self-evolution (learn now = a real /refine on this agent's own session).
  // Busy is keyed by subject and never reset on selection change: the refine
  // keeps running while you look elsewhere; its lesson lands in the timeline
  // and ⚡ regardless.
  const [learnOpen, setLearnOpen] = useState(false);
  const [learnText, setLearnText] = useState("");
  const [learnErr, setLearnErr] = useState<string | null>(null);
  const [learnBusy, setLearnBusy] = useState<Record<string, boolean>>({});
  const [autoPending, setAutoPending] = useState(false);
  const [autoLearnErr, setAutoLearnErr] = useState<string | null>(null);
  const [crons, setCrons] = useState<CronInfo[]>([]);
  // Elapsed unattended time is derived from startedAt; re-render it on the minute.
  const [, setTick] = useState(0);

  const refreshKey = props.refreshKey ?? 0;

  // Scheduled re-entries are master's (cron_list is scoped to its session).
  const loadCrons = useCallback(() => {
    if (root) {
      setCrons([]);
      return;
    }
    fetch(bridgeUrl("/bridge/crons"))
      .then((r) => r.json())
      .then((d) => setCrons(Array.isArray(d?.crons) ? (d.crons as CronInfo[]) : []))
      .catch(() => setCrons([])); // bridge offline — no rows rather than stale ones
  }, [root]);

  useEffect(() => {
    loadCrons();
  }, [loadCrons, refreshKey]);

  // Error rows and drafts are per subject — never carried across a selection.
  useEffect(() => {
    setObjErr(null);
    setAutoErr(null);
    setHbErr(null);
    setObjText("");
    setHbText("");
    setLearnErr(null);
    setLearnText("");
    setLearnOpen(false);
    setAutoLearnErr(null);
  }, [child?.id, root]);

  const startedAt = auto?.enabled ? auto.startedAt : undefined;
  useEffect(() => {
    if (typeof startedAt !== "number") return;
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [startedAt]);

  // Objective writes are "/goal …" prompts intercepted by the session (no model
  // turn); state comes back via goal_update — master's on its own stream, a
  // root's on the watch_root stream. Same pattern for unattended.
  const subjectPrompt = (text: string) =>
    root ? bridgeCmd("root_prompt", text, { target: root }) : bridgeCmd("prompt", text);

  const goalCmd = (sub: string) => {
    setObjErr(null);
    subjectPrompt(`/goal ${sub}`).catch((e) =>
      setObjErr(e instanceof Error ? e.message : t("failed")),
    );
  };

  const submitObjective = () => {
    const text = objText.trim();
    if (!text) return;
    setObjErr(null);
    subjectPrompt(`/goal ${text}`)
      .then(() => setObjText(""))
      .catch((e) => setObjErr(e instanceof Error ? e.message : t("failed")));
  };

  /** Fresh unattended counters for the subject: master's ride an
   *  autonomous_status custom; a root's come back via the status pull. */
  const refreshAuto = async () => {
    if (root) props.onRootRefresh(root);
    else await bridgeCmd("prompt", "/autonomous status");
  };

  const toggleUnattended = async (on: boolean) => {
    setAutoErr(null);
    try {
      if (on) {
        const limits = [
          `turns=${countOr(limTurns, UNATTENDED_DEFAULTS.turns)}`,
          `tokens=${suffixedOr(limTokens, "km", UNATTENDED_DEFAULTS.tokens)}`,
          `time=${suffixedOr(limTime, "smh", UNATTENDED_DEFAULTS.time)}`,
          `continuations=${countOr(limCont, UNATTENDED_DEFAULTS.continued)}`,
        ].join(" ");
        await subjectPrompt(`/autonomous on ${limits}`);
        // A pre-limits daemon rejects the syntax as a failed command (the
        // prompt call itself still resolves): if unattended did not switch
        // on, degrade to the plain toggle it does understand.
        const probe = root
          ? await fetchRootStatus(root).catch(() => null)
          : await fetchAutonomous().catch(() => null);
        if (probe?.autonomous && !probe.autonomous.enabled) {
          await subjectPrompt("/autonomous on");
        }
      } else {
        await subjectPrompt("/autonomous off");
      }
      // The toggle alone does not emit fresh counters — ask for them.
      await refreshAuto();
    } catch (e) {
      setAutoErr(e instanceof Error ? e.message : t("failed"));
    }
  };

  /** Learn now: a real refine on the subject's own session and harness.
   *  Empty instruction = plain refine. Can take minutes; the finished lesson
   *  arrives as refine_complete (timeline card + ⚡ re-pull) on its own. */
  const submitLearn = () => {
    const key = subjectName;
    const text = learnText.trim();
    setLearnErr(null);
    setLearnBusy((m) => ({ ...m, [key]: true }));
    const call = root
      ? bridgeCmd("root_refine", text || undefined, { target: root })
      : bridgeCmd("refine", text || undefined);
    call
      .then(() => {
        setLearnText("");
        setLearnOpen(false);
      })
      .catch((e) => setLearnErr(e instanceof Error ? e.message : t("learn failed")))
      .finally(() => setLearnBusy((m) => ({ ...m, [key]: false })));
  };

  const updateCheckin = (action: "pause" | "resume" | "clear") => {
    setHbErr(null);
    const call = root
      ? bridgeCmd("root_heartbeat_update", undefined, { target: root, action })
      : bridgeCmd("heartbeat_update", undefined, { action });
    call.catch((e) => setHbErr(e instanceof Error ? e.message : t("failed")));
  };

  const cancelCron = (jobId: string) => {
    setHbErr(null);
    bridgeCmd("cron_cancel", undefined, { target: jobId })
      .then(loadCrons)
      .catch((e) => setHbErr(e instanceof Error ? e.message : t("failed")));
  };

  // Structured check-in creation: interval choice + plain instruction — the
  // schedule string is assembled here, never typed by the user.
  const submitCheckin = () => {
    const text = hbText.trim();
    if (!text) return;
    const iv = CHECKIN_INTERVALS.find((x) => x.id === hbEvery) ?? CHECKIN_INTERVALS[2];
    setHbErr(null);
    const call = root
      ? bridgeCmd("root_heartbeat_set", text, {
          target: root,
          schedule: iv.schedule,
          mode: "follow_up",
        })
      : bridgeCmd("heartbeat_set", text, { schedule: iv.schedule, mode: "follow_up" });
    call
      .then(() => setHbText(""))
      .catch((e) => setHbErr(e instanceof Error ? e.message : t("failed")));
  };

  if (child) return <HelperInspector child={child} />;

  // The header's third word answers "who is driving this agent" — the state
  // words (idle/running) live in the panes; here they were redundant.
  const subjectHeader = (
    <div className="subj">
      {root ? <BotAvatar seed={root} /> : <span className="chip master" />}
      <span className="nm">{subjectName}</span>
      <span className="st">
        {root && !loaded ? t("loading…") : goalActive ? t("driven by objective") : t("driven by you")}
      </span>
    </div>
  );

  // A root whose connection state has not arrived yet (attach-on-select is in
  // flight): name the subject, say loading — never claim "no objective".
  if (root && !loaded) {
    return (
      <aside className="insp">
        {subjectHeader}
        <div className="panel">
          <div className="rule">
            {online ? t("loading state…") : t("runtime offline · model only")}
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="insp">
      {subjectHeader}

      {/* Self-evolution: the /refine mechanism, surfaced. "Learn now" runs a
          real refine on this agent's own session (helpers have none — this
          panel never renders for them); the muted line is the auto rhythm's
          honest readout (last review checkpoint + cooldown). The on/off
          switch lives at the top of the ⚡ column — the setting is global. */}
      {online &&
        (() => {
          const ar = root ? props.rootAutoRefine : props.autoRefine;
          const busy = Boolean(learnBusy[subjectName]);
          const last = ar?.lastReviewAt !== undefined ? hhmmEpoch(ar.lastReviewAt) : null;
          const next =
            ar?.enabled && ar.lastReviewAt !== undefined && typeof ar.cooldownMs === "number"
              ? hhmmEpoch(ar.lastReviewAt + ar.cooldownMs)
              : null;
          return (
            <div className="panel">
              <div className="phead">
                <span>{t("Self-evolution")}</span>
              </div>
              {/* The auto side. One global setting, so the box reads master's
                  block even when the panel is bound to a root — a root's own
                  copy lands later (or never, for a root with no live session)
                  and would make this box disagree with the ⚡ column's.
                  Hidden, never faked, when the daemon predates the block. */}
              {props.autoRefine !== null && (
                <>
                  <label className="lauto">
                    <input
                      type="checkbox"
                      checked={props.autoRefine.enabled}
                      disabled={autoPending}
                      onChange={(e) => {
                        setAutoPending(true);
                        setAutoLearnErr(null);
                        props
                          .onToggleAuto(e.target.checked)
                          .catch((err) =>
                            setAutoLearnErr(err instanceof Error ? err.message : t("failed")),
                          )
                          .finally(() => setAutoPending(false));
                      }}
                    />
                    <span>{t("let agents learn on their own")}</span>
                  </label>
                  {autoLearnErr && <div className="ierr">{autoLearnErr}</div>}
                </>
              )}
              {busy ? (
                <div className="rule">{t("learning… this can take a few minutes.")}</div>
              ) : learnOpen ? (
                <div className="hbnew" style={{ marginTop: 0 }}>
                  <input
                    className="iin"
                    placeholder={t("anything to focus on? (optional)")}
                    value={learnText}
                    onChange={(e) => setLearnText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitLearn();
                    }}
                  />
                  <button className="btn" onClick={submitLearn}>
                    {t("start learning")}
                  </button>
                </div>
              ) : (
                <div className="brow" style={{ marginTop: 0 }}>
                  <button className="btn" onClick={() => setLearnOpen(true)}>
                    {t("learn now")}
                  </button>
                </div>
              )}
              {last !== null && (
                <div className="rule" style={{ paddingTop: 8 }}>
                  {t("last auto review {at}", { at: last })}
                  {next !== null
                    ? ` · ${t("next auto learn no earlier than {at}", { at: next })}`
                    : ""}
                </div>
              )}
              {learnErr && <div className="ierr">{learnErr}</div>}
            </div>
          );
        })()}

      {/* Who drives sits in the header above; this panel is the objective itself. */}
      <div className="panel">
        {goalActive ? (
          <>
            <div className="rule">“{goal?.objective}”</div>
            <div className="kv">
              <span className="k">{t("Status")}</span>
              <span className="v ok">{goal?.status ? t(goal.status) : ""}</span>
            </div>
            {typeof goal?.tokenBudget === "number" && goal.tokenBudget > 0 && (
              <div className="kv">
                <span className="k">{t("Budget")}</span>
                <span className="v faint">
                  {t("{used} of {max}", {
                    used: tk(goal.tokensUsed ?? 0),
                    max: tk(goal.tokenBudget),
                  })}{" "}
                  · {Math.round(((goal.tokensUsed ?? 0) / goal.tokenBudget) * 100)}%
                </span>
              </div>
            )}
            {online && (
              <div className="brow">
                {goal?.status === "paused" ? (
                  <button className="btn" onClick={() => goalCmd("resume")}>
                    {t("resume")}
                  </button>
                ) : (
                  <button className="btn" onClick={() => goalCmd("pause")}>
                    {t("pause")}
                  </button>
                )}
                <button className="btn" onClick={() => goalCmd("clear")}>
                  {t("clear")}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="kv">
              <span className="k">{t("Objective")}</span>
              <span className="v faint">{t("none")}</span>
            </div>
            <div className="rule">
              {online
                ? t("{name} acts when you message it. An objective keeps it going on its own.", {
                    name: subjectName,
                  })
                : t(
                    "{name} acts when you message it. Objectives and check-ins need the runtime (bridge offline).",
                    { name: subjectName },
                  )}
            </div>
            {online && (
              <div className="hbnew">
                <input
                  className="iin"
                  placeholder={t("set an objective for {name}…", { name: subjectName })}
                  value={objText}
                  onChange={(e) => setObjText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitObjective();
                  }}
                />
                <button className="btn" onClick={submitObjective}>
                  {t("apply")}
                </button>
              </div>
            )}
          </>
        )}
        {objErr && <div className="ierr">{objErr}</div>}
      </div>

      {auto?.enabled ? (
        <div className="panel">
          <div className="phead">
            <span>{t("Unattended")}</span>
            <code>{t("on")}</code>
          </div>
          <div className="rule">
            {t(
              "Steps in only after a failed check or a turn without evidence; stops at any limit. The objective continues regardless.",
            )}
          </div>
          <div className="kv">
            <span className="k">{t("Continued")}</span>
            <span className="v">
              {t("{used} of {max}", {
                used: auto.continuationsUsed ?? 0,
                max: auto.limits?.maxContinuations ?? "?",
              })}
            </span>
          </div>
          <div className="kv">
            <span className="k">{t("Turns")}</span>
            <span className="v">
              {t("{used} of {max}", { used: auto.turnsUsed ?? 0, max: auto.limits?.maxTurns ?? "?" })}
            </span>
          </div>
          {typeof auto.limits?.maxTokens === "number" && auto.limits.maxTokens > 0 && (
            <div className="kv">
              <span className="k">{t("Tokens")}</span>
              <span className="v">
                {t("{used} of {max}", {
                  used: tk(auto.tokensUsed ?? 0),
                  max: tk(auto.limits.maxTokens),
                })}
              </span>
            </div>
          )}
          {typeof auto.limits?.timeoutMs === "number" && auto.limits.timeoutMs > 0 && (
            <div className="kv">
              <span className="k">{t("Time")}</span>
              {/* startedAt is the only clock the runtime gives; without it we
                  show the limit alone rather than guess how long it has run. */}
              <span className="v">
                {typeof auto.startedAt === "number"
                  ? t("{used} of {max}", {
                      used: asMinutes(Math.max(0, Date.now() - auto.startedAt)),
                      max: asMinutes(auto.limits.timeoutMs),
                    })
                  : t("limit {max}", { max: asMinutes(auto.limits.timeoutMs) })}
              </span>
            </div>
          )}
          {auto.lastInjection && (
            <div className="kv">
              <span className="k">{t("Last continued")}</span>
              <span className="v faint">
                {injectionReasonText(auto.lastInjection.reason)} · {hhmmEpoch(auto.lastInjection.at)}
              </span>
            </div>
          )}
          {auto.lastGateFailure?.command && (
            <div className="ierr">
              {t("last check failed · {command}", {
                command: trunc(auto.lastGateFailure.command, 40),
              })}
            </div>
          )}
          {online && (
            <div className="brow">
              <button className="btn" onClick={() => toggleUnattended(false)}>
                {t("turn off")}
              </button>
            </div>
          )}
          {autoErr && <div className="ierr">{autoErr}</div>}
        </div>
      ) : (
        online && (
          <div className="panel">
            <div className="phead">
              <span>{t("Unattended")}</span>
              <code>{t("off")}</code>
            </div>
            <div className="rule">
              {t(
                "Turns on with these limits. It steps in only after a failed check or a turn without evidence.",
              )}
            </div>
            <div className="lims">
              <label>
                <span>{t("turns")}</span>
                <input
                  value={limTurns}
                  placeholder={UNATTENDED_DEFAULTS.turns}
                  onChange={(e) => setLimTurns(e.target.value)}
                />
              </label>
              <label>
                <span>{t("tokens")}</span>
                <input
                  value={limTokens}
                  placeholder={UNATTENDED_DEFAULTS.tokens}
                  onChange={(e) => setLimTokens(e.target.value)}
                />
              </label>
              <label>
                <span>{t("time")}</span>
                <input
                  value={limTime}
                  placeholder={UNATTENDED_DEFAULTS.time}
                  onChange={(e) => setLimTime(e.target.value)}
                />
              </label>
              <label>
                <span>{t("continued")}</span>
                <input
                  value={limCont}
                  placeholder={UNATTENDED_DEFAULTS.continued}
                  onChange={(e) => setLimCont(e.target.value)}
                />
              </label>
            </div>
            <button className="btn" onClick={() => toggleUnattended(true)}>
              {t("turn unattended on")}
            </button>
            {autoErr && <div className="ierr">{autoErr}</div>}
          </div>
        )
      )}

      {(heartbeats.length > 0 || crons.length > 0 || online) && (
        <div className="panel">
          <div className="phead">
            <span>{t("Re-entry")}</span>
          </div>
          {heartbeats.map((h) => (
            <div className="kv hbrow" key={h.id} title={h.prompt}>
              <span className="k">
                {t(h.source === "rlm_heartbeat" ? "check-in · agent" : "check-in")}
              </span>
              <span className="v faint">
                {h.status === "paused"
                  ? t("paused")
                  : t("next {when}", { when: hbWhen(h.nextRunAt) || t("soon") })}
              </span>
              {h.source !== "rlm_heartbeat" && online && (
                <span className="hbops">
                  {h.status === "paused" ? (
                    <button className="btn xs" onClick={() => updateCheckin("resume")}>
                      {t("resume")}
                    </button>
                  ) : (
                    <button className="btn xs" onClick={() => updateCheckin("pause")}>
                      {t("pause")}
                    </button>
                  )}
                  <button className="btn xs" onClick={() => updateCheckin("clear")}>
                    {t("clear")}
                  </button>
                </span>
              )}
            </div>
          ))}
          {crons.map((c) => {
            // Schedules run days out as easily as minutes — stamp() adds the
            // date when the next run is not today.
            const at = c.nextRunAt ? new Date(c.nextRunAt) : null;
            const next = at && !Number.isNaN(at.getTime()) ? stamp(at) : "";
            return (
              <div className="kv hbrow" key={c.id} title={c.prompt}>
                <span className="k">
                  {t("sched")}{c.schedule?.expression ? ` · ${c.schedule.expression}` : ""}
                </span>
                <span className="v faint">{next ? t("next {when}", { when: next }) : t(c.status)}</span>
                {online && (
                  <span className="hbops">
                    <button className="btn xs" onClick={() => cancelCron(c.id)}>
                      {t("cancel")}
                    </button>
                  </span>
                )}
              </div>
            );
          })}
          {online && (
            <>
              <div className="hbnew">
                <select
                  value={hbEvery}
                  aria-label={t("new check-in")}
                  onChange={(e) => setHbEvery(e.target.value)}
                >
                  {CHECKIN_INTERVALS.map((iv) => (
                    <option key={iv.id} value={iv.id}>
                      {t(iv.label)}
                    </option>
                  ))}
                </select>
                <input
                  className="iin"
                  placeholder={t("wake it with this prompt…")}
                  value={hbText}
                  onChange={(e) => setHbText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitCheckin();
                  }}
                />
                <button className="btn" onClick={submitCheckin}>
                  {t("add")}
                </button>
              </div>
            </>
          )}
          {hbErr && <div className="ierr">{hbErr}</div>}
        </div>
      )}
    </aside>
  );
}
