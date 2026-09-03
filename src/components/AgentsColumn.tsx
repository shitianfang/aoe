import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentState, ChildInfo, ClaudeSubagent, RootAgent } from "../types";
import { flavorTag, helperName, hhmmEpoch, statusIcon, statusWord } from "../helperDisplay";
import { BotAvatar } from "./BotAvatar";
import { bridgeCmd } from "../runtime/bridge";
import { useLang, useT } from "../i18n";

const ACTIVE = new Set(["queued", "running", "done"]);

/** Display node: real family stays real; dragging only regroups the view. */
interface Node {
  key: string;
  label: string;
  avatar: React.ReactNode;
  /** The agent's own little self-tag ("heads down", "sulking in the lobby"). */
  tag: string;
  state: { cls: string; glyph: string; word: string };
  selectable: string | null; // child id when clickable
  draggable: boolean;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

export function AgentsColumn(props: {
  master: AgentState;
  workspace: string;
  children: ChildInfo[];
  /** Claude-path Task subagents — read-only cards under master (no session
   *  to select or message; they exist only while their turn runs). */
  claudeAgents: ClaudeSubagent[];
  /** Other root sessions (roster owned by App — shared with the composer popup). */
  others: RootAgent[];
  selected: string | null;
  selectedRoot: string | null;
  /** Live run state per attached root; overrides the roster word when known. */
  rootStates: Record<string, AgentState>;
  /** Runtime "what am I doing" lines — the agents' own self-tags. */
  working?: string;
  helperWorking: Record<string, string>;
  rootWorking: Record<string, string>;
  onSelect: (childId: string | null) => void;
  onSelectRoot: (name: string) => void;
  onRefreshOthers: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const groupKey = `agents-group:${props.workspace}`;
  const foldKey = `agents-fold:${props.workspace}`;
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [addErr, setAddErr] = useState<string | null>(null);
  /** view-only regrouping: node key -> parent node key */
  const [group, setGroup] = useState<Record<string, string>>(() => loadJson(groupKey, {}));
  const [folded, setFolded] = useState<Record<string, boolean>>(() => loadJson(foldKey, {}));
  const [dropOn, setDropOn] = useState<string | null>(null);
  const others = props.others;

  useEffect(() => {
    setGroup(loadJson(groupKey, {}));
    setFolded(loadJson(foldKey, {}));
  }, [groupKey, foldKey]);

  const createAgent = async () => {
    const name = draft.trim().toLowerCase().replace(/\s+/g, "-");
    if (!name) return;
    setAddErr(null);
    try {
      await bridgeCmd("create_agent", name);
      setDraft("");
      setAdding(false);
      props.onRefreshOthers();
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : t("create failed"));
    }
  };

  /* ---- build display nodes ---- */
  const visibleChildren = props.children.filter((c) => ACTIVE.has(c.status) || showInactive);
  const inactiveCount = props.children.filter((c) => !ACTIVE.has(c.status)).length;

  const { nodes, kin } = useMemo(() => {
    const map = new Map<string, Node>();
    /** Real family for roster kids: kid node key -> its root's node key. */
    const kin: Record<string, string> = {};
    const masterWord = props.master === "working" ? "running" : "idle";
    map.set("master", {
      key: "master",
      label: "master",
      avatar: <span className="chip master" />,
      tag: flavorTag("master", masterWord, props.working),
      state: statusIcon(masterWord),
      selectable: null,
      draggable: true, // draggable into a center pane; still pinned in this list
    });
    visibleChildren.forEach((c) => {
      const word = statusWord(c);
      const name = helperName(c);
      // Real finished time (schema 27) rides on terminal rows; running/queued
      // helpers and older daemons show the tag alone.
      const terminal = c.status === "done" || c.status === "error" || c.status === "cancelled";
      const doneAt = terminal && typeof c.completedAt === "number" ? ` · ${hhmmEpoch(c.completedAt)}` : "";
      map.set(c.id, {
        key: c.id,
        label: name,
        avatar: <BotAvatar seed={name} />,
        tag: `${flavorTag(name, word, props.helperWorking[c.id])}${doneAt}`,
        state: statusIcon(word),
        selectable: c.id,
        draggable: true,
      });
    });
    props.claudeAgents.forEach((a) => {
      map.set(`ca:${a.id}`, {
        key: `ca:${a.id}`,
        label: a.label,
        avatar: <BotAvatar seed={a.label} />,
        tag: a.status === "done" ? t("ran inline, not reachable") : "",
        state: statusIcon(a.status === "running" ? "running" : "done"),
        selectable: null,
        draggable: false,
      });
    });
    others.forEach((a) => {
      // Live event stream is truth once attached; the roster word otherwise.
      const live = props.rootStates[a.name];
      const word = live !== undefined ? (live === "working" ? "running" : "idle") : a.state;
      map.set(`root:${a.name}`, {
        key: `root:${a.name}`,
        label: a.name,
        avatar: <BotAvatar seed={a.name} />,
        tag: flavorTag(a.name, word, props.rootWorking[a.name]),
        state: statusIcon(word),
        selectable: null,
        draggable: true,
      });
      // Roster kids: another root's sub-agents, read-only rows (no session of
      // ours to select or message) — a root with kids is an agent team.
      (a.kids ?? []).forEach((k, i) => {
        const key = `rk:${a.name}:${i}`;
        kin[key] = `root:${a.name}`;
        map.set(key, {
          key,
          label: k.name,
          avatar: <BotAvatar seed={k.name} />,
          tag: flavorTag(k.name, k.state),
          state: statusIcon(k.state),
          selectable: null,
          draggable: false,
        });
      });
    });
    return { nodes: map, kin };
  }, [
    props.master,
    props.children,
    props.claudeAgents,
    visibleChildren,
    others,
    props.rootStates,
    props.working,
    props.helperWorking,
    props.rootWorking,
    lang,
  ]);

  /** parent of a node in the displayed tree (grouping override, else real family). */
  const parentOf = useCallback(
    (key: string): string | null => {
      const g = group[key];
      if (g !== undefined) {
        if (g === "__top") return null;
        if (nodes.has(g)) return g; // stale targets fall through to the default
      }
      if (kin[key] !== undefined) return kin[key]; // roster kid under its root
      if (key === "master" || key.startsWith("root:")) return null;
      return "master"; // real family: helpers sit under master
    },
    [group, nodes, kin],
  );

  /** would `child under parent` loop? */
  const wouldCycle = useCallback(
    (child: string, parent: string): boolean => {
      let cur: string | null = parent;
      for (let i = 0; cur !== null && i < 20; i++) {
        if (cur === child) return true;
        cur = cur === parent && i > 0 ? null : parentOfWith(cur);
      }
      return false;
      function parentOfWith(k: string): string | null {
        const g = group[k];
        if (g !== undefined) return g === "__top" ? null : nodes.has(g) ? g : realParent(k);
        return realParent(k);
      }
      function realParent(k: string): string | null {
        if (kin[k] !== undefined) return kin[k];
        return k === "master" || k.startsWith("root:") ? null : "master";
      }
    },
    [group, nodes, kin],
  );

  const drop = (childKey: string, parentKey: string | "__top") => {
    setDropOn(null);
    if (childKey === "master") return; // the commander stays pinned in this list
    if (parentKey.startsWith("rk:")) return; // read-only roster kids take no drops
    if (childKey === parentKey) return;
    if (parentKey !== "__top" && wouldCycle(childKey, parentKey)) return;
    const next = { ...group, [childKey]: parentKey };
    setGroup(next);
    saveJson(groupKey, next);
  };

  /** Root teams start folded (one row, no matter the crew size); master stays
   *  open — it is the workspace's own context. Toggles persist per workspace. */
  const toggleFold = (key: string, current: boolean) => {
    const next = { ...folded, [key]: !current };
    setFolded(next);
    saveJson(foldKey, next);
  };

  const childrenOf = (key: string): Node[] =>
    [...nodes.values()].filter((n) => n.key !== key && parentOf(n.key) === key);

  const renderNode = (n: Node, depth: number): React.ReactNode => {
    const kids = childrenOf(n.key);
    const isFolded = kids.length > 0 && (folded[n.key] ?? n.key.startsWith("root:"));
    const rootName = n.key.startsWith("root:") ? n.key.slice(5) : null;
    const selected =
      rootName !== null
        ? props.selectedRoot === rootName
        : n.selectable !== null
          ? props.selected === n.selectable
          : props.selected === null && props.selectedRoot === null && n.key === "master";
    return (
      <div key={n.key}>
        <div
          className={`a tree${selected ? " sel" : ""}${dropOn === n.key ? " droptgt" : ""}`}
          style={{ marginLeft: depth * 14, width: `calc(100% - ${depth * 14}px)` }}
          draggable={n.draggable}
          onDragStart={(e) => e.dataTransfer.setData("text/agent-key", n.key)}
          onDragOver={(e) => {
            e.preventDefault();
            setDropOn(n.key);
          }}
          onDragLeave={() => setDropOn((d) => (d === n.key ? null : d))}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation(); // the aside's own onDrop would regroup to __top otherwise
            const key = e.dataTransfer.getData("text/agent-key");
            if (key) drop(key, n.key);
          }}
          onClick={() => {
            if (rootName !== null) props.onSelectRoot(rootName);
            else if (n.key === "master") props.onSelect(null);
            else if (n.selectable) props.onSelect(n.selectable);
          }}
          role="button"
          tabIndex={0}
        >
          {n.avatar}
          <span className="nmw">
            <span className="nmr">
              <span className="nm">{n.label}</span>
              {kids.length > 0 && (
                <button
                  className="fold"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFold(n.key, isFolded);
                  }}
                >
                  {isFolded ? `▸ ${kids.length}` : "▾"}
                </button>
              )}
            </span>
            {n.tag && <span className="tag">{n.tag}</span>}
          </span>
          <span className={n.state.cls} title={t(n.state.word)}>
            {n.state.glyph}
          </span>
        </div>
        {!isFolded && kids.map((k) => renderNode(k, Math.min(depth + 1, 3)))}
      </div>
    );
  };

  const roots = [...nodes.values()].filter((n) => parentOf(n.key) === null);
  // master first, then grouped order as-is
  roots.sort((a, b) => (a.key === "master" ? -1 : b.key === "master" ? 1 : a.label.localeCompare(b.label)));

  return (
    <aside
      className="col2"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const key = e.dataTransfer.getData("text/agent-key");
        if (key) drop(key, "__top");
      }}
    >
      <div className="sec row">
        <span>{t("Agents")}</span>
        <button className="plus" title={t("new agent")} onClick={() => setAdding((v) => !v)}>
          +
        </button>
      </div>
      {adding && (
        <div className="wsnew" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
          <input
            autoFocus
            value={draft}
            placeholder={t("new agent name…")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createAgent()}
          />
          {addErr && <div className="ierr">{addErr}</div>}
        </div>
      )}
      {roots.map((n) => renderNode(n, 0))}
      {props.children.length === 0 && others.length === 0 && props.claudeAgents.length === 0 && (
        <div className="colnote">
          {t("master runs this workspace.")}
          <br />
          {t("helpers appear here when it starts them.")}
          <br />
          {t("e.g. ask master for a small team — one helper to research, one to draft.")}
        </div>
      )}
      {inactiveCount > 0 && (
        <button className="more" onClick={() => setShowInactive((v) => !v)}>
          {t("{n} inactive", { n: inactiveCount })} · {showInactive ? t("hide") : t("show")}
        </button>
      )}
    </aside>
  );
}
