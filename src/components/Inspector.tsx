import { useState } from "react";
import type { AgentState, AutonomousInfo, BridgeState, GoalInfo, HeartbeatInfo } from "../types";
import { bridgeCmd } from "../runtime/bridge";

function hbWhen(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function Inspector(props: {
  master: AgentState;
  goal: GoalInfo | null;
  bridge: BridgeState | null;
  heartbeats: HeartbeatInfo[];
  autonomous: AutonomousInfo | null;
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
                  {Math.round(((goal.tokensUsed ?? 0) / goal.tokenBudget) * 100)}% used
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

      {(props.heartbeats.length > 0 || online) && (
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
        <button className="open" onClick={props.onOpenLearn}>
          open learned →
        </button>
      </div>
    </aside>
  );
}
