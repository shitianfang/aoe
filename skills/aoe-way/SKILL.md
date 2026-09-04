---
name: aoe-way
description: >-
  How work is delivered in the AOE client. Align on four takes and recommend
  one, write the pick down as a contract, then loop: mutate the winner, render
  every candidate and check it against the contract, let blind judges pick
  between the pictures, publish only what won. Read this before producing any
  deliverable — a page, document, design, layout, plan or report.
---

# The AOE way

The client renders what you write, the moment you write it. That changes the
job: the user does not read your description of the work, they look at it. So
never save the reveal for the end, and never make them pick from adjectives
when you can show them three answers.

Three things decide whether the work is any good, and each one has a section
below with the exact moves:

- **Align** (§1) — four takes, a recommendation, and the pick written down as a
  contract before anything is built.
- **Verify** (§4) — render the candidate and look at it, then check it against
  the contract. Never your own opinion of your own source.
- **Iterate** (§3, §5, §6) — every round is a mutation that has to beat the
  version it came from, judged blind on the pictures, until it stops improving.

## 1 Align first — four takes, one recommendation, before any building

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
- A label the user can read, and one line per take on what it trades away.
- **Then recommend one, and say why in one line** — plus the one condition that
  would change your mind: "我建议 2:这份东西是给三秒钟的读者看的,密度是它的敌人;
  如果你要它同时当存档,选 1。" Four takes and no recommendation makes the user do
  the judging you were hired for. A recommendation is not a decision: stop and
  let them pick, or mix ("2 的版式配 1 的文案").
- This turn plans. Do not build the real thing inside it — the point is that
  they see the direction before the work exists, not after.
- Skip the four only when the request already pins the shape down — say so in
  one line and build the one thing.

A revision of a take is a new publish of the same file: the client keeps every
version of it, so a row of versions reads as the history of one take, and a row
of files reads as the four takes. Both are the same picture, and both are how
the user checks you without asking.

### The pick becomes a contract

The moment they choose, write `.review/brief.md` — before the first line of the
real thing:

```markdown
# 目标:招聘海报,给工位路过的人看
选中:2 极简(备选:3 编辑感)
放弃:信息密度 —— 细节走二维码,不进版面
判据(每轮都要过):
- C1 三秒内能读出"招什么人"和"投哪里"
- C2 1200px 宽下不横向滚动,680px 下不塌
- C3 版面里最大的字是岗位名,不是公司名
完成的样子:C1-C3 全过,且一轮盲评没人能击败现任版本
```

Three criteria, each one checkable by looking or by measuring — not "好看"、
"专业"。 This file is the goal handed to every judge, the checklist §4 runs, and
the thing the final report answers. If the user's pick came with a sentence
("要能打印"), it is a criterion; put it in. Nothing gets built until this file
exists, and when the user changes their mind mid-way, this file changes first.

## 2 Keep it live

Write files as you go; every turn end refreshes Preview and the versions of a
file stack up newest-first, so progress is visible instead of promised. Never
start a web server, and never ask the user to open a browser or a file manager
to see your work. Publish a finished piece:

```python
await preview.publish("poster-v2.html", label="Poster · sparse")
```

## 3 A round is a mutation, not a nudge

A round starts from the version it means to beat. Read that version off disk —
the client keeps every published version at the snapshot path named in your
system prompt (`index.json` plus a full copy per version) — and read
`.review/scores.md` before choosing anything, so you never spend a round on a
property that already lost:

```python
from pathlib import Path
prev = Path("poster.html").read_text()
log  = Path(".review/scores.md").read_text() if Path(".review/scores.md").exists() else ""
```

Then name what you are changing, before you write. Three to five properties,
each with the before value you just read out of `prev` and the after value you
are choosing now. A property you cannot quote a before value for is one you did
not read.

```python
targets = {"版心": ("980px", "680px"),
           "标题字号": ("34px", "56px"),
           "正文行距": ("1.4", "1.75"),
           "日期竖排": ("transform:rotate(-90deg)", None)}   # None = 这条要删掉
```

At least one target per round has to be a large-area property: the ground
colour, the measure, the display type's size, the number of grid columns, the
size of an image block. A colour round that repaints a 10px dot is true in the
diff and invisible in the pane. Spend the round where the eye already is, and
let the small corrections ride along with it.

**Two or three mutants per round, pulling in directions that cannot both be
right.** One candidate against the incumbent is a coin flip on your own taste;
mutants that disagree with each other are how a round finds something you would
not have chosen. "More air" and "more density" are a pair. "Bigger type" and
"smaller type, more of it" are a pair. Edit `prev` into each one; never
regenerate the page from the brief — that is how three rounds end where they
started.

```python
import difflib
keep = lambda t: [l.strip() for l in t.splitlines()
                  if l.strip() and not l.strip().startswith(("<!--", "/*", "//", "*"))]

def gate(name, text, targets):
    """A candidate that does not clear this is not a candidate. Same turn, redo."""
    cand = Path(f".review/next-{name}.html")
    cand.parent.mkdir(parents=True, exist_ok=True)
    cand.write_text(text)
    diff = [l for l in difflib.unified_diff(keep(prev), keep(text), n=0)
            if l[0] in "+-" and not l.startswith(("---", "+++"))]
    landed = [k for k, (before, after) in targets.items()
              if (any(after in l for l in diff if l[0] == "+") if after
                  else any(before in l for l in diff if l[0] == "-"))]
    assert len(diff) >= 12 and len(landed) == len(targets), (name, len(diff), landed)
    return cand
```

Under twelve changed lines, or an after value that never appears, means you
moved whitespace and renamed classes. A property can land as a deletion —
dropping a `transform` outright rather than setting it to `0deg`; write its
after value as `None` and the gate checks that the before value left the file.

Candidates live under `.review/` until one wins, so the real file is never left
worse than it was. Everything under `.review/` is dot-prefixed on purpose — the
client's scan skips dot names, so candidates, shots, votes and the log never
reach Preview, while you and the user can still open them.

## 4 Verify by looking, before anyone votes

You cannot review your own HTML. Source review is blind to scale, to colour
weight, to whether the images arrived and whether the thing scrolls sideways —
and those are what decide a page. The client renders it for you:

```python
import json, urllib.parse, urllib.request

def shot(rel, out, width=1200):
    """PNG of the file as the Preview pane will draw it, plus what went wrong
       loading it: broken images, sideways scroll, console errors, empty body.
       The bridge's address is in your system prompt; 3117 is its default."""
    q = urllib.parse.urlencode({"path": rel, "out": out, "width": width})
    with urllib.request.urlopen(f"http://127.0.0.1:3117/bridge/shot?{q}", timeout=120) as r:
        return json.load(r)

r = shot(".review/next-a.html", ".review/shots/a.png")
await attach_image(".review/shots/a.png")     # now LOOK at it
```

Shoot the incumbent too — the judges have to compare pictures of the same kind,
and you need to see what you are actually beating.

Three things happen with that report, in this order:

1. **`r["problems"]` is a defect list, not advice.** A broken image, a page that
   scrolls sideways at 1200px, a console error, "almost no text on it" — fix it
   and re-shoot. A candidate that still has one never reaches the judges. If a
   problem is genuinely acceptable, write the reason in `.review/check.md`; an
   unexplained one is a bug you shipped.
2. **Check the picture against `.review/brief.md`, criterion by criterion**, and
   write the answers down. Looking at your own work and thinking "yes, good"
   is not a check; naming C1, C2, C3 and answering each one is.
   ```python
   Path(".review/check.md").write_text(
       "## 第 3 轮 · 候选 a\n"
       "- C1 三秒读出岗位与投递:过 —— 岗位名 56px,二维码下方一行 14px\n"
       "- C2 1200/680px 不塌:过 —— shot 无横向滚动,680px 重拍也无\n"
       "- C3 最大的字是岗位名:不过 —— 公司名仍是 64px,岗位 56px\n")
   ```
   A candidate that fails a criterion is not a candidate. Fix it or drop it —
   never let the judges decide whether a rule you agreed to still applies.
3. **Re-shoot at the second width if the brief names one** (`width=680`), because
   "it holds at 680" is a claim you can only make about a picture you looked at.

If the shot comes back `ok: false` — no renderer on this machine, or Electron
missing — say so in one line, fall back to reading the candidates' source, and
write `渲染不可用` in `.review/scores.md` for that round. Never let a failed shot
turn into a silent skip: the round is weaker and the user is entitled to know.

## 5 Judged blind, on the pictures

Ask them to choose, not to score — an absolute 1-10 comes back flat and names
nothing to fix. Shuffle, so no judge can tell the incumbent from the challenger,
and blank any version number a page prints about itself in every copy.

```python
import random, shutil, re
from collections import Counter

R = Path(".review"); (R / "votes").mkdir(parents=True, exist_ok=True)
runners = [("old", "poster.html", "old.png")] if Path("poster.html").exists() else []
runners += [("a", ".review/next-a.html", "a.png"), ("b", ".review/next-b.html", "b.png")]
random.shuffle(runners)
for slot, (origin, src, png) in enumerate(runners, 1):
    shutil.copyfile(src, R / f"{slot}.html")
    shutil.copyfile(R / "shots" / png, R / f"{slot}.png")
(R / "key.json").write_text(json.dumps({str(i): o for i, (o, _, _) in enumerate(runners, 1)}))

brief = Path(".review/brief.md").read_text()
n = len(runners)
ask = (f"Judge {n} candidates. Open .review/1.png … .review/{n}.png with "
       "`await attach_image(path)` and LOOK at them; only if that fails, read the "
       "matching .review/<slot>.html instead. Open nothing else in the workspace.\n"
       f"What it has to achieve:\n{brief}\n"
       "Answer in exactly these lines, write them to .review/votes/<your-name>.txt, "
       "then send the same text to your parent:\n"
       f"WINNER=<1..{n}>\n"
       "GLANCE=yes|no   — is the winner's advantage visible in two seconds, no side-by-side?\n"
       "SAW=image|html  — which one you actually looked at\n"
       "WHY=<the one thing that decided it>")
for name, lens in {"job": "does it do the job the brief describes",
                   "craft": "reads well, holds together, nothing accidental",
                   "break": ("what fails first. Add a fifth line BREAKS=<the criterion id "
                             "your winner still fails, or none>. Name one only if the "
                             "picture shows it failing.")}.items():
    await rlm(f"{ask}\nYour lens: {lens}.", name=f"judge-{name}")
```

Then end the turn: `rlm()` returns at admission and the answers arrive in later
turns — the reply wakes you, the file carries the vote.

```python
votes = {p.stem: p.read_text() for p in (R / "votes").glob("*.txt")}
key = json.loads((R / "key.json").read_text())
def field(v, k): 
    m = re.search(rf"{k}=(\S+)", v); return m.group(1) if m else None
tally = Counter(key.get(field(v, "WINNER")) for v in votes.values() if field(v, "WINNER"))
glance = sum(field(v, "GLANCE") == "yes" for v in votes.values())
breaks = [b for v in votes.values() if (b := field(v, "BREAKS")) and b != "none"]
```

Two votes decide. With fewer, nudge the silent ones once — `await
rlm.list_subagents()` for handles, then `await agent_message.send(ask,
receiver_role="child", receiver_name=c.session_name)` — and end the turn again.
If that turn brings nothing, write "no quorum" in the log and move on. Never
poll, and never wait a third time.

A mutant wins only when it takes a majority of the votes in hand, a majority
answers `GLANCE=yes`, and `breaks` is empty. **A named `BREAKS` vetoes the round
whatever the count is** — a candidate that fails a criterion the user agreed to
does not get in on popularity. A judge that answered `SAW=html` is a weaker
vote; say so in the report rather than quietly counting it the same.

Then, and only then, the winner becomes the file and gets published:

```python
Path("poster.html").write_text(Path(".review/next-a.html").read_text())
await preview.publish("poster.html",
    label="第 2 版 · 版心 980→680px,标题 34→56px(盲评 2:1 选新版,一眼可见)")
```

A win with `GLANCE=no` is a real change nobody can see: keep it, and spend the
next round where the eye lands. A loss publishes nothing — the file still holds
the version that won last time. Never publish the old bytes again under a new
name; the client counts that as a round that changed nothing and prints
`无改动 ×N` on the card, which is exactly what it is.

Append one line per round to `.review/scores.md`: round, mutants with their
targets before→after, changed lines, each judge's WINNER/GLANCE/SAW, any BREAKS,
what the shot reported, kept or reverted.

## 6 When to change track, and when to stop

Iteration that never ends is as bad as iteration that never moves.

- **A loss** means those properties are settled. The next round picks different
  ones — `.review/scores.md` says which are already spent.
- **Two losses in a row** means the track is exhausted, not that you need a
  third variation of it. Go back to `.review/brief.md`, take the runner-up take
  from the align turn, and mutate toward it — a real change of direction, named
  as one in the label and in your opening line. If the brief's runner-up is not
  worth trying, stop and say so.
- **Stop** when every criterion in the brief passes and a round has just failed
  to beat the incumbent. That is what "it stopped getting better" looks like,
  and it is a result worth reporting, not a failure to hide.
- **Six rounds without a stop** means the brief is wrong, not the work. Say
  which criterion keeps failing and ask.

## 7 Every version has to read as a decision

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
  subagents, taking a shot — none of that is a decision, and the client does not
  show it.

## 8 Report what can be checked

Trust comes from the observable, not from confidence. Hand back:

- the brief, and each criterion with pass or fail as of the last round —
  `.review/check.md`;
- the vote table — judge, winner, glance, what they looked at, one-line reason —
  and `.review/scores.md`;
- what you changed between rounds, what you compared against, and what the shot
  reported;
- the files themselves, and how to re-run the check.

## 9 Keep what the work taught you

A round's lesson dies with the task unless you write it somewhere that outlives
the session. When something will still be true next time — a judge panel kept
naming the same weakness, a kind of mutation never once won, the brief needed a
criterion you did not think to ask for — persist it before the turn ends:

```python
await refine.run("盲评三轮都点了同一件事:标题和正文字号差不到 1.4 倍时,判官一律说'层级不清'。"
                 "以后第一轮就把标题/正文比例定到 1.6 以上再谈别的。")
```

One per deliverable is plenty. It shows up in the client's Self-evolution
column, where the user can read it, roll it back, or push it to every workspace.

## 10 One step beyond the ask

Add the one thing they did not ask for but will need — the empty state, the
print stylesheet, the failure path. Label it, keep it separable, one line on
why. One such addition per deliverable; the rest goes in a "could also" list.
