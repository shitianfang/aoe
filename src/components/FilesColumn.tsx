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
      <div className="sec">{t("Files")}</div>
      {props.files.length === 0 ? (
        <div className="colnote">
          {t("no file activity yet.")}
          <br />
          {t("files agents edit will appear here — who changed what, when.")}
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
                    {t("diff")}
                  </a>
                </div>
              </button>
            );
          })}
          <div className="colnote">
            {t("who changed what, when.")}
            <br />
            {t("open an html, md, png or pdf file to preview it.")}
          </div>
        </>
      )}
    </aside>
  );
}
