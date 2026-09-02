import type { AgentState, BridgeState, GoalInfo } from "../types";

export function Inspector(props: {
  master: AgentState;
  goal: GoalInfo | null;
  bridge: BridgeState | null;
}) {
  const goal = props.goal;
  const goalActive = Boolean(goal?.active);
  return (
    <aside className="insp">
      <div className="flow">
        <span className={goalActive ? "" : "active"}>you</span>
        <i />
        <span className={goalActive ? "active" : ""}>objective</span>
        <i />
        <span>check-in</span>
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
            {typeof goal?.tokenBudget === "number" && (
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
                ? "master acts when you message it. Set an objective to let it keep going on its own."
                : "master acts when you message it. Objectives and check-ins need the runtime (bridge offline)."}
            </div>
          </>
        )}
      </div>
      <div className="panel">
        <div className="phead">
          <span>Learned</span>
          <code>0</code>
        </div>
        <div className="kv">
          <span className="k">Lessons</span>
          <span className="v faint">none yet</span>
        </div>
      </div>
    </aside>
  );
}
