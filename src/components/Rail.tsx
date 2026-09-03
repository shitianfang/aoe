import type { BridgeState, ColumnView } from "../types";
import { useT } from "../i18n";

export function Rail(props: {
  column: ColumnView;
  workspace: string;
  bridge: BridgeState | null;
  /** The Learned column is the one open. */
  learnedOn: boolean;
  /** Lessons landed since the Learned column was last opened. */
  learnedUnread: boolean;
  onColumn: (v: ColumnView) => void;
  onLearned: () => void;
  onLogo: () => void;
  onSettings: () => void;
}) {
  const t = useT();
  return (
    <nav className="rail">
      <button className="logo" title={t("{ws} · switch workspace", { ws: props.workspace })} onClick={props.onLogo}>
        {props.workspace.slice(0, 1).toUpperCase()}
      </button>
      <button
        className={props.column === "agents" ? "rbtn on" : "rbtn"}
        title={t("Agents")}
        onClick={() => props.onColumn("agents")}
      >
        <svg viewBox="0 0 24 24">
          <rect x="8" y="4" width="8" height="7" />
          <path d="M5 20v-2c0-2.2 3.1-4 7-4s7 1.8 7 4v2" />
        </svg>
      </button>
      <button
        className={props.column === "files" ? "rbtn on" : "rbtn"}
        title={t("Files")}
        onClick={() => props.onColumn("files")}
      >
        <svg viewBox="0 0 24 24">
          <path d="M4 6h6l2 2h8v11H4Z" />
        </svg>
      </button>
      <button
        className={props.learnedOn ? "rbtn on" : "rbtn"}
        title={props.learnedUnread ? `${t("Self-evolution")} · ${t("something new")}` : t("Self-evolution")}
        onClick={props.onLearned}
      >
        <svg viewBox="0 0 24 24">
          <path d="M13 3 5 14h5l-1 7 8-11h-5l1-7Z" />
        </svg>
        {props.learnedUnread && <span className="ldot" />}
      </button>
      <button
        className={props.column === "skills" ? "rbtn on" : "rbtn"}
        title={t("Skills")}
        onClick={() => props.onColumn("skills")}
      >
        <svg viewBox="0 0 24 24">
          <rect x="7" y="7" width="10" height="10" transform="rotate(45 12 12)" />
        </svg>
      </button>
      <button
        className={props.column === "extensions" ? "rbtn on" : "rbtn"}
        title={t("Extensions")}
        onClick={() => props.onColumn("extensions")}
      >
        <svg viewBox="0 0 24 24">
          <rect x="4" y="4" width="7" height="7" />
          <rect x="13" y="4" width="7" height="7" />
          <rect x="4" y="13" width="7" height="7" />
          <rect x="13" y="13" width="7" height="7" />
        </svg>
      </button>
      <div className="sp" />
      <button className="uav" title={t("you · settings")} onClick={props.onSettings}>
        Y<span className={props.bridge?.connected ? "udot" : "udot bad"} />
      </button>
    </nav>
  );
}
