# AOE

A desktop workspace for work you hand to an agent and then walk away from.

Each workspace has a resident agent that lives in it. Give it something to do and it can
keep pursuing that on its own while you are elsewhere, split the work across a crew of
helpers you can open and talk to, keep evidence-backed lessons from what it learned and
apply them to itself, and leave real files behind that you can read and compare version by
version. What the interface says is running comes from the runtime's own state, never from
the model's account of itself.

It runs on your machine: an Electron + React client over a local
[prime-agent](https://github.com/PrimeIntellect-ai/prime-agent) daemon (protocol v7) with a
persistent Python kernel. The session, its files and its harness state stay on your
machine; only model calls leave it.

## Work that keeps itself going

The composer has one switch: **long-running**. Turning it on does not start anything. It
adds an explicit ask to your next message — set up exactly one of these, and say in one
line which you picked and why:

| Driver | Kernel call | For |
| --- | --- | --- |
| Objective | `goal.create(objective, token_budget=…)` | work pursued across many turns until it is achieved |
| Check-in | `rlm_heartbeat.create(instruction, interval=…)` | work revisited on a schedule rather than run continuously |
| Unattended | `autonomous.enable(turns=…, tokens=…, time=…, continuations=…)` | one long task that must not stall at the first ambiguity |

The client never picks for you and never turns a driver on behind your back. The agent
decides, states its choice, and whatever it started then shows up in the Inspector on its
own. Your timeline keeps your own words plus a note that the ask was made — the preamble is
never passed off as something you typed. The switch is per agent and per session: it does
not come back silently after a restart.

The Inspector is the honest record of what is driving the selected agent, and it is also
where you drive it by hand:

- **Objective** — the objective itself, its status, tokens used against its budget with a
  percentage; pause, resume, clear, or set one inline. The subject header reads
  *driven by you* or *driven by objective*.
- **Unattended** — continuations, turns, tokens and elapsed time against their limits; why
  the last continuation was injected (a failed check, or a turn that ended without
  evidence) and which check failed. Limits are editable before you switch it on — turns,
  tokens, time, continuations, prefilled with the runtime's defaults (12 / 80k / 30m / 3).
- **Re-entry** — check-ins and scheduled jobs with their next run time; pause, resume,
  clear, cancel. New check-ins are made from an interval choice and a plain instruction;
  there is no cron syntax to learn.

Every panel binds to whichever agent is selected — the workspace master or any other root
agent on the daemon. While a root's state is still arriving the panel says so rather than
claiming it has no objective.

## Agents that keep what they learn

Lessons are the runtime's harness refinement, surfaced as a first-class part of the
product. A lesson is a review of what just happened that applies small, evidence-backed
edits to the agent's own harness state. The immutable base prompt is never touched.

- **Learn now** runs a real review on the selected agent's own session and harness, with an
  optional line about what to focus on. It takes minutes; the finished lesson arrives as a
  timeline card and a row in the Self-evolution column on its own.
- **Auto-learn** is one switch for every agent and every workspace. The bridge writes the
  setting and reloads every live agent worker, and the Inspector shows the rhythm honestly:
  when the last automatic review happened, and the earliest the next one can happen.
- The **Self-evolution column** (the rail's lightning icon) merges every kept lesson —
  master's, each other root's, and the ones kept everywhere — grouped by owner, newest
  first, with a dot on the rail when something landed since you last looked.
- Opening a lesson shows the whole record: its summary, the harness's own evidence for
  keeping it, what it expects to change (stated by the refiner, never verified by the
  system), the exact harness edits it applied with before and after, its scope, and its
  origin — automatic, asked for, or the agent's own idea.

Two operations, both real: **roll back** undoes a lesson in one step (the rollback is itself
recorded as a lesson, and cannot be rolled back again), and **apply everywhere** runs a
fresh global review seeded with that lesson's summary — a new lesson in the everywhere
scope, which may come out differently from the local one.

## A crew you can actually talk to

The resident master spawns helpers for parallel or background work, and it is not the only
agent on the daemon. The Agents column shows master, its helpers, every other root session,
and those roots' own crews, each with live status and the runtime's own "what am I doing"
line as its subtitle. Team rows count what matters: how many are running, how many need
you, how many failed.

- Any agent with a live session opens as a tab — its full transcript, streaming, with tool
  rows that say what actually ran (the file touched, or the first line of code).
- Message any of them: the composer's `to` picker, or a composer bound to that agent's own
  pane. A message to a helper comes back delivered or queued; an idle root is prompted,
  which wakes it, and a running one is steered.
- A helper's own panel stays honest about what a helper is: its task, status, finish time,
  the model it was spawned with (fixed at spawn, so it is shown, never switched), the tokens
  it spent billed to master, and whether it is still reachable or ran inline and is gone.
  Helpers have no objectives, unattended mode or check-ins of their own, so it does not
  pretend otherwise.
- Stop or remove a helper. Create a new root agent by name straight from the column.
- Transcript history is restored when you attach: older turns fold into one
  *N earlier turns · show* row instead of dumping the whole history at you.

## Files and previews, from the filesystem

The runtime's only tool is a Python REPL, so writes happen inside the kernel and no tool
argument can be trusted as a record of what changed. The bridge scans the workspace at each
turn end and diffs it against the previous manifest. The Files column is that diff: what
changed, who changed it, when.

Preview opens `.html` (in a sandboxed iframe), `.md`, `.png` and `.pdf`. Every turn that
actually changes a file's content snapshots a version, and the view puts the last two side
by side, with the tool calls and lessons that happened between them listed underneath — so
a revision is something you compare, not something you take on trust. Agents can also
declare a work product explicitly, which snapshots immediately under the agent's own label;
snapshots dedupe by path and content hash, so a file both declared and seen by the scan in
one turn is still one version.

## Models

With the runtime connected, the composer's picker switches the model of the session you are
talking to, from the providers the daemon actually has configured — master answers for its
own, each root for its own. Helpers get no picker, because a helper's model is decided when
master spawns it.

Without the runtime, the app degrades to model-only chat rather than breaking: your own
Claude Code login (the bridge runs `claude -p` with tools enabled in the workspace
directory, resumes by session id, and streams its tool activity and Task subagents back into
the timeline) or an NVIDIA NIM model. API keys stay server-side; the renderer never sees
one.

## The workspace itself

Quiet on purpose. It is meant to sit open all day next to the rest of your work.

- Two center panes, each with its own tab group. Drag a tab — or an agent straight out of
  the column — onto either half to open it there. Each pane gets its own composer bound to
  what it shows. The gutter drags, double-click resets it, the side columns remember their
  widths, and the layout is remembered per workspace.
- Chinese by default, English one click away. Light and dark. Agent replies render as
  Markdown, including part-written ones mid-stream.
- Skills and Extensions are read-only catalogs of what the runtime actually has available:
  skills, providers, MCP servers, extensions.
- The first time a workspace opens, the timeline offers a few example asks rather than an
  empty box.

Each directory under `~/.prime/desktop/` is a workspace with its own resident master
session; `general` is the pinned default. The switcher on the rail moves between them and
creates new ones, showing each workspace's master state and whether anything there needs
you.

## Run it

```sh
npm install                   # the app
npm run core:install          # the agent runtime in core/
npm run core:build            # build it once (the bridge loads its dist)

cp .env.example .env          # add your NVIDIA NIM API key
npm run dev                   # renderer at http://localhost:3000
npm run bridge                # daemon bridge on 127.0.0.1:3117
npm run app                   # Electron shell pointing at the dev server
```

The bridge needs **Node >= 22.8** and **uv** on PATH — the daemon and its Python kernel
require them. It defaults `PRIME_AGENT_DIR` to this repo's `core/`, so a source checkout
needs no further configuration. Without the bridge you get model-only chat ("model only" in
Settings, and the composer says so). Never commit `.env`.

The client is not welded to the vendored runtime: it speaks daemon protocol v7 over a local
socket and takes only `packages/coding-agent/dist/index.js` and `prime-agent.sh` out of the
runtime directory. Point `PRIME_AGENT_DIR` at any built prime-agent checkout and it runs —
see [Running against upstream](#running-against-upstream).

### Build

```sh
npm run dist:win       # zip target, output in release/
```

`dist:mac` and `dist:linux` targets exist too; Windows is the one that gets released.
Packaged builds do **not** bundle `core/`. On the target machine the app needs:

- `NIM_API_KEY` in the environment, or `%APPDATA%/AOE/config.json` with
  `{ "nimApiKey": "nvapi-..." }`
- for the real runtime: Node >= 22.8 and uv on PATH, and `PRIME_AGENT_DIR` pointing at a
  built prime-agent checkout — otherwise the app runs in model-only mode

### Running against upstream

`core/` carries changes not yet upstream, which raise the daemon schema from 25 to 27.
Against an upstream checkout every schema-27 path degrades rather than fails:

| Fork surface | What it drives here | Against upstream (schema 25) |
| --- | --- | --- |
| `preview_events` / `preview_published` | primary source for the Preview view | falls back to client-side inference (fs scan at `agent_end`) |
| connection-state `autoRefine` / `autonomous` | unattended status, next-review time | bridge sends `null`; the renderer omits those rows |
| `RefinementResult.source` | lesson origin label on lesson cards | no label shown |
| RLM child `completedAt` | real helper finish time | falls back to an estimate |

`npm run core:pull` pulls the fork forward. Once its changes land upstream, `core/` can
track upstream directly.

## Where it stands

Every capability above runs against a real daemon rather than a mockup — helper crews,
lessons and rollback, previews and the long-running drivers were each walked through live
and the findings written down. Windows zips build and ship, but end-to-end validation on a
real Windows machine has not been done yet. The fork's changes are offered upstream, and
the client already degrades cleanly without them.

Runtime findings and the interaction handoff behind the design:
[docs/daemon-integration.md](docs/daemon-integration.md),
[docs/helper-runtime-findings.md](docs/helper-runtime-findings.md),
[prime-agent-client-handoff](https://github.com/shitianfang/prime-agent-client-handoff).

## Credits and license

AOE is MIT — see [LICENSE](LICENSE).

The agent runtime under [`core/`](core/) is a vendored fork of
[prime-agent](https://github.com/PrimeIntellect-ai/prime-agent), MIT © Mario Zechner and
Prime Intellect. Its license is retained at [core/LICENSE](core/LICENSE) and the vendoring —
which commit, and which changes the fork carries — is recorded in [NOTICE](NOTICE).
