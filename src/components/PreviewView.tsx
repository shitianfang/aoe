import { useEffect, useState } from "react";
import type { PreviewFile, PreviewVersion, TimelineItem } from "../types";
import { fetchPreviewText, previewFileUrl } from "../runtime/preview";

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

/** One version pane: md as plain text, html in a sandboxed iframe, png/pdf raw. */
function VersionPane(props: { file: PreviewFile; version: PreviewVersion | null; current: boolean }) {
  const { file, version } = props;
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
    if (kind === "pdf") return <embed className="vframe" src={previewFileUrl(file.path, v)} type="application/pdf" />;
    if (text === null) return <div className="vempty">loading…</div>;
    if (kind === "html") return <iframe className="vframe" sandbox="" srcDoc={text} title={`${file.name} ${v ?? "live"}`} />;
    return <pre className="vdoc">{text}</pre>;
  };

  return (
    <div className="vbox">
      <div className="vh">
        <b>{version ? (props.current ? `${version.label} · current` : version.label) : "live"}</b>
        <span>{version ? fmtTime(version.at) : "unsaved this turn"}</span>
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
  const file =
    (props.selectedPath ? props.files.find((f) => f.path === props.selectedPath) : undefined) ??
    props.files[0];

  if (!file) {
    return (
      <div className="view">
        <div className="prev">
          <div className="colnote" style={{ padding: 0 }}>
            nothing published yet — files an agent writes will preview here.
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
      ? props.timeline.filter((x): x is Extract<TimelineItem, { kind: "tool" | "divider" }> => {
          const ts = (x.kind === "tool" || x.kind === "divider") && x.ts !== undefined ? x.ts : null;
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
                {f.name}
              </button>
            ))}
          </div>
        )}
        <div className="ph">
          <span className="fn">{file.name}</span>
          {file.live && <span className="live">● live</span>}
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
              between {from.label} → {to.label}
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
                  <strong>{e.text}</strong>
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
