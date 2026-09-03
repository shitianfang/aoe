import { useSyncExternalStore } from "react";

/** Two languages, no framework: one dictionary keyed by the English source
 *  string. A missing key falls back to the key itself, so English needs no
 *  table and a forgotten string degrades to readable English, never a blank. */
export type Lang = "zh" | "en";

export const LANGS: ReadonlyArray<{ id: Lang; label: string }> = [
  { id: "zh", label: "中文" },
  { id: "en", label: "English" },
];

const KEY = "lang";

function load(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "zh" || v === "en") return v;
  } catch {
    /* private mode */
  }
  return "zh"; // Chinese until you say otherwise
}

let lang: Lang = load();
const listeners = new Set<() => void>();

function stampHtml() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
}
stampHtml();

export function getLang(): Lang {
  return lang;
}

export function langLabel(l: Lang): string {
  return LANGS.find((x) => x.id === l)?.label ?? l;
}

export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode */
  }
  stampHtml();
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Re-renders the component when the language changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

/** Translate. `{name}` placeholders are filled from `vars`. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const s = (lang === "zh" ? ZH[key] : undefined) ?? key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined ? m : String(vars[k])));
}

/** `t` bound to the current language — use this inside components so they
 *  re-render when the language changes. */
export function useT(): typeof t {
  useLang();
  return t;
}

/* ---- zh-CN ----
 * Product words stay as terse as the English: this UI is deliberately quiet.
 * Agent names (master, helpers, roots) are identities, not words — never
 * translated. */
const ZH: Record<string, string> = {
  /* rail + columns */
  Agents: "智能体",
  Files: "文件",
  Learned: "经验",
  Skills: "技能",
  Extensions: "扩展",
  Preview: "预览",
  "{ws} · switch workspace": "{ws} · 切换工作区",
  "you · settings": "你 · 设置",

  /* workspaces popup */
  Workspaces: "工作区",
  pinned: "已固定",
  "loading…": "加载中…",
  "new workspace…": "新建工作区…",
  "not open": "未打开",
  "master {state}": "master {state}",
  "{n} needs you": "{n} 项需要你",

  /* settings popup */
  Settings: "设置",
  Theme: "主题",
  Language: "语言",
  Runtime: "后台服务",
  dark: "深色",
  light: "浅色",
  "runtime ok": "服务正常",
  "model only": "仅模型",

  /* agent state words */
  running: "运行中",
  idle: "空闲",
  replied: "已回复",
  "needs you": "需要你",
  failed: "失败",
  stopped: "已停止",
  inactive: "未活动",
  off: "未运行",
  queued: "排队中",
  done: "完成",
  error: "错误",
  "no reply": "未回复",

  /* agents column */
  "new agent": "新建智能体",
  "new agent name…": "新智能体名称…",
  "create failed": "创建失败",
  "master runs this workspace.": "master 负责这个工作区。",
  "helpers appear here when it starts them.": "它启动的助手会出现在这里。",
  "{n} inactive": "{n} 个已结束",
  show: "展开",
  hide: "收起",

  /* flavor tags */
  daydreaming: "发呆中",
  "sulking in the lobby": "在大厅里闲坐",
  "sipping coffee": "喝着咖啡",
  "watching the clock": "盯着时钟",
  "waiting for a ping": "等一条消息",
  "counting pixels": "数像素",
  "heads down": "埋头干活",
  cooking: "正在开火",
  "in the zone": "状态正好",
  "making sparks": "火花四溅",
  "waiting on you": "等你回应",
  "left you a note": "给你留了话",
  "tripped on something": "撞上了问题",
  "clocked out": "下班了",
  "off duty": "休息中",

  /* catalogs */
  "no skills installed.": "尚未安装技能。",
  "nothing here yet.": "这里还没有内容。",

  /* files column */
  "no file activity yet.": "还没有文件活动。",
  "files agents edit will appear here — who changed what, when.":
    "智能体改动的文件会出现在这里 —— 谁、改了什么、什么时候。",
  "who changed what, when.": "谁、改了什么、什么时候。",
  "open an html, md, png or pdf file to preview it.": "打开 html、md、png 或 pdf 文件即可预览。",
  diff: "对比",

  /* learned column (⚡) */
  "what agents pick up while working — later work uses it.":
    "agent 工作中自己学到的改进 —— 之后的工作会用上。",
  "nothing learned yet.": "还没有经验。",
  "agents keep small improvements as they work — they appear here on their own.":
    "agent 干活时会自己记下小改进,自动出现在这里。",
  "for one agent": "只属于某个 agent",
  "for every workspace": "所有工作区通用",
  "something new": "有新内容",
  "kept everywhere": "已在所有工作区",

  /* timeline */
  "lesson kept · {summary}": "记下经验 · {summary}",
  "lesson kept": "记下经验",
  view: "查看",
  "{count} earlier turns · show": "{count} 轮更早的对话 · 展开",
  "running…": "运行中…",
  "session started · {at}": "会话开始 · {at}",
  "workspace {ws} · {at}": "工作区 {ws} · {at}",
  "stopped by you · {at}": "你已停止 · {at}",
  "published · {label}": "已发布 · {label}",
  "delivered · {at}": "已送达 · {at}",
  "queued, lands at its next step": "已排队,将在下一步送达",
  "msg ← {from}": "{from} 发来消息",

  /* panes */
  "nothing open — pick an agent on the left, or drag one here":
    "没有打开的内容 —— 在左侧选一个智能体,或拖一个到这里",
  "helper no longer here": "该助手已不在",
  helper: "助手",
  close: "关闭",
  "attaching · loading history…": "连接中 · 载入历史…",
  "attached mid-run · catching up…": "中途连上 · 正在补齐进度…",
  "no conversation yet": "还没有对话",
  "inactive · a message wakes it": "未活动 · 发消息可唤醒",
  "runs this workspace": "负责这个工作区",

  /* composer */
  "Message {name}…": "发消息给 {name}…",
  "delivered now": "立即送达",
  "to {name}": "发往 {name}",
  SEND: "发送",
  STOP: "停止",
  "other agents": "其他智能体",
  objective: "目标",
  "unattended {used} of {max}": "无人值守 {used}/{max}",
  "unattended on": "无人值守已开",
  "check failed": "检查失败",
  "next check-in {at}": "下次跟进 {at}",
  "runtime offline · model only": "后台服务离线 · 仅模型",
  "waiting on helpers": "等待助手",
  "master running": "master 运行中",
  "master idle": "master 空闲",
  "{name} {state}": "{name} {state}",
  "stop failed": "停止失败",
  "remove failed": "移除失败",
  "message failed": "发送失败",
  "bridge command failed": "bridge 命令失败",

  /* helper view */
  "queued · not yet started": "排队中 · 尚未开始",
  "not yet replied": "尚未回复",
  "finished{done}": "已完成{done}",
  "no reply yet": "尚无回复",
  "still reachable": "仍可联系",
  "ran inline, not reachable": "当场跑完,联系不上",
  "failed{done}": "失败{done}",
  "stopped{done}": "已停止{done}",
  "own cost billed to master": "开销计入 master",
  finished: "已完成",
  "stop helper": "停止助手",
  "remove helper": "移除助手",
  "Task — “{label}”": "任务 —— “{label}”",
  "not reachable — ran inline or removed": "联系不上 —— 当场跑完或已移除",
  "transcript · nothing yet": "对话记录 · 暂无",
  observed: "观察到",
  "nothing observed yet": "还没观察到什么",
  "{name} ran inline — not reachable": "{name} 当场跑完 —— 联系不上",
  "started by master": "由 master 启动",
  "finished without replying": "完成但未回复",
  "answered master · ran inline": "已答复 master · 当场跑完",
  "reply to master": "给 master 的答复",
  "wrapped up": "收工了",
  "failed · {error}": "失败 · {error}",

  /* lessons */
  "kept for this workspace": "仅本工作区保留",
  "from {source}": "来自 {source}",
  "rolls back {id}": "撤销了 {id}",
  summary: "摘要",
  evidence: "依据",
  edits: "改动",
  expected: "预期",
  "none recorded": "无记录",
  "not applied": "未应用",
  "(not checked by the system)": "(系统不会核实)",
  "rolled back": "已撤销",
  "rolling back…": "撤销中…",
  "roll back {id}": "撤销 {id}",
  "roll back": "撤销",
  "reviewing…": "评估中…",
  "apply everywhere": "应用到所有工作区",
  "runs a new review — result may differ": "会重新评估一次 —— 结果可能不同",
  "roll back failed": "撤销失败",
  "apply everywhere failed": "应用到所有工作区失败",
  auto: "自动",
  "you asked": "你要求的",
  "the agent": "智能体",

  /* harness entry kinds (HANDOFF §2) — subagent is a helper in product words */
  prompt: "提示词",
  memory: "记忆",
  subagent: "助手",

  /* learned pane (one lesson's full record) */
  lesson: "经验",
  "pick a lesson on the left to see its full record.": "在左侧点一条经验,查看完整记录。",
  "this lesson is no longer in the record.": "这条经验已不在记录里。",
  "why it was kept": "为什么记下",
  "what changed": "改了什么",

  /* preview */
  "nothing published yet — files an agent writes will preview here.":
    "还没有发布内容 —— 智能体写入的文件会在这里预览。",
  live: "实时",
  published: "已发布",
  current: "当前",
  "unsaved this turn": "本轮未保存",
  "between {from} → {to}": "{from} → {to} 之间",

  /* inspector */
  "check-in": "定时跟进",
  unattended: "无人值守",
  "driven by you": "由你推进",
  "driven by objective": "目标推进中",
  Status: "状态",
  Budget: "预算",
  Objective: "目标",
  none: "无",
  resume: "继续",
  pause: "暂停",
  clear: "清除",
  "master acts when you message it. An objective keeps it going on its own.":
    "你发消息时 master 才行动。设定目标可让它自行推进。",
  "master acts when you message it. Objectives and check-ins need the runtime (bridge offline).":
    "你发消息时 master 才行动。目标与签到需要运行时(bridge 离线)。",
  "set an objective…": "设定一个目标…",
  "set an objective for {name}…": "给 {name} 设定一个目标…",
  "{name} acts when you message it. An objective keeps it going on its own.":
    "你发消息时 {name} 才行动。设定目标可让它自行推进。",
  "{name} acts when you message it. Objectives and check-ins need the runtime (bridge offline).":
    "你发消息时 {name} 才行动。目标与定时跟进需要运行时(bridge 离线)。",
  Unattended: "无人值守",
  "Turns on with these limits. It steps in only after a failed check or a turn without evidence.":
    "按下面这些上限开启。仅在检查失败、或某轮没有交付证据时才介入。",
  on: "开",
  "Steps in only after a failed check or a turn without evidence; stops at any limit. The objective continues regardless.":
    "仅在检查失败、或某轮没有证据时介入;触及任一上限即停止。目标不受影响,继续推进。",
  Continued: "介入次数",
  Turns: "轮数",
  Tokens: "用量",
  Time: "时间",
  "{used} of {max}": "{used}/{max}",
  "limit {max}": "上限 {max}",
  "{n}m": "{n} 分钟",
  "Last continued": "上次介入",
  "last check failed · {command}": "上次检查失败 · {command}",
  "turn off": "关闭",
  "turn unattended on": "开启无人值守",
  turns: "轮数",
  tokens: "用量",
  time: "时长",
  continued: "介入次数",
  "Re-entry": "自动唤醒",
  "check-in · agent": "定时跟进 · 智能体设的",
  paused: "已暂停",
  "next {when}": "下次 {when}",
  soon: "稍后",
  sched: "排期",
  cancel: "取消",
  "new check-in": "新建定时跟进",
  "every 5m": "每 5 分钟",
  "every 15m": "每 15 分钟",
  "every 30m": "每 30 分钟",
  "every 1h": "每小时",
  "every 3h": "每 3 小时",
  daily: "每天",
  "wake it with this prompt…": "到点用这条提示唤醒它…",
  add: "添加",
  apply: "设定",
  "after a failed check": "检查失败后",
  "no evidence in the turn": "本轮没有证据",
  active: "进行中",
  budget_limited: "预算用尽",
  complete: "已完成",

  /* inspector · subject binding */
  Task: "任务",
  "billed to master": "计入 master",
  "runs for master — its objective and check-ins live on master":
    "为 master 工作 —— 目标与定时跟进都在 master 身上",
  "loading state…": "状态载入中…",
};
