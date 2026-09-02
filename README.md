# Prime Agent Desktop

A calm desktop client for [prime-agent](https://github.com/PrimeIntellect-ai/prime-agent) — built for
knowledge workers around three ideas: proactive (long unattended runs), self-improving (lessons), and
multi-agent (a resident **master** agent with helpers).

Design source: [prime-agent-client-handoff](https://github.com/shitianfang/prime-agent-client-handoff)
(interaction handoff + approved mockup).

## Develop

```sh
cp .env.example .env   # add your NVIDIA NIM API key
npm install
npm run dev            # renderer at http://localhost:3000
npm run app            # Electron shell pointing at the dev server
```

The NIM key stays server-side (Vite dev proxy). Never commit `.env`.

## Build (Windows)

```sh
npm run dist:win       # zip target, output in release/
```

The packaged app reads the NIM key from the `NIM_API_KEY` environment variable, or from
`%APPDATA%/prime-desktop/config.json`:

```json
{ "nimApiKey": "nvapi-..." }
```

## Status

- [x] Shell: title bar (light/dark toggle), rail, agents column, master timeline, DRIVERS inspector, composer
- [x] master agent chat via NVIDIA NIM (streaming)
- [ ] Daemon-backed runtime (prime-agent protocol v4): objectives, check-ins, unattended runs, lessons, helpers
- [ ] Files / Learned / Preview views
- [ ] Windows build artifact
