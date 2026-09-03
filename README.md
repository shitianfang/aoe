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
`npm run dev:bridge` runs the bridge against the fork checkout at `/workspace/prime-agent`
(the same as the default; the fork adds `preview.publish` and `autonomous.*` host requests).
Without the bridge the app falls back to plain NIM chat ("model only" in the title bar).

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
