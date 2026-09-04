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
 *  width. Render it at a screen it was plausibly laid out for and project the
 *  whole thing down, instead of handing it a 200px viewport (which triggers
 *  the mobile layout, or none) or cropping it.
 *
 *  These are the standard screens pages are actually written against. Which
 *  one a card gets follows the room it has, and the card is then that screen's
 *  own shape — a picture of the page as it lands on a real display, not a
 *  crop of a page-shaped box. */
const SCREENS = [
  { w: 1280, h: 800 },
  { w: 1024, h: 768 },
  { w: 768, h: 1024 },
  { w: 390, h: 844 },
] as const;
type Screen = (typeof SCREENS)[number];
/** The largest screen this much room can still show at a fraction worth
 *  looking at. Biased upward on purpose: a version card is there to be
 *  compared with the one beside it, and both have to be the layout the page
 *  actually ships — a desktop page at 33% still reads as itself, while the
 *  same card handed a phone viewport is a different document. The phone tier
 *  is for thumbnails so small that nothing but the shape survives anyway. */
const screenFor = (room: number): Screen =>
  room >= 420 ? SCREENS[0] : room >= 300 ? SCREENS[1] : room >= 190 ? SCREENS[2] : SCREENS[3];

/** The ladder the ± buttons walk. 100% is the page's own pixels; the default
 *  sits off the ladder — it is whatever makes the whole screen fit. */
const STEPS = [0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];
const stepFrom = (cur: number, dir: 1 | -1): number =>
  dir > 0
    ? (STEPS.find((s) => s > cur + 0.005) ?? STEPS[STEPS.length - 1])
    : ([...STEPS].reverse().find((s) => s < cur - 0.005) ?? STEPS[0]);

/** Room one card needs; the grid fits as many as that allows and wraps the
 *  rest, so a file that keeps getting new versions keeps stacking them.
 *  auto-FIT, not auto-fill: three versions on a wide pane are three cards
 *  across it, not three 148px stamps in its left third with the empty tracks
 *  of a six-column grid beside them. */
const CARD_MIN = 140;
const GAP = 12; // .vgrid's gap — the column maths below has to agree with it
/** Tallest a card may be. Follows the window rather than a constant: the shell
 *  runs at zoom 1.5, so even a big monitor leaves only ~500 CSS px of pane,
 *  and the rounds log under the cards has to keep a foothold. */
const boxCap = (paneH: number) => (paneH > 0 ? Math.max(240, Math.min(620, paneH - 150)) : 420);

/** What every card in the row draws: one standard screen, how far it is
 *  scaled, and the box that shows it. Shared by the whole row, so versions
 *  stay comparable and the header can state the number being looked at. */
type Shot = {
  screen: Screen;
  /** Scale at which the whole screen fits the card — the default, and what
   *  the readout goes back to. */
  fit: number;
  scale: number;
  /** The screen as drawn, in card pixels. */
  drawnW: number;
  drawnH: number;
  /** The visible box. Equal to the drawing at the fit; smaller than it, and
   *  pannable, once a hand-set zoom outgrows the card. */
  shellW: number;
  boxH: number;
  panX: boolean;
  panY: boolean;
};

/** A scrollbar sits inside the box once the page pans, and it takes its width
 *  out of the page. Hand it its own, or a vertical pan squeezes the drawing
 *  and drags a pointless 6px horizontal bar into existence beside it. */
const SB = 7;

function shotFor(room: number, paneH: number, manual: number | null): Shot {
  const screen = screenFor(room);
  const cap = boxCap(paneH);
  // Both ways, so the default is the whole screen sitting in the card — a
  // preview that crops the fold by default is a preview you cannot trust.
  // Going past it is then a deliberate act, and that is when panning appears.
  const fit = room > 0 ? Math.min(1, room / screen.w, cap / screen.h) : 1;
  const scale = manual ?? fit;
  const drawnW = Math.round(screen.w * scale);
  const drawnH = Math.round(screen.h * scale);
  // Each bar takes its width out of the other axis, so which of them appears
  // is mutually recursive. One pass on the bare numbers settles it: a bar can
  // only ever be the thing that tips the *other* axis over.
  const bar = (over: boolean) => (over ? SB : 0);
  const roughX = drawnW > room;
  const roughY = drawnH > cap;
  const panX = room > 0 && drawnW > room - bar(roughY);
  const panY = drawnH > cap - bar(roughX);
  return {
    screen,
    fit,
    scale,
    drawnW,
    drawnH,
    shellW: room > 0 ? Math.min(room, drawnW + bar(panY)) : 0,
    boxH: Math.min(cap, drawnH + bar(panX)),
    panX,
    panY,
  };
}

/** Size of an element as it changes: `ref` on the node, width and height in px
 *  (0 until it is mounted and measured). */
function useBox(): [(el: HTMLDivElement | null) => void, { w: number; h: number }] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!el) return;
    const read = () =>
      setBox((b) =>
        b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight },
      );
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, box];
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
  /** The projection the whole row shares — measured once, off the grid, so
   *  every version is drawn on the same screen at the same scale. */
  shot: Shot;
}) {
  const t = useT();
  const { file, version, shot } = props;
  const kind = kindOf(file.name);
  const v = version?.label;
  const [text, setText] = useState<string | null>(null);

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
    if (kind === "pdf")
      return (
        <embed
          className="vframe"
          style={{ height: shot.boxH }}
          src={previewFileUrl(file.path, v)}
          type="application/pdf"
        />
      );
    if (kind === null) return <div className="vempty">{t("no preview for this kind of file")}</div>;
    if (text === null) return <div className="vempty">{t("loading…")}</div>;
    if (kind === "html") {
      // Zoomed past the fit, the screen no longer fits the card. The card does
      // not grow — it becomes a window you push the page around inside.
      return (
        <div
          className="vshell"
          style={{
            width: shot.shellW || "100%",
            height: shot.boxH,
            overflowX: shot.panX ? "auto" : "hidden",
            overflowY: shot.panY ? "auto" : "hidden",
          }}
        >
          {/* The page is out of flow (see the css), so nothing it contains can
              set a scroll extent. This one block is what there is to pan. */}
          <div className="vspan" style={{ width: shot.drawnW, height: shot.drawnH }} />
          <iframe
            className="vpage"
            sandbox=""
            /* The page's own scrollbar is not part of the picture — the card
               is the thing that scrolls, when there is anything to scroll. */
            scrolling="no"
            srcDoc={text}
            title={`${file.name} ${v ?? "live"}`}
            style={{ width: shot.screen.w, height: shot.screen.h, transform: `scale(${shot.scale})` }}
          />
        </div>
      );
    }
    return (
      <pre className="vdoc" style={{ maxHeight: shot.boxH }}>
        {text}
      </pre>
    );
  };

  // Declared versions were explicitly published by the agent; say so.
  const vlabel =
    props.head ?? (version ? `${version.label}${version.declared ? ` · ${t("published")}` : ""}` : null);
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
  // The view measures itself: how tall a card may be is a question about this
  // pane, and how wide one is a question about the grid, not about how many
  // versions exist.
  const [panel, pane] = useBox();
  const [grid, gridBox] = useBox();
  const [row, setRow] = useState(true);
  /** Version label (or file path, for a variant row) shown alone at full
   *  width. Cleared when the file changes — a zoom belongs to what you were
   *  looking at. */
  const [zoomKey, setZoomKey] = useState<string | null>(null);
  /** Hand-set zoom, or null to keep taking the one that fits. Every gesture
   *  that changes how much room a card has — opening one full width, closing
   *  it, switching file — hands the scale back to the fit, because the number
   *  the user picked was for the card they were looking at. */
  const [zoomPct, setZoomPct] = useState<number | null>(null);
  const file =
    (props.selectedPath ? props.files.find((f) => f.path === props.selectedPath) : undefined) ??
    props.files[0];

  const filePath = file?.path ?? null;
  useEffect(() => {
    setZoomKey(null);
    setZoomPct(null);
  }, [filePath]);

  if (!file) {
    return (
      <div className="view">
        <div className="prev" ref={panel}>
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
  // What the row draws. The card width is the grid's own arithmetic — the
  // columns auto-fit at CARD_MIN, so how many there are is knowable here, and
  // one measurement up here beats every card measuring itself and landing on a
  // different screen than the card beside it.
  const fits = Math.max(1, Math.floor((gridBox.w + GAP) / (CARD_MIN + GAP)));
  const cols = Math.min(Math.max(cards.length, 1), fits);
  const room =
    gridBox.w > 0 ? Math.max(0, Math.floor((gridBox.w - (cols - 1) * GAP) / cols) - 2) : 0;
  const shot = shotFor(room, pane.h, zoomPct);
  // Any page in the row: a variant row can hold an .html take beside an .md
  // one, and the zoom belongs to the row, not to whichever file is selected.
  const hasPage = (cards.length ? cards : [{ file }]).some((c) => kindOf(c.file.name) === "html");

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
      <div className="prev" ref={panel}>
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
          <span className="mode">
            {hasPage && (
              <>
                {/* Which screen the projection is of. The percentage below is
                    meaningless without it: 50% of a phone and 50% of a desktop
                    are not the same picture. */}
                {pane.w > 520 && (
                  <span
                    className="scr"
                    title={t("drawn on a standard {w}×{h} screen", {
                      w: shot.screen.w,
                      h: shot.screen.h,
                    })}
                  >
                    {shot.screen.w}×{shot.screen.h}
                  </span>
                )}
                <span className="zc">
                  <button
                    className="btn xs"
                    title={t("smaller")}
                    disabled={shot.scale <= STEPS[0] + 0.005}
                    onClick={() => setZoomPct((p) => stepFrom(p ?? shot.fit, -1))}
                  >
                    −
                  </button>
                  {/* The readout is also the way back: lit while a hand-set
                      zoom is standing in for the fit, quiet when it is the
                      fit. */}
                  <button
                    className={zoomPct === null ? "btn xs pct off" : "btn xs pct"}
                    title={t("back to the zoom that fits")}
                    onClick={() => setZoomPct(null)}
                  >
                    {Math.round(shot.scale * 100)}%
                  </button>
                  <button
                    className="btn xs"
                    title={t("bigger")}
                    disabled={shot.scale >= STEPS[STEPS.length - 1] - 0.005}
                    onClick={() => setZoomPct((p) => stepFrom(p ?? shot.fit, 1))}
                  >
                    +
                  </button>
                </span>
              </>
            )}
            {(file.versions.length > 1 || props.files.length > 1) && (
              <button
                className={row && !zoomed ? "btn" : "btn off"}
                onClick={() => {
                  setZoomKey(null);
                  setZoomPct(null);
                  setRow((r) => (zoomed ? true : !r));
                }}
              >
                {t("side by side")}
              </button>
            )}
          </span>
        </div>
        <div
          className="vgrid"
          ref={grid}
          style={{
            gridTemplateColumns:
              cards.length === 1
                ? "minmax(0, 1fr)"
                : `repeat(auto-fit, minmax(${CARD_MIN}px, 1fr))`,
          }}
        >
          {cards.length === 0 ? (
            <VersionPane file={file} version={null} current shot={shot} />
          ) : (
            cards.map((c) => (
              <VersionPane
                key={`${c.file.path}-${c.key}`}
                file={c.file}
                version={c.version}
                current={c.key === all[0]?.key}
                head={c.head}
                zoomed={Boolean(zoomed)}
                shot={shot}
                onZoom={() => {
                  setZoomKey(zoomed ? null : c.key);
                  setZoomPct(null);
                }}
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
