# prime-agent daemon 接入要点(调研结论,2026-09-02)

来源:对 `/workspace/prime-agent`(`@earendil-works/pi-coding-agent` 0.9.1)的源码级调研。
文档 daemon.md 写 protocol v4 已过时,**代码为准:`DAEMON_PROTOCOL_VERSION = 7`**(`src/modes/daemon/daemon-protocol.ts:55`),schema `protocol-7-schema-25-585ef1102921`。

## 拓扑与传输

- 单 **supervisor**(独占公共 socket)+ 每个 root session 一个 **worker 进程**。detach 不停 worker。
- 传输:Unix socket `tmpdir()/prime-agent-$uid/daemon.sock`;**Windows 是 named pipe `\\.\pipe\prime-agent-daemon`**(`daemon-socket.ts:70-75`)。JSONL 分帧,无 TCP/HTTP。
- 连接后 daemon 推 `daemon_hello`(protocol/schemaId/appVersion/serverCapabilities)。
- **命令必须用 envelope**:`{"type":"command","id","protocol":{name,version:7},"clientId","command":{...}}`,裸命令被拒(`daemon-supervisor.ts:1485-1490`)。SDK 的 `DaemonClient` 自动封装。
- 版本严格判等(`daemon-launch.ts:70-76`):protocol.version + schemaId + appVersion 三者全等,否则判 stale。**桌面端 SDK 必须与拉起 daemon 的 CLI 同源同版本**(用同一份 /workspace/prime-agent 构建产物)。

## 接入方式(选定:方案 C)

- `npm install && npm run build`(根目录,tui→ai→agent→coding-agent 串行)产出 dist,包 exports 只开放 `.`。
- 可用导出:`DaemonClient`、`DaemonAgentConnection`、`defaultDaemonSocketPath`、`DAEMON_PROTOCOL_VERSION` 及类型(`src/index.ts:278-349`)。
- `ensureInteractiveDaemonRunning` 未导出且依赖 `process.argv[1]`,**Electron 里不可用**;改为:探测 socket 连不上时 spawn CLI(`prime-agent.sh status` 走正常启动路径拉起 supervisor,或直接 `node <entry> --mode daemon --daemon-socket <path>` detached)。
- renderer(浏览器/Electron renderer)不能直连 socket(SDK 用 node:net);由 Node 侧 bridge 转发。

## master 常驻 session

- 幂等:`list` 找 `sessionName === "master"` 且 `workerState !== "failed"`;找不到则
  `create { name:"master", lifecycle:"resident", config:{cwd}, launchEnv }`。
- **`lifecycle:"resident"` 必须**——client_owned 在 dispose 时会停 worker。误建可 `promoteToResident()`。
- 名字在"同 depth 同 parent"作用域唯一(`agent-messages.ts:201-215`),顶层最多一个 master。
- attach:`DaemonAgentConnection.attach(sharedClient, activeSessionId, {closeClientOnDispose:false, sendClientEnv:true})`;
  观察其它 session 复用同一 socket,加 `{directTransport:false}`,多 attach 无上限(`active-session-state.ts:11` 为 Set)。

## 各机制的读写面(核对过实现)

| 能力 | 快照 | 推送 | 拉取 | 写入 |
|---|---|---|---|---|
| goal | `state.goal`(GoalState) | `goal_update` | `get_connection_state` | `config.initialGoal` 或发 `/goal ...` prompt |
| heartbeat(本 session) | `state.heartbeat` | `heartbeats_changed`(无载荷,全局广播,需节流重拉) | `heartbeat_get` | `setHeartbeat(schedule, text, mode)` |
| 全局 heartbeats | — | `heartbeats_changed` | `heartbeats_list`(不带 sessionId) | `manageHeartbeat` |
| autonomous | **无** | **无** | **无非阻塞命令** | 发 `/autonomous on|off|status` prompt;状态从 `customType:"autonomous_status"` 的 custom message 读 `details` |
| refinement | — | `refine_complete` / `refine_failed` | 历史:transcript custom `prime-agent.refinement`;状态:直读 `harness/harness_state.json`(local)与 `~/.prime/agent/harness/`(global) | `refine({instructions?, rollbackId?, global?})`(10min 超时) |
| RLM 子代理 | `snapshot.children` | `rlm_child_update` | `get_rlm_children`(需 `authoritative_child_roster` 能力) | `cancelRlmChild`、`delete_rlm_subagent` |
| 全局 roster | — | `roster_update` | `roster_subscribe`(需 `agent_roster`,仅 supervisor 连接) | — |
| agent 消息 | transcript | `message_start/end`(custom `agent_message`) | — | `sendAgentMessage(target, text)` → receipt delivered/queued |

会话事件全集(`agent-connection/types.ts:571-612`):基础 `agent_start/end, turn_start/end, message_start/update/end, tool_execution_start/update/end` + `goal_update, rlm_child_update, refine_complete/failed, compaction_start/end, session_info_changed, bash_start/output/end, recap_update` 等。

交互方法:`prompt / promptAndWait / steer / followUp / abort / waitForIdle / compact / refine / setSessionName / setHeartbeat / listHeartbeats / addCronJob / sendAgentMessage / executeBash`。

## 风险清单

1. `heartbeats_changed` 每个 connection 各收一份 → 客户端去重节流。
2. `session_already_active` 错误带 `errorInfo.activeSessionId` → 改 attach。
3. mutating 命令的幂等 `ack_result` SDK 自动处理;自建客户端必须实现。
4. 大 transcript 走 `session_snapshot_begin/chunk/end` 分片,SDK 自动组装。
