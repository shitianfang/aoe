# AOE — working notes for Claude

Electron + React desktop client for a crew of agents. `core/` is a vendored
squash subtree of the prime-agent runtime (see `NOTICE`); the bridge
(`electron/bridge.mjs`) resolves it relative to its own path, so a source
checkout needs no configuration.

## Commit and push at every stopping point

**This checkout is shared.** Several Claude sessions work in `/workspace/aoe`
at the same time, writing the same files. Anything you leave uncommitted is one
overwrite away from gone — this has already happened. So:

- **Commit the moment a change is coherent**, not when the task is finished.
  A working typecheck and a change that stands on its own is enough.
- **`git push origin main` right after every commit.** A local commit still
  dies with the box; only a pushed one is safe.
- **Do not create a branch.** The other sessions share this working tree, so
  switching HEAD yanks it out from under them. This repo commits to `main`.
- **Stage your own hunks, not the whole tree.** `git status` will show other
  sessions' half-finished work. Use `git diff -- <file>`, keep the hunks that
  are yours, `git apply --cached`. If the user asks you to commit everything,
  do — but say in the message that it is a snapshot of concurrent work.
- **Pull before you push** if the push is rejected; another session probably
  pushed first. Never force.

Commit messages are a sentence about what changed for the user, lowercase after
the first word, no `feat:` prefixes — read `git log` for the register.

## Commands

```
npm run dev          # vite on :3000 (the bridge proxies from :3117)
npm run bridge       # the daemon bridge — the app needs it running
npm run app          # electron against the dev server
npm run build        # tsc --noEmit && vite build — run before committing
npm run core:build   # rebuild the vendored runtime after core:pull
```

## UI rules that are already settled

The visual language went through many rounds with the user and is not open for
re-litigation. Before changing anything visual, read the design memory; the
short version:

- Square corners, no border-radius. Light theme by default, manual toggle.
- Separate with background colour, not lines, wherever it will work.
- Every screen answers only: is it running, who is driving, what needs me.
- **Chinese micro-typography**: the small labels in this shell are Latin
  devices — 8–9px mono, uppercased, tracked. In Chinese that is damage.
  `app.css` ends with a single `html[lang="zh-CN"]` block that swaps them to
  sans, drops the tracking and lifts the size (floor 10.5px). Keep the
  overrides in that one block, and **never change the English rendering** —
  it is the tuned baseline. Machine text (ids, clock digits) stays mono.

## Gotchas

- `.gitignore` has `*.local`, which matches `foo.local` but **not**
  `foo.local.html`. Scratch files belong in the scratchpad directory, not the
  repo root — one got committed that way.
- A skill's YAML frontmatter breaks on a bare colon inside `description:`, and
  the skill then fails to load silently. Quote it or fold with `>-`.
- Screenshots (headless, no X, no CJK fonts in the container):
  ```
  ELECTRON_RUN_AS_NODE= xvfb-run -a ./node_modules/.bin/electron --no-sandbox shot.local/shot3.cjs
  ```
  For Chinese, install a CJK font first (`apt-get download fonts-wqy-zenhei`,
  unpack into `~/.fonts`, `fc-cache -f`) or every hanzi renders as tofu.
- At `zoom: 1.5`, `getBoundingClientRect()` already returns scaled coordinates
  — do not multiply again when computing `sendInputEvent` positions.
