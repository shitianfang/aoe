import { useEffect, useState } from "react";
import type { PreviewFile, PreviewVersion, TimelineItem } from "../types";
import { fetchPreviewText, previewFileUrl } from "../runtime/preview";
import { useT } from "../i18n";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The decision out of a message: its first two non-empty lines, stripped of
 *  markdown bullets and headings. A turn's reasoning opens with what it chose;
 *  the rest is elaboration the card row has no room for. */
function firstLines(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)]|#{1,6})\s*/, "").replace(/\*\*/g, "").trim())
    .filter((l) => l.length > 0);
  const out = lines.slice(0, 2).join(" — ");
  return out.length > 160 ? `${out.slice(0, 159)}…` : out;
}

function kindOf(name: string): "html" | "md" | "png" | "pdf" | null {
  if (/\.html?$/i.test(name)) return "html";
  if (/\.md$/i.test(name)) return "md";
  if (/\.png$/i.test(name)) return "png";
  if (/\.pdf$/i.test(name)) return "pdf";
  return null;
}

/** A page written for a desktop window, shown in a column a fraction of that
 *  width. Render it at a logical viewport it was plausibly laid out for and
 *  project the whole thing down, instead of handing it a 200px viewport (which
 *  triggers the mobile layout, or none) or cropping it.
 *  The viewport itself follows the room available: a wide column gets a desktop
 *  page, a narrow one a tablet, and the scale is whatever makes it fit. */
const BOX_H = 420;
/** Card height follows its width, so a thumbnail stays a page-shaped card
 *  instead of a tall box with dead air under a 28% projection. */
const boxHeight = (w: number) => (w > 0 ? Math.min(BOX_H, Math.max(180, Math.round(w * 1.35))) : BOX_H);
const pageWidthFor = (w: number) => (w >= 620 ? 1100 : w >= 380 ? 900 : w >= 240 ? 720 : 480);
/** Room one card needs; the grid fits as many as that allows and wraps the
 *  rest, so a file that keeps getting new versions keeps stacking them. */
const CARD_MIN = 140;

/** Width of an element as it changes: `ref` on the node, width in px (0 until
 *  it is mounted and measured). */
function useWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
}

/** One card in the row: md as plain text, html in a sandboxed iframe, png/pdf
 *  raw. `head` is what the card calls itself — a version word, or a file name
 *  when the row is comparing variants rather than versions. */
function VersionPane(props: {
  file: PreviewFile;
  version: PreviewVersion | null;
  current: boolean;
  head?: string;
  /** Click zooms this card to the full pane, and clicking it again returns. */
  onZoom?: () => void;
  zoomed?: boolean;
}) {
  const t = useT();
  const { file, version } = props;
  const kind = kindOf(file.name);
  const v = version?.label;
  const [text, setText] = useState<string | null>(null);
  // Projection for html: the box measures the column, the page gets a viewport
  // and a scale that fits inside it. 1:1 once the column is wide enough.
  const [measure, width] = useWidth();
  const pageW = pageWidthFor(width);
  const scale = width > 0 ? Math.min(1, width / pageW) : 1;
  const boxH = boxHeight(width);

  useEffect(() => {
    setText(null);
    if (kind !== "md" && kind !== "html") return;
    let stale = false;
    fetchPreviewText(file.path, v).then((t) => {
      if (!stale) setText(t);
    });
    return () => {
      stale = true;
    };
  }, [file.path, v, kind]);

  const body = () => {
    if (kind === "png") return <img className="vimg" src={previewFileUrl(file.path, v)} alt={file.name} />;
    if (kind === "pdf") return <embed className="vframe" src={previewFileUrl(file.path, v)} type="application/pdf" />;
    if (kind === null) return <div className="vempty">{t("no preview for this kind of file")}</div>;
    if (text === null) return <div className="vempty">{t("loading…")}</div>;
    if (kind === "html")
      return (
        <div className="vshell" ref={measure} style={{ height: boxH }}>
          <iframe
            className="vpage"
            sandbox=""
            srcDoc={text}
            title={`${file.name} ${v ?? "live"}`}
            style={{ width: pageW, height: Math.round(boxH / scale), transform: `scale(${scale})` }}
          />
        </div>
      );
    return <pre className="vdoc">{text}</pre>;
  };

  // Declared versions were explicitly published by the agent; say so.
  const vlabel =
    props.head ?? (version ? `${version.label}${version.declared ? ` · ${t("published")}` : ""}` : null);
  // The zoom is stated, not silent: a page at 34% is a projection, and the
  // user should know that before judging its type sizes.
  const zoom = kind === "html" && scale < 1 ? `${Math.round(scale * 100)}% · ` : "";
  // A version with no label of its own says how much moved; the rounds that
  // moved nothing are stated in the log under the cards, not on the card —
  // the card is the picture.
  const delta =
    !version?.note && version?.add !== undefined ? `+${version.add} −${version.del} · ` : "";

  return (
    <div
      className={props.zoomed ? "vbox big" : "vbox"}
      onClick={props.onZoom}
      role={props.onZoom ? "button" : undefined}
      tabIndex={props.onZoom ? 0 : undefined}
      onKeyDown={(e) => {
        if (props.onZoom && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          props.onZoom();
        }
      }}
    >
      <div className="vh">
        <b>{vlabel ? (props.current && !props.head ? `${vlabel} · ${t("current")}` : vlabel) : t("live")}</b>
        <span>
          {delta}
          {zoom}
          {version ? fmtTime(version.at) : t("unsaved this turn")}
        </span>
      </div>
      {body()}
    </div>
  );
}

export function PreviewView(props: {
  files: PreviewFile[];
  selectedPath: string | null;
  timeline: TimelineItem[];
  onSelect: (path: string) => void;
  /** Agent mid-write, for the status line; absent when nothing is running. */
  writer?: string;
}) {
  const t = useT();
  // The view measures itself: whether a side-by-side diff fits is a question
  // about this pane's width, not about how many versions exist.
  const [measure, width] = useWidth();
  const [row, setRow] = useState(true);
  /** Version label (or file path, for a variant row) shown alone at full
   *  width. Cleared when the file changes — a zoom belongs to what you were
   *  looking at. */
  const [zoomKey, setZoomKey] = useState<string | null>(null);
  const file =
    (props.selectedPath ? props.files.find((f) => f.path === props.selectedPath) : undefined) ??
    props.files[0];

  const filePath = file?.path ?? null;
  useEffect(() => {
    setZoomKey(null);
  }, [filePath]);

  if (!file) {
    return (
      <div className="view">
        <div className="prev" ref={measure}>
          <div className="colnote" style={{ padding: 0 }}>
            {t("nothing made yet — pages, documents and images an agent writes preview here.")}
          </div>
        </div>
      </div>
    );
  }

  // Every version stacks, newest first — a run that keeps publishing keeps
  // adding cards, and the grid wraps them. Variants (one version each, several
  // files) stack the same way: the newest take leads.
  const versions = file.versions;
  const siblings = file.versions.length > 1 || props.files.length < 2 ? [] : props.files;
  const all: Array<{ key: string; file: PreviewFile; version: PreviewVersion | null; head?: string }> =
    siblings.length > 1
      ? siblings.map((f) => ({
          key: f.path,
          file: f,
          version: f.versions[f.versions.length - 1] ?? null,
          head: f.label ?? f.name,
        }))
      : [...versions].reverse().map((v, ri) => {
          const i = versions.length - 1 - ri;
          return {
          key: v.label,
          file,
          version: v,
          // The two newest get words instead of numbers: that is how the user
          // reads the stack — what it is now, and what it was before.
          head:
            i === versions.length - 1
              ? t("current")
              : i === versions.length - 2 && versions.length > 1
                ? t("previous")
                : undefined,
          };
        });
  // One card alone: a zoomed one if it is still in the list, else the newest.
  const zoomed = zoomKey ? all.find((c) => c.key === zoomKey) : undefined;
  const cards = zoomed ? [zoomed] : row ? all : all.slice(0, 1);
  // One entry per round, newest first: what that version says it changed, and
  // what the conversation shows behind it — the agent's own decision, a
  // reviewer's verdict, a lesson kept. Tool calls are deliberately absent:
  // `python · import pathlib` is the mechanics of a step, never the judgement
  // in it, and this is the place the user comes to read the judgement.
  const evidence = (prev: PreviewVersion | undefined, v: PreviewVersion) =>
    props.timeline.filter(
      (x): x is Extract<TimelineItem, { kind: "master" | "agent" | "note" | "lesson" }> => {
        if (x.kind !== "master" && x.kind !== "agent" && x.kind !== "note" && x.kind !== "lesson")
          return false;
        if (x.ts === undefined) return false;
        if (x.kind === "note" && !/^(published|已发布)/.test(x.text)) return false;
        if ((x.kind === "master" || x.kind === "agent") && x.text.trim() === "") return false;
        return x.ts <= Date.parse(v.at) && (!prev || x.ts > Date.parse(prev.at));
      },
    );
  // Zoom scopes the log to the version being looked at; otherwise every round
  // is listed, in the same order as the cards above them.
  const rounds = (zoomed ? versions.filter((v) => v.label === zoomed.key) : versions)
    .map((v) => {
      const i = versions.findIndex((x) => x.label === v.label);
      return { v, prev: i > 0 ? versions[i - 1] : undefined, events: evidence(versions[i - 1], v) };
    })
    .reverse();

  return (
    <div className="view">
      <div className="prev" ref={measure}>
        {props.files.length > 1 && (
          <div className="pfiles">
            {props.files.map((f) => (
              <button
                key={f.path}
                className={f.path === file.path ? "btn" : "btn off"}
                title={f.path}
                onClick={() => props.onSelect(f.path)}
              >
                {f.label ?? f.name}
              </button>
            ))}
          </div>
        )}
        <div className="pstat">
          {props.writer ? (
            <>
              <span className="dot" /> {t("preview")} · {t("{who} is writing", { who: props.writer })}
            </>
          ) : (
            <>
              {t("preview")} ·{" "}
              {siblings.length > 1
                ? t("{n} takes to pick from", { n: String(siblings.length) })
                : t("{n} versions kept", { n: String(file.versions.length) })}
              {zoomed && ` · ${t("click to shrink")}`}
            </>
          )}
        </div>
        <div className="ph">
          <span className="fn" title={file.path}>
            {file.label ?? file.name}
          </span>
          {file.label && file.label !== file.name && <span className="sub">{file.name}</span>}
          {file.live && <span className="live">● {t("live")}</span>}
          {(file.versions.length > 1 || props.files.length > 1) && (
            <span className="mode">
              <button
                className={row && !zoomed ? "btn" : "btn off"}
                onClick={() => {
                  setZoomKey(null);
                  setRow((r) => (zoomed ? true : !r));
                }}
              >
                {t("side by side")}
              </button>
            </span>
          )}
        </div>
        <div
          className="vgrid"
          style={{
            gridTemplateColumns:
              cards.length === 1
                ? "minmax(0, 1fr)"
                : `repeat(auto-fill, minmax(${CARD_MIN}px, 1fr))`,
          }}
        >
          {cards.length === 0 ? (
            <VersionPane file={file} version={null} current />
          ) : (
            cards.map((c) => (
              <VersionPane
                key={`${c.file.path}-${c.key}`}
                file={c.file}
                version={c.version}
                current={c.key === all[0]?.key}
                head={c.head}
                zoomed={Boolean(zoomed)}
                onZoom={() => setZoomKey(zoomed ? null : c.key)}
              />
            ))
          )}
        </div>
        {siblings.length < 2 && rounds.length > 0 && (
          <div className="between">
            {rounds.map(({ v, prev, events }) => (
              <div className="round" key={v.label}>
                <div className="bh">
                  {prev
                    ? t("between {from} → {to}", { from: prev.label, to: v.label })
                    : t("{v} · first version", { v: v.label })}
                  <span className="rt">{fmtTime(v.at)}</span>
                </div>
                {v.note && (
                  <div className="ev">
                    <span className="ic" />
                    <strong>{v.note}</strong>
                    <span className="rt" />
                  </div>
                )}
                {!v.note && v.add !== undefined && (
                  <div className="ev">
                    <span className="ic" />
                    <strong>{t("{add} lines added, {del} removed", { add: String(v.add), del: String(v.del) })}</strong>
                    <span className="rt" />
                  </div>
                )}
                {v.same !== undefined && (
                  <div className="ev bad">
                    <span className="ic" />
                    <strong>
                      {t("{n} later round(s) rewrote the file to these same bytes", { n: String(v.same) })}
                      {v.saidAgain ? ` · ${t("republished unchanged as")} ${v.saidAgain}` : ""}
                    </strong>
                    <span className="rt" />
                  </div>
                )}
                {events.map((e) => (
                  <div className={e.kind === "lesson" ? "ev violet" : "ev"} key={e.id}>
                    <span className="ic" />
                    <strong>
                      {e.kind === "lesson"
                        ? t("lesson kept · {summary}", { summary: e.result.summary ?? e.result.id })
                        : e.kind === "note"
                          ? e.text
                          : e.kind === "agent"
                            ? `${e.from} · ${firstLines(e.text)}`
                            : firstLines(e.text)}
                    </strong>
                    <span className="rt">{e.kind === "note" ? (e.rt ?? "") : e.at}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
