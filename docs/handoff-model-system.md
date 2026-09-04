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

## 2d. NIM 用量读数（2026-09-03 追加）

- **NVIDIA 什么都不告诉你**：实测 200 和 429 的响应头里都没有任何 `X-RateLimit-*`，429 的 body
  只有 `{"status":429,"title":"Too Many Requests"}`；`/v1/usage` `/v1/limits` `/v1/account`
  `/v1/credits` 全 404。所以"已用/额度"只能自己数,额度是常量(免费档 ~40 RPM/key,所有模型共用,
  `NIM_RPM` 可覆盖)。
- **实测这个 key 的真实形状**:25 次串行(~19 RPM)全过;20 并发 13 个 429;并发梯度 4 全过、
  6 挂 1 个、8 挂 3 个——**先撑不住的是并发(约 5)不是分钟**。所以 payload 里带 `inflight`,
  agent 一次扇出五个 helper 就会在 `used` 还很低时吃 429。
- **要数得全就得有唯一收口**:`models.json` 的 `baseUrl` 从 `https://integrate.api.nvidia.com/v1`
  改成 `http://127.0.0.1:3117/nim/v1`,vite 的 `/api/nim` 代理和 `electron/main.cjs` 的打包代理
  也都改成指向 bridge。bridge 侧是 `handleNim()`(纯流式透传,SSE 不受影响)+ 一个 60s 滑动窗口。
  **Authorization 优先透传**:daemon 和 vite 各自带自己的 key,只有渲染层那条(永远无 key)才由
  bridge 从 `NIM_API_KEY` / `auth.json` 补上——渲染层不持 key 这条铁律没破。
- **会话在创建或 `set_model` 时解析模型对象**(`ModelRegistry.find` 读 models.json),所以改完
  `baseUrl` 后**已经在跑的会话要重新选一次模型**才会走新路径;新建的会话自动就是新的。
  已端到端验证:新建 root → prompt → `/bridge/nim` 的 `used` 从 0 变 1。
- **代价(用户已知情选择)**:bridge 现在是模型流量的硬依赖,bridge 没起运行时够不着 NIM,
  单独跑 `./core/prime-agent.sh` 也一样。要独立就把 `baseUrl` 改回直连,读数则只剩应用自己那部分。
- UI:`GET /bridge/nim` → `{used,limit,inflight,resetInMs,throttledMsAgo}`,Composer 每 5s 拉一次,
  只在显示模型下拉、且当前模型确实是 NIM 时渲染(Claude Code 那条路不占 NIM 额度)。
  视觉遵守克制铁律:平时只有 mono 的 `32/40 RPM`,≥75% 上琥珀 + 一个小方块、20s 内吃过 429 上红,
  **词义只在 tooltip**。**单位必须写出来**(用户:"0/40 你说清楚是每分钟还是多久"):`RPM` 是 NIM
  自己的说法,对齐它,别只留个分数。
- **模型下拉的宽度**:原生 `<select>` 的宽度是**最长那个 option** 的宽度,短名字后面就空一截。
  修法是同格放一个 `visibility:hidden` 的**克隆 select(只有当前这一个 option)**撑宽度,真的那个
  `position:absolute; inset:0`。别用隐藏 span 加一个"箭头预留 px"去凑——试过,箭头实际占的比猜的多,
  仍然空一截;让浏览器自己算这一个 option 要多宽才是准的。
  **2026-09-04 作废**:下拉换成自绘弹层(见 §2e),按钮宽度天然就是当前名字的宽度,克隆 select 已删。
- **`settings.json` 的 `defaultModel` 会被覆盖**:UI 里换一次模型,`set_model` 就把它写回去。
  所以"设默认模型"不是一劳永逸的,最后一次手选的说了算。

## 2e. Vercel AI Gateway（2026-09-04 追加）

- **为什么加**:一把 key 通四家,用户点名要 `anthropic/claude-opus-5`、`moonshotai/kimi-k3`、
  `deepseek/deepseek-v4-flash`、`stepfun/step-3.7-flash`。四个 id 都对着实时目录
  (`GET https://ai-gateway.vercel.sh/v1/models`,369 个)核过,不是照记忆写的。
- **收口和 NIM 同形**:bridge 的 `handleGateway()` 把 `/gw/*` 透传到 ai-gateway.vercel.sh。
  和 NIM 有一处**故意不同**:NIM 是"调用方带的 Authorization 优先",网关是**无条件覆盖**——
  调用方带什么都丢掉,只用 bridge 自己的 key。这样运行时那条路也不必持 key。
- **bridge 自己读 `.env`**:`process.loadEnvFile()`(Node ≥20.12),所以 `node electron/bridge.mjs`
  不经 vite 也拿得到 `AI_GATEWAY_API_KEY`;真环境变量优先于文件(实测过)。vite 的 `/api/gw` 代理
  因此**不注入 Authorization**,和 `/api/nim` 不一样。
- **额度读数是真数不是自己数的**:Vercel 有 `/v1/credits`(`{balance,total_used}`),
  `GET /bridge/gateway` 转出来(15s 缓存),Composer 显示 `$4.98`,不足 1 上琥珀。因为是账户口径,
  运行时直连还是走 bridge 都算得到——这正是 NIM 必须收口而网关不必的原因。
- **runtime 目录**:prime-agent **自带** `vercel-ai-gateway` provider(`models.generated.ts`,
  两百多个模型,`baseUrl: https://ai-gateway.vercel.sh`),只要 `auth.json` 里有这个 provider
  的凭据就会整份出现在下拉里。所以 `models.json` 里写了同名 provider(四个模型,
  `baseUrl: http://127.0.0.1:3117/gw/v1`),`auth.json` 里放的是**占位符**而不是真 key——
  真 key 由 bridge 在出口换上。合并是**按模型 id** 的:写了的四个覆盖生成目录里的同 id 条目。
- **`modelPayload()` 新增一层过滤**:`declaredModels()` —— `models.json` 里带 `models` 数组的
  provider 视为**声明**而非追加,下拉只出那几个。不加这层,连上 daemon 后下拉是 233 行。
  没写进 `models.json` 的 provider 不受影响(nvidia-nim 正好是全列,等于无变化)。
- **改 models.json 不需要重启 daemon**:目录是每次 `getModelCatalog()` 现读的,实测加完立刻可见
  ——§2a 里"要重启"那句对**目录**不成立(会话解析模型仍在创建/`set_model` 时)。
- **端到端实测(2026-09-04)**:离线路(vite `/api/gw` → bridge → 网关)流式正常;运行时路在一个
  临时工作区把 master 切到 `stepfun/step-3.7-flash` 后跑完整一轮(thinking + ipython 工具 +
  文字,`agent_end`),完事删掉了那个工作区。
- **这把 key 是免费档**:Opus 5 / Kimi K3 / DeepSeek V4 Flash 一律
  `403 RestrictedModelsError: Free tier users do not have access to this model`,
  Step 3.7 Flash 能跑;`deepseek/deepseek-v3.2` 之类是 `429 rate_limit_exceeded`(限速不是禁用)。
  账户充值后前三个即通,代码不用动。网关的原话直接显示在 composer 的错误位。

## 3. Composer 模型下拉（src/components/Composer.tsx）

- 2026-09-04 起是**自绘弹层**（`.mpop`，借 `.topop` 的盒子），不再是原生 `<select>`：composer 在窗口底部，原生下拉往下弹会盖住输入框，用户要求"从上面弹"。`bottom: calc(100% + 8px)` 向上开，点外面 / Esc 关。
- 高度上限**必须用 px 不能用 vh**：外壳是 `zoom: 1.5`，`46vh` 实际画出来占了窗口 69%（vh 按设备高算，再被缩放放大一次）。现在是 `max-height: 300px`。
- 在线：`fetchModels()`（`/bridge/model`）填目录，按 provider 分组，点选乐观更新 + `setDaemonModel()`，失败回拉真值。行 key 用 `provider::id` 防撞。
- 离线：`useModelPick()`（localStorage `model.pick`），三组 Claude Code / AI Gateway / NIM。网关的 id 存成 `gw:` 前缀——`deepseek/deepseek-v4-flash` 和 NIM 的 `deepseek-ai/deepseek-v4-flash-0731` 是两条路，裸 id 记不住是哪条。
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
