import { useEffect, useState } from "react";
import { bridgeUrl } from "../runtime/bridge";
import { NIM_MODELS, setActiveProvider, setNimModel, useProviders } from "../runtime/providers";
import type { CatalogItem } from "../types";
import { useT } from "../i18n";

/** The runtime's catalog for one path: what is loaded, nothing more —
 *  no install, enable or edit affordances. */
function useCatalog(path: string): CatalogItem[] | null {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  useEffect(() => {
    let live = true;
    const land = (v: CatalogItem[]) => {
      if (live) setItems(v);
    };
    fetch(bridgeUrl(path))
      .then((r) => r.json())
      .then((d) => land(Array.isArray(d?.items) ? d.items : []))
      .catch(() => land([]));
    return () => {
      live = false;
    };
  }, [path]);
  return items;
}

/** Read-only left column for the runtime's catalogs (Skills, Extensions). */
function CatalogRows(props: { items: CatalogItem[] | null; empty: string }) {
  const t = useT();
  const { items, empty } = props;
  return (
    <>
      {items !== null && items.length === 0 && <div className="colnote">{t(empty)}</div>}
      {(items ?? []).map((it, i) => (
        <div className="f ro" key={`${it.name}-${i}`} title={it.detail || it.name}>
          <div className="fn">{it.name}</div>
          {it.detail && <div className="fm">{it.detail}</div>}
        </div>
      ))}
    </>
  );
}

export function SkillsColumn() {
  const t = useT();
  const items = useCatalog("/bridge/skills");
  return (
    <aside className="col2">
      <div className="sec">{t("Skills")}</div>
      <CatalogRows items={items} empty="no skills installed." />
    </aside>
  );
}

/** Model extensions are a client-side choice — which backend answers master
 *  when the daemon is not there — and mutually exclusive by construction
 *  (one active id). The catalog below stays the daemon's read-only list. */
export function ExtensionsColumn() {
  const t = useT();
  const { active, nimModel } = useProviders();
  const items = useCatalog("/bridge/extensions");
  return (
    <aside className="col2">
      <div className="sec">{t("Model")}</div>
      <button
        type="button"
        className="f ro"
        onClick={() => setActiveProvider(active === "claude" ? null : "claude")}
      >
        <div className="fn">
          Claude Code
          <span className={active === "claude" ? "ext-state on" : "ext-state"}>
            {active === "claude" ? t("on") : t("off")}
          </span>
        </div>
        <div className="fm">{t("claude -p · your local login")}</div>
      </button>
      <button
        type="button"
        className="f ro"
        onClick={() => setActiveProvider(active === "nim" ? null : "nim")}
      >
        <div className="fn">
          NVIDIA NIM
          <span className={active === "nim" ? "ext-state on" : "ext-state"}>
            {active === "nim" ? t("on") : t("off")}
          </span>
        </div>
        <div className="fm">{t("cloud models · api key")}</div>
      </button>
      {active === "nim" && (
        <select
          className="extmodel"
          value={nimModel}
          onChange={(e) => setNimModel(e.target.value)}
          aria-label={t("NIM model")}
        >
          {NIM_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      )}
      <div className="sec sub">{t("Extensions")}</div>
      <CatalogRows items={items} empty="nothing here yet." />
    </aside>
  );
}
