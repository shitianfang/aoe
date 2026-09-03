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
  /** The line under the name: what this agent was given to do. Falls back to
   *  its own self-tag ("heads down") only when there is no task to show. */
  tag: string;
  state: { cls: string; glyph: string; word: string };
  selectable: string | null; // child id when clickable
  draggable: boolean;
  /** A dimmed, inert sample row — never a real agent. */
  eg?: true;
}

/** A helper's task, collapsed to one line. `label` is the prompt master spawned
 *  it with, so it is the honest answer to "what is this one doing" — the flavor
 *  tag only ever stood in because nothing was reading this field. */
function taskLine(c: ChildInfo): string {
  const s = (c.label ?? "").replace(/\s+/g, " ").trim();
  return s === "" || s === (c.sessionName ?? "") ? "" : s;
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
      // What it was told to do beats how it feels about it. The runtime's own
      // working line still wins when it set one — that is the agent narrating
      // its current step, which is more specific than the task it started from.
      const head = props.helperWorking[c.id] || taskLine(c) || flavorTag(name, word);
      map.set(c.id, {
        key: c.id,
        label: name,
        avatar: <BotAvatar seed={name} />,
        tag: `${head}${doneAt}`,
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
      // Roster kids: another root's crew — a root with kids is an agent team.
      // A kid with a live session opens like a helper (view + message); one
      // without (recycled/inline) stays a read-only stub.
      (a.kids ?? []).forEach((k, i) => {
        // Stable identity when the session id exists; index only for stubs —
        // an index key would re-seat rows onto other agents as the crew churns.
        const key = `rk:${a.name}:${k.activeSessionId ?? i}`;
        kin[key] = `root:${a.name}`;
        const word = k.failed ? "failed" : k.state;
        map.set(key, {
          key,
          label: k.name,
          avatar: <BotAvatar seed={k.name} />,
          tag: flavorTag(k.name, word),
          state: statusIcon(word),
          selectable: k.activeSessionId ? `fk:${k.activeSessionId}` : null,
          draggable: false,
        });
      });
    });
    // Nothing has ever run here: show what a crew looks like rather than a
    // master on its own. Inert and dimmed, labelled as a sample below the
    // tree, and gone the instant a real helper exists — the same bargain the
    // Self-evolution column already makes with its one sample lesson. States
    // are mixed on purpose: the column's job is to answer "who is doing what,
    // and what is already finished", and one row per state shows all of it.
    if (props.children.length === 0 && props.claudeAgents.length === 0) {
      const crew: [string, string, string][] = [
        ["scout", "read the workspace and list what is here", "done"],
        ["drafter", "write the page structure into today.html", "done"],
        ["stylist", "restyle it and publish a version", "running"],
        ["checker", "compare the last two versions and report", "queued"],
      ];
      crew.forEach(([name, task, word], i) => {
        map.set(`eg:${i}`, {
          key: `eg:${i}`,
          label: name,
          avatar: <BotAvatar seed={name} />,
          tag: t(task),
          state: statusIcon(word === "queued" ? "idle" : word),
          selectable: null,
          draggable: false,
          eg: true,
        });
      });
    }
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

  /** A folded team row swaps its flavor tag for the crew's live numbers.
   *  Only states that exist get shown; an all-quiet crew keeps the flavor. */
  const foldSummary = (kids: Node[]): React.ReactNode | null => {
    const count = (w: string) => kids.filter((k) => k.state.word === w).length;
    const parts: React.ReactNode[] = [];
    const run = count("running");
    const need = count("needs you");
    const fail = count("failed");
    if (run > 0) parts.push(<span key="run">{t("{n} running", { n: run })}</span>);
    if (need > 0)
      parts.push(
        <span key="need" className="tagbad">
          {t("{n} need you", { n: need })}
        </span>,
      );
    if (fail > 0)
      parts.push(
        <span key="fail" className="tagbad">
          {t("{n} failed", { n: fail })}
        </span>,
      );
    if (parts.length === 0) return null;
    return parts.flatMap((p, i) => (i > 0 ? [" · ", p] : [p]));
  };

  const renderNode = (n: Node, depth: number): React.ReactNode => {
    const kids = childrenOf(n.key);
    const isFolded = kids.length > 0 && (folded[n.key] ?? n.key.startsWith("root:"));
    const summary = isFolded ? foldSummary(kids) : null;
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
          className={`a tree${selected ? " sel" : ""}${dropOn === n.key ? " droptgt" : ""}${n.eg ? " eg" : ""}`}
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
            if (n.eg) return; // a sample row stands for an agent; there is none to open
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
            {summary !== null ? (
              <span className="tag">{summary}</span>
            ) : (
              n.tag && <span className="tag">{n.tag}</span>
            )}
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
      {/* Says out loud that the crew above is a sample. It sits under the rows
          it labels, so the first thing read is the shape of a real team. */}
      {props.children.length === 0 && props.claudeAgents.length === 0 && (
        <div className="colnote">
          {t("example · real helpers replace this")}
          <br />
          {t("ask master for a team and they appear here, each with its task.")}
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
