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
  "ask master for a team and they appear here, each with its task.":
    "让 master 组个小队,他们就会出现在这里,每个人带着自己的任务。",
  "audit the data in raw/":
    "盘一遍 raw/ 的数据",
  "Nothing gets touched yet — what we can claim depends on what is actually in raw/.":
    "先不动任何东西 —— 能下什么结论,取决于 raw/ 里真有什么。",
  "Three files. `orders_2025q3.csv` is 48,912 rows covering July to September, with enough columns for revenue, order count and average order value. `refunds.csv` and `regions.xlsx` cover the rest.":
    "三个文件。`orders_2025q3.csv` 有 48,912 行,覆盖 7 到 9 月,字段够算收入、订单数和客单价。`refunds.csv` 和 `regions.xlsx` 补上其余部分。",
  "Two problems, both from the re-run export on 8/17: 1,204 rows have no `region` (2.5%), and 316 order ids appear twice. Neither is fatal — but any average computed before fixing them is wrong.":
    "两个问题,都出自 8/17 那次重跑导出:1,204 行没有 `region`(2.5%),316 个 order_id 出现了两次。都不致命 —— 但不先修就算平均值,数字是错的。",
  "A third one, subtler: refunds are stamped UTC, orders are local. Joined as they are, any refund before 8am local falls back onto the day before — and at the turn of each month, into the month before.":
    "第三个更隐蔽:退款是 UTC 时间戳,订单是本地时间。直接 join 的话,本地时间早上 8 点之前的退款会退回到前一天 —— 每逢月初,就退到上一个月。",
  "It can be built. `notes/data-audit.md` now holds the three fixes and the definitions I would hold everyone to: revenue booked by local order time, refunds reported on their own line and never netted off.":
    "能做。`notes/data-audit.md` 里写好了三处修法,以及要求所有人统一的口径:收入按订单的本地时间归月,退款单独一行汇报、不冲抵收入。",
  "clean the data and compute the quarter":
    "清洗数据,算出季度",
  "Fixes first, numbers second — the other order produces a plausible-looking wrong answer.":
    "先修,再算 —— 反过来会算出一个看着挺像样的错数。",
  "316 duplicates dropped. 1,187 of the missing regions came back from the store map in `regions.xlsx`; the last 17 belong to closed stores, so they get their own bucket rather than a guess.":
    "316 条重复已去掉。缺失的 region 里有 1,187 行靠 `regions.xlsx` 的门店映射补了回来;剩下 17 行属于已关停门店,单独归一类,不猜。",
  "Q3: revenue ¥8,412,660, up 11.3% on Q2. 48,596 orders, average order value ¥173.1 — down 2.4%. The quarter grew on volume, not on basket size.":
    "三季度:收入 ¥8,412,660,环比 +11.3%。48,596 单,客单价 ¥173.1,环比 -2.4%。这个季度是靠单量涨起来的,不是靠客单价。",
  "All of the growth is East and South China. Southwest has been negative two months running — 6.8% then 9.1% — and refunds there run 5.2% against 3.1% nationally. That is the one thing in this quarter worth acting on.":
    "增长全部来自华东和华南。西南连续两个月负增长 —— 先 -6.8%,再 -9.1% —— 当地退款率 5.2%,全国是 3.1%。这个季度里真正值得动手的就这一件事。",
  "Cross-checked: the total rebuilt from `data/figures.json` matches the raw sum to the cent. Figures and charts are in `data/` — writer can quote them directly.":
    "对过账:用 `data/figures.json` 反推的总额,和原始表求和分毫不差。数字和图都在 `data/`,writer 可以直接引。",
  "write it into a one-page report and publish":
    "写成一页报告并发布",
  "One page, one file, no external assets — it has to open for whoever it gets forwarded to. The finding goes at the top.":
    "一页、一个文件、不依赖外部资源 —— 转发给谁都得能直接打开。结论放最上面。",
  "Draft is up: the one-line finding, four headline numbers, the regional table, the revenue chart, and the definitions at the foot so nobody re-litigates the numbers. The chart is inlined as base64, so it stays a single file.":
    "初稿好了:一句话结论、四个关键数、区域对比表、那张收入曲线,页脚放口径说明,免得有人回头再争数字。图 base64 内嵌,所以整页仍然只有一个文件。",
  "First version published — it should have opened on the right. Reading it back: the Southwest finding is buried in the regional table, which is the wrong place for the only actionable thing in here.":
    "第一版发出去了 —— 右边应该自动打开了。回头读了一遍:西南那个结论埋在区域对比表里,而它是全篇唯一能落地的东西,位置不对。",
  "Second pass: Southwest is its own block under the headline, the table drops to supporting evidence, and the type scale is down to two sizes. Publishing so the two versions can sit side by side.":
    "第二轮:西南单独成块,提到结论下面;表格降为佐证;字号收到两级。这就发出去,两版可以并排看。",
  "check the numbers in both versions":
    "核对两版报告的数字",
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
  "first time here — try one:": "试试这些",

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
    "智能体干活时学到的改进 —— 之后会用上。",
  "nothing learned yet.": "还没学到东西。",
  "agents keep small improvements as they work — they appear here on their own.":
    "智能体干活时会自己记下小改进,自动出现在这里。",
  "let agents learn on their own": "让智能体自己学",
  "about every {n} turns, or when it tidies its context — at most once per {m} minutes.":
    "大约每 {n} 轮学一次,清理旧对话时也会学;两次之间至少隔 {m} 分钟。",
  "for one agent": "只给某个智能体",
  "for every workspace": "所有工作区通用",
  "something new": "有新内容",
  "kept everywhere": "已应用到所有工作区",

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
  "runs workspace {ws}": "负责工作区 {ws}",
  "switch top-left": "左上角可切换",

  /* composer */
  "Message {name}…": "发消息给 {name}…",
  "delivered now": "立即送达",
  "NIM: {used} of ~{limit} requests this minute. The free tier's ceiling is per key and shared by every model, so this counts the runtime's calls as well as this window's.":
    "NIM：本分钟已用 {used} 次，上限约 {limit} 次。免费额度按 key 计、所有模型共用，所以这里也算上了运行时自己发的请求。",
  "NVIDIA just answered 429. {used} of ~{limit} requests this minute; {inflight} in flight — about five at once is where it starts refusing.":
    "NVIDIA 刚返回了 429。本分钟 {used}/{limit} 次，正在飞 {inflight} 个——大约五个并发就会开始被拒。",
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
  "kept for this workspace": "只给这个智能体",
  "from {source}": "{source}发起",
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
  "reviewing…": "学习中…",
  "apply everywhere": "应用到所有工作区",
  "runs a new review — result may differ": "会重新学一次 —— 结果可能不同",
  "roll back failed": "撤销失败",
  "apply everywhere failed": "应用失败",
  auto: "自动",
  manual: "主动",
  "the agent": "智能体",

  /* harness entry kinds (HANDOFF §2) — subagent is a helper in product words */
  prompt: "提示词",
  memory: "记忆",
  skill: "技能",
  subagent: "助手",
  /* one applied edit, in words instead of "create memory:some_id" */
  "added a {kind}": "新增了{kind}",
  "updated a {kind}": "更新了{kind}",
  "removed a {kind}": "删除了{kind}",
  "no change": "无改动",
  "nothing was changed — the review kept everything as it was.":
    "这次学习没有改动 —— 原样保留。",

  /* self-evolution: the two altitudes, and the overview's numbers */
  "knows now": "现在记着",
  "learning log": "学习记录",
  "revised ×{n}": "改过 {n} 次",
  "undid an earlier lesson": "撤销了一次学习",
  "looked, found nothing to change": "看过一遍,没有要改的",
  "it has not run a round yet.": "它还没学过。",
  "kept now": "现在记着",
  "rounds run": "学过",
  "undone": "其中撤销",
  "changed nothing": "其中没改动",
  "{n} rounds": "{n} 次",
  "where it came from": "怎么来的",
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
  "{n} takes to pick from": "{n} 版方案待选",

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
  "last auto review {at}": "上次自动学习 {at}",
  "next auto learn no earlier than {at}": "下次自动学习最早 {at}",

  /* inspector · subject binding */
  Task: "任务",
  "billed to master": "计入 master",
  Model: "模型",
  "runs for master — its objective, check-ins and model live on master":
    "为 master 工作 —— 目标、定时跟进和模型都在 master 身上",
  "loading state…": "状态载入中…",
};
