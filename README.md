<div align="center">

# AOE

**A**gents · **O**bjectives · **E**volution

A desktop workspace for work you hand to a crew of agents and then walk away from.

English · [中文](README.zh-CN.md)

[![license MIT](https://img.shields.io/badge/license-MIT-111111?style=flat-square)](LICENSE)
[![node ≥ 22.8](https://img.shields.io/badge/node-%E2%89%A5%2022.8-111111?style=flat-square)](#quickstart)
[![runtime prime-agent](https://img.shields.io/badge/runtime-prime--agent%20·%20daemon%20v7-111111?style=flat-square)](https://github.com/PrimeIntellect-ai/prime-agent)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/hero-dark.png">
  <img src="assets/hero-light.png" alt="The AOE window: the agent crew on the left, master's timeline in the middle, the inspector on the right" width="920">
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
mutable prompt and memory, as opposed to its fixed base prompt — stay on your machine. Only
model calls leave it.

One rule runs through the whole interface:

> **What it shows is read from the runtime, never from the model's account of itself.**
> If a panel says an objective is running, the daemon said so.

An agent that reports success is making a claim. A version you can diff, a token count
against a budget, a lesson with its evidence attached, and a helper the daemon still answers
for are facts.

The name is the three things the window is made of, and the three sections below: the
**agents** you put on the work, the **objectives** that keep them going without you, and the
**evolution** they keep afterwards.

## Quickstart

Needs **Node ≥ 22.8** and **[uv](https://docs.astral.sh/uv/)** on PATH — the daemon and its
Python kernel require them. Developed on Linux and macOS; see
[Where it stands](#where-it-stands) for Windows.

```sh
git clone https://github.com/shitianfang/aoe && cd aoe

npm install            # the app
npm run core:install   # the agent runtime, vendored in core/
npm run core:build     # build it once — the bridge loads its dist
```

Give the runtime a model. It keeps its own provider config in `~/.prime/agent/`, set up by
prime-agent itself, and the app reads whatever is there:

```sh
./core/prime-agent.sh   # then /login, and pick a subscription or API-key provider
```

Then three processes, one per terminal. Leave all three running:

```sh
npm run bridge         # daemon bridge on 127.0.0.1:3117 — starts the daemon too
npm run dev            # renderer on http://localhost:3000
npm run app            # the Electron shell
```

The app opens in Chinese; English is one click away under the avatar. The first run offers a
few things to ask for rather than an empty box. Send one — *"Three helpers, one each: a name,
a palette, a tagline for a new app — then pick the best set"* — and watch the left column
fill up.

> [!WARNING]
> The runtime executes model-generated Python with your user permissions, and unattended mode
> exists precisely so an agent does not stop to ask. Worker and kernel processes give
> lifecycle isolation, **not** a security sandbox. Point a workspace at a directory you can
> afford to lose, and keep untrusted instructions, skills and extensions out of it.

If something is off:

| Symptom | Cause |
| --- | --- |
| Settings says *model only*, drivers and helpers are missing | the bridge is not running, or the daemon could not start |
| The daemon dies at startup, or no helper ever spawns | `uv` is missing, or Node is older than 22.8 — check the terminal running the bridge |
| `EADDRINUSE` on 3117 | an older bridge is still alive: `pkill -f "electron/bridge[.]mjs"` |
| The composer has no model picker | no provider is configured in `~/.prime/agent/` yet |

You can also skip the runtime entirely and look around first: without the bridge, the app is
model-only chat over your own Claude Code login or an NVIDIA NIM key ([Models](#models)) —
and none of the three sections below apply.

## Agents

A crew, not a chat window.

- **master is resident**, one per workspace. It spawns helpers for parallel or background
  work, and it is not the only agent on the daemon: the Agents column lists master, its
  helpers, every other *root* — a top-level session of its own, not spawned by anyone — and
  those roots' crews.
- **Every row says what that agent is doing:** the line the agent writes about its current
  step, or else the task it was given, next to a status the daemon reports and a finish time.
  Team rows count what matters: how many are running, how many need you, how many failed.
- **Any live agent opens as a tab**: the full transcript, streaming, with tool rows that name
  the file touched or the first line of code run. Attaching folds older turns into one
  *N earlier turns · show* row instead of dumping the history at you.
- **Talk to any of them** — the composer's `to` picker, or the composer inside that agent's
  own pane. A message to a helper comes back *delivered* or *queued*; an idle root is woken;
  a running root is steered.
- **A helper's panel says what a helper is:** its task, status, finish time, the model it was
  spawned with (fixed at spawn, so it is shown rather than switched), the tokens it spent
  against master's budget, and whether it is still reachable or ran inline and is gone.
  Helpers have no objectives, unattended mode or check-ins of their own, and the panel does
  not invent any.
- Stop or remove a helper; create or delete roots straight from the column.

## Objectives

Work that keeps itself going.

The composer has one switch: **long-running**. Turning it on starts nothing. It prefixes your
next message with an explicit ask — set up exactly one of these, and say in one line which
you picked and why:

| Driver | What the agent calls | For |
| --- | --- | --- |
| **Objective** | `goal.create(objective, token_budget=…)` | work pursued across many turns until it is achieved |
| **Check-in** | `rlm_heartbeat.create(instruction, interval=…)` | work revisited on a schedule rather than run continuously |
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
- **Unattended** — continuations, turns, tokens and elapsed time against their limits, why
  the last continuation was injected (a failed check, or a turn that ended without evidence)
  and which check failed. Limits are editable before you switch it on, prefilled with the
  runtime's defaults: 12 turns, 80k tokens, 30 minutes, 3 continuations.
- **Re-entry** — check-ins and scheduled jobs with their next run time; pause, resume,
  cancel. A new check-in is an interval and a plain instruction. There is no cron syntax to
  learn — and no cron power either.

Every panel binds to whichever agent is selected. While a root's state is still arriving the
panel says so, rather than claiming there is no objective.

## Evolution

What an agent learns, it keeps.

A lesson is a review of what just happened that applies small, evidence-backed edits to that
agent's harness state — supplemental prompt, memories, skill and subagent descriptions. The
immutable base prompt is never touched. This is prime-agent's continual harness, surfaced as
a part of the product you can read, undo and spread.

- **Learn now** runs a review of the selected agent's session and harness, with an optional
  line about what to focus on. It takes minutes; the finished lesson arrives as a timeline
  card and a row in the Self-evolution column on its own.
- **Auto-learn** is one switch for every agent and every workspace — it writes the runtime's
  own global setting, and the bridge reloads every live worker so the change takes hold now.
  The Inspector states the rhythm: when the last automatic review ran, and the earliest the
  next one can.
- **The Self-evolution column** (the rail's lightning icon) merges every kept lesson —
  master's, each other root's, and the ones kept for every workspace — grouped by owner,
  newest first, with a dot on the rail when something landed since you last looked.
- **Opening a lesson shows the whole record**: its summary, the harness's own evidence for
  keeping it, what it expects to change (stated by the refiner, never verified by the
  system), the exact harness edits with before and after, its scope, and its origin —
  automatic, asked for, or the agent's own idea.

Two operations. **Roll back** undoes a lesson in one step; the rollback is itself recorded as
a lesson, and cannot be rolled back again. **Apply everywhere** runs a fresh review in the
global scope, seeded with that lesson's summary — the result is a new lesson that applies to
every session on the machine, and it may come out differently from the local one.

## Files and previews

The runtime's only tool is a Python REPL, so writes happen inside the kernel and no tool
argument can be trusted as a record of what changed. The bridge scans the workspace at each
turn end and diffs it against the previous manifest. The Files column is that diff: what
changed, who changed it, when.

Preview opens `.html` (in a sandboxed iframe), `.md`, `.png` and `.pdf`. Every turn that
changes a file's content snapshots a version, and the view puts the last two side by side
with the tool calls and lessons that happened between them listed underneath — so a revision
is something you compare, not something you take on trust. Agents can also declare a work
product explicitly, which snapshots immediately under the agent's own label. Snapshots dedupe
by path and content hash, so a file both declared and seen by the scan in one turn is still
one version.

## The workspace itself

Built to sit open all day next to the rest of your work.

- **Two center panes, each with its own tab group.** Drag a tab — or an agent straight out of
  the column — onto either half to open it there. Each pane gets its own composer, bound to
  what it shows. The gutter drags, double-click resets it, side columns remember their
  widths, and the layout is stored per workspace.
- **Chinese and English, light and dark**, switched under the avatar. Agent replies render as
  Markdown, including half-written ones mid-stream.
- **Skills and Extensions** are read-only catalogs of what the runtime has available: skills,
  providers, MCP servers, extensions.
- Each directory under `~/.prime/desktop/` is a workspace with its own resident master;
  `general` is the pinned default. The rail's logo switches between them, creates new ones,
  and shows which have something that needs you. It reopens where you left off.

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

The bridge exists for two reasons. A renderer cannot open a unix socket, and the daemon
compares protocol version, schema id and app version for exact equality — so the SDK that
speaks to it has to be the same build that launched it. One Node process owns that
connection, holds the attachments, and fans events out as SSE. Detaching the client does not
stop a worker: close the app and the crew keeps working.

## Models

With the runtime connected, the composer's picker switches the model of the session you are
talking to, drawn from the providers configured in `~/.prime/agent/`. Master answers for its
own; each root for its own. Helpers get no picker, because a helper's model is decided when
master spawns it.

Without the runtime, the app degrades to model-only chat rather than breaking:

- **Claude Code** — the bridge runs `claude -p` with tools enabled in the workspace
  directory, resumes by session id, and streams its tool activity and subagents back into the
  timeline. It reads no credential of its own: the child process inherits your environment
  and uses the login already on your machine.
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
| `NIM_API_KEY`, `NIM_MODEL` | fallback chat provider | — |

`.env` holds the NIM key and is gitignored.

## Where it stands

- **Every capability above runs against a live daemon**, not a mockup. Helper crews, lessons
  and rollback, previews and the long-running drivers were each walked through end to end —
  the session is written up in [docs/e2e-walkthrough-1.md](docs/e2e-walkthrough-1.md), and the
  runtime behaviour behind them in the two findings docs.
- **There are no published binaries.** Build from source.
- **Windows zips build, but have not been validated on real Windows hardware.** Linux and
  macOS are what development runs on.
- **The fork's changes are offered upstream**, and the client already degrades cleanly
  without them.
- **What is not modelled:** cost in money (tokens only), any sandbox around the kernel, and
  any measurement of whether a lesson made an agent better — the refiner's expectation is
  shown, never verified.
- No accounts, no analytics. One user, one machine.

## Build

```sh
npm run dist:win       # zip in release/ — dist:mac and dist:linux exist too
```

Packaged builds do **not** bundle `core/`, so a target machine needs:

- `NIM_API_KEY` in the environment, or `%APPDATA%/AOE/config.json` holding
  `{ "nimApiKey": "nvapi-…" }`
- for the real runtime: Node ≥ 22.8 and uv on PATH, and `PRIME_AGENT_DIR` pointing at a built
  prime-agent checkout — otherwise the app runs in model-only mode

## Running against upstream

The client is not welded to the vendored runtime. It speaks daemon protocol v7 over a local
socket and takes only `packages/coding-agent/dist/index.js` and `prime-agent.sh` out of the
runtime directory, so `PRIME_AGENT_DIR` can point at any built prime-agent checkout.

`core/` carries changes that are not upstream yet, which raise the daemon schema from 25 to
27. Against an upstream checkout every schema-27 path degrades rather than fails:

| Fork surface | What it drives here | Against upstream (schema 25) |
| --- | --- | --- |
| `preview_events` / `preview_published` | primary source for Preview | falls back to a filesystem scan at `agent_end` |
| connection-state `autoRefine` / `autonomous` | unattended status, next-review time | bridge sends `null`; the renderer omits those rows |
| `RefinementResult.source` | lesson origin label | no label shown |
| RLM child `completedAt` | real helper finish time | falls back to an estimate |

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

The `docs/` files above are written in Chinese.

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
