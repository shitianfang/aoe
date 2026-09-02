import type { Theme } from "../types";

export function TitleBar(props: { theme: Theme; onToggleTheme: () => void }) {
  return (
    <div className="bar">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
      <span className="ws" title="workspace">
        general <span className="car">▾</span>
      </span>
      <span className="right">
        <button className="theme" onClick={props.onToggleTheme}>
          {props.theme === "light" ? "dark" : "light"}
        </button>
        <span className="stat">
          <b>●</b>&nbsp; runtime ok
        </span>
      </span>
    </div>
  );
}
