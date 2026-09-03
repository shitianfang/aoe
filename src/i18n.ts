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
  "Self-evolution": "自进化",
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
  "delete workspace": "删除工作区",
  "see what it can do": "看看它能做什么",
  "a fresh workspace with examples": "开一个带示例的新工作区",
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
  queued: "排队中",
  done: "完成",
  error: "错误",
  "no reply": "未回复",

  /* agents column */
  "new agent": "新建智能体",
  "new agent name…": "新智能体名称…",
  "create failed": "创建失败",
  "delete agent": "删除智能体",
  delete: "删除",
  "delete failed": "删除失败",
  /* agents column: task lines + the sample crew shown before anything has run */
  "example · real helpers replace this": "示例 · 有真实助手后即被替换",
  example: "示例",
  "example · a real helper's own words appear here": "示例 · 真实助手会在这里说自己的话",
  "Four files, all at the top level. `notes.md` is the only one with real content — a page outline. Nothing references anything else, so this can be rebuilt from scratch without breaking a link.":
    "四个文件,都在顶层。只有 `notes.md` 有实质内容 —— 一份页面提纲。文件之间没有互相引用,所以从头重做也不会弄断链接。",
  "`today.html` written — one file, no external assets. Header, a three-block day view, and a footer. Style is a placeholder; I left the class names for stylist to work against.":
    "`today.html` 写好了 —— 单文件,不依赖外部资源。页头、三段式日程、页脚。样式先占个位,类名留给 stylist 接手。",
  "Type and spacing done. Publishing the first version now so there is something to compare the next pass against.":
    "字体和间距调完了。先发一版出去,下一轮改完才有东西可以对比。",
  "ask master for a team and they appear here, each with its task.":
    "让 master 组个小队,他们就会出现在这里,每个人带着自己的任务。",
  "read the workspace and list what is here": "通读工作区,列出这里都有什么",
  "write the page structure into today.html": "把页面结构写进 today.html",
  "restyle it and publish a version": "重新配好样式,发布一版",
  "compare the last two versions and report": "对比最近两版,汇报差异",
  "{n} inactive": "{n} 个已结束",
  "{n} running": "{n} 个运行中",
  "on {name}'s team": "{name} 的队员",
  "{n} need you": "{n} 个需要你",
  "{n} failed": "{n} 个失败",
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

  /* first open: the three showcase cards + the sample lesson */
  "first time here — try one:": "第一次来 —— 试试这些:",

  "One AI, a whole crew": "一个 AI,带一整支小队",
  "the left column fills up": "左边那栏会站满",
  "Send twelve helpers out, one idea each: things a desktop agent could do for me. Then rank them.":
    "派十二个助手出去,一人想一个点子:桌面智能体能替我做的事。然后排个序。",

  "Builds it, then makes it better": "先做出来,再一版版改好",
  "Preview opens itself, versions side by side": "预览会自己打开,几版并排看",
  "Make a poster in poster.html — one file, style inline. Then improve it three times: layout, colour, type. Publish each pass.":
    "做一张海报 poster.html,单文件、样式写在里面。然后改三轮:版式、配色、字体,每轮发一版。",

  "Keeps working while you are away": "你不在的时候,它接着干",
  "it picks its own driver": "它自己挑用哪种方式撑着跑",
  "Keep an eye on this workspace while I'm away: log what changes, and what you'd do about it.":
    "我不在的时候帮我盯着这个工作区:记下有什么变化,还有你打算怎么办。",

  "keep reports under three sentences": "汇报控制在三句话以内",
  "example · real records replace this": "示例 · 有真实记录后即被替换",

  /* composer model pick; on/off are also the Inspector's unattended chip words */
  model: "模型",
  on: "启用",
  off: "关闭",

  /* files column */
  "no file activity yet.": "还没有文件活动。",
  "files agents edit will appear here — who changed what, when.":
    "智能体改动的文件会出现在这里 —— 谁、改了什么、什么时候。",
  "who changed what, when.": "谁、改了什么、什么时候。",
  "open an html, md, png or pdf file to preview it.": "打开 html、md、png 或 pdf 文件即可预览。",
  diff: "对比",

  /* self-evolution column (⚡) */
  "what agents pick up while working — later work uses it.":
    "agent 工作中自己学到的改进 —— 以后会用上。",
  "nothing learned yet.": "还没有自进化的记录。",
  "agents keep small improvements as they work — they appear here on their own.":
    "agent 干活时会自己记下小改进,自动出现在这里。",
  "let agents learn on their own": "开启自主学习",
  "about every {n} turns, or when it tidies its context — at most once per {m} minutes.":
    "大约每 {n} 轮、或整理上下文时自动学一次;两次至少间隔 {m} 分钟。",
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
  "long-running": "长程自主",
  "{name} sets up an objective, a wake-up schedule or unattended itself, and says which.":
    "让 {name} 自己选一种方式跑下去——设目标、定时唤醒、或自动运行——并说明选了哪个。",
  "long-running · asked it to set up its own driver": "长程自主 · 已请它自行安排驱动方式",
  "to {name}": "发往 {name}",
  SEND: "发送",
  STOP: "停止",
  "other agents": "其他智能体",
  objective: "目标",
  "unattended {used} of {max}": "自动运行 {used}/{max}",
  "unattended on": "自动运行已开",
  "check failed": "检查失败",
  "next check-in {at}": "下次跟进 {at}",
  "runtime offline · model only": "后台服务离线 · 仅模型",
  "waiting on helpers": "等待助手",
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
  manual: "主动",
  "the agent": "智能体",

  /* harness entry kinds (HANDOFF §2) — subagent is a helper in product words */
  prompt: "提示词",
  memory: "记忆",
  skill: "技能",
  subagent: "助手",
  /* one applied edit, in words instead of "create memory:some_id" */
  "added a {kind}": "新增了一条{kind}",
  "updated a {kind}": "更新了一条{kind}",
  "removed a {kind}": "删除了一条{kind}",
  "no change": "无改动",
  "nothing was changed — the review kept everything as it was.":
    "这次评估后什么都没改 —— 原样保留。",

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
  preview: "预览",
  previous: "上一版",
  "side by side": "并排",
  "{who} is writing": "{who} 正在写",
  "{n} versions kept": "留了 {n} 版",

  /* inspector */
  "check-in": "定时跟进",
  unattended: "自动运行",
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
  Unattended: "自动运行",
  "Turns on with these limits. It steps in only after a failed check or a turn without evidence.":
    "按下面这些上限开启。仅在检查失败、或某轮没有交付证据时才续跑。",
  "Steps in only after a failed check or a turn without evidence; stops at any limit. The objective continues regardless.":
    "仅在检查失败、或某轮没有证据时续跑；触及任一上限即停止。目标不受影响，继续推进。",
  Continued: "续跑次数",
  Turns: "轮数",
  Tokens: "用量",
  Time: "时间",
  "{used} of {max}": "{used}/{max}",
  "limit {max}": "上限 {max}",
  "{n}m": "{n} 分钟",
  "Last continued": "上次续跑",
  "last check failed · {command}": "上次检查失败 · {command}",
  "turn off": "关闭",
  "turn unattended on": "开启自动运行",
  turns: "轮数",
  tokens: "用量",
  time: "时长",
  continued: "续跑次数",
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

  /* inspector · self-evolution (manual /refine + auto rhythm readout) */
  "learn now": "学习一次",
  "anything to focus on? (optional)": "想让它注意什么?(可选)",
  "start learning": "开始学习",
  "learning… this can take a few minutes.": "正在学习… 可能需要几分钟。",
  "learn failed": "学习失败",
  "last auto review {at}": "上次自动评估 {at}",
  "next auto learn no earlier than {at}": "下次自动学习不早于 {at}",

  /* inspector · subject binding */
  Task: "任务",
  "billed to master": "计入 master",
  Model: "模型",
  "runs for master — its objective, check-ins and model live on master":
    "为 master 工作 —— 目标、定时跟进和模型都在 master 身上",
  "loading state…": "状态载入中…",
};
