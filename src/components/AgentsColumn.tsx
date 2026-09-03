import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentState, ChildInfo } from "../types";
import { chipGlyph, chipHue, helperName, statusWord } from "../helperDisplay";
import { bridgeCmd, bridgeUrl } from "../runtime/bridge";

const ACTIVE = new Set(["queued", "running", "done"]);

/** Other root sessions on this daemon (GET /bridge/agents) — read-only rows. */
interface RootAgent {
  name: string;
  state: "running" | "idle" | "inactive";
}

/** Display node: real family stays real; dragging only regroups the view. */
interface Node {
  key: string;
  label: string;
  chip: { cls: string; glyph: string };
  stateLabel: string;
  stateCls: string;
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
  selected: string | null;
  onSelect: (childId: string | null) => void;
  onWorkspaces: () => void;
}) {
  const groupKey = `agents-group:${props.workspace}`;
  const foldKey = `agents-fold:${props.workspace}`;
  const [showInactive, setShowInactive] = useState(false);
  const [others, setOthers] = useState<RootAgent[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [addErr, setAddErr] = useState<string | null>(null);
  /** view-only regrouping: node key -> parent node key */
  const [group, setGroup] = useState<Record<string, string>>(() => loadJson(groupKey, {}));
  const [folded, setFolded] = useState<Record<string, boolean>>(() => loadJson(foldKey, {}));
  const [dropOn, setDropOn] = useState<string | null>(null);

  useEffect(() => {
    setGroup(loadJson(groupKey, {}));
    setFolded(loadJson(foldKey, {}));
  }, [groupKey, foldKey]);

  const refreshOthers = useCallback(() => {
    fetch(bridgeUrl("/bridge/agents"))
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.agents)) setOthers(d.agents as RootAgent[]);
      })
      .catch(() => {
        /* bridge offline */
      });
  }, []);
  useEffect(refreshOthers, [refreshOthers]);

  const createAgent = async () => {
    const name = draft.trim().toLowerCase().replace(/\s+/g, "-");
    if (!name) return;
    setAddErr(null);
    try {
      await bridgeCmd("create_agent", name);
      setDraft("");
      setAdding(false);
      refreshOthers();
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : "create failed");
    }
  };

  /* ---- build display nodes ---- */
  const visibleChildren = props.children.filter((c) => ACTIVE.has(c.status) || showInactive);
  const inactiveCount = props.children.filter((c) => !ACTIVE.has(c.status)).length;

  const nodes = useMemo(() => {
    const map = new Map<string, Node>();
    map.set("master", {
      key: "master",
      label: "master",
      chip: { cls: "chip master", glyph: "" },
      stateLabel: props.master === "working" ? "running" : "idle",
      stateCls: props.master === "working" ? "st run" : "st",
      selectable: null,
      draggable: false, // the commander stays pinned
    });
    visibleChildren.forEach((c) => {
      const st = statusWord(c);
      map.set(c.id, {
        key: c.id,
        label: helperName(c),
        chip: { cls: `chip ${chipHue(props.children.indexOf(c))}`, glyph: chipGlyph(c) },
        stateLabel: st.label,
        stateCls: st.cls,
        selectable: c.id,
        draggable: true,
      });
    });
    others.forEach((a) => {
      map.set(`root:${a.name}`, {
        key: `root:${a.name}`,
        label: a.name,
        chip: { cls: "chip ghost", glyph: a.name.slice(0, 1).toUpperCase() },
        stateLabel: a.state,
        stateCls: a.state === "running" ? "st run" : "st",
        selectable: null,
        draggable: true,
      });
    });
    return map;
  }, [props.master, props.children, visibleChildren, others]);

  /** parent of a node in the displayed tree (grouping override, else real family). */
  const parentOf = useCallback(
    (key: string): string | null => {
      const g = group[key];
      if (g !== undefined) {
        if (g === "__top") return null;
        if (nodes.has(g)) return g; // stale targets fall through to the default
      }
      if (key === "master" || key.startsWith("root:")) return null;
      return "master"; // real family: helpers sit under master
    },
    [group, nodes],
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
        return k === "master" || k.startsWith("root:") ? null : "master";
      }
    },
    [group, nodes],
  );

  const drop = (childKey: string, parentKey: string | "__top") => {
    setDropOn(null);
    if (childKey === parentKey) return;
    if (parentKey !== "__top" && wouldCycle(childKey, parentKey)) return;
    const next = { ...group, [childKey]: parentKey };
    setGroup(next);
    saveJson(groupKey, next);
  };

  const toggleFold = (key: string) => {
    const next = { ...folded, [key]: !folded[key] };
    setFolded(next);
    saveJson(foldKey, next);
  };

  const childrenOf = (key: string): Node[] =>
    [...nodes.values()].filter((n) => n.key !== key && parentOf(n.key) === key);

  const renderNode = (n: Node, depth: number): React.ReactNode => {
    const kids = childrenOf(n.key);
    const isFolded = Boolean(folded[n.key]);
    const selected = n.selectable !== null ? props.selected === n.selectable : props.selected === null && n.key === "master";
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
            const key = e.dataTransfer.getData("text/agent-key");
            if (key) drop(key, n.key);
          }}
          onClick={() => {
            if (n.key === "master") props.onSelect(null);
            else if (n.selectable) props.onSelect(n.selectable);
          }}
          role="button"
          tabIndex={0}
        >
          {kids.length > 0 ? (
            <button
              className="fold"
              onClick={(e) => {
                e.stopPropagation();
                toggleFold(n.key);
              }}
            >
              {isFolded ? "▸" : "▾"}
            </button>
          ) : (
            <span className="fold none" />
          )}
          <span className={n.chip.cls}>{n.chip.glyph}</span>
          <span className="nm">{n.label}</span>
          <span className={n.stateCls}>{n.stateLabel}</span>
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
      <button className="wslabel" onClick={props.onWorkspaces}>
        {props.workspace} <span className="car">▾</span>
      </button>
      <div className="sec row">
        <span>Agents</span>
        <button className="plus" title="new agent" onClick={() => setAdding((v) => !v)}>
          +
        </button>
      </div>
      {adding && (
        <div className="wsnew" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
          <input
            autoFocus
            value={draft}
            placeholder="new agent name…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createAgent()}
          />
          {addErr && <div className="ierr">{addErr}</div>}
        </div>
      )}
      {roots.map((n) => renderNode(n, 0))}
      {props.children.length === 0 && others.length === 0 && (
        <div className="colnote">
          master runs this workspace.
          <br />
          helpers appear here when it starts them.
        </div>
      )}
      {inactiveCount > 0 && (
        <button className="more" onClick={() => setShowInactive((v) => !v)}>
          {inactiveCount} inactive · {showInactive ? "hide" : "show"}
        </button>
      )}
    </aside>
  );
}
