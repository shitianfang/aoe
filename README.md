<div align="center">

# AOE

**A**gents · **O**bjectives · **E**volution

A desktop workspace for work you hand to a crew of agents and then walk away from.

English · [中文](README.zh-CN.md)

[![license MIT](https://img.shields.io/badge/license-MIT-111111?style=flat-square)](LICENSE)
[![node ≥ 22.8](https://img.shields.io/badge/node-%E2%89%A5%2022.8-111111?style=flat-square)](#quickstart)
[![runtime prime-agent](https://img.shields.io/badge/runtime-prime--agent%20·%20daemon%20v7-111111?style=flat-square)](https://github.com/PrimeIntellect-ai/prime-agent)

[Quickstart](#quickstart) · [Agents](#agents) · [Objectives](#objectives) · [Evolution](#evolution) · [How it works](#how-it-works) · [Where it stands](#where-it-stands)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/hero-dark.png">
  <img src="assets/hero-light.png" alt="The AOE window: the agent crew on the left, master's first-run suggestions in the middle, the inspector on the right" width="920">
</picture>

<sub>A workspace on first run — the crew on the left, what master offers to do in the middle, what drives it on the right.</sub>

</div>

## What it is

Each workspace has a resident agent called **master**. You tell it what you want. It puts a
crew of helpers on the work, keeps going while you are elsewhere, leaves files behind, and
folds what it learned back into itself. Any agent on the machine can be opened, read and
talked to.

It is built for work you would rather check on than watch: a batch of variations to compare,
a document that gets rewritten five times, something to keep an eye on while you are away.
It is not an IDE and not a pair-programmer — no editor, no git integration, no test runner.
What comes back is files in a directory and a record of how they got there.

It runs locally: an Electron client over a [prime-agent](https://github.com/PrimeIntellect-ai/prime-agent)
daemon with a persistent Python kernel. Sessions, files and harness state — the agent's own
mutable prompt and memory, as opposed to its fixed base prompt — stay on your machine; model
calls and one web font are the only things that leave it.

One rule runs through the whole interface:

> **What it shows is read from the runtime, never from the model's account of itself.**
> If a panel says an objective is running, the daemon said so.

An agent that reports success is making a claim. A version you can diff, a token count
against a budget, a lesson with its evidence attached, and a helper the daemon still answers
for are facts.

The name is the three things the window is made of, and the three sections below: the agents
you put on the work, the objectives that keep them going without you, and the evolution they
keep afterwards. It is early — no binaries, build from source, and
[Where it stands](#where-it-stands) spells out what is missing.

## Quickstart

**Look around first**, in about two minutes. No runtime and no daemon: the real shell in
model-only chat, without the crew, the drivers or the lessons.

```sh
git clone https://github.com/shitianfang/aoe && cd aoe
npm install
cp .env.example .env   # an NVIDIA NIM key — https://build.nvidia.com
npm run dev            # renderer on http://localhost:3000
npm run app            # the Electron shell, in a second terminal
```

**The real thing** needs **Node ≥ 22.8** and **[uv](https://docs.astral.sh/uv/)** on PATH —
the daemon and its Python kernel require them. Developed on Linux and macOS; see
[Where it stands](#where-it-stands) for Windows.

```sh
npm run core:install   # the agent runtime, vendored in core/
npm run core:build     # build it once — the bridge loads its dist
```

Give the runtime a model. prime-agent keeps its own provider config in `~/.prime/agent/` and
the app reads whatever is there: Anthropic, OpenAI, Google, OpenRouter, Groq, DeepSeek, Prime
Inference and a couple of dozen more are built in, plus any OpenAI-compatible endpoint — this
project develops against NVIDIA NIM.

```sh
./core/prime-agent.sh   # then /login, and pick a subscription or API-key provider
```

Then three processes, one per terminal. Leave all three running:

```sh
npm run bridge         # the Node process between app and daemon, on 127.0.0.1:3117
npm run dev            # renderer on http://localhost:3000
npm run app            # the Electron shell
```

`npm run bridge` starts the daemon too. The app opens in Chinese; English is one click away
under the avatar. The first run offers a few things to ask for rather than an empty box. Send
one — *"Three helpers, one each: a name, a palette, a tagline for a new app — then pick the
best set"* — and watch the left column fill up.

> [!WARNING]
> The runtime executes model-generated Python with your user permissions, and unattended mode
> exists precisely so an agent does not stop to ask. Worker and kernel processes give
> lifecycle isolation, **not** a security sandbox. Point a workspace at a directory you can
> afford to lose, and keep untrusted instructions, skills and extensions out of it.
> The bridge binds `127.0.0.1` but answers any origin, and `npm run dev` serves the renderer
> on `0.0.0.0` — anything that can reach port 3117 can drive your agents. Trusted network
> only.
>
> To stop a run: the composer's send button becomes **stop** while an agent is working, which
> aborts the turn. Closing the app does not — workers are resident and keep going. Clear the
> objective or switch unattended off to stop it starting again, and `pkill -f prime-agent`
> ends everything.

If something is off:

| Symptom | Cause | Fix |
| --- | --- | --- |
| Settings says *model only*; no crew, no drivers | the bridge is not running, or the daemon could not start | read the terminal running `npm run bridge` — it says which |
| The daemon dies at startup, or no helper ever spawns | `uv` missing, or Node older than 22.8 | install [uv](https://docs.astral.sh/uv/); `node -v` in the bridge's own terminal |
| `EADDRINUSE` on 3117 | an older bridge is still alive | `pkill -f "electron/bridge[.]mjs"`, then start it again |
| The composer has no model picker | no provider configured yet | `./core/prime-agent.sh`, then `/login` |

## Agents

A crew, not a chat window.

- **master is resident**, one per workspace. It spawns helpers for parallel or background
  work, and it is not the only agent on the daemon: the Agents column lists master, its
  helpers, every other *root* — a top-level session of its own, not spawned by anyone — and
  those roots' crews.
- **Every row says what that agent is doing:** the line the agent writes about its current
  step, or else the task it was given, next to a status the daemon reports and a finish time.
  An agent with neither gets a bit of stable flavour for the state it is in, so no row is
  blank. Team rows count how many are running, how many need you, how many failed.
- **Any live agent opens as a tab**: the full transcript, streaming, with tool rows that name
  the file touched or the first line of code run. Attaching folds older turns into one
  *N earlier turns · show* row instead of dumping the history at you.
- **Talk to any of them** — the composer's `to` picker, or the composer inside that agent's
  own pane. A message to a helper comes back *delivered* or *queued*; an idle root is woken;
  a running root is steered.
- **A helper's panel says what a helper is:** its task, status, finish time, the model it was
  spawned with (fixed at spawn, so it is shown rather than switched), the tokens it spent
  against master's budget, and whether it is still reachable or ran inline and is gone.
  Helpers have no objectives, unattended mode or check-ins of their own, and the panel leaves
  those rows out rather than filling them in.
- Stop or remove a helper; create or delete roots straight from the column.

## Objectives

Work that keeps itself going.

The composer has one switch: **long-running**. Turning it on starts nothing. It prefixes your
next message with an explicit ask — set up exactly one *driver*, the runtime mechanism that
decides when the agent acts next, and say in one line which you picked and why:

| Driver | What the agent calls | For |
| --- | --- | --- |
| **Objective** | `goal.create(objective, token_budget=…)` | work pursued across many turns until it is achieved — the ask names 400k tokens when you don't |
| **Check-in** | `rlm_heartbeat.create(instruction, interval=…)` | work revisited on a schedule rather than run continuously — the runtime calls these heartbeats |
| **Unattended** | `autonomous.enable(turns=…, tokens=…, time=…, continuations=…)` | one long task that must not stall at the first ambiguity |

The client never picks for you and never turns a driver on behind your back. The agent
decides, states its choice, and whatever it started shows up in the Inspector on its own.
Your timeline keeps your own words plus a note that the ask was made — that prefix is never
passed off as something you typed. The switch is per agent and per session, and does not come
back silently after a restart.

The Inspector is the record of what is driving the selected agent, and where you drive it by
hand:

- **Objective** — the objective, its status, tokens used against its budget; pause, resume,
  clear, or set one inline. The header reads *driven by you* or *driven by objective*.
- **Unattended** — continuations, turns, tokens and elapsed time against their limits, and
  why the last continuation was injected. In practice that reason is always *a turn that
  ended without evidence*: the failed-check case needs gate commands, which only a daemon
  launched with them has. Limits are editable before you switch it on, prefilled with the
  runtime's defaults: 12 turns, 80k tokens, 30 minutes, 3 continuations.
- **Re-entry** — the check-ins above and any scheduled jobs, with their next run time; pause,
  resume, cancel. A new check-in is an interval and a plain instruction. There is no cron
  syntax to learn — and no cron power either.

Objective, unattended and check-ins bind to whichever agent is selected; while a root's state
is still arriving the panel says so, rather than claiming there is no objective. Two things
are deliberately not per-agent, and are labelled that way: scheduled jobs are master's, and
the auto-learn switch below is the machine's.

## Evolution

What an agent learns, it keeps.

A lesson is what the runtime's *refiner* — its own review pass over the trajectory, not a
separate agent — writes when it finds something worth keeping: small, evidence-backed edits to
that agent's harness state — supplemental prompt, memories, skill and subagent descriptions. The
immutable base prompt is never touched. This is prime-agent's continual harness, surfaced as
a part of the product you can read, undo and spread.

- **Learn now** runs a review of the selected agent's session and harness, with an optional
  line about what to focus on. It takes minutes; the finished lesson turns up on its own as a
  row in the Self-evolution column, and — for master — as a card in the timeline as it lands.
- **Auto-learn** is one switch for the whole machine: every agent, every workspace. It writes
  the runtime's own global setting, and the bridge reloads every live worker so the change
  takes hold now. The Inspector states the rhythm: when the last automatic review ran, and
  the earliest the next one can.
- **The Self-evolution column** (the rail's lightning icon) merges every kept lesson into two
  groups — *for one agent*, where master's and every root's are interleaved newest first with
  the owner on each row, and *for every workspace*. A dot on the rail marks anything that
  landed since you last looked.
- **Opening a lesson shows the record**: its summary, the harness's own evidence for keeping
  it, what it expects to change (stated by the refiner, never verified by the system), the
  edits it applied, its scope, and its origin — automatic, asked for, or the agent's own
  idea. A lesson caught live in the timeline shows one thing more: each edit with its before
  and after.

Two operations. **Roll back** undoes a lesson in one step; the rollback is itself recorded as
a lesson, and the column will not offer to roll that one back again. **Apply everywhere**
runs a fresh review in the global scope, seeded with that lesson's summary — the result is a
new lesson that applies to every session on the machine, and it may come out differently from
the local one.

## Files and previews

The runtime's only tool is a Python REPL, so writes happen inside the kernel and no tool
argument can be trusted as a record of what changed. The bridge scans the workspace at each
turn end and diffs it against the previous manifest. The Files column is that diff, plus
whatever an agent publishes explicitly: what changed, who changed it, when. The scan stops at
four levels deep and skips dot-directories, so a file written to `.out/report.html` will not
appear.

Preview opens `.html` (in a sandboxed iframe), `.md`, `.png` and `.pdf`. Every turn that
changes a file's content snapshots a version, and the view puts the last two side by side
with the tool calls and lessons that happened between them listed underneath. Agents can also
declare a work
product explicitly, which snapshots immediately under the agent's own label. Snapshots dedupe
by path and content hash, so a file both declared and seen by the scan in one turn is still
one version. They are kept as real files under `~/.prime/desktop/.previews/`, and nothing
prunes them — a page you iterate on all day leaves a copy per turn.

## House rules

The client is not neutral about how work gets done here. Every session AOE creates gets an
appended system prompt — never a
replacement for the runtime's own — telling the agent that this workspace renders what it
writes: show three genuinely different variants before building anything with a shape, write
files as you go rather than describing them, never start a web server or ask the user to open
one, publish finished work with `preview.publish(path, label=…)`, and end a turn with what
changed and what is next.

The longer form is a skill shipped in this repo, [`skills/aoe-way`](skills/aoe-way/SKILL.md),
which the bridge hands the runtime alongside its own. It carries the variant rules, a blind
subagent review protocol for picking between finalists, and what to report so you can check
the work instead of trusting it. Edit it, and the agents in your workspaces work differently.

## The workspace itself

Each directory under `~/.prime/desktop/` is a workspace with its own resident master;
`general` is the pinned default. The rail's logo switches between them and creates new ones,
saying which masters are running. It reopens where you left off.

- **Up to four center panes on a 2×2 grid, each with its own tab group.** Drag a tab — or an
  agent straight out of the column — past a pane's edge to split there, or into its middle to
  add it as a tab. Each pane gets its own composer, bound to what it shows, and the layout is
  stored per workspace.
- **Chinese and English, light and dark**, switched under the avatar. Agent replies render as
  Markdown, including half-written ones mid-stream.
- **Skills and Extensions** are read-only catalogs of what the runtime has available: skills,
  providers, MCP servers, extensions.

## How it works

```
┌──────────────────────────────────────────────────────────────────┐
│  renderer — React in Electron, no state framework                │
│  agents · timeline · inspector · self-evolution · files · preview│
└───────────────────────────────┬──────────────────────────────────┘
                                │  HTTP + SSE on 127.0.0.1:3117
┌───────────────────────────────▼──────────────────────────────────┐
│  bridge — electron/bridge.mjs (Node)                             │
│  workspaces · attach and steer · turn-end file diff · snapshots  │
└───────────────────────────────┬──────────────────────────────────┘
                                │  daemon protocol v7, JSONL over a
                                │  unix socket (named pipe on Windows)
┌───────────────────────────────▼──────────────────────────────────┐
│  prime-agent daemon — core/                                      │
│  supervisor ─▶ one worker per root session ─▶ Python kernel      │
└──────────────────────────────────────────────────────────────────┘
```

The bridge exists for two reasons. A renderer cannot open a unix socket, and prime-agent's
launch path treats a running daemon whose protocol version, schema id or app version differs
from its own as stale and replaces it — so the SDK that speaks to a daemon has to be the same
build. One Node process owns that
connection, holds the attachments, and fans events out as SSE. Detaching the client does not
stop a worker: close the app and the crew keeps working.

## Models

With the runtime connected, the composer's picker switches the model of the session you are
talking to, drawn from the providers configured in `~/.prime/agent/`. Master answers for its
own; each root for its own. Helpers get no picker, because a helper's model is decided when
master spawns it.

Without the runtime, the app degrades to model-only chat rather than breaking:

- **Claude Code** — the bridge runs `claude -p` in the workspace directory with
  `--permission-mode acceptEdits` and Bash, WebSearch and WebFetch allowed, resumes by session
  id, and streams its tool activity and subagents back into the timeline. AOE adds no
  credential of its own; the child inherits your environment and uses the login already there.
  One session is shared across the app, and this path needs the bridge — it is a bridge route,
  unlike NIM. It has not been made to work on Windows.
- **NVIDIA NIM** — `NIM_API_KEY` from `.env`, proxied server-side; the renderer never sees a
  key. Keys come from [build.nvidia.com](https://build.nvidia.com); `NIM_MODEL` defaults to
  `deepseek-ai/deepseek-v4-flash-0731`.

## Configuration

| Variable | What it does | Default |
| --- | --- | --- |
| `PRIME_AGENT_DIR` | which runtime build the bridge loads | this repo's `core/` |
| `PRIME_BRIDGE_PORT` | bridge port | `3117` |
| `PRIME_WORKSPACE_ROOT` | where workspaces live | `~/.prime/desktop` |
| `PRIME_WORKSPACE` | workspace to open | last opened, else `general` |
| `PRIME_AGENT_DAEMON_SOCKET` | daemon socket path | the SDK's platform default |
| `NIM_API_KEY` | key for the fallback chat provider | — |
| `NIM_MODEL` | model for the fallback chat provider | `deepseek-ai/deepseek-v4-flash-0731` |
| `AOE_DEV_URL` | dev server the Electron shell loads | `http://localhost:3000` |
| `AOE_DEBUG_TURNS` | log every roster turn end | off |

`.env` holds the NIM key and is gitignored.

## Where it stands

- **Everything above is wired to a live daemon**, not mocked. Helper crews and the
  long-running drivers were walked through end to end and written up — see
  [docs/e2e-walkthrough-1.md](docs/e2e-walkthrough-1.md) and the two findings docs, all three
  in Chinese, and all three written before the runtime was vendored into `core/`, when the
  daemon was still at schema 25. Lessons, rollback and previews run against real runtime
  calls but have no published walkthrough yet.
- **There are no published binaries.** Build from source.
- **Windows zips build, but have not been validated on real Windows hardware**, and the
  Claude Code fallback is known not to work there. Linux and macOS are what development runs
  on.
- **The fork's changes are offered upstream** — not yet as a pull request. The client
  degrades without them; the table below says exactly how.
- **What is not modelled:** cost in money (tokens only), any sandbox around the kernel, and
  any measurement of whether a lesson made an agent better — the refiner's expectation is
  shown, never verified.
- No accounts, no analytics. One user, one machine.

## Build

```sh
npm run dist:win       # zip in release/ — dist:mac (zip) and dist:linux (AppImage, tar.gz) too
```

Packaged builds do **not** bundle `core/`, so a target machine needs:

- `NIM_API_KEY` in the environment, or `%APPDATA%/AOE/config.json` holding
  `{ "nimApiKey": "nvapi-…" }`
- for the real runtime: Node ≥ 22.8 and uv on PATH, and `PRIME_AGENT_DIR` pointing at a built
  prime-agent checkout — otherwise the app runs in model-only mode

## Running against upstream

The client is not welded to the vendored runtime. It speaks daemon protocol v7 over a local
socket and takes three things out of the runtime directory — `dist/index.js` as its SDK,
`dist/cli.js` to spawn the daemon when none is up, and `skills/` for the Skills catalog — so
`PRIME_AGENT_DIR` can point at any built prime-agent checkout.

`core/` carries changes that are not upstream yet, which raise the daemon schema from 25 to
27. Against an upstream checkout every schema-27 path degrades rather than fails:

| Fork surface | What it drives here | Against upstream (schema 25) |
| --- | --- | --- |
| `preview_events` / `preview_published` | snapshot the moment work is published, its label, its timeline chip | the turn-end filesystem scan — which always runs anyway — becomes the only source, and nothing is labelled published |
| connection-state `autonomous` | the unattended panel | comes back `null`; the panel is omitted |
| connection-state `autoRefine` | auto-learn switch and next-review time | the switch survives: the bridge reads `settings.json` instead. Only the *last review / next no earlier than* line goes |
| `RefinementResult.source` | lesson origin label | no label shown |
| helper `completedAt` | real helper finish time | no finish time; the status word stands alone |

`npm run core:pull` pulls the fork forward. Once these land upstream, `core/` can track
upstream directly. [NOTICE](NOTICE) records the vendored commit and every change the fork
carries.

## Docs

- [docs/e2e-walkthrough-1.md](docs/e2e-walkthrough-1.md) — one full session walked end to end
- [docs/daemon-integration.md](docs/daemon-integration.md) — how the daemon is driven:
  topology, envelopes, the read/write surface of every mechanism, and the risks
- [docs/helper-runtime-findings.md](docs/helper-runtime-findings.md) — measured behaviour of
  RLM (recursive language model) helpers: event shapes, multi-attach, what the kernel needs
- [prime-agent-client-handoff](https://github.com/shitianfang/prime-agent-client-handoff) —
  the interaction handoff behind the design

## Contributing

Issues and pull requests are welcome. Runtime changes belong in
[prime-agent](https://github.com/PrimeIntellect-ai/prime-agent) itself — what `core/` carries
today is a fork waiting on upstream, not a place to build on.

## Credits and license

AOE is MIT — see [LICENSE](LICENSE).

The agent runtime under [`core/`](core/) is a vendored fork of
[prime-agent](https://github.com/PrimeIntellect-ai/prime-agent), MIT © Mario Zechner and
Prime Intellect. Its license is retained at [core/LICENSE](core/LICENSE), and [NOTICE](NOTICE)
records which commit was vendored and which changes the fork carries.
