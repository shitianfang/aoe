import { useEffect, useState } from "react";
import type { LearnedSel } from "../types";
import { fetchLearned, flatEntries, type LearnedData } from "./LearnedView";

/** Left column for Learned: the catalog of kept entries. Clicking a row pops
 *  the detail into a center pane (App owns that); clicking again deselects. */
export function LearnedColumn(props: {
  selected: LearnedSel | null;
  /** Bumped when a new lesson lands — re-pulls the catalog. */
  epoch: number;
  onSelect: (s: LearnedSel | null) => void;
}) {
  const [data, setData] = useState<LearnedData | null>(null);
  useEffect(() => {
    fetchLearned().then(setData);
  }, [props.epoch]);

  const entries = [
    ...flatEntries(data?.local ?? null, "this workspace"),
    ...flatEntries(data?.global ?? null, "everywhere"),
  ];

  return (
    <aside className="col2">
      <div className="sec">Learned</div>
      {entries.length === 0 && (
        <div className="colnote">
          nothing learned yet.
          <br />
          lessons master keeps appear here.
        </div>
      )}
      {entries.map((e) => {
        const on =
          props.selected !== null &&
          props.selected.scope === e.scope &&
          props.selected.kind === e.kind &&
          props.selected.id === e.id;
        return (
          <button
            key={`${e.scope}-${e.kind}-${e.id}`}
            className={on ? "lentry on" : "lentry"}
            onClick={() => props.onSelect(on ? null : { scope: e.scope, kind: e.kind, id: e.id })}
          >
            <span className="kd">{e.kind}</span>
            <span className="tt">{e.title ?? e.id}</span>
            {e.scope === "everywhere" && <span className="gd" title="kept everywhere" />}
          </button>
        );
      })}
    </aside>
  );
}
