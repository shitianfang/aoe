import { useEffect, useState } from "react";
import { bridgeUrl } from "../runtime/bridge";
import type { CatalogItem } from "../types";

/** Read-only left column for the runtime's catalogs (Skills, Extensions):
 *  what is loaded, nothing more — no install, enable or edit affordances. */
function CatalogColumn(props: { title: string; path: string; empty: string }) {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  useEffect(() => {
    let live = true;
    const land = (v: CatalogItem[]) => {
      if (live) setItems(v);
    };
    fetch(bridgeUrl(props.path))
      .then((r) => r.json())
      .then((d) => land(Array.isArray(d?.items) ? d.items : []))
      .catch(() => land([]));
    return () => {
      live = false;
    };
  }, [props.path]);

  return (
    <aside className="col2">
      <div className="sec">{props.title}</div>
      {items !== null && items.length === 0 && <div className="colnote">{props.empty}</div>}
      {(items ?? []).map((it, i) => (
        <div className="f ro" key={`${it.name}-${i}`} title={it.detail || it.name}>
          <div className="fn">{it.name}</div>
          {it.detail && <div className="fm">{it.detail}</div>}
        </div>
      ))}
    </aside>
  );
}

export function SkillsColumn() {
  return <CatalogColumn title="Skills" path="/bridge/skills" empty="no skills installed." />;
}

export function ExtensionsColumn() {
  return <CatalogColumn title="Extensions" path="/bridge/extensions" empty="nothing here yet." />;
}
