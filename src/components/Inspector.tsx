import { useCallback, useEffect, useState } from "react";
import type {
  AgentState,
  AutoRefineInfo,
  AutonomousInfo,
  BridgeState,
  CronInfo,
  GoalInfo,
  HeartbeatInfo,
} from "../types";
import { hhmmEpoch, injectionReasonText } from "../helperDisplay";
import { bridgeCmd, bridgeUrl } from "../runtime/bridge";

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

const asMinutes = (ms: number) => `${Math.max(0, Math.round(ms / 60_000))}m`;

/** Refinement rows in the harness state files (GET /bridge/learned). */
interface LearnedSummary {
  today: number;
  last: string;
}

function stamp(d: Date): string {
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? hhmm(d)
    : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${hhmm(d)}`;
}

/** Count today's lessons and find the newest, across both scopes. Returns null
 *  when the harness has no dated refinement — nothing to say, so nothing shown. */
function summarizeLearned(data: unknown): LearnedSummary | null {
  const scopes = ["local", "global"] as const;
  const dates: Date[] = [];
  for (const scope of scopes) {
    const rows = (data as Record<string, { refinements?: { created_at?: string }[] } | null>)?.[scope]
      ?.refinements;
    for (const r of rows ?? []) {
      if (!r?.created_at) continue;
      const d = new Date(r.created_at);
      if (!Number.isNaN(d.getTime())) dates.push(d);
    }
  }
  if (dates.length === 0) return null;
  const now = new Date();
  const today = dates.filter(
    (d) =>
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate(),
  ).length;
  const last = dates.reduce((a, b) => (b.getTime() > a.getTime() ? b : a));
  return { today, last: stamp(last) };
}

export function Inspector(props: {
  master: AgentState;
  goal: GoalInfo | null;
  bridge: BridgeState | null;
  heartbeats: HeartbeatInfo[];
  autonomous: AutonomousInfo | null;
  /** Bumped by App when the bridge state behind the pulled rows may have moved
   *  (attach, heartbeats_changed, refine_complete) — re-pulls crons and lessons. */
  refreshKey?: number;
  onOpenLearn: () => void;
}) {
  const goal = props.goal;
  const goalActive = Boolean(goal?.active);
  const auto = props.autonomous;
  const online = Boolean(props.bridge?.connected);

  const [objText, setObjText] = useState("");
  const [objErr, setObjErr] = useState<string | null>(null);
  const [autoErr, setAutoErr] = useState<string | null>(null);
  const [hbText, setHbText] = useState("");
  const [hbErr, setHbErr] = useState<string | null>(null);
  const [crons, setCrons] = useState<CronInfo[]>([]);
  const [learned, setLearned] = useState<LearnedSummary | null>(null);
  const [autoRefine, setAutoRefine] = useState<AutoRefineInfo | null>(null);
  // Elapsed unattended time is derived from startedAt; re-render it on the minute.
  const [, setTick] = useState(0);

  const refreshKey = props.refreshKey ?? 0;

  const loadCrons = useCallback(() => {
    fetch(bridgeUrl("/bridge/crons"))
      .then((r) => r.json())
      .then((d) => setCrons(Array.isArray(d?.crons) ? (d.crons as CronInfo[]) : []))
      .catch(() => setCrons([])); // bridge offline — no rows rather than stale ones
  }, []);

  useEffect(() => {
    loadCrons();
    fetch(bridgeUrl("/bridge/learned"))
      .then((r) => r.json())
      .then((d) => {
        setLearned(summarizeLearned(d));
        // autoRefine rides along (schema 27); null on older daemons.
        setAutoRefine((d as { autoRefine?: AutoRefineInfo | null })?.autoRefine ?? null);
      })
      .catch(() => {
        setLearned(null);
        setAutoRefine(null);
      });
  }, [loadCrons, refreshKey]);

  const startedAt = auto?.enabled ? auto.startedAt : undefined;
  useEffect(() => {
    if (typeof startedAt !== "number") return;
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [startedAt]);

  // Objective writes are "/goal …" prompts intercepted by the session (no model
  // turn); state comes back via goal_update. Same pattern for unattended.
  const goalCmd = (sub: string) => {
    setObjErr(null);
    bridgeCmd("prompt", `/goal ${sub}`).catch((e) =>
      setObjErr(e instanceof Error ? e.message : "failed"),
    );
  };

  const submitObjective = () => {
    const text = objText.trim();
    if (!text) return;
    setObjErr(null);
    bridgeCmd("prompt", `/goal ${text}`)
      .then(() => setObjText(""))
      .catch((e) => setObjErr(e instanceof Error ? e.message : "failed"));
  };

  const toggleUnattended = async (on: boolean) => {
    setAutoErr(null);
    try {
      await bridgeCmd("prompt", `/autonomous ${on ? "on" : "off"}`);
      // The toggle alone does not emit fresh counters — ask for them.
      await bridgeCmd("prompt", "/autonomous status");
    } catch (e) {
      setAutoErr(e instanceof Error ? e.message : "failed");
    }
  };

  const updateCheckin = (action: "pause" | "resume" | "clear") => {
    setHbErr(null);
    bridgeCmd("heartbeat_update", undefined, { action }).catch((e) =>
      setHbErr(e instanceof Error ? e.message : "failed"),
    );
  };

  const cancelCron = (jobId: string) => {
    setHbErr(null);
    bridgeCmd("cron_cancel", undefined, { target: jobId })
      .then(loadCrons)
      .catch((e) => setHbErr(e instanceof Error ? e.message : "failed"));
  };

  const submitCheckin = () => {
    const m = /^every\s+([^:]+?)\s*:\s*(.+)$/i.exec(hbText.trim());
    if (!m) {
      setHbErr("format: every 30m: instruction");
      return;
    }
    setHbErr(null);
    bridgeCmd("heartbeat_set", m[2].trim(), { schedule: `every ${m[1].trim()}`, mode: "follow_up" })
      .then(() => setHbText(""))
      .catch((e) => setHbErr(e instanceof Error ? e.message : "failed"));
  };

  return (
    <aside className="insp">
      <div className="flow">
        <span className={goalActive ? "active" : ""}>objective</span>
        <i />
        <span className={auto?.enabled ? "active" : ""}>unattended</span>
        <i />
        <span className={props.heartbeats.some((h) => h.status === "active") ? "active" : ""}>
          check-in
        </span>
      </div>

      <div className="panel">
        <div className="phead">
          <span>Driving</span>
          <code>{goalActive ? "objective" : "you"}</code>
        </div>
        {goalActive ? (
          <>
            <div className="rule">“{goal?.objective}”</div>
            <div className="kv">
              <span className="k">Status</span>
              <span className="v ok">{goal?.status}</span>
            </div>
            {typeof goal?.tokenBudget === "number" && goal.tokenBudget > 0 && (
              <div className="kv">
                <span className="k">Budget</span>
                <span className="v faint">
                  {tk(goal.tokensUsed ?? 0)} of {tk(goal.tokenBudget)} ·{" "}
                  {Math.round(((goal.tokensUsed ?? 0) / goal.tokenBudget) * 100)}%
                </span>
              </div>
            )}
            {online && (
              <div className="brow">
                {goal?.status === "paused" ? (
                  <button className="btn" onClick={() => goalCmd("resume")}>
                    resume
                  </button>
                ) : (
                  <button className="btn" onClick={() => goalCmd("pause")}>
                    pause
                  </button>
                )}
                <button className="btn" onClick={() => goalCmd("clear")}>
                  clear
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="kv">
              <span className="k">Objective</span>
              <span className="v faint">none</span>
            </div>
            <div className="rule">
              {online
                ? "master acts when you message it. An objective keeps it going on its own."
                : "master acts when you message it. Objectives and check-ins need the runtime (bridge offline)."}
            </div>
            {online && (
              <input
                className="iin"
                placeholder="set an objective…"
                value={objText}
                onChange={(e) => setObjText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitObjective();
                }}
              />
            )}
          </>
        )}
        {objErr && <div className="ierr">{objErr}</div>}
      </div>

      {auto?.enabled ? (
        <div className="panel">
          <div className="phead">
            <span>Unattended</span>
            <code>on</code>
          </div>
          <div className="rule">
            Steps in only after a failed check or a turn without evidence; stops at any limit. The
            objective continues regardless.
          </div>
          <div className="kv">
            <span className="k">Continued</span>
            <span className="v">
              {auto.continuationsUsed ?? 0} of {auto.limits?.maxContinuations ?? "?"}
            </span>
          </div>
          <div className="kv">
            <span className="k">Turns</span>
            <span className="v">
              {auto.turnsUsed ?? 0} of {auto.limits?.maxTurns ?? "?"}
            </span>
          </div>
          {typeof auto.limits?.maxTokens === "number" && auto.limits.maxTokens > 0 && (
            <div className="kv">
              <span className="k">Tokens</span>
              <span className="v">
                {tk(auto.tokensUsed ?? 0)} of {tk(auto.limits.maxTokens)}
              </span>
            </div>
          )}
          {typeof auto.limits?.timeoutMs === "number" && auto.limits.timeoutMs > 0 && (
            <div className="kv">
              <span className="k">Time</span>
              {/* startedAt is the only clock the runtime gives; without it we
                  show the limit alone rather than guess how long it has run. */}
              <span className="v">
                {typeof auto.startedAt === "number"
                  ? `${asMinutes(Math.max(0, Date.now() - auto.startedAt))} of ${asMinutes(auto.limits.timeoutMs)}`
                  : `limit ${asMinutes(auto.limits.timeoutMs)}`}
              </span>
            </div>
          )}
          {auto.lastInjection && (
            <div className="kv">
              <span className="k">Last continued</span>
              <span className="v faint">
                {injectionReasonText(auto.lastInjection.reason)} · {hhmmEpoch(auto.lastInjection.at)}
              </span>
            </div>
          )}
          {auto.lastGateFailure?.command && (
            <div className="ierr">last check failed · {trunc(auto.lastGateFailure.command, 40)}</div>
          )}
          {online && (
            <div className="brow">
              <button className="btn" onClick={() => toggleUnattended(false)}>
                turn off
              </button>
            </div>
          )}
          {autoErr && <div className="ierr">{autoErr}</div>}
        </div>
      ) : (
        online && (
          <div className="panel">
            <div className="phead">
              <span>Unattended</span>
              <code>off</code>
            </div>
            <button className="btn" onClick={() => toggleUnattended(true)}>
              turn unattended on
            </button>
            {autoErr && <div className="ierr">{autoErr}</div>}
          </div>
        )
      )}

      {(props.heartbeats.length > 0 || crons.length > 0 || online) && (
        <div className="panel">
          <div className="phead">
            <span>Re-entry</span>
          </div>
          {props.heartbeats.map((h) => (
            <div className="kv hbrow" key={h.id} title={h.prompt}>
              <span className="k">
                {h.source === "rlm_heartbeat" ? "check-in · agent" : "check-in"}
              </span>
              <span className="v faint">
                {h.status === "paused" ? "paused" : `next ${hbWhen(h.nextRunAt) || "soon"}`}
              </span>
              {h.source !== "rlm_heartbeat" && online && (
                <span className="hbops">
                  {h.status === "paused" ? (
                    <button className="btn xs" onClick={() => updateCheckin("resume")}>
                      resume
                    </button>
                  ) : (
                    <button className="btn xs" onClick={() => updateCheckin("pause")}>
                      pause
                    </button>
                  )}
                  <button className="btn xs" onClick={() => updateCheckin("clear")}>
                    clear
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
                  sched{c.schedule?.expression ? ` · ${c.schedule.expression}` : ""}
                </span>
                <span className="v faint">{next ? `next ${next}` : c.status}</span>
                {online && (
                  <span className="hbops">
                    <button className="btn xs" onClick={() => cancelCron(c.id)}>
                      cancel
                    </button>
                  </span>
                )}
              </div>
            );
          })}
          {online && (
            <input
              className="iin"
              placeholder="new check-in… (every 30m: instruction)"
              value={hbText}
              onChange={(e) => setHbText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCheckin();
              }}
            />
          )}
          {hbErr && <div className="ierr">{hbErr}</div>}
        </div>
      )}

      <div className="panel">
        <div className="phead">
          <span>Learned</span>
        </div>
        {learned && (
          <>
            <div className="kv">
              <span className="k">Today</span>
              <span className="v">{learned.today}</span>
            </div>
            <div className="kv">
              <span className="k">Last lesson</span>
              <span className="v faint">{learned.last}</span>
            </div>
          </>
        )}
        {/* last review + cooldown bound the next auto review (schema 27);
            without both numbers there is nothing honest to show. */}
        {autoRefine?.enabled &&
          typeof autoRefine.lastReviewAt === "number" &&
          typeof autoRefine.cooldownMs === "number" && (
            <div className="kv">
              <span className="k">Next review</span>
              <span className="v faint">
                not before {stamp(new Date(autoRefine.lastReviewAt + autoRefine.cooldownMs))}
              </span>
            </div>
          )}
        <button className="open" onClick={props.onOpenLearn}>
          open learned →
        </button>
      </div>
    </aside>
  );
}
