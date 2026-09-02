import type { BridgeState, Theme } from "../types";

export function TitleBar(props: {
  theme: Theme;
  bridge: BridgeState | null;
  wsOpen: boolean;
  onToggleWs: () => void;
  onToggleTheme: () => void;
}) {
  const runtime = props.bridge?.connected
    ? { label: "runtime ok", bad: false }
    : { label: "model only", bad: true };
  return (
    <div className="bar">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
      <button className="ws" onClick={props.onToggleWs}>
        general <span className="car">▾</span>
      </button>
      <span className="right">
        <button className="theme" onClick={props.onToggleTheme}>
          {props.theme === "light" ? "dark" : "light"}
        </button>
        <span className="stat">
          <b className={runtime.bad ? "bad" : ""}>●</b>&nbsp; {runtime.label}
        </span>
      </span>
      {props.wsOpen && <div className="scrim" onClick={props.onToggleWs} />}
      {props.wsOpen && (
        <div className="wspop">
          <div className="h">Workspaces</div>
          <div className="wsrow">
            <span className="n">general ✓</span>
            <span className="pin">pinned</span>
            <span className="m">master here</span>
          </div>
        </div>
      )}
    </div>
  );
}
