---
name: aoe-way
description: >-
  How work is delivered in the AOE client. Align with three real variants
  before building, keep the preview live, blind-review the finalists with
  subagent judges, and report what the user can check. Read this before
  producing any deliverable — a page, document, design, layout, plan or report.
---

# The AOE way

The client renders what you write, the moment you write it. That changes the
job: the user does not read your description of the work, they look at it. So
never save the reveal for the end, and never make them pick from adjectives
when you can show them three answers.

## 1 Align first — three variants, not one guess

For anything with a shape (a page, a layout, a document, a schedule, an API
surface), the first turn produces **three genuinely different** takes, written
as files:

```
poster-v1.html   dense, information-first
poster-v2.html   one image, one line, everything else out
poster-v3.html   editorial, long copy, small type
```

- Different **approach**, not a different accent colour. If two variants would
  score the same for the same reason, one of them is wasted.
- One line per variant on what it trades away. Then ask the user to pick, or to
  mix ("v2's layout with v1's copy").
- Skip the variants only when the request already pins the shape down — say so
  in one line and build the one thing.

## 2 Keep it live

Write files as you go; every turn end refreshes Preview and the last two
versions of a file sit side by side, so progress is visible instead of
promised. Never start a web server, and never ask the user to open a browser
or a file manager to see your work. Publish a finished piece:

```python
await preview.publish("poster-v2.html", label="Poster · sparse")
```

## 3 Blind review by subagents

Before you call something done, have it judged blind.

1. Copy the finalists to neutral names inside `.review/` — `a.html`, `b.html`,
   `c.html` — shuffled, with no provenance: no `v2` in the name, no comment
   saying which is newest or yours. `.review/` is dot-prefixed on purpose: the
   client's file scan ignores it, so the scratch copies never reach Preview.
2. Spawn one judge per lens, each blind:

```python
goal = "<the user's request, verbatim>"
await rlm(f"Read .review/a.html, .review/b.html, .review/c.html. Score each "
          f"1-10 against this goal: {goal}. Judge only whether it does the "
          f"job. One line of reasoning per file. Reply with the table.",
          name="judge-job")
await rlm(..., name="judge-craft")   # reads well, holds together, no jank
await rlm(..., name="judge-break")   # what fails first, edge cases, missing states
```

3. `rlm()` returns at admission, not completion — the judges' answers arrive in
   later turns as messages. Collect them, tally, take the majority.
4. Iterate: fix what the low scores name, re-run the panel on the revision, and
   stop when the top choice is stable across two rounds. Never hint to a judge
   which file is the new one.

## 4 Report what can be checked

Trust comes from the observable, not from confidence. Hand back:

- the score table — judge, file, score, one-line reason;
- what you changed between rounds, and what you compared against;
- the files themselves, and how to re-run the check.

## 5 One step beyond the ask

Add the one thing they did not ask for but will need — the empty state, the
print stylesheet, the failure path. Label it, keep it separable, one line on
why. One such addition per deliverable; the rest goes in a "could also" list.
