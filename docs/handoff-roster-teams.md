# Handoff：roster 推送 + agent team 折叠（已完成）/ team 状态区（待对齐设计）

本次会话的背景：讨论"并发十几个乃至几百个 agent 时 UI 怎么设计"，已与用户对齐的
方向和本次落地的两件事都记录在这里，供另一个环境继续。

## 已对齐的设计方向（用户已确认）

- 设计不变量：**默认视图的可见信息量不随 agent 数量增长**。规模收进"例外"
  （needs you / 失败）和下钻；不做高密度监控墙（工程师式仪表盘被明确否决）。
- 十几个 agent：主语仍是 agent，注意力反转（needs-you 优先、其余折叠）；
  中心区两栏上限**保留**。
- 几百个 agent：主语换成"团队/批次"，单个 agent 降级为可下钻的明细。
- **多 agent 概览不做成对话流里的卡片**（用户判断在现有实现里不好做），
  改做**左侧 Agents 栏下方的 "agent team 状态"区域**。
  **team 的定义：有子 agent 的 agent 就是一个 team**——不引入"批次"新概念。
- team 状态区的**具体设计必须先和用户对齐再动手**（用户原话），见文末"待办"。

## 本次已落地并验证（tsc + vite build 通过，未真机验证）

### 1. daemon roster_update 推送接线（取代 30 秒轮询）

daemon 有现成能力：`roster_subscribe`（需 server capability `agent_roster`，
control 连接即可）返回全量 roster，之后按变更推 `roster_update
{changed, removed, resync?}`。条目 `AgentRosterEntry = {agentId, status:
"running"|"idle"|"inactive", summary: SessionSummary瘦身}`，**含 subagent 条目**
（`summary.runtimeKind === "subagent"`，父链接在 `summary.parentSessionId` /
`parentActiveSessionId`）。参考实现：prime-agent 仓库
`packages/coding-agent/src/modes/agents-view/roster-store.ts`。

改动：

- `electron/bridge.mjs`：新增 roster 缓存段（搜 "live agent roster"）。
  - `subscribeRoster()` 在 `connectDaemon()` 里 caps 拿到后调用（不 await，
    失败只是继续靠轮询）。订阅期间的竞态推送先入 `rosterPending` 缓冲，
    快照落地后重放（照抄 roster-store 的做法）。
  - onMessage 里同时监听 `daemon_hello`：传输层重连后服务端订阅已死，
    自动重订阅。
  - `rosterAgents()` 产出瘦身形状给渲染进程：非 master 的 root 列表
    `{name, state, kids?:[{name,state}]}`；subagent 按 parentSessionId join 到
    root 上成为 `kids`。**master 自己的 helper 不在此列**（它们的 parent 是
    master，不在 roots 里，join 不上自然掉出）——master 的 helper 继续走
    `snapshot.children`（信息更丰富：可选中、终态详情）。
  - 变更经 `broadcastRoster()`（microtask 合并）以 SSE `{type:"roster", agents}`
    广播；新 SSE 客户端连上时若 rosterLive 则重放一帧。
  - `GET /bridge/agents` 在 rosterLive 时直接从缓存出，老 daemon 走原 list 请求。
- `src/runtime/bridge.ts`：`BridgeMessage` 加 `{type:"roster", agents: RootAgent[]}`。
- `src/types.ts`：`RootAgent` 加可选 `kids?: RootKid[]`；新增 `RootKid`。
- `src/App.tsx`：`refreshOthers` 拆成 `applyOthers(others)`（reconcile 逻辑不变）
  + fetch 壳；SSE 新增 `roster` 分支（记 `rosterAtRef` 时间戳后 applyOthers）。
  30 秒轮询保留为兜底：**推送 90 秒内有到达就跳过 fetch**，推送断了自愈回轮询。

### 2. agent team 折叠（AgentsColumn）

- 其他 root 的 kids 以**只读行**进树：key `rk:${root}:${i}`，不可选中、不可拖、
  不接受 drop（`drop()` 里挡了 `rk:` 目标）。真实父子关系记在 memo 返回的
  `kin` record 里，`parentOf` / `wouldCycle` 都查它。
- **root team 默认折叠**（一行代表全队），master 默认展开（它是工作区自身上下文）；
  折叠按钮在折起时显示 `▸ N`（N=子行数）。用户的手动开合仍按 workspace 存
  localStorage（`agents-fold:*`），语义改为"覆盖默认值"。

### 已知边界 / 未验证项

- **未连真 daemon 验证**（本环境额度不足）。验证路径：跑 `npm run bridge` + dev
  server，另开 terminal 用 prime-agent 建几个非 master root 并让其 spawn 子 agent，
  确认：左栏 root 秒级出现/消失、team 折叠行 `▸ N`、掉推送 90s 后轮询接管。
- roster 的 kid 行状态只有粗粒度 running/idle/inactive（roster 没有 needs-you
  语义）；needs-you 目前只对 master 的 helper 存在（前端从事件流推导）。
  做 team 状态区时要决定：daemon 侧扩展 roster 语义，还是对例外 agent 选择性
  attach 补细节。
- `flavorTag(k.name, k.state)` 给 kid 行的是 flavor 文案（"off duty" 等），
  i18n 词条已全部存在，无新增词条。

## 待办（按优先级）

1. **team 状态区设计对齐**（必须先过用户）：位置定在左栏 Agents 列表下方。
   我准备提给用户的方案雏形（尚未提出，仅供起草参考）：一个极简聚合块，
   只在存在 team 时出现，每 team 一行：身份色小块 + team 名 + `N running` +
   needs-you/失败计数（红，仅非零时显示）；点击行=选中该 root。整块高度
   受限，超出滚动。切记用户审美：直角、mono、克制、可见字数 ≤140。
2. 真机端到端验证上面两个功能。
3. （远期，已对齐方向但未排期）几百 agent 时的下钻视图与 AppState 收敛
   （8 个 per-agent Record → `Record<agentId, AgentRuntime>`）、列表虚拟化。

## 相关记忆/文档

- 用户决策记忆：`~/.claude/projects/-workspace/memory/` 下
  `prime-desktop-multiagent-ui.md`（本方向）、`prime-agent-ui-extreme-restraint.md`
  （视觉约束）、`prime-desktop-build-decisions.md`（流程约束）。
- daemon 能力矩阵：`docs/daemon-integration.md`（roster 行在 §表格）。
