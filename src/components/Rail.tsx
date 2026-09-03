import type { BridgeState, ColumnView } from "../types";

export function Rail(props: {
  column: ColumnView;
  bridge: BridgeState | null;
  onColumn: (v: ColumnView) => void;
  onLogo: () => void;
  onSettings: () => void;
}) {
  return (
    <nav className="rail">
      <button className="logo" title="switch workspace" onClick={props.onLogo} />
      <button
        className={props.column === "agents" ? "rbtn on" : "rbtn"}
        title="Agents"
        onClick={() => props.onColumn("agents")}
      >
        <svg viewBox="0 0 24 24">
          <rect x="8" y="4" width="8" height="7" />
          <path d="M5 20v-2c0-2.2 3.1-4 7-4s7 1.8 7 4v2" />
        </svg>
      </button>
      <button
        className={props.column === "files" ? "rbtn on" : "rbtn"}
        title="Files"
        onClick={() => props.onColumn("files")}
      >
        <svg viewBox="0 0 24 24">
          <path d="M4 6h6l2 2h8v11H4Z" />
        </svg>
      </button>
      <div className="rbtn" title="Skills — placeholder">
        <svg viewBox="0 0 24 24">
          <rect x="7" y="7" width="10" height="10" transform="rotate(45 12 12)" />
        </svg>
      </div>
      <div className="rbtn" title="Extensions — placeholder">
        <svg viewBox="0 0 24 24">
          <rect x="4" y="4" width="7" height="7" />
          <rect x="13" y="4" width="7" height="7" />
          <rect x="4" y="13" width="7" height="7" />
          <rect x="13" y="13" width="7" height="7" />
        </svg>
      </div>
      <div className="sp" />
      <button className="uav" title="you · settings" onClick={props.onSettings}>
        Y<span className={props.bridge?.connected ? "udot" : "udot bad"} />
      </button>
    </nav>
  );
}
