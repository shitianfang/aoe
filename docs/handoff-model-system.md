# HANDOFF：模型系统（claude -p 包装器 + NIM 目录 + daemon 模型切换）


> 写于本仓库把客户端与运行时并库之前。当时二者是两个独立 checkout，文中的 `core/`
> 和 `仓库根` 是对它们的回指；结论仍然有效，路径按现在的单仓布局读。

写于 2026-09-03。接手的人或 agent 先读本文，再读 `shitianfang/prime-agent-client-handoff` 的 `HANDOFF.md`（原始交互设计）与 `docs/` 下其他 handoff。本文覆盖**模型接入这条线**的实现与决策，兼及同期修掉的一批可见性 bug。

## 0. 三十秒摘要

- master 的对话有三个后端：**daemon**（在线时唯一路径，模型由 runtime 决定）、**claude -p**（离线回退之一，本机 Claude Code 登录）、**NIM**（离线回退之二）。三者共用 Composer 左下**同一个模型下拉**：在线列 runtime 目录并真切换（`set_model`），离线选 Claude Code / NIM 模型。
- claude -p 不是纯文字包装：开了工具（`--permission-mode acceptEdits --allowedTools Bash,WebSearch,WebFetch`），cwd 钉在工作区目录，是真 agent。它的 Task 子 agent 显示为 Agents 栏 master 下的**只读卡片**（不可对话，这是 CLI 机制边界）。
- NIM 模型列表**全部经过实时验证**——旧目录会轮换下架（llama-3.3/qwen2.5/deepseek-r1/kimi-k2 都已 404；`openai/gpt-oss-120b` 2026-09-03T08:00Z EOL，现在直接 410 Gone），改列表前必须先查 `GET https://integrate.api.nvidia.com/v1/models`。stepfun 不在 NIM 上。
- 所有链路都端到端实测过（curl 真调用 + 真实事件流），非纸面。

## 1. 用户既定决策（不要走回头路）

- **模型选择只放 Composer 输入区**，不做扩展开关——用户明确否决过 Extensions 栏的启用/关闭方案。互斥由"单一选中值"结构保证。
- **不引入 Claude Agent SDK**——用户警惕重型方案（"别把 primeAgent 重写一遍"）。claude -p 加 CLI 参数已覆盖需求；SDK 只在确需自定义 MCP 工具桥接时再议。
- **绝不把订阅 token 伪装成 API 端点**，那才是触发风控的行为。spawn 官方 CLI（继承环境登录）是唯一合规路径。
- 模型列表要**新、快、好**，不上过时模型。

## 2. 三条模型路径

### 2a. daemon 在线（正常态）

- 对话走 prime-agent runtime，模型由 daemon 会话决定。
- `GET /bridge/model` → `{ current, models }`：current 来自 `get_connection_state` 的 `state.model`；models 来自 `masterConn.getModelCatalog()`，按 `configuredProviders` 过滤（目前只有 `nvidia-nim`）。
- 切换：cmd op `set_model`（`{ text: modelId, provider }`）→ `masterConn.setModel()`，持久化进会话。只作用于**当前工作区的 master**，root/helper 不受影响。
- runtime 目录注册在 `~/.prime/agent/models.json`。当前已注册 **6 个**（都实测过）：deepseek-v4-flash、deepseek-v4-pro、kimi-k3、nemotron-3.5-lightning-30b-a3b、nemotron-3-super-120b-a12b、minimax-m3。gpt-oss-120b 已于 2026-09-03 从 NIM 下架（410），已删除。改 models.json 后要重启 daemon 才生效。
- **新会话的默认模型不在 models.json 里，在 `~/.prime/agent/settings.json` 的 `defaultModel`**（`set_model` / `root_set_model` 会回写它）。2026-09-03 从 nemotron-3.5-lightning 改成 `deepseek-ai/deepseek-v4-pro-0813`：Lightning 的 AA 智力指数只有 24，是目录里最弱的一档，却在当默认。`NIM_MODEL`（vite define / main.cjs）是**离线直连**那条路的默认，两者是两个独立的默认值，一起改。
- **`reasoning_content` 不是统一的**（原文写"7 个全吐"，实测不成立，2026-09-03 逐个 curl 复核）：
  flash / kimi-k3 / nemotron-3-super / nemotron-3.5-lightning 会吐，**pro 和 minimax-m3 不吐**。
  好在 NIM 两种形态都收：这四个模型第二轮**回传或不回传** `reasoning_content` 都是 200，
  pro / minimax 不回传也是 200——所以 models.json 里只有 flash 带 compat 块**不是 bug**，
  加不加都能跑。真要统一，也只该加在会吐的那四个上。

### 2b. claude -p（离线回退，选 "Claude Code"）

- `POST /bridge/claude`（bridge.mjs `handleClaude`）：`{ text, sessionId?, system? }` → SSE 帧 `{type:"delta"|"tool"|"subagent"|"done"|"error"}`。
- spawn `claude -p <text> --output-format stream-json --verbose --include-partial-messages --permission-mode acceptEdits --allowedTools Bash,WebSearch,WebFetch [--append-system-prompt …] [--resume <sid>]`，cwd = WORKSPACE_DIR（请求时读取，工作区可切换）。系统提示词会追加一句工作区边界（只准在该文件夹内工作；CLI 自身对 cwd 外文件访问在 -p 模式自动拒绝）。
- 多轮靠 `--resume`（renderer 侧 `src/runtime/claude.ts` 持有 sessionId），不传历史数组。
- 子 agent：assistant 消息里 `Task`/`Agent` 工具的 tool_use id 被跟踪，发 `subagent running/done` 帧；渲染为 Agents 栏 master 下的只读卡片（`AppState.claudeAgents`，每个新 turn 清空）。`parent_tool_use_id` 存在的 text_delta 会被过滤，防止子 agent 的文字混进 master 气泡。
- 环境要求：本机 `claude` CLI 已登录（当前环境 /usr/bin/claude v2.1.257）。

### 2c. NIM 直连（离线回退，选任一 NIM 模型）

- dev 走 Vite 代理 `/api/nim`（key 在 .env，服务端注入）；打包走 electron/main.cjs 的本地代理。**renderer 选的模型优先，env/config 只是兜底**（main.cjs：`if (!parsed.model)`）。
- 离线候选列表在 `src/runtime/providers.ts` 的 `MODEL_PICKS`，与 models.json 独立维护——改前先查实时目录（§0）。

## 3. Composer 模型下拉（src/components/Composer.tsx）

- 在线：`fetchModels()`（`/bridge/model`）填目录，onChange 乐观更新 + `setDaemonModel()`，失败回拉真值。选项 value 用 `provider::id` 防撞。
- 离线：`useModelPick()`（localStorage `model.pick`）。
- `fixedRoot`（root 面板内嵌 composer）不显示下拉。

## 4. 同期修掉的可见性 bug（root/test 面板事故的根因）

1. **用户消息被吞**：root_snapshot 整体替换时间线，把快照拍摄前一瞬发出的本地 user 行抹掉 → 现在快照替换会保留快照中没有的尾部 user 行（App.tsx root_snapshot 处理器）。
2. **空白气泡**：deepseek 等模型 tool-only turn 的正文是纯空白（`"\n\n"`），所有判空点从 `=== ""` 改为 `trim()`（App.tsx 多处 + bridge slimHistory）。
3. **python 行无详情**：工具行现在带 args 摘要——文件名或代码首行（`python · 2+3`），master/root/helper 三处面板一致（`toolLabel()` + bridge helper 瘦身处）。
4. **root 回复借用 master 头像**：Timeline 加 `botSeed` prop，root 面板传自己的名字。

## 5. 运行环境铁律

- **prime-agent daemon 要 Node ≥22.8**，系统 node 是 20。起 bridge/daemon 一律 `PATH=$HOME/.local/node22/bin:$PATH`。版本不对时 daemon 起不来且 spawn 的报错被吞（stdio ignore）。
- kill daemon 后残留 `/tmp/prime-agent-1000/daemon.sock.lock`（目录）会让新 daemon 永远等锁——症状是 bridge 报 "daemon did not come up"。清理：`rm -rf /tmp/prime-agent-1000/daemon.sock.lock daemon.sock`。
- bridge 对 daemon **无重连重试**：连接失败它继续占着 3117 但 `connected:false`。重启顺序：先杀旧 bridge（按 3117 端口找 pid，别用 `pkill -f`——会误杀自己 shell），再起新的。
- dev：vite 3000 + bridge 3117（`npm run bridge`）；daemon 由 bridge 自动 spawn。
- **多会话并发**：本仓库经常被多个会话同时改。动手前 `git fetch` + `git status`，提交用精确路径 `git add <path>`，push 被拒就 `git pull --rebase`。

## 6. 未完成 / 已知边界

- claude 子 agent卡片不可对话（CLI 机制如此），只在当前 turn 存活。
- `set_model` 只管 master；root 会话的模型切换未做。
- 打包形态（electron main 托管 bridge + /bridge/claude）**没在打包环境验证过**，只验了 dev。
- ~~models.json 里 7 个模型的 contextWindow/maxTokens 是保守通用值（128k/32k），未逐个核实。~~
  **contextWindow 已于 2026-09-03 逐个实测**（发一个超长请求，400 的报文会点名该部署的真实上限）：
  flash / pro / kimi-k3 = `1048576`，nemotron-3-super / nemotron-3.5-lightning = `1000000`，
  minimax-m3 = `262144`。此前统一写 128k，把 Nemotron 3 Super 唯一的强项（RULER@1M 91.8）
  和 DeepSeek 的百万窗口全砍掉了。`maxTokens` 仍是 32768——那不是模型上限，是**故意**的单轮
  输出封顶（NIM 对这几个模型的 max_tokens 基本不校验），要改是策略问题不是核实问题。
- test root 曾出现 turn 长期不关闭（child 回消息后 needs_input 挂着），daemon 拒收新 prompt 报 "already processing"——重启 daemon 可清；根因在 runtime 侧，未查。
- 首开示例（Timeline `EXAMPLES`、自进化示例行、Agents 空态例句）在有真实数据后自动退场；文案改动记得同步 i18n.ts。
