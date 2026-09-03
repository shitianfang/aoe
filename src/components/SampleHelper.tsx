import type { SampleAgent } from "../sampleCrew";
import { BotAvatar } from "./BotAvatar";
import { Markdown } from "../markdown";
import { useT } from "../i18n";
import { ToolText } from "./ToolText";

/** A sample helper's pane: the same shape a real one has — who, its task, the
 *  exchange — built from written copy rather than a session. It reuses
 *  HelperView's rows verbatim, down to the words on a tool row, so what a
 *  newcomer learns here still holds when the first real helper opens; the
 *  header says 示例 so it is never mistaken for one. No composer and no
 *  stop/remove: there is nothing on the other end to send to. */
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
        {/* A helper that has not started yet has no session to have said
            anything in — so, exactly as the live pane does for one that is not
            reachable, its task appears as master's message below rather than
            as a header line. Never both. */}
        {a.turns.length > 0 && (
          <div className="r3">{t("Task — “{label}”", { label: t(a.task) })}</div>
        )}
      </div>
      <div className="transcript hevents">
        {a.turns.length === 0 ? (
          <>
            <div className="msg user">
              <span className="chip ghost">M</span>
              <span className="body">
                <span className="afrom">master</span>
                {t(a.task)}
              </span>
            </div>
            <div className="div">{t("queued · not yet started")}</div>
          </>
        ) : (
          a.turns.map((row, i) =>
            row.kind === "tool" ? (
              // A step, not a speaker: it hangs off the message column under
              // the helper that ran it, the way the live transcript does.
              <div className={`ev step${row.status === "running" ? " run" : ""}`} key={i}>
                <span className="ic" />
                <strong>
                  <ToolText text={row.text} />
                </strong>
              </div>
            ) : (
              <div className="msg" key={i}>
                <BotAvatar seed={a.name} />
                <div className="body">
                  <Markdown text={t(row.text)} />
                </div>
                {row.at ? <span className="when">{row.at}</span> : null}
              </div>
            ),
          )
        )}
        {/* A queued helper's pane is already one dashed line saying nothing
            has started; a second one under it says the same thing twice. */}
        {a.turns.length > 0 && (
          <div className="div">{t("example · a real helper's own words appear here")}</div>
        )}
      </div>
    </div>
  );
}
