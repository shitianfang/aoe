import { useEffect, useState } from "react";
import type { AgentState, BridgeState, Theme } from "../types";
import { fetchWorkspaces, switchWorkspace, type WorkspaceInfo } from "../runtime/bridge";
import { LANGS, getLang, setLang, useT } from "../i18n";

/** Workspace switcher, anchored by the rail logo / column label. */
export function WorkspacePopup(props: {
  bridge: BridgeState | null;
  master: AgentState;
  needsYou: number;
  onClose: () => void;
}) {
  const t = useT();
  const workspace = props.bridge?.workspace || "general";
  const [list, setList] = useState<WorkspaceInfo[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchWorkspaces()
      .then((r) => setList(r.workspaces))
      .catch(() => setList([{ name: workspace, pinned: workspace === "general", state: "idle" }]));
  }, [workspace]);

  const go = async (name: string) => {
    if (busy || name === workspace) {
      props.onClose();
      return;
    }
    setBusy(true);
    try {
      await switchWorkspace(name);
      props.onClose();
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

  /* The showcase only renders on a master with nothing in its transcript, so
     "see what it can do" has to mean a workspace that has never run — in one
     you have already used, the cards are gone for good and there is no honest
     way to bring them back. Hence a NEW workspace every time: demo, demo-2,
     demo-3. Reusing one name would hand back a used master on the second
     click, which is exactly the state the cards do not survive. */
  const demo = () => {
    const taken = new Set((list ?? []).map((w) => w.name));
    let name = "demo";
    for (let n = 2; taken.has(name); n++) name = `demo-${n}`;
    void go(name);
  };

  const stateWord = (w: WorkspaceInfo) =>
    w.name === workspace
      ? `${t("master {state}", { state: t(props.master === "working" ? "running" : "idle") })}${
          props.needsYou > 0 ? ` · ${t("{n} needs you", { n: props.needsYou })}` : ""
        }`
      : w.state === "off"
        ? t("not open")
        : t("master {state}", { state: t(w.state) });

  return (
    <>
      <div className="scrim" onClick={props.onClose} />
      <div className="wspop">
        <div className="h">{t("Workspaces")}</div>
        {(list ?? []).map((w) => (
          <button className="wsrow" key={w.name} onClick={() => void go(w.name)} disabled={busy}>
            <span className="n">
              {w.name}
              {w.name === workspace ? " ✓" : ""}
            </span>
            {w.pinned && <span className="pin">{t("pinned")}</span>}
            <span className="m">{busy ? "…" : stateWord(w)}</span>
          </button>
        ))}
        {list === null && (
          <div className="wsrow">
            <span className="m">{t("loading…")}</span>
          </div>
        )}
        <div className="wsnew">
          <input
            value={draft}
            placeholder={t("new workspace…")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
        </div>
        {/* Bottom of the list on purpose: it is the way in for a new user, not
            a workspace you keep coming back to. */}
        <button className="wsrow demo" onClick={demo} disabled={busy || list === null}>
          <span className="n">{t("see what it can do")}</span>
          <span className="m">{t("a fresh workspace with examples")}</span>
        </button>
      </div>
    </>
  );
}

/** Settings, anchored by the rail avatar: language, theme + runtime status. */
export function SettingsPopup(props: {
  theme: Theme;
  bridge: BridgeState | null;
  onToggleTheme: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const lang = getLang();
  const runtime = props.bridge?.connected
    ? { label: t("runtime ok"), bad: false }
    : { label: t("model only"), bad: true };
  return (
    <>
      <div className="scrim" onClick={props.onClose} />
      <div className="setpop">
        <div className="h">{t("Settings")}</div>
        <div className="srow">
          <span className="k">{t("Language")}</span>
          <span className="seg">
            {LANGS.map((l) => (
              <button
                className={l.id === lang ? "btn on" : "btn"}
                key={l.id}
                onClick={() => setLang(l.id)}
              >
                {l.label}
              </button>
            ))}
          </span>
        </div>
        <div className="srow">
          <span className="k">{t("Theme")}</span>
          <button className="btn" onClick={props.onToggleTheme}>
            {props.theme === "light" ? t("dark") : t("light")}
          </button>
        </div>
        <div className="srow">
          <span className="k">{t("Runtime")}</span>
          <span className="stat">
            <b className={runtime.bad ? "bad" : ""}>●</b>&nbsp; {runtime.label}
          </span>
        </div>
      </div>
    </>
  );
}
