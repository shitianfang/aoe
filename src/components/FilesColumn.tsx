import type { FileActivity } from "../types";
import { useT } from "../i18n";

const PREVIEWABLE = /\.(html?|md|png|pdf)$/i;

export function FilesColumn(props: {
  files: FileActivity[];
  onOpenPreview: (file: FileActivity) => void;
}) {
  const t = useT();
  return (
    <aside className="col2">
      <div className="sec">{t("Artifacts")}</div>
      {props.files.length === 0 ? (
        <div className="colnote">
          {t("nothing made yet.")}
          <br />
          {t("pages, documents and images an agent writes land here — who made it, when.")}
        </div>
      ) : (
        props.files.map((f) => {
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
                  {t("versions")}
                </a>
              </div>
            </button>
          );
        })
      )}
    </aside>
  );
}
