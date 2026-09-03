# RLM helper(子代理)运行时实测结论(2026-09-02)


> 写于本仓库把客户端与运行时并库之前。当时二者是两个独立 checkout，文中的 `core/`
> 和 `仓库根` 是对它们的回指；结论仍然有效，路径按现在的单仓布局读。

在远程 Linux dev box(非 root 用户)上实跑,daemon protocol v7,
schema `protocol-7-schema-25-585ef1102921`,appVersion `0.9.1`,provider = NVIDIA NIM
(`deepseek-ai/deepseek-v4-flash-0731`)。

**结论先行:helper 派生跑通了;`rlm_child_update` / `snapshot.children` / `get_rlm_children` /
`agent_message` 四种形状全部拿到真实样本;多 attach 可行(同一个 `DaemonClient` 同时 attach
master 和子会话)。** 探针脚本与原始事件日志未随本仓库发布。

---

## 1. 环境:uv 与 Node 版本

RLM 的 Python kernel 走 uv 引导。缺 uv 时 `ipython` 工具直接失败,`rlm()` 无法调用,
子代理一个都起不来。实测报错原文(来自 master transcript 里失败的那一轮):

```
Failed to set up the Python kernel runtime. uv is required to set up the Python kernel.
Install uv yourself: curl -LsSf https://astral.sh/uv/install.sh | sh, or set
PRIME_AGENT_INSTALL_UV=1 to let prime-agent run that installer.
```

远程当前状态(**已装好,本次无需重装**):

| 项 | 值 |
|---|---|
| uv | `/home/vscode/.local/bin/uv`,`uv 0.12.9 (x86_64-unknown-linux-gnu)`,由 astral 官方脚本装入 |
| kernel venv | `~/.prime/agent/kernel-venv`(uv 首次引导时自动创建,python 3.11) |
| kernel 进程 | `~/.prime/agent/kernel-venv/bin/python -m rlm.repl`,常驻,挂在 worker 进程下 |
| Node | prime-agent 需要 **Node >= 22.8**;系统默认 node 是 20.x,可用的在 `~/.local/node22/bin` |

**凡是碰 prime-agent 的进程(daemon / bridge / 探针)都必须带这个 PATH:**

```bash
PATH=$HOME/.local/node22/bin:$HOME/.local/bin:$PATH
```

`~/.local/bin` 是给 worker 找 uv 的,`~/.local/node22/bin` 是给 Node 版本的。
两者缺一:缺前者 kernel 起不来 → 没有子代理;缺后者 daemon 根本跑不起来。

替代方案(未采用,记录备查):设 `PRIME_AGENT_INSTALL_UV=1` 让 prime-agent 自己跑安装脚本;
或设 `PRIME_AGENT_KERNEL_PYTHON` 指向已装 `prime-agent-runtime` 的 Python 跳过引导。

## 2. daemon 重启流程(实测有效)

worker 是 daemon supervisor fork 出来的,**PATH 是从 supervisor 继承的**,所以装完 uv 必须
重启 supervisor,不然老 worker 仍然看不到 uv。

```bash
pkill -f 'prime-agent'                     # 停掉 supervisor + 所有 worker
cd 仓库根
PATH=$HOME/.local/node22/bin:$HOME/.local/bin:$PATH node electron/bridge.mjs &   # bridge 自己会拉起 daemon
```

bridge(`electron/bridge.mjs`)探测到 socket 连不上就 spawn
`node <PRIME_AGENT_DIR>/packages/coding-agent/dist/cli.js --mode daemon --daemon-socket <path>`,
并幂等地 resume/create 名为 `master` 的常驻 root session。验证:

```bash
curl -s http://127.0.0.1:3117/bridge/health
# {"connected":true,"master":{"name":"master","activeSessionId":"603f075adea1"},"error":null}
```

`daemon_hello` 里能直接确认 supervisor 用的是哪个 node:

```json
{
  "type": "daemon_hello",
  "socketPath": "/tmp/prime-agent-1000/daemon.sock",
  "protocol": { "name": "prime-agent.daemon", "version": 7 },
  "schemaId": "protocol-7-schema-25-585ef1102921",
  "schemaRevision": 25,
  "appVersion": "0.9.1",
  "runtime": {
    "buildId": "release-0.9.1",
    "executablePath": "/home/vscode/.local/node22/bin/node",
    "entrypointPath": "core/packages/coding-agent/dist/cli.js"
  },
  "supervisorGeneration": "e117cf86-…", "supervisorOwnerToken": "1124b4e3-…",
  "supervisorPid": 17067, "supervisorProcessStartId": "proc:671068196",
  "clientId": "857ca4674b1f",
  "serverCapabilities": ["attach_snapshot","event_sequence","extension_ui","slim_attach",
    "chunked_snapshot","client_owned_sessions","delete_rlm_subagent","heartbeat_catalog",
    "heartbeat_management","model_catalog","side_question_transcript","transient_bash",
    "session_input_admission","prompt_admission_cancellation","owned_prompt_cancellation",
    "queue_message_mutation","authoritative_child_roster","owned_session_recovery_context",
    "rlm_quiescence_barrier","session_input_pause","acp_mcp_servers","agent_roster",
    "direct_peer_transport"]
}
```

> `authoritative_child_roster` **在**能力表里 → `get_rlm_children` 可用。
> 注意 `client.supportsServerCapability(...)` 在 `waitForHello()` 之前一律返回 false,
> 连上就查会误判成"没有该能力"。

## 3. helper 派生:成功

两次独立成功(`test-helper`、`probe-helper-2`)。派生方式就是让 master 在 kernel 里跑
`await rlm(task, name=...)`,返回句柄不等结果:

```
handle fields: RLMSpawnHandle(
  rlm_child_id='sub-f7f7fa30', name='test-helper',
  session_dir=PosixPath('/home/vscode/.prime/agent/session-artifacts/<parentSessionId>/sub-f7f7fa30'),
  model='nvidia-nim/deepseek-ai/deepseek-v4-flash-0731')
```

子代理用 `await agent_message.send("pong", receiver_role="parent")` 回话,父侧确实收到。
`probe-helper-2` 全程 `durationMs: 16745`,`test-helper` `durationMs: 35301`。

---

## 4. 真实事件形状

### 4.1 `rlm_child_update`(session event,推送)

一次 helper 全生命周期发了 19–22 条。载荷永远是 `{ type, child }`,`child` 是
`AgentConnectionRlmChildAgentSnapshot`。字段**大量可选、逐步补齐**,不是一次给全。

首帧(admission,`status: "queued"` —— 注意此时**没有** `activeSessionId`,也没有任何计数):

```json
{"type":"rlm_child_update","child":{
  "id":"sub-837aedd9",
  "sessionName":"probe-helper-2",
  "model":"nvidia-nim/deepseek-ai/deepseek-v4-flash-0731",
  "label":"Reply to your parent with the single word pong via agent_message.send(\"pong\", receiver_role=\"parent\"), then stop.",
  "status":"queued",
  "sessionDir":"/home/vscode/.prime/agent/session-artifacts/01a06426-…/sub-837aedd9"}}
```

运行中(出现 `activeSessionId`、`activity`、`repliedSinceTask`、`toolUseCount`、`tokenCount`):

```json
{"type":"rlm_child_update","child":{
  "id":"sub-f7f7fa30","sessionName":"test-helper",
  "model":"nvidia-nim/deepseek-ai/deepseek-v4-flash-0731",
  "label":"Reply to your parent with the single word pong …",
  "status":"running","toolUseCount":1,"tokenCount":4771,
  "sessionDir":"…/sub-f7f7fa30",
  "activity":{"kind":"executing","toolName":"ipython"},
  "repliedSinceTask":false,
  "activeSessionId":"830ae9aab877"}}
```

终帧(`status: "done"`,补上 `durationMs` / `answerPreview` / `recap`):

```json
{"type":"rlm_child_update","child":{
  "id":"sub-837aedd9","sessionName":"probe-helper-2",
  "model":"nvidia-nim/deepseek-ai/deepseek-v4-flash-0731",
  "label":"Reply to your parent with the single word pong …",
  "status":"done","durationMs":16745,
  "answerPreview":"Task complete. I sent \"pong\" to the parent as requested.",
  "toolUseCount":1,"tokenCount":5149,"recap":"",
  "sessionDir":"…/sub-837aedd9",
  "repliedSinceTask":true,
  "activeSessionId":"a01ccf839e8b"}}
```

**观察到的状态与字段行为**

- `status`(类型全集 `types.ts:542`):`"queued" | "running" | "done" | "error" | "cancelled"`。
  本次实际观察到 `queued → running → done`。注意是 **`done` 不是 `completed`**——
  `completed` 只出现在磁盘 registry 和 Python 侧 `RLMSubagent.status`,两套词不一样。
- `activity`:`{kind: "waiting" | "writing" | "executing", toolName?}`。`done` 帧上
  `activity` **被删掉**(不是置空,是整个 key 不出现)。
- `answerPreview` 是**逐 token 增长**的:`"The"` → `"The parent"` → `"The parent has"` → …
  UI 直接渲染会看到打字机效果;要么接受要么只在终态取。
- `repliedSinceTask` 在子代理 `agent_message.send` 成功那一刻从 `false` 翻成 `true`,
  这是"HELPER 已回报 / NO REPLY"那个状态词的真实数据源。
- `tokenCount` / `toolUseCount` 只在有变化时出现,中间帧可能整个不带。
- `durationMs` **只在终帧才有**,运行中永远没有 → 运行中的"已跑多久"必须客户端自己按
  首见时间算。
- 没有观察到 `parentId` 和 `error` 字段(单层、无失败样本)。

### 4.2 `snapshot.children`(attach 快照)

`getInitialSnapshot().children` 的元素形状与 `rlm_child_update.child` **完全一致**,
并且**带 `activeSessionId`**:

```json
[{"id":"sub-837aedd9","sessionName":"probe-helper-2",
  "model":"nvidia-nim/deepseek-ai/deepseek-v4-flash-0731",
  "label":"Reply to your parent with the single word pong …",
  "status":"done","durationMs":16745,
  "answerPreview":"Task complete. I sent \"pong\" to the parent as requested.",
  "toolUseCount":1,"tokenCount":5149,"recap":"",
  "sessionDir":"…/sub-837aedd9","repliedSinceTask":true,
  "activeSessionId":"a01ccf839e8b"}]
```

### 4.3 `get_rlm_children`(拉取)—— **有坑,少一个字段**

`DaemonAgentConnection.getRlmChildSnapshots()`(命令 `get_rlm_children`,能力
`authoritative_child_roster`)返回 `{children, eventSequence}`。实测返回的 `children`
**永远不带 `activeSessionId`**:

```json
[{"id":"sub-837aedd9","sessionName":"probe-helper-2",
  "model":"nvidia-nim/deepseek-ai/deepseek-v4-flash-0731",
  "label":"…","status":"done","durationMs":16745,
  "answerPreview":"Task complete. I sent \"pong\" to the parent as requested.",
  "toolUseCount":1,"tokenCount":5149,"recap":"","sessionDir":"…/sub-837aedd9",
  "repliedSinceTask":true}]
```

源码印证(**这是核心的不一致,不是我们这边用错了**):

- `daemon-mode.ts:4519` 的 `get_rlm_children` 直接返回
  `state.runtime.session.getRlmChildSnapshots()`,而 `AgentSession` 层面根本不知道自己的
  daemon active-session id;
- 推送路径有 `stampRlmChildActiveSessionId()`(`daemon-mode.ts:7153`)专门补这个字段;
- attach 快照路径走 `buildRlmChildSnapshots()`(`daemon-session-list.ts:373-376`)也补;
- **只有 `get_rlm_children` 两条路都没走。**

→ **UI/bridge 规则:`activeSessionId` 只能从 `rlm_child_update` 事件、`snapshot.children`
或 `list {all:true}` 里取,绝不能指望 `get_rlm_children`。** 用 `get_rlm_children` 刷新
roster 时必须按 `child.id` merge 回本地已缓存的 `activeSessionId`,否则"点开 helper"的
入口会莫名其妙消失。

### 4.4 子代理在 `list {all:true}` 里的样子

运行中的子代理是一个**独立的 daemon session**(可寻址),但**跑在父 worker 的同一个进程里**
(`workerPid` 与 master 相同,本次都是 17093):

```json
{"id":"a01ccf839e8b","lifecycle":"live","activity":"working","isSessionActive":true,
 "runtimeKind":"subagent","rlmDepth":1,
 "activeSessionId":"a01ccf839e8b","sessionId":"01a0647f-96d5-778d-a569-fbaeed8314d9",
 "sessionFile":"…/session-artifacts/01a06426-…/sub-837aedd9/01a0647f-….jsonl",
 "sessionName":"probe-helper-2","cwd":"/home/vscode/.prime/desktop/general",
 "isStreaming":true,"hasRunningRlmChildren":false,
 "attachedClients":1,"messageCount":1,"unfinishedActionCount":1,
 "created":"2026-09-02T23:41:18.422Z","modified":"2026-09-02T23:41:18.447Z",
 "firstMessage":"Reply to your parent with the single word pong …",
 "parentActiveSessionId":"603f075adea1",
 "parentSessionId":"01a06426-bc02-765e-8ca8-30f9c2309a62",
 "parentSessionPath":"/home/vscode/.prime/agent/sessions/01a06426-….jsonl",
 "rlmChildId":"sub-837aedd9","repliedSinceTask":false,"rlmParentNodeId":"sub-837aedd9",
 "spawnCode":"h = await rlm(\"…\", name=\"probe-helper-2\")\nprint(h)",
 "rosterStatus":"running","workerState":"ready","workerPid":17093}
```

`parentActiveSessionId` + `rlmChildId` + `rlmDepth` 就是画家族树需要的全部拓扑,
比 `snapshot.children` 更全。`spawnCode` 也在这里(HANDOFF 已决定不展示)。

**注意:子代理一旦终态(done)并被父代理回收,就从 `list` 里消失了。** 上面这条是运行中抓的。

### 4.5 `agent_message`(子→父)

到达父 session 的形式是 transcript 里的一条 **custom message**,`customType: "agent_message"`,
通过 `message_start` / `message_end` 事件推送:

```json
{"type":"session_event","event":{"type":"message_end","message":{
  "role":"custom",
  "customType":"agent_message",
  "content":"[from child:test-helper]\nAgent-to-agent message received.\nSource: agent_message\nFrom: test-helper, active 830ae9aab877, session 01a0647a-…, client agent\nTo: master, active 603f075adea1, session 01a06426-…\nMessage id: agentmsg_abd5a173-…\n\npong",
  "display":true,
  "details":{
    "id":"agentmsg_abd5a173-b78d-4b62-bc21-eecceef0bffb",
    "message":"pong",
    "from":{"activeSessionId":"830ae9aab877","sessionId":"01a0647a-…",
            "sessionName":"test-helper","runtimeKind":"subagent","clientId":"agent"},
    "fromRelationship":"child",
    "target":{"activeSessionId":"603f075adea1","sessionId":"01a06426-…",
              "sessionName":"master","runtimeKind":"top-level"}},
  "timestamp":1788392180384}}}
```

- **UI 只该读 `details.message`(纯正文 `"pong"`)**,`content` 是给模型看的带信封的长文本。
- `details.fromRelationship`:`"child"`(家族角色,直接可用)。
- `details.from.clientId === "agent"` 表示是代理自己发的;客户端(bridge)发的会是
  `"daemon-client:<uuid>"`,这样能区分"helper 回话"和"人在 UI 里发的话"。

### 4.6 客户端 → 子代理:`sendAgentMessage` 回执

`masterConn.sendAgentMessage(childActiveSessionId, text)` 的真实回执:

```json
{"id":"agentmsg_47952fb2-9b44-42a3-b92b-ac04bf466150",
 "source":"agent_message",
 "target":{"activeSessionId":"a01ccf839e8b","sessionId":"01a0647f-…",
           "sessionName":"probe-helper-2","runtimeKind":"subagent"},
 "from":{"activeSessionId":"603f075adea1","sessionId":"01a06426-…",
         "sessionName":"master","runtimeKind":"top-level",
         "clientId":"daemon-client:e41b3b19-…"},
 "message":"probe ack, no reply needed",
 "deliveryStatus":"queued",
 "queuedAt":"2026-09-02T23:41:18.501Z",
 "deliveryMode":"steer"}
```

印证 HANDOFF §2 的说法:**发给子代理永远是 `deliveryMode: "steer"` + `deliveryStatus: "queued"`**。
子代理侧同时收到一条 `session_action_update`:

```json
{"type":"session_action_update","actions":{
  "queuedCount":1,
  "steering":["Agent message received: probe ack, no reply needed"],
  "followUps":[]}}
```

→ UI 那个 `delivered as steer` 的措辞是对的,而且可以直接把 `deliveryStatus` 显示成
queued;**没有观察到 `delivered`**(子代理正忙)。

### 4.7 Python 侧的 roster(仅供理解,客户端不用)

master 在 kernel 里跑 `rlm.list_subagents()` / `agent_message.list_agents()` 的真实返回:

```
{'current': {'name': 'master', 'id': '01a06426-…', 'depth': 0},
 'entries': [{'relationship': 'child', 'name': 'lister', 'id': '01a0647b-…',
              'depth': 1, 'status': 'idle', 'repliedSinceTask': True},
             {'relationship': 'child', 'name': 'test-helper', 'id': '01a0647a-…',
              'depth': 1, 'status': 'idle', 'repliedSinceTask': True}]}

[RLMSubagent(rlm_child_id='sub-f7f7fa30', active_session_id='830ae9aab877',
             session_id='01a0647a-…', session_name='test-helper',
             session_dir=PosixPath('…/sub-f7f7fa30'), status='completed'), …]
```

三套状态词并存,**别混**:
daemon 事件 `queued/running/done/error/cancelled` ·
Python `agent_message.list_agents()` `running/idle/inactive` ·
registry/`RLMSubagent` `running/completed/deleted`。

---

## 5. 多 attach:**可行,已验证**

同一个 `DaemonClient`(一条 socket)上,在 master 的 `DaemonAgentConnection` 保持存活的
同时,attach 第二个 `DaemonAgentConnection` 到子会话:

```js
const childConn = await sdk.DaemonAgentConnection.attach(client, childActiveSessionId, {
  closeClientOnDispose: false, sendClientEnv: false, directTransport: false,
});
```

实测结果:

| 检查项 | 结果 |
|---|---|
| attach 到子会话 | **成功**(`attachOk: true`) |
| master 连接是否还可用 | **是**(attach 后 `getRlmChildSnapshots()` 正常) |
| 两个连接同时收事件 | **是**(master 收 `rlm_child_update`,child 收自己的 `message_*` / `tool_execution_*`) |
| dispose 子连接后 master | **仍可用** |
| 同时还有第三个客户端 | **是**——bridge 也 attach 着 master,`list` 显示 `master attachedClients=2`、`probe-helper-2 attachedClients=1` |

即 HANDOFF §11 "验证单客户端多 session attach" 这一条:**通过,Agents 列不需要退化成轮询 + 单 attach。**

### 多 attach 的三个坑

1. **attach 瞬间的快照可能是空的。** 子代理刚 `running` 就 attach,`snapshot.messages.length === 0`,
   20 秒后再取是 5。子会话的 transcript 是边跑边写的,**UI 不能把首帧快照当成"这个 helper 什么都没做"**,
   必须靠订阅事件补齐(随后会收到一条 `session_resynced`,里面带完整 snapshot)。
2. **子连接会推 `extension_ui_request`。** 实测收到 4 条,都是 `method: "setWorkingMessage"`:
   ```json
   {"type":"extension_ui_request","request":{"id":"953e0576-…","method":"setWorkingMessage",
     "payload":{"message":"Starting Python kernel..."}}}
   ```
   后续依次是 `"Restoring Python state..."`、`"Preparing Python runtime..."`、`payload:{}`(清空)。
   bridge 目前只转发 `session_event`/`connection_status`/`closed`/`heartbeats_changed`,
   **这些请求被静默丢弃**。它们其实是免费的"helper 正在干嘛"文案,值得转发;
   `payload: {}` 表示清除当前文案。
3. **子会话的 id 是短 id(`a01ccf839e8b`),与 `sessionId`(uuid `01a0647f-…`)不是一回事。**
   attach 必须用 `activeSessionId`;`agent_message` 的 `details.from.sessionId` 是 uuid,
   要跟 roster 关联得用 `activeSessionId` 或 `sessionName`。

---

## 6. 必须处理的坑(给 UI / bridge 代码)

1. **`abort()` 之后会话会卡死,必须 `resume_queue`。**
   `AgentSession.requestAbort()` 把 `_sessionInputPumpSuspended` 置 true
   (`agent-session.ts:6972`),此后任何 `prompt` 都被拒:
   ```
   Error: Cannot admit a session action while queued session input is suspended.
   ```
   **它不会自己恢复。** 唯一出路是 daemon 命令 `resume_queue`
   (`daemon-mode.ts:4281`,调 `session.resumeQueuedWork()`):
   ```js
   await client.request({ type: "resume_queue", activeSessionId });
   ```
   注意:即便队列是空的、命令返回 `success:false / "No queued work to resume"`,
   **pump 也已经被恢复了**,紧接着的 `prompt` 就成功了(本次实测正是如此)。
   → bridge 的 `abort` 之后、或任何 `prompt` 撞上这条错误时,都要自动补一次 `resume_queue` 再重试。
   SDK 没有导出这个方法,得用 `client.request()` 裸发。

2. **helper 会被 agent 自己删掉。** 实测 master 在下一轮自作主张跑了
   `await rlm.delete_subagent(child)`,两个已完成的 helper 立刻从 `snapshot.children`、
   `get_rlm_children` 和 `list` 里全部消失,磁盘 `rlm-subagent.json` 变成 `"status":"deleted"`,
   `~/.prime/agent/rlm-ledger/<hash>.jsonl` 追加 `{"op":"delete",…,"reason":"user"}`。
   → **Agents 列必须能接受"一个 helper 行凭空消失"**,不能假设终态条目会一直在。
   (HANDOFF 已经写了不显示 deleted 行,这里补充的是:删除可能来自 agent 而非用户。)

3. **终态 helper 的可寻址性是有窗口的。** 只要没被删,`done` 的 daemon-backed 子代理仍带
   `activeSessionId`、仍在 `snapshot.children` 里、仍可 attach;一旦被删就彻底没了。
   磁盘上 transcript 和 `rlm-subagent.json` 仍在
   (`~/.prime/agent/session-artifacts/<parentSessionId>/<childId>/`),但 daemon 的
   `get_rlm_children` 不会再返回(`_isUnboundTerminalRlmChildRun` 会隐藏无 session 的终态 run)。

4. **`supportsServerCapability` 必须在 `await client.waitForHello()` 之后才准。**
   连上立即查会全返回 false。

5. **`get_rlm_children` 缺 `activeSessionId`**(见 §4.3),必须 merge。

6. **`answerPreview` 是流式增长的**,别当作稳定值。

7. **子代理跑在父 worker 的同一进程里**(`workerPid` 相同),一个 worker 挂掉会带走整棵子树。
   `worker_recovery` 的 custom message 实测确实会出现在父 transcript 里:
   ```
   customType: "prime-agent.worker_recovery"
   <prime_agent_worker_interrupted> The isolated session worker stopped during in-flight work.
   The saved transcript was recovered, but uncertain model, tool, bash, or child-agent work was
   not replayed. Inspect external side effects before continuing. </prime_agent_worker_interrupted>
   ```
   这是 "runtime recovering/failed" 状态词的真实数据源。

8. **master 的 `activity` 字段会残留 `"working"`** 而 `isStreaming` 是 false
   (探针启动时见过一次)。判断"在不在跑"用 `snapshot.state.isStreaming`,别用 list 的 `activity`。

## 7. 本次跑到的事件类型分布(一次 helper 派生 turn,master 侧)

```json
{"session_event:agent_start":2,"session_event:turn_start":3,
 "session_event:message_start":6,"session_event:message_end":5,
 "session_event:message_update":88,"session_event:tool_execution_start":1,
 "session_event:rlm_child_update":22,"session_event:tool_execution_update":8,
 "session_event:tool_execution_end":1,"session_event:turn_end":2,
 "session_event:agent_end":1,"session_event:session_action_update":3}
```

子会话侧(attach 之后):

```json
{"session_resynced":1,"session_event:session_action_update":5,
 "session_event:message_start":4,"session_event:message_update":24,
 "session_event:message_end":4,"session_event:tool_execution_start":1,
 "extension_ui_request":4,"session_event:tool_execution_update":3,
 "session_event:tool_execution_end":1,"session_event:turn_end":2,
 "session_event:agent_end":2,"session_event:agent_start":1,
 "session_event:turn_start":1,"session_event:recap_update":1,"session_status":1}
```

`message_update` 的量级(单轮 88 条)说明 **renderer 侧必须做节流/合并**。

---

## 8. 产物

探针脚本与原始日志(未随本仓库发布,下表记录当时的产物构成):

| 文件 | 说明 |
|---|---|
| `helper-probe.mjs` | attach master → 提示派生 helper → 记录全部事件 → 拉 `get_rlm_children` |
| `spawn-and-multiattach.mjs` | 派生 helper 并在 `rlm_child_update` 一出现 `activeSessionId` 就 attach 子会话(多 attach 验证) |
| `multi-attach-probe.mjs` | 只做多 attach 的版本(首跑时 helper 已被 agent 删掉,故失败,保留备查) |
| `list-sessions.mjs` | 列 session + 打 hello/能力 |
| `events.log` | helper-probe 的全量 NDJSON 事件流 |
| `multi-attach.log` | spawn-and-multiattach 的全量 NDJSON(含子会话事件流) |
| `probe.out` / `multiattach.out` | 两次运行的 stdout |

运行方式:在探针目录下,用 Node >= 22.8 直接跑,例如
`node spawn-and-multiattach.mjs`。

全程只读:未改动运行时或客户端任何代码,未提交任何东西。
