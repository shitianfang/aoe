# HANDOFF：长程自主运行模式（长程自主开关 + autonomous skill）


> 写于本仓库把客户端与运行时并库之前。当时二者是两个独立 checkout，文中的 `core/`
> 和 `仓库根` 是对它们的回指；结论仍然有效，路径按现在的单仓布局读。

写于 2026-09-03，会话 c982c5f6。接手的人或 agent 先读本文，再读 `shitianfang/prime-agent-client-handoff` 的 `HANDOFF.md`（原始交互设计，词表在 §4，铁律在 §0；仓库 `shitianfang/prime-agent-client-handoff`）。

本文覆盖的是**实现**，不是设计。设计线的结论不重复。

## ✅ 续跑记录（2026-09-03，会话 c7ff6d26）：本文的待办已全部完成

接手会话把 §6 的六项全部做完。本节之后的原文保留作背景，其中"未验证 / 未推送"的表述已过时：

- **§3 六处修复全部复核通过**，含 3.1 末尾那条"不必再走 `_agentEventQueue`"的判断（`_processAgentEvent` 本身就在队列里串行执行，成立）。
- **§4 说"现有 harness 做不到中途调用"是错的**：`agent-session-goal.test.ts` 的 `createFauxIpythonTool` 就是现成模式。已补 3.1 回归测试（真实 turn 中途经假 ipython 工具分发 host request），并做了变异验证——把 emit 改回立即执行，测试确实变红。
- **实机 E2E 抓到一个所有单测和两轮审查都漏掉的致命 bug**：kernel 传输层把信封字段并进 payload（`rlm/__init__.py:81` 混入 `type`，`repl-manager.ts` 加 `cellSourceCode`），而 `parseAutonomousLimitPayload` 遍历所有键，导致**每次真实 `autonomous.enable` 调用都报 usage 错**。修法：只读四个具名限额键（与 goal/preview handler 惯例一致）；测试里的假 ipython 工具现在携带真实信封，这类错配以后单测能抓到。教训：**host handler 的单测必须带传输信封**。
- **实机全链路验证通过**（隔离 bridge:3217 + 独立 socket/workspace 的 daemon + master@e2e，NIM 真模型）：带前缀发长任务 → master 只选一个驱动并一行说明理由（选了 `goal.create`，带 `token_budget=400000`）；信封修复并重启 daemon 后 `autonomous.enable(turns=3, time="5m")` 成功，续跑机制真实运转（观察到 continuationsUsed/turnsUsed 增长）；abort 后 `autonomous_status` 落盘在 toolResult 之后——3.1 修复在生产成立，中止路径的冲刷也正常。
- **fable 两轮对抗性审查放行**（SAFE TO PUSH）。fork 已推送：`fork/main` = `2d8f6cccc`（`d91113c00` 功能、`dc78aa4c7` 键护栏+回归测试、`2d8f6cccc` 信封修复）。`d91113c00` 在推送前已被另一会话先推上去。
- **§6.5/6.6 已修并推送**（本仓库 `a32acfa`：dev:bridge 指向真实路径、README Status 刷新；顺带带上了这两个文件里进行中的 AOE 更名段）。
- 审查留下两个不阻塞的已知项：(i) `clearedDispatchEnded`/`!msg` 早退路径上 status 落盘会推迟到下一轮末（连接快照仍实时，纯外观）；(ii) 限额键白名单大小写敏感，手写 `host_request` 传 `{Turns:"5"}` 会被静默忽略（bundled skill 只发小写，无真实调用方受影响）。
- §7 的两个真实缺口仍在：客户端没有暴露 goal 的 `--budget` 输入；autonomous gate 命令只能从启动参数配，bridge 没传。
- 运行须知：daemon 硬性要求 Node ≥22.8，本机在 `/home/vscode/.local/node22/bin/node`（`/usr/bin/node` 是 20，直接拒起）；daemon/worker 进程 argv 被改写成 `prime-agent`，按 cmdline 找不到，要用 `/proc/<pid>/environ` 或 cwd 定位。

## 0. 三十秒摘要

- 目标：客户端加一个「长程自主」开关，勾上以后发消息，由 master 自己在三种续跑方式里**选一种**建起来，参数它自己填。
- 三种方式里原本只有两种能被 agent 调用（`goal.create`、`rlm_heartbeat.create`），自动运行没有 agent 侧 API，所以给 fork 补了 `autonomous.*` host request + 一个 bundled skill。
- 客户端不做任何判断、不替用户开任何东西：勾上只是在消息前面加一段**明确请求**，剩下由模型决定。两个 skill 的护栏原文都是 "only when the user or system/developer instructions explicitly ask"，这段前缀就是那句明确请求。
- 已经过一轮 fable 子 agent 对抗性审查，查出 1 个致命 + 2 个高危 + 3 个中低，**全部已修**。修复本身尚未复核，这是交给你的第一件事。
- **端到端一次都没跑过。** fork 没有 `npm run build`，所以"勾选 → master 调 `autonomous.enable` → 右栏亮起"这条链路从未实际执行。

## 1. 当前仓库状态

| 仓库 | 位置 | 本次提交 | 状态 |
|---|---|---|---|
| fork | `core/` | `d91113c00` | **未推送**。相对 `fork/main`(`bfa11f049`) ahead 1，相对上游 `origin/main` ahead 7 |
| 客户端 | `仓库根` | `167f158` | **已被其他会话 push 到 origin/main**，内容是审查修复后的版本（已核对 `stripLongRun`、`masterComposerSubject` 均在内） |

`core/` 的 `origin` 指向**上游** `PrimeIntellect-ai/prime-agent`，fork 是额外加的 remote `fork`（`shitianfang/prime-agent`）。拉 fork 代码用 `git pull fork main`，`git pull` 默认走上游。

### ⚠️ 并发写入警告

本次会话期间，`仓库根` 被**另一个会话反复修改和推送**：中途凭空多出 `c58d4ee`、`3612a57`、`5180357`、`2c44fe7` 四个提交，工作区里一度出现别人未提交的 `electron/bridge.mjs` 改动（`/bridge/model` 端点 + 模型切换），我的 commit hash 也被别人重写过（`686dc9a` → `167f158`）。

**动手前先 `git fetch` 并检查 `git status`，不要假设工作区是你上次看到的样子。提交时用精确路径 `git add <path>`，不要 `git add -A`。**

另外 `core/` 的工作区里长期有两个未提交的生成文件改动（`package-lock.json`、`packages/ai/src/models.generated.ts`），不是本次产物，**不要提交它们**。

## 2. 做了什么

### 2.1 fork：`autonomous.*` host request + bundled skill（`d91113c00`，8 文件 +424）

新增 host request `autonomous.get` / `autonomous.enable` / `autonomous.disable`，以及包装它们的 bundled skill `packages/coding-agent/skills/autonomous/`。做法完全照抄同仓库既有的 `preview.publish`（`7886065b0`）。

关键实现点，按重要性：

1. **状态消息在 `agent_end` 冲刷，不在 kernel 调用里发。** host request 跑在 turn 中途（ipython 工具调用里），而 `_emitAutonomousStatus` 原本唯一的调用方 `_handleAutonomousSlashCommand` 跑在两个 turn 之间。见 §3.1，这是审查查出的致命 bug。字段 `_pendingAutonomousStatusEmit`，入口 `_requestAutonomousStatusEmit()`（按 `this.isStreaming` 分流，判据抄自 `compact.run`），冲刷点在 `_processAgentEvent` 的 `agent_end` 分支、goal 续跑之前。
2. **agent 每个会话只有一次授权。** `_autonomousAgentArmed` 记录"额度用掉了"而不是当前状态——只挡直接重开的话，`disable()` 然后 `enable()` 就能把计数器清零。
3. **agent 只能关自己开的。** `_autonomousArmedByAgent`；用户跑 `/autonomous on|off` 会把所有权收回（两个分支都置 false）。
4. **只对 root session 开放。** handler 注册和 `_modelVisibleSkills` 过滤都以 `this._rlmDepth === 0` 为门，和 goal/compact/refine 同一套做法。理由：自动运行是用户为"他正在看的那个会话"设的预算，RLM 子代理在工具调用里给自己批续跑，会在报告它的面板之外花掉这笔预算。
5. **参数校验完全复用斜杠命令的。** `parseAutonomousLimitPayload` 把 `{turns, tokens, time, continuations}` 拼成 token 串交给现有的 `parseAutonomousLimitArgs`，所以两条路接受一样的写法（`"150k"`、`"45m"`、裸数字当分钟）、拒绝一样的输入、报同一句 usage。值里不允许出现空白和 `=`，否则 `{tokens: "80k time=99h"}` 能从一个字段偷塞第二个上限。

**没有改任何协议形状**：状态本来就走 `autonomous_status` custom message 和连接快照，所以不需要新的 daemon 命令、事件或 capability，也没进 startup 路径（`AGENTS.md` 的硬性要求）。

测试 `packages/coding-agent/test/suite/agent-session-autonomous-host.test.ts`，12 个；`builtin-skills.test.ts` 加了一个加载断言。

### 2.2 客户端：长程自主开关（`167f158`）

`to master ▾` 旁边一个复选框。勾上后发消息，实际发给 runtime 的是 `LONG_RUN_PREAMBLE + "\n\n" + 用户原文`（`src/runtime/longrun.ts`）。

- 前缀让模型**选且只选一个**，并用一行说明选了哪个、为什么；明确要求 `goal.create` 必须传 `token_budget=400000`（无预算的目标只有完成或出错才停，那不该是一个复选框能开出来的东西）；并说明某个调用不可用时改选另外两个（对付 fork 未 build 的情况）。
- **时间线不撒谎**：user 行只显示用户打的字，另加一条 quiet note「长程自主 · 已请它自行安排驱动方式」。重连回放时 `historyToItems` 用 `stripLongRun` 把前缀剥掉再把 note 行放回去——runtime 存的是发出去的原文，不处理的话重启后整段前缀会当成用户的话显示出来。
- **按对象分开**：`longRun: Record<string, boolean>`，键是 `"master"` 或 root 名。在某个 root 的面板勾上不会连带武装 master。
- 目标是 helper 时不显示（helper 没有自己的驱动器）；bridge 断开时解除武装（开关会隐藏，留着会在重连后闷声生效）；**故意不持久化**——会给每条消息追加指令的开关，重启后悄悄还开着不合适。

## 3. fable 第一轮审查发现与修复对照（**请优先复核这一节**）

审查覆盖两个仓库的完整 diff，结论是 "Do not push repo A as-is"。以下每条都已修，但**修复未经复核**。

### 3.1 致命 — 中途 push 消息会永久损坏会话（CONFIRMED）

追到底的链路：agent loop 在工具执行**之前**就把 assistant(tool_use) 消息追加进 `agent.state.messages`（`packages/agent/src/agent.ts:565-568`），toolResult 在工具**结束之后**才追加（`agent-loop.ts:650-654`）。所以在工具调用中途 push 一条 custom message，持久化顺序是：

```
assistant(tool_use ipython) → custom autonomous_status → toolResult
```

当前这一轮不受影响（loop 用的是快照），**这正是原来的单元测试没抓到的原因**——测试是在 idle 会话上直接调 handler。但下一轮会重新快照 `state.messages`，`convertToLlm`（`src/core/messages.ts:511-526`）把不在四项排除清单里的 custom 类型转成 **user 消息**，Anthropic 转换层不做重排或孤儿修复，于是发出去的是 `assistant[tool_use] → user[text] → user[tool_result]`，provider 400。而且顺序已经落盘（`appendCustomMessageEntry`），重启也恢复不了，只有 compaction 或 branch 能绕开。

**修法**：延迟到 `agent_end` 再 emit（§2.1 第 1 点）。参照的是 `goal.*` 和 `preview.publish` —— 它们在中途只 `_emit` 领域事件、从不碰 `agent.state.messages`；以及 `compact.run`/`refine.run` —— 它们显式把工作排到 turn 边界。

> 审查还附带指出：原实现直接调 `this._emit`，绕开了 `_agentEventQueue` 的序列化纪律（参考 `_recordLateIpythonSentAgentMessage`）。**这一条我没有单独处理**，因为改成延迟到 `agent_end` 之后已经不在中途了。请复核这个判断是否成立。

### 3.2 高危 — 一次授权的守卫形同虚设（CONFIRMED）

原来只挡"已经开着时再开"。`disable()` 然后 `enable()` 两个 host request 就能拿到全新计数器和任意上限，正是守卫要防的那种提权。而且 commit message、changelog、SKILL.md 三处都宣称"会话内无法把已停的限额重置掉"——**那只是散文，不是强制**，SKILL.md 甚至点名了绕过方法。

**修法**：改成追踪已花掉的授权（§2.1 第 2 点），SKILL.md 改写成描述真实执行的语义。

### 3.3 中 — agent 能关掉用户开的模式（CONFIRMED）

自动运行的续跑提示语明确写着 "Do not end the session yourself"，而原实现给了模型一个正好干这件事的 API。**修法**：§2.1 第 3 点。

### 3.4 中 — skill 和 handler 对所有会话无条件暴露（CONFIRMED）

后果有两层：(i) 每个 fork 用户的 system prompt 里都多了一个自动运行 API，模型自己判断"这活挺长"就能开——SKILL.md 的护栏只是建议性的，而且叠加 3.1 那个未经请求的调用会直接弄坏会话，这是对完全没用这个功能的用户的行为改变；(ii) RLM 子代理原本没有任何路径碰到自动运行（斜杠命令是面向用户的，子代理创建时不带 autonomous 配置），现在能在父代理的工具调用里给自己批续跑。**修法**：§2.1 第 4 点。

### 3.5 中 — 客户端回放把前缀当成用户原话（CONFIRMED）

**修法**：`stripLongRun`（§2.2）。注意这只修了本客户端；同一个会话被 TUI 或别的客户端 attach 时，看到的仍然是带前缀的原文。这是可接受的——runtime 存的就是那个——但值得知道。

### 3.6 低 — 一个全局标志被所有 composer 共用 / 离线时仍武装（CONFIRMED，审查评为"是意外不是缺陷"）

**修法**：按对象分开 + 断开即解除（§2.2）。

### 3.7 低 — 一个字段能偷塞第二个上限

**修法**：值里禁止空白和 `=`（§2.1 第 5 点）。

审查同时**明确排除**了三个我曾怀疑的点，接手时不必重查：客户端能否感知中途开启（能，`App.tsx` 的 `autonomous_status` message_end 处理是无条件的）、`stateRef` 陈旧（不会，每次渲染都赋值）、steer 路径下前缀的落位（正常）。

## 4. 验证到哪一步了（以及没到哪一步）

**已验证**

- fork：pre-commit 完整 `check`（biome + tsgo + `check:installer` + `check:browser-smoke`）通过；`agent-session-autonomous-host` 12 个、`agent-session-autonomous` 28 个、`builtin-skills` 24 个全过。
- 客户端：`tsc --noEmit` 干净，`vite build` 通过。

**没有验证**

- **端到端一次都没跑过。** fork 需要先 `npm run build`（bridge 从 `packages/coding-agent/dist/index.js` 加载 SDK），否则 `autonomous.enable` 在运行时必然 NameError。
- **3.1 的修复没有回归测试。** 要复现原 bug 需要在真实 turn 中途调用 handler，现有 harness 做不到（`isStreaming` 是 getter，背后是 activeRun）。目前只有推理和代码对称性支撑。**这是最值得补的一个测试**，也是最容易再次被静态检查放过的地方。
- 三个 guard（一次授权、只关自己的、root-only）在真实 kernel 调用下的行为没验过，只有直接调 handler 的单元测试。

## 5. 既有失败的测试（不是你造成的，别去追）

`npx vitest run --dir packages/coding-agent/test` 干净跑一次是 **18 failed / 4582 passed / 38 skipped（17 个文件）**。已用独立 worktree 在 `bfa11f049`（本次改动之前）做过对照：

- `resource-loader.test.ts` → `should prefer project resources over user on name collisions`
- `ipython-cell-diff.test.ts` → `renders a large diff without spreading the row array (no RangeError)`

这两个是最像被本次改动打破的（前者管 skill 加载），**基线上失败完全一样**。

其余失败集中在 `daemon-command`、`daemon-serialized-refine-process`、`stdout-cleanliness`、`suite/regressions/4600|4603|4606|4685`——都要 spawn 真实进程或访问 npm registry / github，沙箱里拿不到网络；而且它们跑的是 `dist/`（未重新 build），根本加载不到本次改的源码。

⚠️ **一个方法论教训**：不要在全量测试跑的过程中 `git stash`。我犯过一次，把失败数从真实的 18 放大到 36（失败文件从 17 个变成 24 个），之后花了一轮才排除掉。

## 6. 未决与下一步（建议顺序）

1. **复核 §3 的六处修复**，尤其 3.1 的延迟方案是否真的把消息放在了安全位置，以及 3.1 末尾那条"不必再走 `_agentEventQueue`"的判断。
2. **补 3.1 的回归测试**。哪怕只是构造一个能让 `isStreaming` 为真的场景，断言 `agent.state.messages` 在 handler 返回后没有增长。
3. `cd core/ && npm run build`，然后实机走一遍：勾选 → 发一条长任务 → 看 master 选了哪个 → 看右栏是否亮起。
4. 通过后推送 fork：`git push fork main`。客户端那侧已经在 `origin/main` 上了。
5. ~~修 `package.json` 的 `dev:bridge`~~ —— 已随并库解决：运行时进了仓库的 `core/`，bridge 自己按脚本位置解析，`dev:bridge` 已删除。
6. README 的 Status 里 `[ ] Preview host-request pipeline in core` 已过时，fork 上做完了。

## 7. 背景：三个驱动器不是三种做法，是三个环节

接手的人很容易把「目标 / 自动运行 / 自动唤醒」当成三选一的同类项。它们不是，单独跑效果差别很大——这直接决定前缀该怎么写。

| | 回答的问题 | 单独跑的效果 |
|---|---|---|
| 自动唤醒（rlm_heartbeat / heartbeat） | 何时**开始** | 周期性短轮次，跨轮意图只有唤醒提示里那句话 |
| 目标（goal） | 为什么**继续**、往哪去 | **无界自续**，每轮结束都注入续跑，只在 stopReason 为 error/aborted、撞 token 预算、agent 调 `goal.complete()`、或用户 pause/clear 时停 |
| 自动运行（autonomous） | 一轮内**别早停** + 硬上限 | 不启动任何东西；只在 gate 失败或本轮无终端证据时续；默认 3 次续跑 / 12 轮 / 80k / 30 分钟，任一到顶即停 |

两个必须记住的后果：

- **自动运行的四个上限管不住目标**，两套计数器完全独立。Inspector 的文案就是诚实的：*"stops at any limit. The objective continues regardless."* 所以"能长跑但有刹车"只能靠给目标设 `token_budget`。
- 核心支持 `/goal --budget <tokens> <objective>` 和 `--token-budget=`（`agent-session.ts` 的 `_parseGoalSlashCommand`），但**客户端没有暴露这个输入**，`Inspector.tsx` 只发 `/goal ${text}`。这是一个真实缺口：界面上唯一能设上限的地方（自动运行那四格）恰恰约束不了唯一会无界跑的东西。前缀里硬写 `token_budget=400000` 是权宜之计，不是解法。

另一个坑：自动运行的 gate 命令**只能从启动参数 `--autonomous-gate` 配置**，bridge 没传，`DEFAULT_AUTONOMOUS_GATES.commands` 是空数组。所以面板上写的「仅在检查失败、或某轮没有交付证据时才续跑」，**前半句是死分支**，实际只会因 `missing_terminal_evidence` 续跑。机制是真的，但界面里没有任何地方能定义"检查"是什么。

## 8. 术语（本次新定，覆盖 `HANDOFF.md` §4 的直译）

用户在实施阶段逐条否决了几个直译，理由一律是"叫个容易理解的"。中文标签优先可读性，不追求和英文产品词字面对应；英文侧保持 §4 不变。

| 机制 / 英文 | 中文（现行） | 曾用（已否决） |
|---|---|---|
| autonomous / unattended | **自动运行** | 无人值守 |
| continuations | **续跑次数** | 介入次数（会被读成"外部有人插手"，实际是会话自己接着跑） |
| objective（面板空状态标题） | **开启目标** | 目标 |
| long-running mode | **长程自主** | — |

注意「开启目标」只用在**空状态**那一行；目标激活后面板直接显示目标原文，没有这个标题。状态条上表示"正在被目标驱动"的词仍然是「目标」。

## 9. 关键文件索引

```
fork（core/）
  packages/coding-agent/src/core/autonomous.ts          限额解析、setAutonomousEnabled、AUTONOMOUS_SKILL_NAME
  packages/coding-agent/src/core/agent-session.ts       handleAutonomousHostRequest、_requestAutonomousStatusEmit、
                                                        _flushPendingAutonomousStatus、_createKernelHostHandlers、
                                                        _modelVisibleSkills
  packages/coding-agent/skills/autonomous/              SKILL.md + pyproject + src/autonomous/__init__.py
  packages/coding-agent/test/suite/agent-session-autonomous-host.test.ts

客户端（仓库根）
  src/runtime/longrun.ts        LONG_RUN_PREAMBLE、withLongRun、stripLongRun
  src/components/Composer.tsx   .lrun 开关（crow 行内，helper 目标时让位给 delivered now）
  src/App.tsx                   longRunNote、historyToItems 的剥离、send/postRoot 的应用点、
                                masterComposerSubject、断开解除武装
  src/types.ts                  AppState.longRun: Record<string, boolean>
  electron/bridge.mjs           daemon 桥（本次未改；注意别人可能正在改它）
```
