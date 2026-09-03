---
name: autonomous
description: Read or switch autonomous mode for this session from the Python REPL. Use to keep a single long task from stopping early, and only when the user or system/developer instructions explicitly ask for unattended operation.
---

# Autonomous

Autonomous mode keeps one long task going: when a turn ends without terminal
evidence, or a configured gate command fails, the harness injects a
continuation instead of handing control back. It is bounded by four limits —
continuations, turns, tokens, and wall-clock time — and any one of them
reaching zero stops the run. It never *starts* a run; it only prevents an
in-flight one from stopping early.

Call it directly from the Python REPL:

```python
await autonomous.get()
await autonomous.enable(turns=20, tokens="150k", time="45m", continuations=5)
await autonomous.disable()
```

## API

- `await autonomous.get()` — current status as a dict: `enabled`,
  `continuationsUsed`, `turnsUsed`, `tokensUsed`, `startedAt`, `limits`
  (`maxContinuations`, `maxTurns`, `maxTokens`, `timeoutMs`), `gates`,
  `lastGateFailure`, and `lastInjection`.
- `await autonomous.enable(turns=None, tokens=None, time=None,
  continuations=None)` — switch autonomous mode on and reset its counters.
  Every limit is optional; an omitted limit falls back to the session's
  baseline (the `--autonomous-*` startup flags, or the defaults: 3
  continuations, 12 turns, 80k tokens, 30 minutes). `tokens` accepts a plain
  count or a `k`/`m` suffix (`"150k"`); `time` accepts `s`/`m`/`h` and treats
  a bare number as minutes (`"45m"`). You get one grant per session: this
  fails if autonomous mode is already on, and it fails afterwards even once
  you have switched it off again.
- `await autonomous.disable()` — switch autonomous mode off and drop any
  queued continuation. Only works on a mode you armed yourself; one the user
  switched on is theirs to clear.

## Rules

- Enable only when the user or system/developer instructions explicitly ask
  for unattended or long-running operation. Do not switch it on to give
  yourself room on an ordinary task.
- Enabling resets every counter, which is why you only get one grant. If a
  limit stops the run, report where it stopped and what remains; do not look
  for a way to continue past the budget you were given.
- Autonomous mode is not a way to start work on a schedule (use
  `rlm_heartbeat`) or to pursue an objective across many turns (use `goal`).
  Choose the one that matches what the work actually needs.
- The switch only reaches the user when the turn ends, so say in your reply
  which mode you armed and with what limits.
