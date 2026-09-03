import { useCallback, useEffect, useRef, useState } from "react";
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
 *  width: render it at this logical viewport and project it down, instead of
 *  handing it a 300px viewport it was never laid out for. */
const PAGE_W = 1100;
const BOX_H = 420;
const MIN_SCALE = 0.3;

/** One version pane: md as plain text, html in a sandboxed iframe, png/pdf raw. */
function VersionPane(props: { file: PreviewFile; version: PreviewVersion | null; current: boolean }) {
  const t = useT();
  const { file, version } = props;
  const kind = kindOf(file.name);
  const v = version?.label;
  const [text, setText] = useState<string | null>(null);
  // Projection scale for html: the box measures itself, the page keeps its
  // desktop width. 1 when the column is already wide enough.
  const [scale, setScale] = useState(MIN_SCALE);
  const box = useRef<HTMLDivElement | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    box.current = el;
    if (el) setScale(Math.min(1, Math.max(MIN_SCALE, el.clientWidth / PAGE_W)));
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el || kind !== "html") return;
    const ro = new ResizeObserver(() => {
      setScale(Math.min(1, Math.max(MIN_SCALE, el.clientWidth / PAGE_W)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [kind, text]);

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
        <div className="vshell" ref={measure} style={{ height: BOX_H }}>
          <iframe
            className="vpage"
            sandbox=""
            srcDoc={text}
            title={`${file.name} ${v ?? "live"}`}
            style={{ width: PAGE_W, height: Math.round(BOX_H / scale), transform: `scale(${scale})` }}
          />
        </div>
      );
    return <pre className="vdoc">{text}</pre>;
  };

  // Declared versions were explicitly published by the agent; say so.
  const vlabel = version ? `${version.label}${version.declared ? ` · ${t("published")}` : ""}` : null;
  // The zoom is stated, not silent: a page at 34% is a projection, and the
  // user should know that before judging its type sizes.
  const zoom = kind === "html" && scale < 1 ? `${Math.round(scale * 100)}% · ` : "";
  return (
    <div className="vbox">
      <div className="vh">
        <b>{vlabel ? (props.current ? `${vlabel} · ${t("current")}` : vlabel) : t("live")}</b>
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
}) {
  const t = useT();
  const file =
    (props.selectedPath ? props.files.find((f) => f.path === props.selectedPath) : undefined) ??
    props.files[0];

  if (!file) {
    return (
      <div className="view">
        <div className="prev">
          <div className="colnote" style={{ padding: 0 }}>
            {t("nothing published yet — files an agent writes will preview here.")}
          </div>
        </div>
      </div>
    );
  }

  // Last two snapshots side by side; a file touched this turn but never
  // snapshotted yet gets a single live pane.
  const shown = file.versions.slice(-2);
  const [from, to] = shown.length === 2 ? shown : [undefined, undefined];

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
      <div className="prev">
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
        <div className="ph">
          <span className="fn" title={file.path}>
            {file.label ?? file.name}
          </span>
          {file.label && file.label !== file.name && <span className="sub">{file.name}</span>}
          {file.live && <span className="live">● {t("live")}</span>}
        </div>
        <div className={shown.length === 2 ? "vgrid" : "vgrid overlay"}>
          {shown.length === 0 ? (
            <VersionPane file={file} version={null} current />
          ) : (
            shown.map((v, i) => (
              <VersionPane key={v.label} file={file} version={v} current={i === shown.length - 1} />
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
