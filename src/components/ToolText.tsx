/** A tool row's label, as the bridge composes it: `python · <first line of the
 *  code>` — or a bare tool name when the tool took no code. The name repeats on
 *  every row of a run and the code is the part that differs, so the name is
 *  dimmed to a prefix and the ink stays on the code. */
export function ToolText(props: { text: string }) {
  const cut = props.text.indexOf(" · ");
  if (cut < 0) return <>{props.text}</>;
  return (
    <>
      <span className="tn">{props.text.slice(0, cut)}</span>
      {props.text.slice(cut + 3)}
    </>
  );
}
