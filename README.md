# AOE

A calm desktop client for [prime-agent](https://github.com/PrimeIntellect-ai/prime-agent) — built for
knowledge workers around three ideas: proactive (long unattended runs), self-improving (lessons), and
multi-agent (a resident **master** agent with helpers).

Design source: [prime-agent-client-handoff](https://github.com/shitianfang/prime-agent-client-handoff)
(interaction handoff + approved mockup). Runtime findings: [docs/daemon-integration.md](docs/daemon-integration.md),
[docs/helper-runtime-findings.md](docs/helper-runtime-findings.md).

## Develop

```sh
cp .env.example .env   # add your NVIDIA NIM API key
npm install
npm run dev            # renderer at http://localhost:3000
npm run bridge         # daemon bridge on 127.0.0.1:3117 (real runtime)
npm run app            # Electron shell pointing at the dev server
```

The bridge needs **Node >= 22.8** and **uv** on PATH (the prime-agent daemon and its Python kernel
require them), plus a built prime-agent checkout at `PRIME_AGENT_DIR` (default `/workspace/prime-agent`).
`npm run dev:bridge` defaults `PRIME_AGENT_DIR` to the preview-publish fork at
`/workspace/prime-agent-fork`, so `PRIME_AGENT_DIR=... npm run dev:bridge` still wins.
Without the bridge the app falls back to plain NIM chat ("model only" in the title bar).

### Which checkout

The client is not bound to the fork: it speaks daemon protocol v7 over the socket and takes only
`packages/coding-agent/dist/index.js` and `prime-agent.sh` out of `PRIME_AGENT_DIR`. The fork serves
daemon schema 27 and the `preview_events` capability; upstream serves schema 25. Against upstream
every schema-27 path degrades rather than fails:

| Fork surface | What it drives here | Against upstream (schema 25) |
| --- | --- | --- |
| `preview_events` / `preview_published` | primary source for the Preview view | falls back to client-side inference (fs scan at `agent_end`) |
| connection-state `autoRefine` / `autonomous` | unattended status, next-review time | bridge sends `null`; the renderer omits those rows |
| `RefinementResult.source` | lesson origin label on lesson cards | no label shown |
| RLM child `completedAt` | real helper finish time | falls back to an estimate |

Once the fork's changes land upstream, drop the `dev:bridge` default and point `PRIME_AGENT_DIR` at
upstream.

The NIM key stays server-side (Vite dev proxy / bridge). Never commit `.env`.

## Workspaces

Each directory under `~/.prime/desktop/` is a workspace with its own resident master
(session `master@<name>`; `general` is the pinned default). Switch or create from the
title-bar workspace menu.

## Build (Windows)

```sh
npm run dist:win       # zip target, output in release/
```

The packaged app hosts the daemon bridge itself. On the target machine it needs:

- `NIM_API_KEY` env var, or `%APPDATA%/AOE/config.json` with `{ "nimApiKey": "nvapi-..." }`
- for the real runtime: Node >= 22.8 and uv on PATH, and `PRIME_AGENT_DIR` pointing at a built
  prime-agent checkout (otherwise the app runs in model-only mode)

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
- [x] Preview host-request pipeline in core (fork: `preview.publish`)
- [x] Long-running switch: master picks its own driver (goal / heartbeat / unattended; fork adds `autonomous.*`)
- [ ] Windows end-to-end validation on a real machine
