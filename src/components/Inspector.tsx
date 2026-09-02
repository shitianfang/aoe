import type { AgentState } from "../types";

export function Inspector(props: { master: AgentState }) {
  return (
    <aside className="insp">
      <div className="flow">
        <span className="active">you</span>
        <i />
        <span>objective</span>
        <i />
        <span>check-in</span>
      </div>
      <div className="panel">
        <div className="phead">
          <span>Driving</span>
          <code>{props.master === "working" ? "you · live" : "you"}</code>
        </div>
        <div className="kv">
          <span className="k">Objective</span>
          <span className="v faint">none</span>
        </div>
        <div className="rule">
          master acts when you message it. Objectives, check-ins and unattended runs arrive with the
          daemon runtime.
        </div>
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
