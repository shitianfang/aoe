import { useEffect, useState } from "react";
import type { PreviewFile, PreviewVersion, TimelineItem } from "../types";
import { fetchPreviewText, previewFileUrl } from "../runtime/preview";
import { useT } from "../i18n";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
/** Room one card needs before another one is worth adding. */
const CARD_MIN = 140;
/** Cards never go past four, however wide the pane gets. */
const MAX_CARDS = 4;

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

  return (
    <div className="vbox">
      <div className="vh">
        <b>{vlabel ? (props.current && !props.head ? `${vlabel} · ${t("current")}` : vlabel) : t("live")}</b>
        <span>
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
  const file =
    (props.selectedPath ? props.files.find((f) => f.path === props.selectedPath) : undefined) ??
    props.files[0];

  if (!file) {
    return (
      <div className="view">
        <div className="prev" ref={measure}>
          <div className="colnote" style={{ padding: 0 }}>
            {t("nothing published yet — files an agent writes will preview here.")}
          </div>
        </div>
      </div>
    );
  }

  // How many cards this pane can carry: room for one each, four at most, and
  // one when the row is off. Then what the cards are — the file's own last
  // versions if it has several, otherwise one card per sibling file, which is
  // how four variants written for an alignment round line up.
  const fit = row ? Math.max(1, Math.min(MAX_CARDS, Math.floor((width || CARD_MIN) / CARD_MIN))) : 1;
  const versions = file.versions.slice(-fit);
  // The list arrives newest-first; a variant row reads left to right in the
  // order the agent produced them.
  const siblings =
    file.versions.length > 1 || props.files.length < 2 ? [] : props.files.slice(0, fit).reverse();
  const cards: Array<{ file: PreviewFile; version: PreviewVersion | null; head?: string }> =
    siblings.length > 1
      ? siblings.map((f) => ({
          file: f,
          version: f.versions[f.versions.length - 1] ?? null,
          head: f.label ?? f.name,
        }))
      : versions.map((v, i) => ({
          file,
          version: v,
          // The two newest get words instead of numbers: that is how the user
          // reads the row — what it is now, and what it was before.
          head:
            i === versions.length - 1
              ? t("current")
              : i === versions.length - 2 && versions.length > 1
                ? t("previous")
                : undefined,
        }));
  // The event list belongs to a run of versions, not to a variant row.
  const [from, to] =
    siblings.length > 1 || versions.length < 2
      ? [undefined, undefined]
      : [versions[0], versions[versions.length - 1]];

  // Timeline events that happened between the two shown snapshots (real
  // tool/lesson rows only; items without a real timestamp are left out).
  const between =
    from && to
      ? props.timeline.filter((x): x is Extract<TimelineItem, { kind: "tool" | "divider" | "lesson" }> => {
          const ts =
            (x.kind === "tool" || x.kind === "divider" || x.kind === "lesson") && x.ts !== undefined ? x.ts : null;
          if (ts === null) return false;
          if (x.kind === "divider" && !x.text.startsWith("lesson kept")) return false;
          return ts > Date.parse(from.at) && ts <= Date.parse(to.at);
        })
      : [];

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
              <button className={row ? "btn" : "btn off"} onClick={() => setRow((r) => !r)}>
                {t("side by side")}
              </button>
            </span>
          )}
        </div>
        <div className="vgrid" style={{ gridTemplateColumns: `repeat(${Math.max(cards.length, 1)}, minmax(0, 1fr))` }}>
          {cards.length === 0 ? (
            <VersionPane file={file} version={null} current />
          ) : (
            cards.map((c, i) => (
              <VersionPane
                key={c.head ? `${c.file.path}-${c.head}` : `${c.file.path}-${c.version?.label}`}
                file={c.file}
                version={c.version}
                current={i === cards.length - 1}
                head={c.head}
              />
            ))
          )}
        </div>
        {from && to && between.length > 0 && (
          <div className="between">
            <div className="bh">
              {t("between {from} → {to}", { from: from.label, to: to.label })}
            </div>
            {between.map((e) =>
              e.kind === "tool" ? (
                <div className={e.status === "error" ? "ev bad" : "ev"} key={e.id}>
                  <span className="ic" />
                  <strong>{e.name}</strong>
                  <span className="rt">{e.at}</span>
                </div>
              ) : (
                <div className="ev violet" key={e.id}>
                  <span className="ic" />
                  <strong>
                    {e.kind === "lesson"
                      ? t("lesson kept · {summary}", { summary: e.result.summary ?? e.result.id })
                      : e.kind === "divider"
                        ? e.text
                        : ""}
                  </strong>
                  <span className="rt" />
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
