import { useEffect, useState } from "react";
import type { AgentState, BridgeState, Theme } from "../types";
import { fetchWorkspaces, switchWorkspace, type WorkspaceInfo } from "../runtime/bridge";

export function TitleBar(props: {
  theme: Theme;
  bridge: BridgeState | null;
  master: AgentState;
  needsYou: number;
  wsOpen: boolean;
  onToggleWs: () => void;
  onToggleTheme: () => void;
}) {
  const runtime = props.bridge?.connected
    ? { label: "runtime ok", bad: false }
    : { label: "model only", bad: true };
  const workspace = props.bridge?.workspace || "general";

  const [list, setList] = useState<WorkspaceInfo[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!props.wsOpen) return;
    setList(null);
    fetchWorkspaces()
      .then((r) => setList(r.workspaces))
      .catch(() => setList([{ name: workspace, pinned: workspace === "general", state: "idle" }]));
  }, [props.wsOpen, workspace]);

  const go = async (name: string) => {
    if (busy || name === workspace) {
      props.onToggleWs();
      return;
    }
    setBusy(true);
    try {
      await switchWorkspace(name);
      props.onToggleWs();
    } catch {
      /* bridge reports state via hello; leave the popup open */
    } finally {
      setBusy(false);
    }
  };

  const create = () => {
    const name = draft.trim().toLowerCase().replace(/\s+/g, "-");
    if (!name) return;
    setDraft("");
    void go(name);
  };

  const stateWord = (w: WorkspaceInfo) =>
    w.name === workspace
      ? `master ${props.master === "working" ? "running" : "idle"}${props.needsYou > 0 ? ` · ${props.needsYou} needs you` : ""}`
      : w.state === "off"
        ? "not open"
        : `master ${w.state}`;

  return (
    <div className="bar">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
      <button className="ws" onClick={props.onToggleWs}>
        {workspace} <span className="car">▾</span>
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
          {(list ?? []).map((w) => (
            <button className="wsrow" key={w.name} onClick={() => void go(w.name)} disabled={busy}>
              <span className="n">
                {w.name}
                {w.name === workspace ? " ✓" : ""}
              </span>
              {w.pinned && <span className="pin">pinned</span>}
              <span className="m">{busy ? "…" : stateWord(w)}</span>
            </button>
          ))}
          {list === null && <div className="wsrow"><span className="m">loading…</span></div>}
          <div className="wsnew">
            <input
              value={draft}
              placeholder="new workspace…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
