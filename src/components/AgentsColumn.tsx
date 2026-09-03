import { useEffect, useState } from "react";
import type { AgentState, ChildInfo } from "../types";
import { chipGlyph, chipHue, helperName, statusWord } from "../helperDisplay";
import { bridgeUrl } from "../runtime/bridge";

const ACTIVE = new Set(["queued", "running", "done"]);

/** Other root sessions on this daemon (GET /bridge/agents) — read-only rows. */
interface RootAgent {
  name: string;
  state: "running" | "idle" | "inactive";
}

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
  const [others, setOthers] = useState<RootAgent[]>([]);
  const [showOtherInactive, setShowOtherInactive] = useState(false);
  // One pull when the panel opens is enough — these rows are display-only.
  useEffect(() => {
    let live = true;
    fetch(bridgeUrl("/bridge/agents"))
      .then((r) => r.json())
      .then((d) => {
        if (live && Array.isArray(d.agents)) setOthers(d.agents as RootAgent[]);
      })
      .catch(() => {
        /* bridge offline */
      });
    return () => {
      live = false;
    };
  }, []);
  const active = props.children.filter((c) => ACTIVE.has(c.status));
  const inactive = props.children.filter((c) => !ACTIVE.has(c.status));
  const otherActive = others.filter((a) => a.state !== "inactive");
  const otherInactive = others.filter((a) => a.state === "inactive");
  const otherRow = (a: RootAgent, i: number) => (
    <div className="a ro" key={`${a.name}-${i}`} title={a.name}>
      <span className="chip ghost">{a.name.slice(0, 1).toUpperCase()}</span>
      <span className="nm">{a.name}</span>
      <span className={a.state === "running" ? "st run" : "st"}>{a.state}</span>
    </div>
  );
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
      {others.length > 0 && (
        <>
          <div className="sec sub">Other</div>
          {otherActive.map(otherRow)}
          {showOtherInactive && otherInactive.map(otherRow)}
          {otherInactive.length > 0 && (
            <button className="more" onClick={() => setShowOtherInactive((v) => !v)}>
              {otherInactive.length} inactive · {showOtherInactive ? "hide" : "show"}
            </button>
          )}
        </>
      )}
    </aside>
  );
}
