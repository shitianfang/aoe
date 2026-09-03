import type { SampleAgent } from "../sampleCrew";
import { BotAvatar } from "./BotAvatar";
import { Markdown } from "../markdown";
import { useT } from "../i18n";

/** A sample helper's pane: the same shape a real one has — who, its task, the
 *  exchange — built from written copy rather than a session. It reuses
 *  HelperView's classes so it reads as the real thing, and says 示例 in the
 *  header so it is never mistaken for one. No composer and no stop/remove:
 *  there is nothing on the other end to send to. */
export function SampleHelper(props: { agent: SampleAgent }) {
  const t = useT();
  const a = props.agent;
  const word = a.state === "running" ? t("running") : a.state === "queued" ? t("queued") : t("finished");
  return (
    <div className="view">
      <div className="ahead">
        <div className="r1">
          <BotAvatar seed={a.name} />
          <span className="nm">{a.name}</span>
          <span className="rel">
            {t("helper")} ·{" "}
            {a.state === "running" ? <span className="run">{word}</span> : <>{word}</>}
            {a.at ? ` ${a.at}` : ""}
            {" · "}
            <b>{t("example")}</b>
          </span>
        </div>
        <div className="r3">{t("Task — “{label}”", { label: t(a.task) })}</div>
      </div>
      <div className="transcript hevents">
        {a.turns.map((row, i) =>
          row.kind === "tool" ? (
            <div className="ev" key={i}>
              <span className="ic" />
              <strong>{row.text}</strong>
              <span className={row.status === "done" ? "rt ok" : "rt"}>
                {t(row.status === "done" ? "done" : "running…")}
              </span>
            </div>
          ) : row.kind === "task" ? (
            <div className="msg user" key={i}>
              <span className="chip ghost">M</span>
              <span className="body">
                <span className="afrom">master</span>
                {t(row.text)}
              </span>
            </div>
          ) : (
            <div className="msg" key={i}>
              <BotAvatar seed={a.name} />
              <div className="body">
                <span className="afrom">{a.name}</span>
                <Markdown text={t(row.text)} />
                {row.at ? <span className="when">{row.at}</span> : null}
              </div>
            </div>
          ),
        )}
        <div className="div">{t("example · a real helper's own words appear here")}</div>
      </div>
    </div>
  );
}
