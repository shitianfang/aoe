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

## 1 Align first — four takes, in the preview, before any building

For anything with a shape (a page, a layout, a document, a schedule, an API
surface), the first turn produces **four genuinely different** takes, each its
own file, each published so the client can lay them side by side:

```python
# poster-1.html  dense, information-first
# poster-2.html  one image, one line, everything else out
# poster-3.html  editorial, long copy, small type
# poster-4.html  a poster that is mostly type
for n, label in [(1, "密集信息"), (2, "极简"), (3, "编辑感"), (4, "纯文字")]:
    await preview.publish(f"poster-{n}.html", label=label)
```

- Different **approach**, not a different accent colour. If two takes would
  score the same for the same reason, one of them is wasted.
- Four, because two invites "neither" and three tends to collapse into a middle
  one; four covers the corners of the space.
- A label the user can read, and one line per take on what it trades away. Then
  stop: ask them to pick, or to mix ("2's layout with 1's copy").
- This turn plans. Do not build the real thing inside it — the point is that
  they see the direction before the work exists, not after.
- Skip the four only when the request already pins the shape down — say so in
  one line and build the one thing.

A revision of a take is a new publish of the same file: the client keeps the
last four versions of it, so a row of versions reads as the history of one
take, and a row of files reads as the four takes. Both are the same picture,
and both are how the user checks you without asking.

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
   `c.html`, `d.html` — shuffled, with no provenance: no `-2` in the name, no
   comment saying which is newest or yours. `.review/` is dot-prefixed on
   purpose: the client's file scan ignores it, so the scratch copies never
   reach Preview.
2. Spawn one judge per lens, each blind:

```python
goal = "<the user's request, verbatim>"
await rlm(f"Read .review/a.html … d.html. Score each 1-10 against this goal: "
          f"{goal}. Judge only whether it does the job. One line of reasoning "
          f"per file. Reply with the table.",
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
