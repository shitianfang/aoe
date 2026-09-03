# E2E 走查 #1:知识工作者双 helper 场景(2026-09-03)


> 写于本仓库把客户端与运行时并库之前。当时二者是两个独立 checkout，文中的 `core/`
> 和 `仓库根` 是对它们的回指；结论仍然有效，路径按现在的单仓布局读。

场景:通过 bridge(127.0.0.1:3117,`POST /bridge/cmd`,经 Vite 3000 同源代理发送)向常驻
master(NVIDIA NIM `deepseek-ai/deepseek-v4-flash-0731`)下发任务:并行派生两个 helper ——
`notes-digest`(把 cwd 文件列表整理成 markdown 写入 `summary.md` 并回报)与 `checker`
(数文件数并回报),等两者回报后 master 用 edit 给 `summary.md` 追加一行。全程用
`curl -sN /bridge/events` 抓 SSE(存于 scratchpad `e2e-events.log`),对照 `src/App.tsx`
的 `onEvent` 映射逐条验收。

**场景结果:业务链路全部跑通。** 两个 helper 均派生成功(`sub-6ac8ff8e` notes-digest、
`sub-ec4fcdb2` checker),都用 `agent_message.send(..., receiver_role='parent')` 回报了
父代理,`summary.md` 落盘且被 master 追加了 `reviewed by master`,两个 helper 的
`rlm-subagent.json` 终态均为 `"status":"completed"`。

> **捕获中断说明**:场景运行中途主会话重启了 bridge(合并工作区切换 + preview 管道代码),
> SSE 流在两个 helper 进入 `running` 之后断开。此后的终态事件帧(`status:"done"`、
> `repliedSinceTask:true`、`agent_message` 的 message_end)未被本次 SSE 捕获;这些条目的
> 证据改用磁盘上的 master transcript(`~/.prime/agent/sessions/01a06426-bc02-….jsonl`)、
> helper registry 文件,以及 `本地抓取的 events.log` 中同 daemon 的历史真实样本,
> 并逐条标注"部分验证"。按主会话要求未重跑场景(节约配额)。全程无 429/402 额度错误。

本次 SSE 实际捕获的事件分布(114 帧):

```json
{"hello":1,"event:agent_start":1,"event:turn_start":2,"event:message_start":4,
 "event:message_end":4,"event:message_update":81,"event:tool_execution_start":1,
 "event:rlm_child_update":8,"event:tool_execution_update":8,"event:tool_execution_end":1,
 "event:turn_end":2,"event:agent_end":1}
```

注意:**master 在派生 helper 后即结束本轮(`agent_end`),helper 的完成/回报把 master
再次唤醒**——这是 RLM 的正常节奏,`agent_end` ≠ 任务完成。UI 把 `agent_end` 映射成
master "idle" 是对的,但见 bug B6。

---

## 1. Agents 列:`rlm_child_update` 的 merge —— ✅ 通过(终态帧部分验证)

`App.tsx` 的 `mergeChild`(148-168 行)按 `child.id` merge,且
`activeSessionId: child.activeSessionId ?? prev?.activeSessionId` 保证缓存的 session id
不被后续缺字段的帧抹掉。实测印证了字段"逐步补齐"的形状:

首帧(admission,**无 `activeSessionId`、无 `repliedSinceTask`**):

```json
{"type":"rlm_child_update","child":{
  "id":"sub-6ac8ff8e","sessionName":"notes-digest",
  "model":"nvidia-nim/deepseek-ai/deepseek-v4-flash-0731",
  "label":"List the files in the current working directory …, write a short markdown digest … into summary.md …",
  "status":"queued",
  "sessionDir":"…/session-artifacts/01a06426-…/sub-6ac8ff8e"}}
```

运行帧(补上 `activeSessionId` 与 `repliedSinceTask:false`,checker 一侧):

```json
{"type":"rlm_child_update","child":{
  "id":"sub-ec4fcdb2","sessionName":"checker",
  "label":"Count the files in the current working directory … and send just the count …",
  "status":"running","sessionDir":"…/sub-ec4fcdb2",
  "repliedSinceTask":false,"activeSessionId":"6bcb2fab2cb6"}}
```

notes-digest 同样在 running 帧拿到 `"activeSessionId":"51ebb74da626"`(并带
`"activity":{"kind":"writing"}`)。两个 helper 的 id 各自稳定(8 帧里 sub-6ac8ff8e ×4、
sub-ec4fcdb2 ×4),merge 后 Agents 列恰好两行,无重复。

- **id 合并**:✅(同 id 多帧,`children.filter(c=>c.id!==child.id)` + append)。
- **activeSessionId 不丢**:✅ 代码路径正确;首帧→运行帧的补齐实测吻合
  `docs/helper-runtime-findings.md` §4.1/§4.3 的坑(`get_rlm_children` 缺该字段时靠 merge 保住)。
- **repliedSinceTask 翻转**:⚠️ 部分验证。本次 SSE 只捕到 `false`(断流);但磁盘证据确凿:
  两个 helper 的 `agent_message` 都到达了 master transcript(见 §2),registry 终态
  `"status":"completed"`;probe 历史样本(同 daemon)有完整的
  `"status":"done","repliedSinceTask":true` 终帧。`childTransitionEvents`(App.tsx 60-80)
  以 `!prev.repliedSinceTask && next.repliedSinceTask` 生成 "replied" 事件、
  `statusWord()`(helperDisplay.ts 19-26)以它区分 "replied"/"needs you" —— 数据源选得对。

## 2. Timeline:agent_message custom / 工具 chip / divider —— ✅ 通过(custom 帧凭 transcript 验证)

**agent_message custom**:映射(App.tsx 200-229)只在 `message_end` 处理、只读
`details.message`,忽略模型信封 `content` —— 与真实形状匹配。本次两条真实回报
(master transcript 第 334 / 340 行,transcript 的 custom_message 就是 message_end 推送的载荷):

```json
{"customType":"agent_message","display":true,"details":{
  "id":"agentmsg_98d91761-0f2f-4e55-be69-a2af3420e803",
  "message":"0",
  "from":{"activeSessionId":"6bcb2fab2cb6","sessionId":"01a06491-a91a-…",
          "sessionName":"checker","runtimeKind":"subagent","clientId":"agent"},
  "fromRelationship":"child",
  "target":{"activeSessionId":"603f075adea1","sessionName":"master","runtimeKind":"top-level"}}}
```

```json
{"customType":"agent_message","details":{
  "id":"agentmsg_09f38603-…",
  "message":"Listed files in /home/vscode/.prime/desktop/general (directory is empty) and wrote digest to summary.md.",
  "from":{"activeSessionId":"51ebb74da626","sessionName":"notes-digest", "clientId":"agent"}, …}}
```

- `details.message` 是纯文本 ✅,可直接渲染;divider 文案 `msg ← checker` 的
  `from.sessionName` 存在 ✅;按 `activeSessionId`/`sessionName` 回填 helper 事件流的两条
  查找路径都能命中(running 帧已缓存 activeSessionId)✅。
- 边界:checker 的回报正文是字符串 `"0"` —— `excerpt` 逻辑用 `(d?.message ?? "").slice(0,80)`
  判空,`"0"` 非空字符串,不踩 falsy 坑 ✅。

**工具 chip**:`tool_execution_start` → running chip,`tool_execution_end` 按
`toolCallId` 收口 —— 实测 id 对得上(`call_2026efa28a6c4ea1a661603a` 的 start/end 各 1 帧):

```json
{"type":"tool_execution_start","toolCallId":"call_2026efa28a6c4ea1a661603a",
 "toolName":"ipython","args":{"code":"h1 = await rlm(\"List the files …\", name=\"notes-digest\")\nh2 = await rlm(\"Count the files …\", name=\"checker\")\n…"}}
```

chip 文案是裸 `ipython`(无 path 后缀)—— 语义上它其实是"派生了两个 helper",见 bug B5。

**divider**:`session started` divider、`queued · lands after it finishes`(follow_up)与
`msg ← <helper>` divider 逻辑均在;本次未触发 refine/follow_up 分支。

## 3. Files 列:summary.md 无法从工具事件推导 —— ❌ 不通过(最严重发现)

`filePathFromArgs` 匹配 `args.path` / `args.file_path`,且 App.tsx 279 行只在
`toolName === "edit"` 时写入 Files 列。**但 RLM 会话根本不会发 `edit` 工具事件:**

- **真实工具名是 `ipython`,args 只有 `{code}`**。本次 master 侧唯一的文件类事件即上面的
  `tool_execution_start`;probe 历史日志同样全部是 `"toolName":"ipython"`。
  代码印证:`packages/coding-agent/dist/core/tools/index.d.ts` —
  `export type ToolName = "ipython"`,`createAllToolDefinitions` 只暴露 ipython 一个工具。
  (`core/tools/edit.js` 里 `name:"edit"`、schema `{path, edits}` 的定义存在,但不在 RLM
  模式的 roster 里 —— `filePathFromArgs` 的 `path` 键是按它写的,可惜事件层看不到它。)
- **helper 写 summary.md 用的是 kernel 里的裸 Python**(notes-digest 子会话 transcript):
  ```python
  with open("summary.md","w") as f: f.write(md)
  ```
- **master 追加那一行用的是 kernel 内的 edit skill(Python 模块,不是 daemon 工具)**:
  ```python
  # master transcript 第 349 行,ipython toolCall 的 code:
  result = await edit.run(path="/home/vscode/.prime/desktop/general/summary.md",
                          old_str=…, new_str=…)   # → "Edited /home/vscode/.prime/desktop/general/summary.md"
  # edit.__file__ = core/packages/coding-agent/skills/edit/src/edit/__init__.py
  ```
- 且 helper 的工具事件只出现在 helper 自己的 daemon 子会话里,bridge 只 attach master,
  事件根本到不了 renderer。

结论:当前实现下 Files 列在真实 RLM 会话中**永远为空**(`toolName==="edit"` 永不命中,
`args.code` 里也没有 path 字段)。修复建议见 B1。

## 4. abort → resume_queue 自动重试 —— ✅ 通过

对重启后的新 bridge 实测一轮(短任务,控制配额):

1. `{"op":"prompt","text":"Count slowly from 1 to 50 in python…"}` → `{"ok":true}`;
2. 运行中 `{"op":"abort"}` → `{"ok":true}`(00:14:22Z,transcript 里该轮 assistant 内容为空,
   被截断落盘);
3. 紧接 `{"op":"prompt","text":"Say only the word ok."}` → **`{"ok":true}`**,且 4 秒后该
   prompt 落进 master transcript 并得到 assistant 响应:

```json
{"type":"message","id":"66c04a37","timestamp":"2026-09-03T00:14:26.662Z",
 "message":{"role":"user","content":[{"type":"text","text":"Say only the word ok."}]}}
{"type":"message","id":"79f4221a","timestamp":"2026-09-03T00:14:37.912Z",
 "message":{"role":"assistant","content":[…,{"type":"toolCall","name":"ipython",…}]}}
```

即 abort 后的 prompt 没有撞死在
`Cannot admit a session action while queued session input is suspended`(bridge.mjs 的
`withResumeRetry` 会捕获该错误、裸发 `resume_queue` 后重试)。链路验收通过。
行为层小注:模型收到 "Say only the word ok." 后自作主张接着执行了被 abort 的数数任务
(又 abort 了一次收尾)—— 这是模型行为,不是 bridge/映射问题。

## 5. onEvent 漏掉的事件类型(按本次捕获频次)

| 事件 | 频次(本次单轮) | 现状 | 说明 |
|---|---|---|---|
| `message_update`(纯 thinking) | 48/81 | 处理了但渲染为空 | deepseek 的 thinking_delta 占大头,`extractText` 只取 `text` 块 → master 行长时间空 bubble + 光标(B3) |
| `tool_execution_update` | 8 | 未处理 | 带逐步 args/details,可做工具 chip 进度;直接忽略至少无害 |
| `turn_end` | 2 | 未处理 | 可用作轮次 divider/耗时统计 |
| `session_action_update` | 0(本次)/常见 | 未处理 | steer/follow_up 的队列回执(queuedCount/steering);现在 "queued · lands after…" divider 是纯乐观 UI |
| `extension_ui_request` | —(被 bridge 丢弃) | 未转发 | helper 的 "Starting Python kernel…" 免费文案(findings §5) |
| `agent_end.messages` | 1(载荷巨大) | 只当信号用 | 见 B4 |

另:同源代理验证 ✅ —— 场景 prompt 就是从 `http://127.0.0.1:3000/bridge/cmd` 发出并成功的。

---

## Bug 清单(按严重度)

**B1(高)Files 列在真实 RLM 会话中永远为空。**
`toolName === "edit"` 永不命中(工具全集只有 `ipython`),`filePathFromArgs` 在
`{code}` 里也找不到 path。文件写入实际发生在 kernel 内(裸 Python `open().write()` 或
edit skill `edit.run(path=…)`),且 helper 的写入连事件都不经过 master 连接。
建议(按性价比):① bridge 侧用 fs watcher(如 chokidar)盯 workspace cwd,把文件增改
作为独立 `file_activity` 帧推给 renderer —— 能同时覆盖 master 与 helper;② 次选:解析
ipython 的 tool result `details`(edit skill 会发 diff display MIME)提取 path;
③ 长期:若上游给 RLM 暴露真正的 edit/write 工具事件再切回事件推导。

**B2(高)SSE 后连/重连的 renderer 拿不到 snapshot。**
bridge 只在 `connectDaemon()` 成功那一刻 `broadcast({type:"snapshot",…})`;本次捕获证明
后连的 SSE client 只收到 `hello`(capture 首帧即 hello,无 snapshot 帧)。刷新页面后
Agents 列/goal 全空,只能等下一条 `rlm_child_update` 慢慢攒 —— 而终态 helper 可能再也
没有增量帧。建议:`/bridge/events` 每个新连接接入时立即补发一份当前 snapshot
(`getInitialSnapshot()` 或 bridge 内存缓存)。※ 本条按重启前的 bridge 代码验证,
新合并的 bridge 若已改请复核后销项。

**B3(中)thinking 阶段 master 渲染为空 bubble。**
`message_start` 即 push 空 master 行,thinking_delta(本次 48 帧)不产生可见文本,
用户看到长时间"空行+光标"。建议:content 全为 thinking 块时显示 "thinking…" 占位,
或延迟到首个 text 块再建行。

**B4(中)`agent_end` 全量 messages 经 SSE 转发。**
本次单帧 ~8KB,长会话会到 MB 级;renderer 只拿它当"idle"信号。建议 bridge 转发前剥掉
`messages`(或只留 usage/stopReason)。

**B5(低)工具 chip 语义弱。**
唯一工具是 `ipython`,chip 恒显示裸 "ipython"。`args.code` 里 `await rlm(...)`、
`edit.run(...)`、`agent_message.send(...)` 都可轻量正则识别,把 chip 升级成
"spawn helper ×2"、"edit · summary.md"、"reply to parent" 一类文案(顺带能救一部分 B1)。

**B6(低)master "idle" 与 "等 helper 回报中" 不区分。**
`agent_end` 后 master 显示 idle,但两个 helper 还在跑 —— 对用户而言任务没完。可在
`children` 存在 running/queued 项时把 master 状态词换成 "waiting for helpers"。

**B7(低)helper 回报时若 roster 尚空,helper 事件流条目会丢。**
`agent_message` 分支里 `children.find(...)` 找不到 child 时只出 divider、静默丢
helper event(App.tsx 216-217)。与 B2 叠加(刷新后 roster 空)时会发生。B2 修好后
基本消除;也可把无主消息暂存、待 roster 补齐再归档。

## 结论

事件→UI 数据链路的**主干是通的**:Agents 列 merge 语义与真实 `rlm_child_update`
帧形状吻合(含 activeSessionId 补齐/保持),`agent_message` 的 `details.message`
纯文本可直接渲染,abort→resume_queue 自动重试实测有效,3000 端口同源代理正常。
两处必须修的断点:Files 列的事件推导前提不成立(B1),SSE 重连拿不到 snapshot(B2)。
本次走查未改任何 `src/` 代码、未提交。
