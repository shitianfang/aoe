import type { AgentState, AutonomousInfo, BridgeState, GoalInfo, HeartbeatInfo } from "../types";

function hbWhen(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

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
          </>
        ) : (
          <>
            <div className="kv">
              <span className="k">Objective</span>
              <span className="v faint">none</span>
            </div>
            <div className="rule">
              {props.bridge?.connected
                ? "master acts when you message it. “/goal …” gives it an objective to keep going on its own."
                : "master acts when you message it. Objectives and check-ins need the runtime (bridge offline)."}
            </div>
          </>
        )}
      </div>

      {auto?.enabled && (
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
        </div>
      )}

      {props.heartbeats.length > 0 && (
        <div className="panel">
          <div className="phead">
            <span>Re-entry</span>
          </div>
          {props.heartbeats.map((h) => (
            <div className="kv" key={h.id} title={h.prompt}>
              <span className="k">
                {h.source === "rlm_heartbeat" ? "check-in · agent" : "check-in"}
              </span>
              <span className="v faint">
                {h.status === "paused" ? "paused" : `next ${hbWhen(h.nextRunAt) || "soon"}`}
              </span>
            </div>
          ))}
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
