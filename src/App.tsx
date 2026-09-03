import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentState,
  AppState,
  AutoRefineInfo,
  AutonomousInfo,
  ChildInfo,
  ColumnView,
  ComposerTarget,
  FileActivity,
  GoalInfo,
  HeartbeatInfo,
  HelperEvent,
  HelperToolRow,
  HistoryMessage,
  LessonResult,
  PaneView,
  RootAgent,
  Theme,
  TimelineItem,
} from "./types";
import { SettingsPopup, WorkspacePopup } from "./components/Overlays";
import { Rail } from "./components/Rail";
import { AgentsColumn } from "./components/AgentsColumn";
import { BotAvatar } from "./components/BotAvatar";
import { ExtensionsColumn, SkillsColumn } from "./components/CatalogColumn";
import { helperName, injectionReasonText } from "./helperDisplay";
import { FilesColumn } from "./components/FilesColumn";
import { LearnedColumn } from "./components/LearnedColumn";
import { Timeline } from "./components/Timeline";
import { LearnedView } from "./components/LearnedView";
import { PreviewView } from "./components/PreviewView";
import { HelperView } from "./components/HelperView";
import { Composer } from "./components/Composer";
import { Inspector } from "./components/Inspector";
import { runMasterTurn, clock } from "./runtime/master";
import {
  openBridge,
  bridgeCmd,
  steer,
  sendAgentMessage,
  stopHelper,
  removeHelper,
  extractText,
  bridgeUrl,
  fetchAutonomous,
  fetchRootStatus,
  type BridgeMessage,
} from "./runtime/bridge";
import { fetchPreviewFiles } from "./runtime/preview";
import { fetchLessons } from "./runtime/learned";
import { withLongRun } from "./runtime/longrun";
import type { ChatMessage } from "./runtime/nim";
import type { LearnedSel } from "./types";
import { t as tr, useT } from "./i18n";

let nextId = 1;
const id = () => `t${nextId++}`;

/** The row that records a long-running send. The preamble itself is not shown
 *  — what matters is that the ask was made; what it produced shows up as the
 *  real goal / check-in / unattended state in DRIVERS moments later. */
const longRunNote = (): TimelineItem => ({
  kind: "note",
  id: id(),
  text: tr("long-running · asked it to set up its own driver"),
  rt: clock(),
  ts: Date.now(),
});

function filePathFromArgs(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const a = args as { path?: unknown; file_path?: unknown };
  const p = typeof a.path === "string" ? a.path : typeof a.file_path === "string" ? a.file_path : null;
  return p && p.length > 0 ? p : null;
}

/** Tool-row label: the file name when the args carry a path, else the first
 *  line of code (ipython) — enough to see what actually ran. */
function toolLabel(toolName: string, args: unknown): string {
  const path = filePathFromArgs(args);
  if (path) return `${toolName} · ${path.split(/[\\/]/).pop()}`;
  const code = (args as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code.trim()) {
    return `${toolName} · ${code.trim().split("\n")[0].slice(0, 60)}`;
  }
  return toolName;
}

function upsertFile(files: FileActivity[], path: string, who: string): FileActivity[] {
  const name = path.split(/[\\/]/).pop() ?? path;
  const row: FileActivity = { path, name, who, at: clock() };
  return [row, ...files.filter((f) => f.path !== path)];
}

/* ---- center split layout helpers ----
 * The canonical fields (view/selectedAgent/selectedRoot) describe the FOCUSED
 * pane; split.other is the second pane. See SplitState in types.ts. */

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

/** The focused pane's content, mirroring center()'s render precedence
 *  (learned/preview sit on top of a lingering agent selection). */
function currentPane(s: AppState): PaneView {
  if (s.view === "empty") return { kind: "empty" };
  if (s.view === "learned") return { kind: "learned" };
  if (s.view === "preview") return { kind: "preview" };
  if (s.selectedAgent && s.children.some((c) => c.id === s.selectedAgent))
    return { kind: "helper", childId: s.selectedAgent };
  if (s.selectedRoot) return { kind: "root", name: s.selectedRoot };
  return { kind: "timeline" };
}

/** State patch that makes `p` the focused pane's content. learned/preview keep
 *  the agent selection underneath, exactly like the plain setView did. */
function panePatch(p: PaneView): Partial<AppState> {
  if (p.kind === "empty") return { view: "empty", selectedAgent: null, selectedRoot: null };
  if (p.kind === "learned") return { view: "learned" };
  if (p.kind === "preview") return { view: "preview" };
  if (p.kind === "helper") return { view: "timeline", selectedAgent: p.childId, selectedRoot: null };
  if (p.kind === "root") return { view: "timeline", selectedAgent: null, selectedRoot: p.name };
  return { view: "timeline", selectedAgent: null, selectedRoot: null };
}

function sameView(a: PaneView, b: PaneView): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "helper" && b.kind === "helper") return a.childId === b.childId;
  if (a.kind === "root" && b.kind === "root") return a.name === b.name;
  return true;
}

/* ---- tab groups ----
 * Each pane holds a LIST of open tabs (tabsL/tabsR); the visible one is the
 * pane's active tab. The focused pane's active tab is the canonical fields,
 * the other pane's is split.other — so watches/composer stay unchanged. */

type Side = "left" | "right";
const sideKey = (sd: Side) => (sd === "left" ? "tabsL" : "tabsR") as "tabsL" | "tabsR";
const tabsOf = (s: AppState, sd: Side): PaneView[] => (sd === "left" ? s.tabsL : s.tabsR);
const focusSideOf = (s: AppState): Side => s.split?.focusSide ?? "left";
const inList = (list: PaneView[], v: PaneView) => list.some((t) => sameView(t, v));
const addTab = (list: PaneView[], v: PaneView) => (inList(list, v) ? list : [...list, v]);

/** The view a pane currently shows (null: no second pane). */
function activeOf(s: AppState, sd: Side): PaneView | null {
  if (!s.split) return sd === "left" ? currentPane(s) : null;
  return sd === s.split.focusSide ? currentPane(s) : s.split.other;
}

/** Activate one of a pane's open tabs; focus moves to that pane. */
function activateTab(s: AppState, sd: Side, v: PaneView): AppState {
  if (!inList(tabsOf(s, sd), v)) return s;
  if (!s.split || sd === s.split.focusSide) return { ...s, ...panePatch(v) };
  return { ...s, ...panePatch(v), split: { other: currentPane(s), focusSide: sd } };
}

/** Open `v` in pane `sd` as its active tab, focused; dropping on the right
 *  half of a single pane opens the split. */
function openIn(s: AppState, sd: Side, v: PaneView): AppState {
  if (!s.split) {
    const cur = currentPane(s);
    if (sd === "right" && cur.kind !== "empty" && !sameView(cur, v)) {
      return { ...s, ...panePatch(v), tabsR: addTab(s.tabsR, v), split: { other: cur, focusSide: "right" } };
    }
    return { ...s, ...panePatch(v), tabsL: addTab(s.tabsL, v) };
  }
  const patch = { [sideKey(sd)]: addTab(tabsOf(s, sd), v) };
  if (sd === s.split.focusSide) return { ...s, ...panePatch(v), ...patch };
  return { ...s, ...panePatch(v), ...patch, split: { other: currentPane(s), focusSide: sd } };
}

/** Remove `v` from pane `sd`'s tab list; a removed active tab hands the pane
 *  to its neighbor, an emptied pane collapses (split: the other pane stays;
 *  single: the empty state). */
function removeTab(s: AppState, sd: Side, v: PaneView): AppState {
  const list = tabsOf(s, sd);
  const idx = list.findIndex((t) => sameView(t, v));
  if (idx < 0) return s;
  const next = list.filter((t) => !sameView(t, v));
  const act = activeOf(s, sd);
  const base = { ...s, [sideKey(sd)]: next } as AppState;
  if (!act || !sameView(act, v)) return base;
  if (next.length > 0) {
    const nv = next[Math.min(idx, next.length - 1)];
    if (!s.split || sd === s.split.focusSide) return { ...base, ...panePatch(nv) };
    return { ...base, split: { ...s.split, other: nv } };
  }
  if (!s.split) return { ...base, ...panePatch({ kind: "empty" }) };
  const survTabs = sd === "left" ? base.tabsR : base.tabsL;
  const survActive = sd === s.split.focusSide ? s.split.other : currentPane(s);
  return { ...base, ...panePatch(survActive), split: null, tabsL: survTabs, tabsR: [] };
}

/** A tab (or an agent row) dragged onto a pane: move it there and activate. */
function moveTab(s: AppState, v: PaneView, sd: Side): AppState {
  const src: Side | null = inList(s.tabsL, v) ? "left" : inList(s.tabsR, v) ? "right" : null;
  if (src === sd) return activateTab(s, sd, v);
  const removed = src ? removeTab(s, src, v) : s;
  return openIn(removed, sd, v);
}

/** Auto-pop (preview / learned): show `v` in the pane the user is NOT in,
 *  without stealing focus; no-op when it is already visible somewhere. */
function popPane(s: AppState, v: PaneView): AppState {
  if (sameView(currentPane(s), v) || (s.split && sameView(s.split.other, v))) return s;
  if (!s.split) {
    if (currentPane(s).kind === "empty") return openIn(s, "left", v);
    return { ...s, tabsR: addTab(s.tabsR, v), split: { other: v, focusSide: "left" } };
  }
  const os: Side = s.split.focusSide === "left" ? "right" : "left";
  return { ...s, [sideKey(os)]: addTab(tabsOf(s, os), v), split: { ...s.split, other: v } } as AppState;
}

/** Show `v` in the focused pane. If the OTHER pane already holds that tab,
 *  don't duplicate — activate it there (focus follows). */
function showFocused(s: AppState, v: PaneView): AppState {
  const os: Side = focusSideOf(s) === "left" ? "right" : "left";
  if (s.split && inList(tabsOf(s, os), v)) return activateTab(s, os, v);
  return openIn(s, focusSideOf(s), v);
}

/** Drop tabs whose helper/root vanished from a fresh roster (flags say which
 *  roster is fresh); removeTab fixes actives and collapses emptied panes. */
function reconcileSplit(s: AppState, fresh: { children?: boolean; roots?: boolean } = {}): AppState {
  const stale = (v: PaneView) =>
    (fresh.children === true && v.kind === "helper" && !s.children.some((c) => c.id === v.childId)) ||
    (fresh.roots === true && v.kind === "root" && !s.others.some((a) => a.name === v.name));
  let out = s;
  for (let guard = 0; guard < 40; guard++) {
    const hitL = tabsOf(out, "left").find(stale);
    const hitR = hitL ? undefined : tabsOf(out, "right").find(stale);
    if (!hitL && !hitR) break;
    out = removeTab(out, hitL ? "left" : "right", (hitL ?? hitR) as PaneView);
  }
  return out;
}

/** Persisted-layout shape guard (localStorage may hold anything). */
function sanePane(p: unknown): PaneView | null {
  if (!p || typeof p !== "object") return null;
  const v = p as { kind?: unknown; childId?: unknown; name?: unknown };
  if (v.kind === "timeline" || v.kind === "learned" || v.kind === "preview" || v.kind === "empty")
    return { kind: v.kind };
  if (v.kind === "helper" && typeof v.childId === "string") return { kind: "helper", childId: v.childId };
  if (v.kind === "root" && typeof v.name === "string") return { kind: "root", name: v.name };
  return null;
}

/** Restore a saved tab layout (per-workspace key). Stale helper/root tabs
 *  are tolerated here and reconciled once the real rosters arrive. */
function restoreSplit(key: string): Partial<AppState> {
  const raw = loadJson<{
    tabsL?: unknown[];
    tabsR?: unknown[];
    activeL?: unknown;
    activeR?: unknown;
    focus?: unknown;
  } | null>(key, null);
  const tl = (Array.isArray(raw?.tabsL) ? raw.tabsL : [])
    .map(sanePane)
    .filter((x): x is PaneView => x !== null && x.kind !== "empty");
  const tr = (Array.isArray(raw?.tabsR) ? raw.tabsR : [])
    .map(sanePane)
    .filter((x): x is PaneView => x !== null && x.kind !== "empty");
  if (tl.length === 0) return {};
  const aL0 = sanePane(raw?.activeL);
  const aL = aL0 && inList(tl, aL0) ? aL0 : tl[0];
  if (tr.length === 0) return { ...panePatch(aL), tabsL: tl, tabsR: [], split: null };
  const aR0 = sanePane(raw?.activeR);
  const aR = aR0 && inList(tr, aR0) ? aR0 : tr[0];
  const focusSide = raw?.focus === "right" ? ("right" as const) : ("left" as const);
  const focused = focusSide === "left" ? aL : aR;
  const other = focusSide === "left" ? aR : aL;
  return { ...panePatch(focused), tabsL: tl, tabsR: tr, split: { other, focusSide } };
}

function hhmm(at?: number): string {
  if (at === undefined) return "";
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Rules (dashed dividers) mark only long silences, not every event. */
const GAP_MS = 30 * 60 * 1000;

/** Snapshot history → timeline rows: user/assistant as normal rows (never
 *  streaming), agent messages as quiet note chips, dividers only on gaps. */
function historyToItems(messages: HistoryMessage[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  let last: number | undefined;
  for (const m of messages) {
    if (m.at !== undefined) {
      if (last !== undefined && m.at - last > GAP_MS) {
        out.push({ kind: "divider", id: id(), text: hhmm(m.at) });
      }
      last = m.at;
    }
    if (m.role === "user") out.push({ kind: "user", id: id(), text: m.text, at: hhmm(m.at) });
    else if (m.role === "assistant") {
      // Tool-only turns replay as empty assistant messages — skip them, an
      // avatar with no words is just a hole in the rhythm.
      if (m.text.trim() !== "") out.push({ kind: "master", id: id(), text: m.text, at: hhmm(m.at) });
    }
    else if (m.text.trim() !== "") {
      // Another agent's message into this conversation — a real message row.
      out.push({ kind: "agent", id: id(), from: m.from ?? "agent", text: m.text, at: hhmm(m.at) });
    } else {
      out.push({
        kind: "note",
        id: id(),
        text: tr("msg ← {from}", { from: m.from ?? "agent" }),
        rt: hhmm(m.at),
      });
    }
  }
  return out;
}

/** Long histories open on the recent tail; the rest folds into one divider. */
const HISTORY_OPEN = 30;
function foldHistory(items: TimelineItem[]): TimelineItem[] {
  if (items.length <= HISTORY_OPEN) return items;
  const older = items.slice(0, items.length - HISTORY_OPEN);
  return [
    { kind: "collapsed", id: id(), count: older.length, items: older },
    ...items.slice(-HISTORY_OPEN),
  ];
}

/** Append the helper events implied by a child snapshot transition.
 *  answerPreview streams token-by-token, so reply text is never taken from it —
 *  the actual reply arrives as an agent_message custom. */
function childTransitionEvents(prev: ChildInfo | undefined, next: ChildInfo): HelperEvent[] {
  const out: HelperEvent[] = [];
  if (!prev) {
    out.push({ id: id(), tone: "", text: tr("started by master"), rt: clock() });
  }
  if (prev && !prev.repliedSinceTask && next.repliedSinceTask) {
    out.push({ id: id(), tone: "good", text: tr("replied"), rt: clock() });
  }
  if (prev && prev.status !== next.status) {
    if (next.status === "done" && !next.repliedSinceTask) {
      out.push({ id: id(), tone: "bad", text: tr("finished without replying"), rt: clock() });
    } else if (next.status === "done") {
      out.push({ id: id(), tone: "", text: tr("finished"), rt: clock() });
    } else if (next.status === "error") {
      out.push({
        id: id(),
        tone: "bad",
        text: next.error ? tr("failed · {error}", { error: next.error }) : tr("failed"),
        rt: clock(),
      });
    } else if (next.status === "cancelled") {
      out.push({ id: id(), tone: "", text: tr("stopped"), rt: clock() });
    }
  }
  return out;
}

export function App() {
  const [state, setState] = useState<AppState>(() => ({
    theme: (document.documentElement.dataset.theme as Theme) ?? "light",
    master: "idle",
    view: "timeline",
    column: "agents",
    selectedAgent: null,
    selectedRoot: null,
    split: null,
    tabsL: [{ kind: "timeline" }],
    tabsR: [],
    others: [],
    rootTimelines: {},
    rootLoad: {},
    rootStates: {},
    rootWorking: {},
    rootGoals: {},
    rootAutonomous: {},
    autoRefine: null,
    rootAutoRefine: {},
    bridge: null,
    goal: null,
    children: [],
    claudeAgents: [],
    helperEvents: {},
    helperTranscripts: {},
    helperWorking: {},
    files: [],
    previewFiles: [],
    previewPath: null,
    heartbeats: [],
    autonomous: null,
    target: { kind: "master" },
    longRun: false,
    timeline: [{ kind: "divider", id: id(), text: tr("session started · {at}", { at: clock() }) }],
  }));
  const tt = useT();
  const [wsOpen, setWsOpen] = useState(false);
  // Learned: the lesson the ⚡ column selected (detail in the center pane),
  // a counter bumped per kept lesson so column + pane re-pull, and whether
  // lessons landed since the column was last opened (rail dot).
  const [learnedSel, setLearnedSel] = useState<LearnedSel | null>(null);
  const [lessonEpoch, setLessonEpoch] = useState(0);
  const [learnedUnread, setLearnedUnread] = useState(false);
  // Split width: the left pane's share [0.2, 0.8], persisted per workspace.
  const ratioKey = `pane-ratio:${state.bridge?.workspace || "general"}`;
  const [paneRatio, setPaneRatio] = useState(0.5);
  useEffect(() => {
    setPaneRatio(loadJson(ratioKey, 0.5));
  }, [ratioKey]);
  // Bumped when the bridge-pulled rows the inspector owns (scheduled
  // re-entries) may have moved: attach, heartbeats_changed.
  const [inspectorKey, setInspectorKey] = useState(0);
  // send() reads fresh state without re-binding the callback per keystroke.
  const stateRef = useRef(state);
  stateRef.current = state;
  const historyRef = useRef<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  // Streaming assistant row fed by daemon message events, keyed by message id when present.
  const daemonMsgRef = useRef<{ itemId: string; key: unknown } | null>(null);
  // One turn can push ~90 message_update events — coalesce them to ~50ms flushes.
  const pendingRef = useRef<{ itemId: string; text: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  // Per-root equivalents of the two refs above, keyed by root session name.
  const rootMsgRef = useRef<Record<string, { itemId: string; key: unknown }>>({});
  const rootPendingRef = useRef<
    Record<string, { itemId: string; text: string; timer: ReturnType<typeof setTimeout> }>
  >({});
  const bridgeRef = useRef(false);
  // Snapshots repeat on bridge reconnect (same workspace) — seed history once.
  const histSeededRef = useRef(false);
  // Paths declared via preview_published this turn (event path/source, may be
  // absolute). Dedupes the inferred file_activity fallback against the
  // declared source within one turn window; cleared at agent_end.
  const declaredRef = useRef<Set<string>>(new Set());
  // Declared path waiting to be selected once the preview list re-pull lands.
  const pendingPreviewRef = useRef<string | null>(null);
  // Last live timeline append; long silences get one dashed time rule.
  const lastAtRef = useRef(Date.now());
  // Last unattended injection already rendered as a timeline line (its `at`),
  // so a status refresh never repeats the line for the same continuation.
  const lastInjectionSeenRef = useRef<number | undefined>(undefined);
  const [setOpen, setSetOpen] = useState(false);
  // The tab being dragged (drag data is unreadable during dragover) + the
  // half of the center that would be taken on drop.
  const dragViewRef = useRef<PaneView | null>(null);
  const [dropHint, setDropHint] = useState<"left" | "right" | null>(null);
  // Per-workspace persistence key for the split layout; set at hello so the
  // save effect never writes before the restore ran.
  const splitKeyRef = useRef<string | null>(null);

  const toggleTheme = useCallback(() => {
    setState((s) => {
      const theme: Theme = s.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = theme;
      try {
        localStorage.setItem("theme", theme);
      } catch {
        /* private mode */
      }
      return { ...s, theme };
    });
  }, []);

  /** Re-pull the other-roots roster; a root gone from it falls back to master
   *  (honest empty state — no invented rows, no stale selection or target). */
  const refreshOthers = useCallback(async () => {
    try {
      const r = await fetch(bridgeUrl("/bridge/agents")).then((x) => x.json());
      const others: RootAgent[] = Array.isArray(r.agents) ? (r.agents as RootAgent[]) : [];
      setState((s) => {
        const has = (n: string | null) => n !== null && others.some((a) => a.name === n);
        return reconcileSplit(
          {
            ...s,
            others,
            selectedRoot: has(s.selectedRoot) ? s.selectedRoot : null,
            target: s.target.kind === "root" && !has(s.target.name) ? { kind: "master" } : s.target,
          },
          { roots: true },
        );
      });
    } catch {
      /* bridge offline */
    }
  }, []);
  useEffect(() => {
    const t = setInterval(refreshOthers, 30_000);
    return () => clearInterval(t);
  }, [refreshOthers]);

  /** Re-pull one root's status blocks (goal/unattended) from its connection
   *  state — read-only, no transcript write. Used when the Inspector binds to
   *  a root: on select, on bridge signals, and after its own writes. */
  const refreshRootStatus = useCallback((name: string) => {
    fetchRootStatus(name)
      .then((d) => {
        if (!d.attached) return; // not watched yet — the snapshot will land
        setState((s) => ({
          ...s,
          rootGoals: { ...s.rootGoals, [name]: d.goal },
          rootAutonomous: { ...s.rootAutonomous, [name]: d.autonomous },
          rootAutoRefine: { ...s.rootAutoRefine, [name]: d.autoRefine },
        }));
      })
      .catch(() => {
        /* bridge offline */
      });
  }, []);

  /* ---- daemon bridge ingestion ---- */
  useEffect(() => {
    const push = (item: TimelineItem) =>
      setState((s) => {
        // A dashed rule only after a long silence — never per event.
        const now = Date.now();
        const gap = now - lastAtRef.current > GAP_MS;
        lastAtRef.current = now;
        return {
          ...s,
          timeline: [
            ...s.timeline,
            ...(gap ? [{ kind: "divider", id: id(), text: clock() } as TimelineItem] : []),
            item,
          ],
        };
      });

    let hbTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshHeartbeats = () => {
      // heartbeats_changed is a global no-payload signal — throttle the re-pull.
      if (hbTimer) return;
      hbTimer = setTimeout(async () => {
        hbTimer = null;
        try {
          const r = await fetch(bridgeUrl("/bridge/heartbeats")).then((x) => x.json());
          const jobs: HeartbeatInfo[] = (r.heartbeats ?? [])
            .map((h: { job?: HeartbeatInfo }) => h.job ?? (h as HeartbeatInfo))
            .filter((j: HeartbeatInfo) => j.status === "active" || j.status === "paused");
          setState((s) => ({ ...s, heartbeats: jobs }));
        } catch {
          /* bridge offline */
        }
      }, 400);
    };

    let pvTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshPreview = () => {
      // preview_update fires once per turn with changes — cheap throttled re-pull.
      if (pvTimer) return;
      pvTimer = setTimeout(async () => {
        pvTimer = null;
        const previewFiles = await fetchPreviewFiles().catch(() => []);
        setState((s) => {
          // A declared preview selects its entry once the list carries it
          // (the event path may be absolute; index keys are workspace-relative).
          const pend = pendingPreviewRef.current;
          let previewPath = s.previewPath;
          if (pend) {
            const base = pend.split(/[\\/]/).pop();
            const match = previewFiles.find(
              (f) => f.path === pend || pend.endsWith(`/${f.path}`) || f.name === base,
            );
            if (match) {
              previewPath = match.path;
              pendingPreviewRef.current = null;
            }
          }
          return { ...s, previewFiles, previewPath };
        });
      }, 300);
    };

    /** Was this (possibly relative) path declared via preview.publish this turn? */
    const declaredThisTurn = (p: string) => {
      for (const d of declaredRef.current) {
        if (d === p || d.endsWith(`/${p}`) || p.endsWith(`/${d}`)) return true;
      }
      return false;
    };

    const mergeChild = (child: ChildInfo) => {
      setState((s) => {
        const prev = s.children.find((c) => c.id === child.id);
        // Child fields fill in progressively; some pull paths omit
        // activeSessionId — merge by id, never drop a cached session id.
        const merged = {
          ...prev,
          ...child,
          activeSessionId: child.activeSessionId ?? prev?.activeSessionId,
        };
        const events = childTransitionEvents(prev, merged);
        return {
          ...s,
          children: [...s.children.filter((c) => c.id !== child.id), merged],
          helperEvents:
            events.length > 0
              ? { ...s.helperEvents, [child.id]: [...(s.helperEvents[child.id] ?? []), ...events] }
              : s.helperEvents,
        };
      });
    };

    const onEvent = (event: Record<string, unknown>) => {
      const t = event.type as string;
      if (t === "agent_start" || t === "turn_start") {
        setState((s) => ({ ...s, master: "working" }));
      } else if (t === "agent_end") {
        daemonMsgRef.current = null;
        declaredRef.current.clear(); // turn window for declared-vs-inferred dedupe
        if (pendingRef.current) {
          clearTimeout(pendingRef.current.timer);
          pendingRef.current = null;
        }
        setState((s) => ({
          ...s,
          master: "idle",
          working: undefined,
          timeline: s.timeline
            .map((x) => (x.kind === "master" && x.streaming ? { ...x, streaming: false } : x))
            // A settled master row with no text is noise (orphan timestamp).
            .filter((x) => !(x.kind === "master" && !x.streaming && x.text === "")),
        }));
      } else if (t === "goal_update") {
        setState((s) => ({ ...s, goal: (event.goal as GoalInfo) ?? null }));
      } else if (t === "rlm_child_update") {
        const child = event.child as ChildInfo;
        if (!child?.id) return;
        mergeChild(child);
      } else if (t === "message_start" || t === "message_update" || t === "message_end") {
        const message = event.message as
          | { role?: string; id?: unknown; customType?: string; details?: unknown }
          | undefined;
        if (!message) return;
        if (message.role === "custom") {
          if (t !== "message_end") return;
          if (message.customType === "autonomous_status") {
            const details = (message.details as AutonomousInfo) ?? null;
            // A status the user asked for covers any continuation it reports.
            if (details?.lastInjection) lastInjectionSeenRef.current = details.lastInjection.at;
            setState((s) => ({ ...s, autonomous: details }));
          } else if (message.customType === "agent_message") {
            // details.message is the bare text; content is the model-facing envelope.
            const d = message.details as
              | {
                  from?: { sessionName?: string; activeSessionId?: string; clientId?: string };
                  message?: string;
                }
              | undefined;
            const from = d?.from;
            const fromName = from?.sessionName ?? "agent";
            setState((s) => {
              const child = s.children.find(
                (c) =>
                  (from?.activeSessionId !== undefined && c.activeSessionId === from.activeSessionId) ||
                  c.sessionName === fromName,
              );
              // A full message row with the sender's avatar; empty payloads
              // fall back to a quiet note chip.
              const body = (d?.message ?? "").trim();
              const note: TimelineItem = body
                ? { kind: "agent", id: id(), from: fromName, text: body, at: clock() }
                : { kind: "note", id: id(), text: `msg ← ${fromName}`, rt: clock() };
              if (!child) return { ...s, timeline: [...s.timeline, note] };
              s = { ...s, timeline: [...s.timeline, note] };
              const excerpt = (d?.message ?? "").slice(0, 80);
              const ev: HelperEvent = {
                id: id(),
                tone: "",
                text: excerpt ? `msg → master · “${excerpt}”` : "msg → master",
                rt: clock(),
              };
              return {
                ...s,
                helperEvents: { ...s.helperEvents, [child.id]: [...(s.helperEvents[child.id] ?? []), ev] },
              };
            });
          } else if (message.customType === "prime-agent.refinement") {
            // covered by refine_complete; ignore the transcript echo
          }
          return;
        }
        if (message.role === "user") {
          // A user message the runtime injected mid-run is how an unattended
          // continuation surfaces. Confirm against the machine field — a fresh
          // status pull whose lastInjection moved — never against prompt text,
          // so steers and check-ins can't fake the line.
          if (t !== "message_end" || !stateRef.current.autonomous?.enabled) return;
          void fetchAutonomous()
            .then(({ autonomous }) => {
              if (!autonomous) return;
              const inj = autonomous.lastInjection;
              setState((s) => ({ ...s, autonomous }));
              if (inj && inj.at !== lastInjectionSeenRef.current) {
                lastInjectionSeenRef.current = inj.at;
                const used = autonomous.continuationsUsed;
                const max = autonomous.limits?.maxContinuations;
                const counter =
                  typeof used === "number" && typeof max === "number" ? ` (${used} of ${max})` : "";
                push({
                  kind: "note",
                  id: id(),
                  text: `continued unattended · ${injectionReasonText(inj.reason)}${counter}`,
                  rt: clock(),
                  ts: Date.now(),
                });
              }
            })
            .catch(() => {});
          return;
        }
        if (message.role !== "assistant") return;
        const text = extractText(message);
        // Reasoning-only updates carry no text — and some models pad a
        // tool-only turn with bare whitespace; never render an empty bubble.
        if (text.trim() === "" && !daemonMsgRef.current) return;
        const key = message.id ?? "assistant";
        const applyText = (itemId: string, value: string, streaming: boolean) =>
          setState((s) => ({
            ...s,
            timeline: s.timeline.map((x) =>
              x.id === itemId && x.kind === "master" ? { ...x, text: value, streaming } : x,
            ),
          }));
        if (!daemonMsgRef.current || daemonMsgRef.current.key !== key) {
          const itemId = id();
          daemonMsgRef.current = { itemId, key };
          push({ kind: "master", id: itemId, text, at: clock(), streaming: true });
        } else {
          const itemId = daemonMsgRef.current.itemId;
          if (t === "message_end") {
            if (pendingRef.current) {
              clearTimeout(pendingRef.current.timer);
              pendingRef.current = null;
            }
            if (text.trim() === "") {
              // The message ended with no words (tool-only) — drop its row.
              setState((s) => ({ ...s, timeline: s.timeline.filter((x) => x.id !== itemId) }));
            } else {
              applyText(itemId, text, false);
            }
            daemonMsgRef.current = null;
          } else if (pendingRef.current?.itemId === itemId) {
            pendingRef.current.text = text;
          } else {
            if (pendingRef.current) clearTimeout(pendingRef.current.timer);
            pendingRef.current = {
              itemId,
              text,
              timer: setTimeout(() => {
                const p = pendingRef.current;
                pendingRef.current = null;
                if (p) applyText(p.itemId, p.text, true);
              }, 50),
            };
          }
        }
      } else if (t === "tool_execution_start") {
        const raw = String(event.toolName ?? "tool");
        const toolName = raw === "ipython" ? "python" : raw;
        const path = filePathFromArgs(event.args);
        const label = toolLabel(toolName, event.args);
        const writes = toolName === "edit" || toolName === "write";
        if (path && writes) refreshPreview(); // live marker moves mid-turn
        setState((s) => ({
          ...s,
          files: path && writes ? upsertFile(s.files, path, "master") : s.files,
          timeline: [
            ...s.timeline,
            {
              kind: "tool",
              id: `tool-${String(event.toolCallId ?? id())}`,
              name: label,
              status: "running",
              at: clock(),
              ts: Date.now(),
            },
          ],
        }));
      } else if (t === "tool_execution_end") {
        const toolId = `tool-${String(event.toolCallId ?? "")}`;
        setState((s) => ({
          ...s,
          timeline: s.timeline.map((x) =>
            x.id === toolId && x.kind === "tool" ? { ...x, status: event.isError ? "error" : "done" } : x,
          ),
        }));
      } else if (t === "preview_published") {
        // Declared preview (daemon capability preview_events) — the primary
        // source for the Preview view. The bridge already snapshot the file;
        // here: one timeline chip, a Files row, and select the preview entry.
        const p = event.preview as
          | { source?: string; kind?: string; path?: string; label?: string }
          | undefined;
        if (!p) return;
        const resolved = p.path ?? p.source ?? "";
        const base = resolved.split(/[\\/]/).pop() || "file";
        push({
          kind: "note",
          id: id(),
          text: tr("published · {label}", { label: p.label || base }),
          rt: clock(),
          ts: Date.now(),
        });
        if (resolved) {
          declaredRef.current.add(resolved);
          if (p.kind === "file") {
            pendingPreviewRef.current = resolved;
            setState((s) => ({ ...s, files: upsertFile(s.files, resolved, "master") }));
            refreshPreview();
          }
        }
      } else if (t === "refine_complete") {
        setLessonEpoch((n) => n + 1); // ⚡ column / pane / rail dot re-pull
        const result = event.result as LessonResult | undefined;
        if (result?.id) {
          push({ kind: "lesson", id: id(), result, at: clock(), ts: Date.now() });
        } else {
          push({ kind: "note", id: id(), text: tr("lesson kept"), rt: clock(), ts: Date.now() });
        }
        // No auto-pop: the lesson card lands in the timeline and the Learned
        // column re-pulls; the pane opens only when the user clicks a row.
      } else if (t === "refine_failed") {
        const raw = event.error;
        const msg =
          typeof raw === "string" ? raw : (raw as { message?: string } | undefined)?.message ?? "unknown error";
        push({
          kind: "note",
          id: id(),
          text: `lesson attempt failed · ${msg.slice(0, 80)}`,
          tone: "bad",
          rt: clock(),
          ts: Date.now(),
        });
      } else if (t === "compaction_end") {
        // compaction is not shown (HANDOFF §4)
      }
    };

    /* ---- other-root event stream (watch_root feed) ---- */
    const patchRootItems = (root: string, fn: (items: TimelineItem[]) => TimelineItem[]) =>
      setState((s) => ({
        ...s,
        rootTimelines: { ...s.rootTimelines, [root]: fn(s.rootTimelines[root] ?? []) },
      }));
    const clearRootStream = (root: string) => {
      delete rootMsgRef.current[root];
      const p = rootPendingRef.current[root];
      if (p) {
        clearTimeout(p.timer);
        delete rootPendingRef.current[root];
      }
    };

    /** Mirror of onEvent for another root's session, scoped to that root's own
     *  timeline, run state, and status blocks (goal/unattended feed the
     *  Inspector when this root is selected; lesson/preview stay master's). */
    const onRootEvent = (root: string, event: Record<string, unknown>) => {
      const t = event.type as string;
      if (t === "goal_update") {
        // The root's own objective moved (a "/goal …" write or its runtime) —
        // the Inspector bound to this root re-renders from here.
        setState((s) => ({
          ...s,
          rootGoals: { ...s.rootGoals, [root]: (event.goal as GoalInfo) ?? null },
        }));
      } else if (t === "agent_start" || t === "turn_start") {
        setState((s) => ({ ...s, rootStates: { ...s.rootStates, [root]: "working" } }));
      } else if (t === "agent_end") {
        clearRootStream(root);
        setState((s) => ({
          ...s,
          rootStates: { ...s.rootStates, [root]: "idle" },
          rootWorking: { ...s.rootWorking, [root]: "" },
          rootTimelines: {
            ...s.rootTimelines,
            [root]: (s.rootTimelines[root] ?? [])
              .map((x) => (x.kind === "master" && x.streaming ? { ...x, streaming: false } : x))
              .filter((x) => !(x.kind === "master" && !x.streaming && x.text.trim() === "")),
          },
        }));
      } else if (t === "message_start" || t === "message_update" || t === "message_end") {
        const message = event.message as
          | { role?: string; id?: unknown; customType?: string; details?: unknown }
          | undefined;
        if (!message) return;
        // The root's unattended counters ride autonomous_status customs on its
        // own stream, exactly like master's.
        if (message.role === "custom") {
          if (t === "message_end" && message.customType === "autonomous_status") {
            setState((s) => ({
              ...s,
              rootAutonomous: {
                ...s.rootAutonomous,
                [root]: (message.details as AutonomousInfo) ?? null,
              },
            }));
          }
          return;
        }
        if (message.role !== "assistant") return;
        const text = extractText(message);
        const cur = rootMsgRef.current[root];
        if (text.trim() === "" && !cur) return;
        const key = message.id ?? "assistant";
        const applyText = (itemId: string, value: string, streaming: boolean) =>
          patchRootItems(root, (items) =>
            items.map((x) => (x.id === itemId && x.kind === "master" ? { ...x, text: value, streaming } : x)),
          );
        if (!cur || cur.key !== key) {
          const itemId = id();
          rootMsgRef.current[root] = { itemId, key };
          patchRootItems(root, (items) => [
            ...items,
            { kind: "master", id: itemId, text, at: clock(), streaming: true },
          ]);
        } else if (t === "message_end") {
          const p = rootPendingRef.current[root];
          if (p) {
            clearTimeout(p.timer);
            delete rootPendingRef.current[root];
          }
          if (text.trim() === "") {
            // Tool-only message: drop the empty streaming row.
            patchRootItems(root, (items) => items.filter((x) => x.id !== cur.itemId));
          } else {
            applyText(cur.itemId, text, false);
          }
          delete rootMsgRef.current[root];
        } else {
          const p = rootPendingRef.current[root];
          if (p?.itemId === cur.itemId) {
            p.text = text;
          } else {
            if (p) clearTimeout(p.timer);
            rootPendingRef.current[root] = {
              itemId: cur.itemId,
              text,
              timer: setTimeout(() => {
                const q = rootPendingRef.current[root];
                delete rootPendingRef.current[root];
                if (q) applyText(q.itemId, q.text, true);
              }, 50),
            };
          }
        }
      } else if (t === "tool_execution_start") {
        const raw = String(event.toolName ?? "tool");
        const toolName = raw === "ipython" ? "python" : raw;
        const label = toolLabel(toolName, event.args);
        patchRootItems(root, (items) => [
          ...items,
          {
            kind: "tool",
            id: `rtool-${root}-${String(event.toolCallId ?? id())}`,
            name: label,
            status: "running",
            at: clock(),
            ts: Date.now(),
          },
        ]);
      } else if (t === "tool_execution_end") {
        const toolId = `rtool-${root}-${String(event.toolCallId ?? "")}`;
        patchRootItems(root, (items) =>
          items.map((x) =>
            x.id === toolId && x.kind === "tool" ? { ...x, status: event.isError ? "error" : "done" } : x,
          ),
        );
      } else if (t === "refine_complete") {
        // A watched root kept a lesson of its own — the ⚡ surfaces re-pull.
        setLessonEpoch((n) => n + 1);
      }
    };

    const bridge = openBridge((m: BridgeMessage) => {
      if (m.type === "hello") {
        bridgeRef.current = m.daemon.connected;
        const ws = m.daemon.workspace ?? null;
        setState((s) => {
          const switched = ws !== null && s.bridge?.workspace != null && ws !== s.bridge.workspace;
          const bridgeState = {
            connected: m.daemon.connected,
            error: m.daemon.error ?? null,
            workspace: ws,
            // Capability detection: the daemon says whether it emits
            // preview_published (declared previews); absent = inference only.
            previewEvents: (m.daemon.capabilities ?? []).includes("preview_events"),
          };
          // Split layout is per workspace; restore once per key so a
          // reconnect hello never clobbers the user's in-session layout.
          const splitKey = `center-split:${ws ?? "general"}`;
          if (!switched) {
            if (splitKeyRef.current === splitKey) return { ...s, bridge: bridgeState };
            splitKeyRef.current = splitKey;
            return { ...s, bridge: bridgeState, ...restoreSplit(splitKey) };
          }
          splitKeyRef.current = splitKey;
          // A workspace is its own master, helpers, other roots, files, history.
          daemonMsgRef.current = null;
          historyRef.current = [];
          histSeededRef.current = false;
          declaredRef.current.clear();
          pendingPreviewRef.current = null;
          rootMsgRef.current = {};
          for (const p of Object.values(rootPendingRef.current)) clearTimeout(p.timer);
          rootPendingRef.current = {};
          return {
            ...s,
            bridge: bridgeState,
            master: "idle",
            view: "timeline",
            selectedAgent: null,
            selectedRoot: null,
            split: null,
            tabsL: [{ kind: "timeline" }],
            tabsR: [],
            others: [],
            rootTimelines: {},
            rootLoad: {},
            rootStates: {},
            rootWorking: {},
            rootGoals: {},
            rootAutonomous: {},
            autoRefine: null,
            rootAutoRefine: {},
            goal: null,
            children: [],
            helperEvents: {},
            helperTranscripts: {},
            helperWorking: {},
            files: [],
            previewFiles: [],
            previewPath: null,
            heartbeats: [],
            autonomous: null,
            target: { kind: "master" },
    longRun: false,
            error: undefined,
            timeline: [{ kind: "divider", id: id(), text: tr("workspace {ws} · {at}", { ws, at: clock() }) }],
            ...restoreSplit(splitKey),
          };
        });
        if (m.daemon.connected) {
          refreshHeartbeats();
          refreshPreview();
          refreshOthers();
          setInspectorKey((n) => n + 1);
          setLessonEpoch((n) => n + 1); // workspace switch = a different harness
        }
      } else if (m.type === "heartbeats_changed") {
        refreshHeartbeats();
        // Scheduled jobs live in the same store; the signal is the closest
        // push the daemon gives for them.
        setInspectorKey((n) => n + 1);
      } else if (m.type === "preview_update") {
        refreshPreview();
      } else if (m.type === "file_activity") {
        // fs truth from the bridge's per-turn scan (writes happen inside the
        // kernel). A file already declared via preview.publish this turn has
        // its row — don't double-count the inferred sighting.
        if (declaredThisTurn(m.file.path)) return;
        setState((s) => ({ ...s, files: upsertFile(s.files, m.file.path, "master") }));
      } else if (m.type === "working_message") {
        setState((s) => ({ ...s, working: m.text || undefined }));
      } else if (m.type === "helper_event") {
        // Live transcript of a watched helper session, keyed on the wire by
        // activeSessionId. resync replaces the child's rows; msg/tool append,
        // except a tool_execution_end updating the row its _start appended.
        setState((s) => {
          const child = s.children.find((c) => c.activeSessionId === m.sessionId);
          if (!child) return s;
          const ev = m.event;
          if (ev.kind === "resync") {
            return { ...s, helperTranscripts: { ...s.helperTranscripts, [child.id]: ev.messages } };
          }
          const rows = s.helperTranscripts[child.id] ?? [];
          if (ev.kind === "tool" && ev.id) {
            const i = rows.findIndex((r) => r.kind === "tool" && r.id === ev.id);
            if (i >= 0) {
              const next = rows.slice();
              next[i] = { ...(next[i] as HelperToolRow), status: ev.status };
              return { ...s, helperTranscripts: { ...s.helperTranscripts, [child.id]: next } };
            }
          }
          return { ...s, helperTranscripts: { ...s.helperTranscripts, [child.id]: [...rows, ev] } };
        });
      } else if (m.type === "helper_working") {
        setState((s) => {
          const child = s.children.find((c) => c.activeSessionId === m.sessionId);
          if (!child) return s;
          return { ...s, helperWorking: { ...s.helperWorking, [child.id]: m.text } };
        });
      } else if (m.type === "root_snapshot") {
        // Canonical transcript for a watched root: same slim/replay/fold shape
        // as master's attach history. Replaces wholesale (resync semantics) —
        // except the tail of live tool rows from the turn in flight: the
        // snapshot carries only messages, and wiping a running "python" row
        // mid-turn reads as a glitch.
        const items = foldHistory(historyToItems((m.messages as HistoryMessage[]) ?? []));
        // A user message sent just before the attach snapshot was taken is in
        // the local timeline but not yet in the snapshot — replacing wholesale
        // would swallow it. Keep trailing user rows the snapshot doesn't have.
        const snapUserTexts = new Set(
          items
            .flatMap((it) => (it.kind === "collapsed" ? it.items : [it]))
            .filter((it): it is Extract<TimelineItem, { kind: "user" }> => it.kind === "user")
            .map((it) => it.text),
        );
        const liveTail = (prev: TimelineItem[] | undefined): TimelineItem[] => {
          if (!prev) return [];
          let i = prev.length;
          while (
            i > 0 &&
            (prev[i - 1].kind === "tool" || prev[i - 1].kind === "note" || prev[i - 1].kind === "user")
          )
            i--;
          return prev
            .slice(i)
            .filter(
              (x) =>
                x.kind === "tool" || (x.kind === "user" && !snapUserTexts.has(x.text)),
            );
        };
        clearRootStream(m.root);
        // The snapshot carries the root's own status blocks (schema 27) — the
        // Inspector binds to them; a key present (even null) means "loaded".
        const rstate = m.state;
        setState((s) => ({
          ...s,
          rootTimelines: {
            ...s.rootTimelines,
            [m.root]: [...items, ...liveTail(s.rootTimelines[m.root])],
          },
          rootLoad: { ...s.rootLoad, [m.root]: m.partial ? "partial" : "full" },
          rootStates:
            m.running === undefined
              ? s.rootStates
              : { ...s.rootStates, [m.root]: m.running ? "working" : "idle" },
          rootGoals: rstate
            ? { ...s.rootGoals, [m.root]: (rstate.goal as GoalInfo | null) ?? null }
            : s.rootGoals,
          rootAutonomous: rstate
            ? { ...s.rootAutonomous, [m.root]: (rstate.autonomous as AutonomousInfo | null) ?? null }
            : s.rootAutonomous,
          rootAutoRefine: rstate
            ? { ...s.rootAutoRefine, [m.root]: (rstate.autoRefine as AutoRefineInfo | null) ?? null }
            : s.rootAutoRefine,
        }));
      } else if (m.type === "root_event") {
        onRootEvent(m.root, m.event);
      } else if (m.type === "root_working") {
        setState((s) => ({ ...s, rootWorking: { ...s.rootWorking, [m.root]: m.text } }));
      } else if (m.type === "snapshot") {
        // The snapshot roster is authoritative: helpers can vanish (the agent
        // may delete its own). Merge by id, keep cached session ids, drop the
        // vanished, and never leave a stale selection or composer target.
        const roster = (m.children as ChildInfo[]) ?? [];
        // Attach history rides along once per workspace: the timeline at this
        // point is a single divider (session started / workspace switch), and
        // the earlier turns follow it. A reconnect snapshot must not re-seed.
        const history = histSeededRef.current
          ? []
          : foldHistory(historyToItems((m.messages as HistoryMessage[]) ?? []));
        histSeededRef.current = true;
        // Attach snapshot carries the live unattended status (schema 27) — a
        // client attaching after a continuation still shows the last reason.
        const snapAuto = (m.state.autonomous as AutonomousInfo | null | undefined) ?? null;
        if (snapAuto?.lastInjection) lastInjectionSeenRef.current = snapAuto.lastInjection.at;
        const snapRefine = (m.state.autoRefine as AutoRefineInfo | null | undefined) ?? null;
        setState((s) => {
          const children = roster.map((c) => {
            const prev = s.children.find((p) => p.id === c.id);
            return { ...prev, ...c, activeSessionId: c.activeSessionId ?? prev?.activeSessionId };
          });
          const has = (cid: string | null) => cid !== null && children.some((c) => c.id === cid);
          return reconcileSplit(
            {
              ...s,
              goal: (m.state.goal as GoalInfo) ?? null,
              autonomous: snapAuto ?? s.autonomous,
              autoRefine: snapRefine ?? s.autoRefine,
              children,
              timeline: history.length > 0 ? [...s.timeline, ...history] : s.timeline,
              selectedAgent: has(s.selectedAgent) ? s.selectedAgent : null,
              target:
                s.target.kind === "helper" && !has(s.target.childId) ? { kind: "master" } : s.target,
            },
            { children: true },
          );
        });
      } else if (m.type === "event") {
        onEvent(m.event);
      }
    });
    return () => bridge.close();
  }, [refreshOthers]);

  const setColumn = useCallback((column: ColumnView) => setState((s) => ({ ...s, column })), []);
  // Selecting an agent in the column never changes the composer target —
  // helpers and other roots alike; the target moves only via the to ▾ popup.
  // It changes what the focused pane shows.
  const selectAgent = useCallback(
    (childId: string | null) =>
      setState((s) => showFocused(s, childId ? { kind: "helper", childId } : { kind: "timeline" })),
    [],
  );
  const selectRoot = useCallback(
    (name: string) => setState((s) => showFocused(s, { kind: "root", name })),
    [],
  );
  // Picking a to ▾ target also jumps the view to that conversation's tab —
  // the input follows the pane, so the pane follows the pick.
  /** Long-running mode is deliberately session-scoped: a switch that adds an
   *  instruction to every message should not come back silently after a
   *  restart. Switching workspaces clears it with the rest of the state. */
  const setLongRun = useCallback((v: boolean) => setState((s) => ({ ...s, longRun: v })), []);

  const setTarget = useCallback(
    (target: ComposerTarget) =>
      setState((s) => {
        const withTarget = { ...s, target };
        if (target.kind === "helper") return showFocused(withTarget, { kind: "helper", childId: target.childId });
        if (target.kind === "root") return showFocused(withTarget, { kind: "root", name: target.name });
        return showFocused(withTarget, { kind: "timeline" });
      }),
    [],
  );
  // From the Files column: match the tool-arg path (may be absolute) against
  // the workspace-relative preview index.
  const openPreview = useCallback(
    (file?: FileActivity) =>
      setState((s) => {
        const match = file
          ? s.previewFiles.find(
              (p) => p.path === file.path || file.path.endsWith(`/${p.path}`) || p.name === file.name,
            )
          : undefined;
        return {
          ...showFocused(s, { kind: "preview" }),
          selectedAgent: null,
          previewPath: match?.path ?? s.previewPath,
        };
      }),
    [],
  );
  // Clicking anywhere in the unfocused pane moves focus there (model swap:
  // canonical fields take that pane's content, `other` takes the old one).
  const focusPane = useCallback(
    (side: "left" | "right") =>
      setState((s) => {
        if (!s.split || s.split.focusSide === side) return s;
        return { ...s, ...panePatch(s.split.other), split: { other: currentPane(s), focusSide: side } };
      }),
    [],
  );
  /** × on a tab. */
  const closeTab = useCallback((side: "left" | "right" | null, v: PaneView) => {
    setState((s) => removeTab(s, side ?? "left", v));
  }, []);
  /** Click a tab in a pane's strip. */
  const pickTab = useCallback((side: "left" | "right" | null, v: PaneView) => {
    setState((s) => activateTab(s, side ?? "left", v));
  }, []);
  /** Rail ⚡ toggles the Learned column on the left. */
  const toggleLearned = useCallback(() => {
    setState((s) => ({ ...s, column: s.column === "learned" ? "agents" : "learned" }));
  }, []);
  /** A lesson picked in the ⚡ column: its full record pops into a center pane
   *  (split, keeping your focus); picking it again deselects. */
  const selectLearned = useCallback((sel: LearnedSel | null) => {
    setLearnedSel(sel);
    if (sel) setState((s) => popPane(s, { kind: "learned" }));
  }, []);

  /** The ⚡ column's one checkbox: the GLOBAL auto-refine setting
   *  (settings.json autoRefine.enabled). The bridge writes the file and
   *  reloads every live root worker — the response carries the value read
   *  back from master's connection state, which is what we keep. */
  const toggleAutoRefine = useCallback(
    async (enabled: boolean) => {
      const d = await bridgeCmd("set_auto_refine", undefined, { enabled });
      const now = Boolean(d.enabled);
      setState((s) => ({
        ...s,
        autoRefine: s.autoRefine ? { ...s.autoRefine, enabled: now } : { enabled: now },
      }));
      const sel = stateRef.current.selectedRoot;
      if (sel) refreshRootStatus(sel); // its effective value moved with the file
    },
    [refreshRootStatus],
  );

  // ⚡ unread dot: lessons newer than when the column was last open. Reads the
  // same cached pull the column uses — one fetch per epoch/roster, no hammering.
  const learnedRootsKey = state.others
    .map((a) => a.name)
    .sort()
    .join("\n");
  const learnedSeenKey = `learned-seen:${state.bridge?.workspace || "general"}`;
  const learnedColumnOpen = state.column === "learned";
  const learnedConnected = Boolean(state.bridge?.connected);
  useEffect(() => {
    if (!learnedConnected) return;
    let live = true;
    fetchLessons(lessonEpoch, learnedRootsKey === "" ? [] : learnedRootsKey.split("\n")).then((rows) => {
      if (!live) return;
      const newest = rows.reduce((a, r) => ((r.created_at ?? "") > a ? (r.created_at as string) : a), "");
      if (learnedColumnOpen) {
        // Looking at the list marks everything seen.
        if (newest !== "") {
          try {
            localStorage.setItem(learnedSeenKey, newest);
          } catch {
            /* private mode */
          }
        }
        setLearnedUnread(false);
        return;
      }
      let seen = "";
      try {
        seen = localStorage.getItem(learnedSeenKey) ?? "";
      } catch {
        /* private mode */
      }
      setLearnedUnread(newest !== "" && newest > seen);
    });
    return () => {
      live = false;
    };
  }, [learnedConnected, lessonEpoch, learnedRootsKey, learnedSeenKey, learnedColumnOpen]);
  /** A tab (or agent row) dropped on the left/right half of the center area. */
  const dropPane = useCallback((v: PaneView, side: "left" | "right") => {
    setState((s) => moveTab(s, v, side));
  }, []);
  const selectPreviewFile = useCallback(
    (previewPath: string) => setState((s) => ({ ...s, previewPath })),
    [],
  );

  const stop = useCallback(() => {
    const target = stateRef.current.target;
    if (target.kind === "root") {
      bridgeCmd("root_abort", undefined, { target: target.name }).catch(() => undefined);
      return;
    }
    if (bridgeRef.current) {
      bridgeCmd("abort").catch(() => undefined);
    } else {
      abortRef.current?.abort();
    }
  }, []);

  const stopHelperById = useCallback((childId: string) => {
    stopHelper(childId).catch((e) =>
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : tr("stop failed") })),
    );
  }, []);

  const removeHelperById = useCallback((childId: string) => {
    removeHelper(childId)
      .then(() =>
        setState((s) => ({
          ...s,
          children: s.children.filter((c) => c.id !== childId),
          selectedAgent: s.selectedAgent === childId ? null : s.selectedAgent,
          target:
            s.target.kind === "helper" && s.target.childId === childId ? { kind: "master" } : s.target,
        })),
      )
      .catch((e) => setState((s) => ({ ...s, error: e instanceof Error ? e.message : tr("remove failed") })));
  }, []);

  const sendToHelper = useCallback(async (child: ChildInfo, text: string) => {
    if (!child.activeSessionId) return;
    try {
      const status = await sendAgentMessage(child.activeSessionId, text);
      const ev: HelperEvent = {
        id: id(),
        tone: "",
        text: `msg ← you · “${text}”`,
        rt:
          status === "queued"
            ? tr("queued, lands at its next step")
            : tr("delivered · {at}", { at: clock() }),
      };
      setState((s) => ({
        ...s,
        error: undefined,
        helperEvents: { ...s.helperEvents, [child.id]: [...(s.helperEvents[child.id] ?? []), ev] },
      }));
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : tr("message failed") }));
    }
  }, []);

  /* ---- NIM fallback path (no daemon) ---- */
  const sendViaNim = useCallback(async (text: string, masterId: string) => {
    const abort = new AbortController();
    abortRef.current = abort;
    // Last turn's subagent cards make way for this turn's.
    setState((s) => (s.claudeAgents.length ? { ...s, claudeAgents: [] } : s));
    const settle = (patch: (t: TimelineItem) => TimelineItem | null, error?: string) =>
      setState((s) => ({
        ...s,
        master: "idle",
        working: undefined,
        error,
        timeline: s.timeline
          .map((t) => (t.id === masterId ? patch(t) : t))
          .filter((t): t is TimelineItem => t !== null),
      }));
    try {
      const reply = await runMasterTurn(
        historyRef.current,
        (delta) => {
          setState((s) => ({
            ...s,
            timeline: s.timeline.map((t) =>
              t.id === masterId && t.kind === "master" ? { ...t, text: t.text + delta } : t,
            ),
          }));
        },
        abort.signal,
        // Tool activity (claude path) rides the same strip the daemon uses.
        (label) => setState((s) => ({ ...s, working: label })),
        // Task subagents become read-only cards in the Agents column.
        (sa) =>
          setState((s) => ({
            ...s,
            claudeAgents: s.claudeAgents.some((x) => x.id === sa.id)
              ? s.claudeAgents.map((x) => (x.id === sa.id ? sa : x))
              : [...s.claudeAgents, sa],
          })),
      );
      historyRef.current.push({ role: "assistant", content: reply });
      settle((t) => (t.kind === "master" ? { ...t, streaming: false } : t));
    } catch (e) {
      const aborted = abort.signal.aborted;
      settle(
        (t) => {
          if (t.kind !== "master") return t;
          if (t.text === "") return null;
          historyRef.current.push({ role: "assistant", content: t.text });
          return { ...t, streaming: false };
        },
        aborted ? undefined : e instanceof Error ? e.message : "model request failed",
      );
      if (aborted) {
        setState((s) => ({
          ...s,
          timeline: [
            ...s.timeline,
            { kind: "divider", id: id(), text: tr("stopped by you · {at}", { at: clock() }) },
          ],
        }));
      }
    } finally {
      abortRef.current = null;
    }
  }, []);

  /** Message another root: prompt when idle (wakes it — normal daemon
   *  behavior), steer when running. Shared by the root pane's own composer
   *  and the to ▾ target path. */
  const postRoot = useCallback(async (name: string, text: string) => {
    const busy = (stateRef.current.rootStates[name] ?? "idle") === "working";
    const op = busy ? "root_steer" : "root_prompt";
    const longRun = stateRef.current.longRun;
    // The timeline keeps the user's own words; the long-running ask rides
    // along as a note row, never disguised as something they typed.
    const rows: TimelineItem[] = [{ kind: "user", id: id(), text, at: clock() }];
    if (longRun) rows.push(longRunNote());
    setState((s) => ({
      ...s,
      error: undefined,
      rootStates: busy ? s.rootStates : { ...s.rootStates, [name]: "working" },
      rootTimelines: {
        ...s.rootTimelines,
        [name]: [...(s.rootTimelines[name] ?? []), ...rows],
      },
    }));
    try {
      await bridgeCmd(op, longRun ? withLongRun(text) : text, { target: name });
    } catch (e) {
      setState((s) => ({
        ...s,
        error: e instanceof Error ? e.message : tr("bridge command failed"),
      }));
    }
  }, []);
  const stopRoot = useCallback((name: string) => {
    bridgeCmd("root_abort", undefined, { target: name }).catch(() => undefined);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const current = stateRef.current;
      if (current.target.kind === "helper") {
        const child = current.children.find(
          (c) => c.id === (current.target as { childId: string }).childId,
        );
        if (child) await sendToHelper(child, text);
        return;
      }
      const userItem: TimelineItem = { kind: "user", id: id(), text, at: clock() };
      if (current.target.kind === "root") {
        // Another root session via the to ▾ target: jump the view to it, like
        // master's send, then post through the shared pane-send path.
        const name = current.target.name;
        setState((s) => showFocused(s, { kind: "root", name }));
        await postRoot(name, text);
        return;
      }
      if (bridgeRef.current) {
        const busy = current.master === "working";
        const op = busy ? "steer" : "prompt";
        const longRun = current.longRun;
        const rows = longRun ? [userItem, longRunNote()] : [userItem];
        setState((s) => {
          const jumped = showFocused(s, { kind: "timeline" });
          return {
            ...jumped,
            master: "working",
            error: undefined,
            timeline: [...jumped.timeline, ...rows],
          };
        });
        const sent = longRun ? withLongRun(text) : text;
        try {
          if (op === "steer") await steer(sent);
          else await bridgeCmd("prompt", sent);
        } catch (e) {
          setState((s) => ({
            ...s,
            error: e instanceof Error ? e.message : tr("bridge command failed"),
          }));
        }
        return;
      }
      const masterId = id();
      historyRef.current.push({ role: "user", content: text });
      setState((s) => {
        const jumped = showFocused(s, { kind: "timeline" });
        return {
          ...jumped,
          master: "working",
          error: undefined,
          timeline: [
            ...jumped.timeline,
            userItem,
            { kind: "master", id: masterId, text: "", at: clock(), streaming: true },
          ],
        };
      });
      await sendViaNim(text, masterId);
    },
    [sendViaNim, sendToHelper, postRoot],
  );

  const selectedChild = state.selectedAgent
    ? state.children.find((c) => c.id === state.selectedAgent) ?? null
    : null;
  const needsYou = state.children.filter((c) => c.status === "done" && !c.repliedSinceTask).length;

  // Either pane can hold a helper or root view now — watch whatever is open.
  const otherPane = state.split?.other ?? null;
  const otherHelper =
    otherPane?.kind === "helper" ? state.children.find((c) => c.id === otherPane.childId) ?? null : null;

  // Watch open helpers' live sessions (second attaches on the same daemon
  // socket). Attach can fail when the helper ran inline or was deleted — no
  // retry; the view then shows observed events only.
  const helperWatchKey = [
    ...new Set(
      [selectedChild?.activeSessionId, otherHelper?.activeSessionId].filter((x): x is string => Boolean(x)),
    ),
  ]
    .sort()
    .join("\n");
  useEffect(() => {
    if (!helperWatchKey) return;
    const targets = helperWatchKey.split("\n");
    for (const t of targets) bridgeCmd("watch_helper", undefined, { target: t }).catch(() => undefined);
    return () => {
      for (const t of targets) bridgeCmd("unwatch_helper", undefined, { target: t }).catch(() => undefined);
    };
  }, [helperWatchKey]);

  // Watch open other roots (another attach, mirroring watch_helper). Detaches
  // on switch-away; an attach failure means the root is gone — fall back to
  // master honestly (the roster re-pull also reconciles a stale pane).
  const rootWatchKey = [
    ...new Set(
      [state.selectedRoot, otherPane?.kind === "root" ? otherPane.name : null].filter(
        (x): x is string => Boolean(x),
      ),
    ),
  ]
    .sort()
    .join("\n");
  useEffect(() => {
    if (!rootWatchKey) return;
    const names = rootWatchKey.split("\n");
    for (const name of names) {
      bridgeCmd("watch_root", undefined, { target: name }).catch(() => {
        refreshOthers();
        setState((s) => reconcileSplit(s.selectedRoot === name ? { ...s, selectedRoot: null } : s));
      });
    }
    return () => {
      for (const name of names) bridgeCmd("unwatch_root", undefined, { target: name }).catch(() => undefined);
    };
  }, [rootWatchKey, refreshOthers]);

  // The Inspector binds to the selected root: keep its status blocks fresh on
  // select and whenever the bridge signals state may have moved (inspectorKey).
  // The watch_root snapshot delivers the first state; this covers re-pulls.
  const selRootForStatus = state.selectedRoot;
  const bridgeConnected = Boolean(state.bridge?.connected);
  useEffect(() => {
    if (!selRootForStatus || !bridgeConnected) return;
    refreshRootStatus(selRootForStatus);
  }, [selRootForStatus, bridgeConnected, inspectorKey, refreshRootStatus]);

  // Persist the tab layout per workspace. Guarded by splitKeyRef so nothing
  // writes before the restore.
  const splitSave = JSON.stringify({
    tabsL: state.tabsL,
    tabsR: state.tabsR,
    activeL: activeOf(state, "left"),
    activeR: activeOf(state, "right"),
    focus: focusSideOf(state),
  });
  useEffect(() => {
    const key = splitKeyRef.current;
    if (!key) return;
    saveJson(key, JSON.parse(splitSave));
  }, [splitSave]);

  // An agent writing files this turn auto-opens Preview in the second pane
  // (right of the focused one), without stealing focus. Each new live snapshot
  // signature triggers once — closing the pane doesn't reopen it for the same
  // write, the next write brings it back.
  const liveSig = state.previewFiles
    .filter((f) => f.live)
    .map((f) => `${f.path}:${f.versions.length}`)
    .sort()
    .join("|");
  const autoPreviewRef = useRef("");
  useEffect(() => {
    if (!liveSig || liveSig === autoPreviewRef.current) return;
    autoPreviewRef.current = liveSig;
    setState((s) => popPane(s, { kind: "preview" }));
  }, [liveSig]);

  // A root's run state: its own event stream once attached, else the roster word.
  const rootStateOf = (name: string): AgentState =>
    state.rootStates[name] ??
    (state.others.find((a) => a.name === name)?.state === "running" ? "working" : "idle");
  // Busy-ness the composer acts on — the current target's, not the view's.
  const targetState: AgentState =
    state.target.kind === "root" ? rootStateOf(state.target.name) : state.master;

  const composer = () => (
    <Composer
      master={state.master}
      targetState={targetState}
      goal={state.goal}
      autonomous={state.autonomous}
      heartbeats={state.heartbeats}
      bridge={state.bridge}
      children={state.children}
      others={state.others}
      target={state.target}
      working={state.working}
      error={state.error}
      longRun={state.longRun}
      onLongRun={setLongRun}
      onTarget={setTarget}
      onSend={send}
      onStop={stop}
    />
  );

  // A root pane's own composer: fixed to that root — the chat input follows
  // the pane, wherever the to ▾ target of the master composer points.
  const rootComposer = (name: string) => (
    <Composer
      master={state.master}
      targetState={rootStateOf(name)}
      goal={state.goal}
      autonomous={state.autonomous}
      heartbeats={state.heartbeats}
      bridge={state.bridge}
      children={state.children}
      others={state.others}
      target={state.target}
      working={state.working}
      error={state.error}
      viewRoot={{ name, state: rootStateOf(name), working: state.rootWorking[name] || undefined }}
      fixedRoot={name}
      longRun={state.longRun}
      onLongRun={setLongRun}
      onTarget={setTarget}
      onSend={(t) => postRoot(name, t)}
      onStop={() => stopRoot(name)}
    />
  );

  // Another root session's timeline — same replay/fold shape as master's;
  // header + transcript only (the composer is placed by the caller).
  const renderRootPane = (name: string) => {
    const other = state.others.find((a) => a.name === name);
    const items = state.rootTimelines[name] ?? [];
    const load = state.rootLoad[name];
    const rs = rootStateOf(name);
    // Honest empty states: attaching, mid-run catch-up, or truly nothing.
    const placeholder: TimelineItem = {
      kind: "divider",
      id: `rload-${name}`,
      text:
        load === undefined
          ? tt("attaching · loading history…")
          : load === "partial"
            ? tt("attached mid-run · catching up…")
            : tt("no conversation yet"),
    };
    return (
      <>
        <div className="ahead">
          <div className="r1">
            <BotAvatar seed={name} />
            <span className="nm">{name}</span>
            <span className="rel">
              {rs === "working" ? (
                <span className="run">{tt("running")}</span>
              ) : other?.state === "inactive" && load === undefined ? (
                <>{tt("inactive · a message wakes it")}</>
              ) : (
                <>{tt("idle")}</>
              )}
            </span>
          </div>
        </div>
        <Timeline items={items.length > 0 ? items : [placeholder]} />
      </>
    );
  };

  /** One pane's content. */
  const paneBody = (p: PaneView) => {
    if (p.kind === "empty") {
      return (
        <div className="pnote">{tt("nothing open — pick an agent on the left, or drag one here")}</div>
      );
    }
    if (p.kind === "learned")
      return (
        <LearnedView
          sel={learnedSel}
          epoch={lessonEpoch}
          roots={learnedRootsKey === "" ? [] : learnedRootsKey.split("\n")}
          onChanged={() => setLessonEpoch((n) => n + 1)}
        />
      );
    if (p.kind === "preview") {
      return (
        <PreviewView
          files={state.previewFiles}
          selectedPath={state.previewPath}
          timeline={state.timeline}
          onSelect={selectPreviewFile}
        />
      );
    }
    if (p.kind === "helper") {
      const child = state.children.find((c) => c.id === p.childId) ?? null;
      if (!child) {
        // Restored pane whose helper is gone; the roster snapshot reconciles
        // it away — until then, say so instead of inventing content.
        return (
          <div className="transcript">
            <div className="div">{tt("helper no longer here")}</div>
          </div>
        );
      }
      return (
        <HelperView
          child={child}
          events={state.helperEvents[child.id] ?? []}
          transcript={state.helperTranscripts[child.id] ?? []}
          working={state.helperWorking[child.id] || undefined}
          onStop={stopHelperById}
          onRemove={removeHelperById}
          onSend={sendToHelper}
        />
      );
    }
    if (p.kind === "root") return renderRootPane(p.name);
    // master gets the same one-line agent header as root/helper panes
    return (
      <>
        <div className="ahead">
          <div className="r1">
            <span className="chip master" />
            <span className="nm">master</span>
            <span className="rel">
              {tt("runs this workspace")} ·{" "}
              {state.master === "working" ? (
                <span className="run">{tt("running")}</span>
              ) : (
                <>{tt("idle")}</>
              )}
            </span>
          </div>
        </div>
        <Timeline items={state.timeline} onExample={send} />
      </>
    );
  };

  const focusedPane = currentPane(state);

  const paneTitle = (p: PaneView): string => {
    if (p.kind === "learned") return tt("Self-evolution");
    if (p.kind === "preview") return tt("Preview");
    if (p.kind === "helper") {
      const c = state.children.find((x) => x.id === p.childId);
      return c ? helperName(c) : tt("helper");
    }
    if (p.kind === "root") return p.name;
    if (p.kind === "empty") return "";
    return "master";
  };

  /** The chat input follows its pane: master timeline gets the to ▾ composer,
   *  a root pane gets one fixed to that root; helpers carry their own input. */
  const paneComposer = (p: PaneView) => {
    if (p.kind === "timeline") return composer();
    if (p.kind === "root") return rootComposer(p.name);
    return null;
  };

  /** Drag the gutter to resize the split; double-click resets to 50/50. */
  const gutterDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const panes = e.currentTarget.parentElement;
    if (!panes) return;
    const rect = panes.getBoundingClientRect();
    document.body.classList.add("resizing");
    const move = (ev: MouseEvent) => {
      const r = Math.min(0.8, Math.max(0.2, (ev.clientX - rect.left) / rect.width));
      setPaneRatio(r);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("resizing");
      setPaneRatio((r) => {
        saveJson(ratioKey, r);
        return r;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const center = () => {
    if (state.split) {
      // Two panes split by a draggable gutter; each pane carries its own tab
      // group and (for conversations) its own input.
      const fs = state.split.focusSide;
      return (
        <div className="panes">
          {renderPane("left", fs !== "left")}
          <div
            className="gutter"
            onMouseDown={gutterDown}
            onDoubleClick={() => {
              setPaneRatio(0.5);
              saveJson(ratioKey, 0.5);
            }}
          />
          {renderPane("right", fs !== "right")}
        </div>
      );
    }
    return renderPane(null, false);
  };

  /* ---- drag: tabs and agent rows both land on a half or a strip ---- */
  const agentKeyToView = (key: string): PaneView =>
    key === "master" ? { kind: "timeline" } : key.startsWith("root:") ? { kind: "root", name: key.slice(5) } : { kind: "helper", childId: key };
  const tabDragStart = (v: PaneView) => (e: React.DragEvent) => {
    dragViewRef.current = v;
    e.dataTransfer.setData("text/plain", v.kind);
    e.dataTransfer.effectAllowed = "move";
  };
  const tabDragEnd = () => {
    dragViewRef.current = null;
    setDropHint(null);
  };
  /** The dragged view: a center tab (ref) or an Agents-column row (dataTransfer). */
  const draggedView = (e: React.DragEvent): PaneView | null => {
    if (dragViewRef.current) return dragViewRef.current;
    const key = e.dataTransfer.getData("text/agent-key");
    return key ? agentKeyToView(key) : null;
  };
  const dragIsRelevant = (e: React.DragEvent) =>
    dragViewRef.current !== null || e.dataTransfer.types.includes("text/agent-key");
  const dropSide = (e: React.DragEvent<HTMLDivElement>): "left" | "right" => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? "left" : "right";
  };
  const bodyDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dragIsRelevant(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const side = dropSide(e);
    setDropHint((h) => (h === side ? h : side));
  };
  const bodyDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropHint(null);
  };
  const bodyDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const v = draggedView(e);
    dragViewRef.current = null;
    setDropHint(null);
    if (!v) return;
    e.preventDefault();
    dropPane(v, dropSide(e));
  };
  const tabsDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dragIsRelevant(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  /** A drop on a pane's own strip moves the view into that pane. */
  const tabsDropOn = (side: "left" | "right" | null) => (e: React.DragEvent<HTMLDivElement>) => {
    const v = draggedView(e);
    dragViewRef.current = null;
    setDropHint(null);
    if (!v) return;
    e.preventDefault();
    e.stopPropagation();
    dropPane(v, side ?? "left");
  };

  /** One pane's tab group: every open tab, active highlighted, each closable
   *  and draggable. The strip follows the pane — there is no global tab bar. */
  const paneTabs = (side: "left" | "right" | null, active: PaneView) => {
    const list = side === "right" ? state.tabsR : state.tabsL;
    return (
      <div className="tabs" onDragOver={tabsDragOver} onDrop={tabsDropOn(side)}>
        {list.map((t) => (
          <div
            key={`${t.kind}:${t.kind === "helper" ? t.childId : t.kind === "root" ? t.name : ""}`}
            className={sameView(t, active) ? "tab on" : "tab"}
            draggable
            onDragStart={tabDragStart(t)}
            onDragEnd={tabDragEnd}
            onClick={() => pickTab(side, t)}
          >
            {paneTitle(t)}
            <button
              className="tx"
              title={tt("close")}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(side, t);
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    );
  };

  const renderPane = (side: "left" | "right" | null, away: boolean) => {
    const p = side === null ? focusedPane : (activeOf(state, side) ?? { kind: "empty" as const });
    const grow = side === "left" ? paneRatio : side === "right" ? 1 - paneRatio : 1;
    return (
      <div
        key={side ?? "solo"}
        className={away ? "pane away" : "pane"}
        style={{ flexGrow: grow }}
        onMouseDownCapture={side ? () => focusPane(side) : undefined}
      >
        {paneTabs(side, p)}
        <div className="pbody">{paneBody(p)}</div>
        {paneComposer(p)}
      </div>
    );
  };

  return (
    <div className="app">
      {wsOpen && (
        <WorkspacePopup
          bridge={state.bridge}
          master={state.master}
          needsYou={needsYou}
          onClose={() => setWsOpen(false)}
        />
      )}
      {setOpen && (
        <SettingsPopup
          theme={state.theme}
          bridge={state.bridge}
          onToggleTheme={toggleTheme}
          onClose={() => setSetOpen(false)}
        />
      )}
      <div className="frame">
        <Rail
          column={state.column}
          workspace={state.bridge?.workspace || "general"}
          bridge={state.bridge}
          learnedOn={state.column === "learned"}
          learnedUnread={learnedUnread}
          onColumn={setColumn}
          onLearned={toggleLearned}
          onLogo={() => setWsOpen((v) => !v)}
          onSettings={() => setSetOpen((v) => !v)}
        />
        {state.column === "learned" ? (
          <LearnedColumn
            selected={learnedSel}
            epoch={lessonEpoch}
            roots={learnedRootsKey === "" ? [] : learnedRootsKey.split("\n")}
            autoRefine={state.autoRefine}
            online={Boolean(state.bridge?.connected)}
            onSelect={selectLearned}
            onToggleAuto={toggleAutoRefine}
          />
        ) : state.column === "skills" ? (
          <SkillsColumn />
        ) : state.column === "extensions" ? (
          <ExtensionsColumn />
        ) : state.column === "agents" ? (
          <AgentsColumn
            master={state.master}
            workspace={state.bridge?.workspace || "general"}
            children={state.children}
            claudeAgents={state.claudeAgents}
            others={state.others}
            selected={state.selectedAgent}
            selectedRoot={state.selectedRoot}
            rootStates={state.rootStates}
            working={state.working}
            helperWorking={state.helperWorking}
            rootWorking={state.rootWorking}
            onSelect={selectAgent}
            onSelectRoot={selectRoot}
            onRefreshOthers={refreshOthers}
          />
        ) : (
          <FilesColumn files={state.files} onOpenPreview={openPreview} />
        )}
        <div className="center">
          <div className="cbody" onDragOver={bodyDragOver} onDragLeave={bodyDragLeave} onDrop={bodyDrop}>
            {center()}
            {dropHint && <div className={`drophint ${dropHint}`} />}
          </div>
        </div>
        <Inspector
          goal={state.goal}
          bridge={state.bridge}
          heartbeats={state.heartbeats}
          autonomous={state.autonomous}
          selectedChild={selectedChild}
          selectedRoot={state.selectedRoot}
          rootGoal={state.selectedRoot ? state.rootGoals[state.selectedRoot] ?? null : null}
          rootAutonomous={
            state.selectedRoot ? state.rootAutonomous[state.selectedRoot] ?? null : null
          }
          autoRefine={state.autoRefine}
          rootAutoRefine={
            state.selectedRoot ? state.rootAutoRefine[state.selectedRoot] ?? null : null
          }
          rootLoaded={
            state.selectedRoot !== null &&
            Object.prototype.hasOwnProperty.call(state.rootGoals, state.selectedRoot)
          }
          refreshKey={inspectorKey}
          onRootRefresh={refreshRootStatus}
        />
      </div>
    </div>
  );
}
