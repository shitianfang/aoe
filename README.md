# AOE

A calm desktop workspace for knowledge workers, built around three ideas: **proactive**
(long unattended runs), **self-improving** (lessons the agent keeps), and **multi-agent**
(a resident *master* agent with helpers).

AOE is one repository holding both halves of that:

| | |
| --- | --- |
| **the app** — root | Electron + React client, and the daemon bridge it talks to |
| **the runtime** — [`core/`](core/) | a vendored fork of [prime-agent](https://github.com/PrimeIntellect-ai/prime-agent) (MIT), the agent daemon and its Python kernel |

The client is not welded to the fork: it speaks daemon protocol v7 over a local socket and
takes only `packages/coding-agent/dist/index.js` and `prime-agent.sh` out of the runtime
directory. Point `PRIME_AGENT_DIR` at an upstream checkout and everything still runs —
see [Running against upstream](#running-against-upstream).

## Develop

```sh
npm install                   # the app
npm run core:install          # the runtime in core/
npm run core:build            # build core/ once (the bridge loads its dist)

cp .env.example .env          # add your NVIDIA NIM API key
npm run dev                   # renderer at http://localhost:3000
npm run bridge                # daemon bridge on 127.0.0.1:3117
npm run app                   # Electron shell pointing at the dev server
```

The bridge needs **Node >= 22.8** and **uv** on PATH — the daemon and its Python kernel
require them. It defaults `PRIME_AGENT_DIR` to this repo's `core/`, so a source checkout
needs no configuration. Without the bridge the app falls back to plain NIM chat
("model only" in the title bar).

The NIM key stays server-side (Vite dev proxy / bridge). Never commit `.env`.

## Workspaces

Each directory under `~/.prime/desktop/` is a workspace with its own resident master
(session `master@<name>`; `general` is the pinned default). Switch or create from the
title-bar workspace menu.

## Build (Windows)

```sh
npm run dist:win       # zip target, output in release/
```

Packaged builds do **not** bundle `core/`. On the target machine the app needs:

- `NIM_API_KEY` env var, or `%APPDATA%/AOE/config.json` with `{ "nimApiKey": "nvapi-..." }`
- for the real runtime: Node >= 22.8 and uv on PATH, and `PRIME_AGENT_DIR` pointing at a
  built prime-agent checkout (otherwise the app runs in model-only mode)

## Running against upstream

`core/` carries five changes not yet upstream, which raise the daemon schema from 25 to 27.
Against an upstream checkout every schema-27 path degrades rather than fails:

| Fork surface | What it drives here | Against upstream (schema 25) |
| --- | --- | --- |
| `preview_events` / `preview_published` | primary source for the Preview view | falls back to client-side inference (fs scan at `agent_end`) |
| connection-state `autoRefine` / `autonomous` | unattended status, next-review time | bridge sends `null`; the renderer omits those rows |
| `RefinementResult.source` | lesson origin label on lesson cards | no label shown |
| RLM child `completedAt` | real helper finish time | falls back to an estimate |

`npm run core:pull` pulls the fork forward. Once its changes land upstream, `core/` can
track upstream directly.

## Status

- [x] Shell per the approved mockup: light/dark, rail, agents column, timeline, DRIVERS, composer
- [x] Real runtime: daemon protocol v7 bridge — resident master, streaming replies, tool events
- [x] Helpers: roster, helper view with live child-session transcript, family-wide composer targeting
- [x] Objectives with pause/resume/clear + inline set; unattended toggle; check-in create/pause/clear
- [x] Lessons end-to-end (verified live): timeline lesson cards, Learned history/entries, one-step rollback
- [x] Transcript history restored on attach ("N earlier turns · show"); other root agents listed
- [x] Files and Preview from filesystem truth (per-turn scan; version snapshots)
- [x] Workspaces with pinned general default
- [x] Windows zip releases
- [x] Preview host-request pipeline in core (`preview.publish`)
- [x] Long-running switch: master picks its own driver (goal / heartbeat / unattended, `autonomous.*`)
- [x] Side columns drag to width
- [ ] Windows end-to-end validation on a real machine

## Design source

[prime-agent-client-handoff](https://github.com/shitianfang/prime-agent-client-handoff) —
interaction handoff and the approved mockup. Runtime findings:
[docs/daemon-integration.md](docs/daemon-integration.md),
[docs/helper-runtime-findings.md](docs/helper-runtime-findings.md).

## License

MIT — see [LICENSE](LICENSE). `core/` is a fork of prime-agent, MIT © Mario Zechner and
Prime Intellect; its license is retained at [core/LICENSE](core/LICENSE) and the vendoring
is recorded in [NOTICE](NOTICE).
