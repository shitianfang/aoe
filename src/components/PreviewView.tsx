import { useState } from "react";
import type { PreviewState } from "../types";

export function PreviewView(props: { preview: PreviewState | null }) {
  const [mode, setMode] = useState<"side" | "overlay">("side");
  const p = props.preview;

  if (!p) {
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

  const shown = mode === "overlay" ? p.versions.slice(-1) : p.versions.slice(-2);
  const [from, to] = p.versions.slice(-2).map((v) => v.label);
  return (
    <div className="view">
      <div className="prev">
        <div className="ph">
          <span className="fn">{p.fileName}</span>
          {p.live && <span className="live">● live</span>}
          <span className="mode">
            <button className={mode === "side" ? "btn" : "btn off"} onClick={() => setMode("side")}>
              side by side
            </button>
            <button className={mode === "overlay" ? "btn" : "btn off"} onClick={() => setMode("overlay")}>
              overlay
            </button>
          </span>
        </div>
        <div className={mode === "overlay" ? "vgrid overlay" : "vgrid"}>
          {shown.map((v, i) => (
            <div className="vbox" key={v.label}>
              <div className="vh">
                <b>{i === shown.length - 1 ? `${v.label} · current` : v.label}</b>
                <span>{v.at}</span>
              </div>
              <div className="vempty">snapshot pending</div>
            </div>
          ))}
        </div>
        {p.between.length > 0 && from && to && (
          <div className="between">
            <div className="bh">
              between {from} → {to}
            </div>
            {p.between.map((e) => (
              <div className={e.tone ? `ev ${e.tone}` : "ev"} key={e.id}>
                <span className="ic" />
                <strong>{e.text}</strong>
                <span className="rt">{e.rt}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
