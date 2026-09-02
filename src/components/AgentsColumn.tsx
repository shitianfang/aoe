import { useState } from "react";
import type { AgentState, ChildInfo } from "../types";
import { chipGlyph, chipHue, helperName, statusWord } from "../helperDisplay";

const ACTIVE = new Set(["queued", "running", "done"]);

function Row(props: {
  child: ChildInfo;
  index: number;
  selected: boolean;
  onSelect: (childId: string) => void;
}) {
  const st = statusWord(props.child);
  return (
    <button
      className={props.selected ? "a indent sel" : "a indent"}
      title={props.child.label}
      onClick={() => props.onSelect(props.child.id)}
    >
      <span className={`chip ${chipHue(props.index)}`}>{chipGlyph(props.child)}</span>
      <span className="nm">{helperName(props.child)}</span>
      <span className={st.cls}>{st.label}</span>
    </button>
  );
}

export function AgentsColumn(props: {
  master: AgentState;
  children: ChildInfo[];
  selected: string | null;
  onSelect: (childId: string | null) => void;
}) {
  const [showInactive, setShowInactive] = useState(false);
  const active = props.children.filter((c) => ACTIVE.has(c.status));
  const inactive = props.children.filter((c) => !ACTIVE.has(c.status));
  return (
    <aside className="col2">
      <div className="sec">Agents</div>
      <button className={props.selected === null ? "a sel" : "a"} onClick={() => props.onSelect(null)}>
        <span className="chip master" />
        <span className="nm">master</span>
        <span className={props.master === "working" ? "st run" : "st"}>
          {props.master === "working" ? "running" : "idle"}
        </span>
      </button>
      {active.map((c) => (
        <Row
          key={c.id}
          child={c}
          index={props.children.indexOf(c)}
          selected={props.selected === c.id}
          onSelect={props.onSelect}
        />
      ))}
      {props.children.length === 0 && (
        <div className="colnote">
          master runs this workspace.
          <br />
          helpers appear here when it starts them.
        </div>
      )}
      {showInactive &&
        inactive.map((c) => (
          <Row
            key={c.id}
            child={c}
            index={props.children.indexOf(c)}
            selected={props.selected === c.id}
            onSelect={props.onSelect}
          />
        ))}
      {inactive.length > 0 && (
        <button className="more" onClick={() => setShowInactive((v) => !v)}>
          {inactive.length} inactive · {showInactive ? "hide" : "show"}
        </button>
      )}
    </aside>
  );
}
