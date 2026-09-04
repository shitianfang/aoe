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
        title={t("Artifacts")}
        onClick={() => props.onColumn("files")}
      >
        {/* A web page: window frame, top bar, a stub of an address field.
            What lands in this column is almost always a page the client
            renders, so the icon says page rather than folder or artboard. */}
        <svg viewBox="0 0 24 24">
          <rect x="3" y="4" width="18" height="16" />
          <path d="M3 9h18M6 6.5h4" />
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
        {/* A four-pointed star: a specialty. The rail's other glyphs are all
            rectilinear, so the one shape that is not carries "what it is good
            at" without borrowing the plug (extensions) or the bolt
            (self-evolution). */}
        <svg viewBox="0 0 24 24">
          <path d="M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z" />
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
