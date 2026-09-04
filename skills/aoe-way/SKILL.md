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

## 3 A round is one named change, judged blind

A round starts from the version it means to beat. Read that version, and name
what you are changing before you write:

```python
from pathlib import Path
prev = Path("poster.html").read_text()
targets = {"版心": ("980px", "680px"),
           "标题字号": ("34px", "56px"),
           "正文行距": ("1.4", "1.75"),
           "日期竖排": ("transform:rotate(-90deg)", None)}   # None = 这条要删掉
```

Three to five properties, each with the before value you just read out of
`prev` and the after value you are choosing now. A property you cannot quote a
before value for is one you did not read.

At least one target per round has to be a large-area property: the ground
colour, the measure, the display type's size, the number of grid columns, the
size of an image block. The client shows versions as thumbnails a few hundred
pixels wide, and the judges read HTML — they cannot see that scale, so they
will call a corner detail "visible at a glance" in good faith. A colour round
that repaints a 10px dot, or a type round that moves a 12px label, is true in
the diff and invisible in the pane. Spend the round where the eye already is,
and let the small corrections ride along with it.

Edit `prev` into the candidate; never regenerate the page from the brief — that
is how three rounds end where they started. The candidate lives under
`.review/` until it wins, so the real file is never left worse than it was:

```python
import difflib
cand = Path(".review/next.html")
cand.parent.mkdir(parents=True, exist_ok=True)
cand.write_text(new_text)   # new_text = prev with this round's edits applied
keep = lambda t: [l.strip() for l in t.splitlines()
                  if l.strip() and not l.strip().startswith(("<!--", "/*", "//", "*"))]
diff = [l for l in difflib.unified_diff(keep(prev), keep(cand.read_text()), n=0)
        if l[0] in "+-" and not l.startswith(("---", "+++"))]
landed = [k for k, (before, after) in targets.items()
          if (any(after in l for l in diff if l[0] == "+") if after
              else any(before in l for l in diff if l[0] == "-"))]
assert len(diff) >= 12 and len(landed) == len(targets), (len(diff), landed)
```

Under twelve changed lines, or an after value that never appears, means you
moved whitespace and renamed classes: redo it in the same turn. A round that
fails this gate is not published and is not a version.

A property can land as a deletion — dropping a `transform` outright rather than
setting it to `0deg`. Write its after value as `None` and the gate checks that
the before value left the file, instead of hunting for an after value that was
never meant to exist.

Then the judges. Ask them to choose, not to score — an absolute 1-10 comes back
flat and names nothing to fix.

```python
import json, random, shutil
pair = [("old", "poster.html"), ("new", ".review/next.html")]
random.shuffle(pair)
Path(".review/votes").mkdir(parents=True, exist_ok=True)
for slot, (origin, src) in enumerate(pair, 1):
    shutil.copyfile(src, f".review/{slot}.html")
Path(".review/key.json").write_text(
    json.dumps({str(i): o for i, (o, _) in enumerate(pair, 1)}))
ask = ("Open .review/1.html and .review/2.html, nothing else. Goal: " + goal +
       ". Line 1: WINNER=1 or WINNER=2. Line 2: GLANCE=yes or GLANCE=no — is the "
       "difference visible in two seconds, with no side-by-side? Line 3: the one "
       "thing that decided it. Write those three lines to "
       ".review/votes/<your-name>.txt, then send the same text to your parent.")
for n, lens in {"job": "does it do the job", "craft": "reads well, holds together",
                "break": "what fails first"}.items():
    await rlm(f"{ask} Your lens: {lens}.", name=f"judge-{n}")
```

Blank any version number a page prints about itself, in both copies. Then end
the turn: `rlm()` returns at admission and the answers arrive in later turns —
the reply wakes you, the file carries the vote.

```python
votes = {p.stem: p.read_text() for p in Path(".review/votes").glob("*.txt")}
key = json.loads(Path(".review/key.json").read_text())
slot = next(s for s, o in key.items() if o == "new")
won = sum(f"WINNER={slot}" in v for v in votes.values())
seen = sum("GLANCE=yes" in v for v in votes.values())
```

Two votes decide. With fewer, nudge the silent ones once — `await
rlm.list_subagents()` for handles, then `await agent_message.send(ask,
receiver_role="child", receiver_name=c.session_name)` — and end the turn again.
If that turn brings nothing, write "no quorum" in the log and move on. Never
poll, and never wait a third time.

The candidate wins only when a majority of the votes in hand picks it and a
majority answers GLANCE=yes. Then it becomes the file and gets published:

```python
Path("poster.html").write_text(cand.read_text())
await preview.publish("poster.html",
    label="第 2 版 · 版心 980→680px,标题 34→56px(盲评 2:1 选新版,一眼可见)")
```

A win with GLANCE=no is a real change nobody can see: keep it, and spend the
next round where the eye lands. A loss publishes nothing — the file still holds
the version that won last time, and the next round picks different properties.
Never publish the old bytes again under a new name; the client marks that as a
round that changed nothing, which is exactly what it is.

Append one line per round to `.review/scores.md`: round, targets with
before→after, changed lines, each judge's WINNER and GLANCE, kept or reverted.
Everything under `.review/` is dot-prefixed on purpose — the client's scan skips
dot names, so the candidate, the copies, the votes and the log never reach
Preview, while you and the user can still open them.

## 4 Every version has to read as a decision

The client keeps every published version as a card, newest first, with your
label under it and your opening sentence between one version and the next. So
those two strings are the record of the work — write them for the person who
will read them a day later:

```python
await preview.publish("poster.html",
    label="第 3 版 · 字体:标题 34→56px 衬线,正文 1.4→1.7 行距(盲评 3:0 选新版)")
```

- Label: `第 N 版 · <这轮定了什么>:<具体改动>(<证据>)`. The round's subject, the
  change, and what makes it better — a score, a measurement, a count.
- Opening sentence of the turn: the choice and what it beats. "第三轮定字体:
  标题换衬线,和正文的对比更明确;上一版标题和正文太像,三个盲评里两个都点了这一条。"
- Never narrate the mechanics. Reading a file, importing a library, listing
  subagents — none of that is a decision, and the client does not show it.

## 5 Report what can be checked

Trust comes from the observable, not from confidence. Hand back:

- the vote table — judge, winner, glance, one-line reason, and `.review/scores.md`;
- what you changed between rounds, and what you compared against;
- the files themselves, and how to re-run the check.

## 6 One step beyond the ask

Add the one thing they did not ask for but will need — the empty state, the
print stylesheet, the failure path. Label it, keep it separable, one line on
why. One such addition per deliverable; the rest goes in a "could also" list.
