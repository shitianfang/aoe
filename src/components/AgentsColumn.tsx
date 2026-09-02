import type { AgentState, ChildInfo } from "../types";

const HUES = ["cyan", "amber", "violet"] as const;

function childState(c: ChildInfo): { label: string; cls: string } {
  if (c.status === "running" || c.status === "queued") return { label: c.status, cls: "st run" };
  if (c.status === "done") {
    return c.repliedSinceTask
      ? { label: "replied", cls: "st" }
      : { label: "no reply", cls: "st need" };
  }
  return { label: c.status, cls: "st" };
}

export function AgentsColumn(props: { master: AgentState; children: ChildInfo[] }) {
  return (
    <aside className="col2">
      <div className="sec">Agents</div>
      <button className="arow sel">
        <span className="chip master" />
        <span className="nm">master</span>
        <span className={props.master === "working" ? "st run" : "st"}>{props.master}</span>
      </button>
      {props.children.map((c, i) => {
        const st = childState(c);
        return (
          <button className="arow indent" key={c.id} title={c.label}>
            <span className={`chip ${HUES[i % HUES.length]}`}>
              {(c.label || "?").slice(0, 1).toUpperCase()}
            </span>
            <span className="nm">{c.label}</span>
            <span className={st.cls}>{st.label}</span>
          </button>
        );
      })}
      {props.children.length === 0 && (
        <div className="colnote">
          master runs this workspace.
          <br />
          helpers appear here when it starts them.
        </div>
      )}
    </aside>
  );
}
