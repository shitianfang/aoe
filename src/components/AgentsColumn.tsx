import type { AgentState } from "../types";

export function AgentsColumn(props: { master: AgentState }) {
  return (
    <aside className="col2">
      <div className="sec">Agents</div>
      <button className="arow sel">
        <span className="chip master" />
        <span className="nm">master</span>
        <span className={props.master === "working" ? "st run" : "st"}>{props.master}</span>
      </button>
      <div className="colnote">
        master runs this workspace.
        <br />
        helpers appear here when it starts them.
      </div>
    </aside>
  );
}
