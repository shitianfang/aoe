---
name: preview
description: Declare a finished work product (a file in the workspace or a served URL) from the Python REPL so attached clients can present it. Use after producing a reviewable artifact such as an HTML page, image, PDF, or report, or after starting a local server that serves one.
---

# Preview

`preview.publish` marks a source as a work product. The host records the
publication in the session transcript and notifies attached clients; it does
not copy, watch, or snapshot the source. Call it directly from the Python
REPL:

```python
await preview.publish("report/index.html", label="Quarterly report")
await preview.publish("http://localhost:5173", label="Dev server")
```

## API

- `await preview.publish(source, label=None)` — declare `source` as a work
  product. `source` is a file path (absolute or relative to the workspace) or
  an `http(s)://` URL. A file path must exist; publishing fails otherwise.
  `label` is an optional short human-readable title (at most 200 characters).
  Returns the recorded preview as a dict: `source`, `kind` (`"file"` or
  `"url"`), `path` (absolute path, files only), `label`, `timestamp`,
  `turnIndex`.

## Rules

- Publish only genuine deliverables the user should look at, not intermediate
  or scratch files. One publication per finished artifact is enough; publish
  again only after a meaningful revision.
- Publishing never blocks on a client: it succeeds even when nothing is
  attached to the session.
