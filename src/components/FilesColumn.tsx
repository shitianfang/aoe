import type { FileActivity } from "../types";

const PREVIEWABLE = /\.(html?|md|png)$/i;

export function FilesColumn(props: {
  files: FileActivity[];
  onOpenPreview: (file: FileActivity) => void;
}) {
  return (
    <aside className="col2">
      <div className="sec">Files</div>
      {props.files.length === 0 ? (
        <div className="colnote">
          no file activity yet.
          <br />
          files agents edit will appear here — who changed what, when.
        </div>
      ) : (
        <>
          {props.files.map((f) => {
            const previewable = PREVIEWABLE.test(f.name);
            const open = () => previewable && props.onOpenPreview(f);
            return (
              <button className="f" key={f.path} title={f.path} onClick={open}>
                <div className="fn">{f.name}</div>
                <div className="fm">
                  <span className="w">{f.who}</span>
                  <span>{f.at}</span>
                  <a
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onOpenPreview(f);
                    }}
                  >
                    diff
                  </a>
                </div>
              </button>
            );
          })}
          <div className="colnote">
            who changed what, when.
            <br />
            open an html, md or png file to preview it.
          </div>
        </>
      )}
    </aside>
  );
}
