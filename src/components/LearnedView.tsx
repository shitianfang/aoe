export function LearnedView() {
  return (
    <div className="learn">
      <div className="sec">History</div>
      <div className="colnote" style={{ padding: "0 0 18px" }}>
        no lessons yet. When master keeps a lesson it appears here — with its evidence, edits, and a
        one-step roll back.
      </div>
      <div className="sec">Entries</div>
      <div className="colnote" style={{ padding: 0 }}>
        base instructions are never edited — lessons are appended, and undone one lesson at a time.
      </div>
    </div>
  );
}
