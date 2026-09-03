import { memo } from "react";
import type { ReactNode } from "react";

/** Markdown for agent replies — a small, dependency-free subset rendered
 *  straight to React. Agents write in Markdown by habit; before this the raw
 *  `**` and `- ` landed in the transcript as literal punctuation.
 *
 *  Covered: fenced code, ATX headings, bullet/numbered lists (nested), block
 *  quotes, pipe tables, rules, and inline code / bold / italic / strike /
 *  links. Anything else falls through as plain text — a partial or malformed
 *  document (mid-stream, half a fence typed) must still read as what the
 *  agent wrote, never as an error. */

/* ---------------------------------------------------------------- inline */

/** One pass over a line: code · bold · strike · italic · link · bare url.
 *  Order matters — `**` is tried before `*`. */
const INLINE = new RegExp(
  [
    // Every span is length-bounded: an unclosed marker must give up quickly
    // instead of rescanning the rest of a long line for each one it meets.
    "(`+)([^]{0,2000}?)\\1", // 1,2 code span
    "\\*\\*([^]{1,1000}?)\\*\\*", // 3 bold
    "__([^]{1,1000}?)__", // 4 bold
    "~~([^]{1,1000}?)~~", // 5 strike
    "\\*(?!\\s)([^]{1,1000}?)(?<!\\s)\\*", // 6 italic
    "(?<![A-Za-z0-9_])_(?!\\s)([^]{1,1000}?)(?<!\\s)_(?![A-Za-z0-9_])", // 7 italic
    // Bounded, and the target excludes parentheses: an unbalanced "[a](b" in
    // agent output must fail fast, not scan the rest of the line for every
    // bracket (that was seconds of frozen UI on a long line).
    "\\[([^\\]\\n]{0,200})\\]\\(\\s*<?([^\\s<>()]{0,500})>?(?:\\s+\"[^\"]{0,200}\")?\\s*\\)", // 8,9 link
    "(https?://[^\\s<>()\\[\\]]+[^\\s<>()\\[\\].,;:!?'\"])", // 10 bare url
  ].join("|"),
  "g",
);

const UNESC = /\\([\\`*_{}[\]()#+\-.!~>|])/g;
const plain = (s: string) => s.replace(UNESC, "$1");

/** Links open in the OS browser (main denies in-app windows). Only schemes
 *  main will actually open are linked; anything else stays literal text. */
const LINKABLE = /^(https?:|mailto:)/i;

function Link(props: { href: string; children: ReactNode }) {
  return (
    <a href={props.href} target="_blank" rel="noreferrer noopener">
      {props.children}
    </a>
  );
}

function inline(text: string, key: string): ReactNode[] {
  // Scan first, build second: the emphasis branches call back into inline()
  // for their contents, and a shared /g/ regex cannot be scanning two strings
  // at once (its lastIndex would be reset under the outer loop).
  const found: RegExpExecArray[] = [];
  INLINE.lastIndex = 0;
  for (let m = INLINE.exec(text); m !== null; m = INLINE.exec(text)) found.push(m);

  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of found) {
    // A backslash-escaped marker is text, not syntax.
    if (m.index > 0 && text[m.index - 1] === "\\") continue;
    if (m.index < last) continue; // consumed inside an earlier match
    if (m.index > last) out.push(plain(text.slice(last, m.index)));
    const k = `${key}.${n++}`;
    if (m[2] !== undefined) out.push(<code key={k}>{m[2].trim()}</code>);
    else if (m[3] ?? m[4]) out.push(<b key={k}>{inline((m[3] ?? m[4]) as string, k)}</b>);
    else if (m[5]) out.push(<s key={k}>{inline(m[5], k)}</s>);
    else if (m[6] ?? m[7]) out.push(<em key={k}>{inline((m[6] ?? m[7]) as string, k)}</em>);
    else if (m[9] !== undefined)
      // A scheme we cannot open would leave the reader with a label and no
      // address — show the markup as written instead.
      out.push(
        LINKABLE.test(m[9]) ? (
          <Link key={k} href={m[9]}>
            {m[8] ? inline(m[8], k) : m[9]}
          </Link>
        ) : (
          <span key={k}>{plain(m[0])}</span>
        ),
      );
    else if (m[10])
      out.push(
        <Link key={k} href={m[10]}>
          {m[10]}
        </Link>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(plain(text.slice(last)));
  return out;
}

/** Inline text with its own newlines kept as breaks — a chat message wraps
 *  where its author wrapped it, unlike a rendered document. */
function inlineLines(text: string, key: string): ReactNode[] {
  const rows = text.split("\n");
  const out: ReactNode[] = [];
  rows.forEach((row, i) => {
    if (i > 0) out.push(<br key={`${key}.br${i}`} />);
    out.push(...inline(row, `${key}.${i}`));
  });
  return out;
}

/* ---------------------------------------------------------------- blocks */

type Block =
  | { t: "p"; text: string }
  | { t: "h"; level: number; text: string }
  | { t: "code"; code: string }
  | { t: "quote"; blocks: Block[] }
  | { t: "list"; ordered: boolean; start: number; items: Block[][] }
  | { t: "hr" }
  | { t: "table"; head: string[]; rows: string[][] };

const FENCE = /^ {0,3}(`{3,}|~{3,})([^`]*)$/;
const HEAD = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const UL = /^(\s*)[-*+][ \t]+(.*)$/;
const OL = /^(\s*)(\d{1,9})[.)][ \t]+(.*)$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;

const indentOf = (s: string) => s.length - s.trimStart().length;
const dedent = (s: string, n: number) => {
  let i = 0;
  while (i < n && (s[i] === " " || s[i] === "\t")) i++;
  return s.slice(i);
};

const isTableDelim = (s: string) =>
  s.includes("-") && /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(s) && s.includes("|");
const cells = (s: string) =>
  s
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/** A line that opens a block of its own ends a lazy continuation. */
function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEAD.test(line) || HR.test(line) || UL.test(line) || OL.test(line);
}

function nextNonBlank(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) if (lines[i].trim() !== "") return i;
  return -1;
}

/** One list, from its first marker line to the first line that is not part of
 *  it. Item bodies are re-parsed as blocks, so nesting comes for free. */
function parseList(lines: string[], start: number, depth: number): { block: Block; next: number } {
  const head = OL.exec(lines[start]);
  const ordered = head !== null;
  const first = ordered ? head : (UL.exec(lines[start]) as RegExpExecArray);
  const base = first[1].length;
  const items: Block[][] = [];
  let cur: string[] | null = null;
  // Width of the open item's marker, so its continuation lines lose exactly
  // the indent the marker introduced and no more.
  let hang = base + 2;
  let i = start;
  const close = () => {
    if (cur) items.push(parseBlocks(cur, depth + 1));
    cur = null;
  };
  while (i < lines.length) {
    const line = lines[i];
    const u = UL.exec(line);
    const o = OL.exec(line);
    const mine = ordered ? o : u;
    const other = ordered ? u : o;
    if (mine && mine[1].length <= base) {
      close();
      const content = ordered ? mine[3] : mine[2];
      hang = line.length - content.length;
      cur = [content];
      i++;
      continue;
    }
    if (other && other[1].length <= base) break; // the list changed kind — a new one
    if (line.trim() === "") {
      const j = nextNonBlank(lines, i + 1);
      if (j === -1) break;
      const nu = UL.exec(lines[j]);
      const no = OL.exec(lines[j]);
      const nm = ordered ? no : nu;
      if ((nm && nm[1].length <= base) || indentOf(lines[j]) > base) {
        cur?.push("");
        i++;
        continue;
      }
      break;
    }
    if (cur === null) break;
    cur.push(dedent(line, hang));
    i++;
  }
  close();
  return { block: { t: "list", ordered, start: ordered ? Number(first[2]) : 1, items }, next: i };
}

/** `depth` bounds quote/list nesting: past a dozen levels the document is
 *  pathological rather than structured, and the rest reads as plain text. */
function parseBlocks(lines: string[], depth = 0): Block[] {
  if (depth > 12) return lines.some((l) => l.trim() !== "") ? [{ t: "p", text: lines.join("\n") }] : [];
  const out: Block[] = [];
  const para: string[] = [];
  const flush = () => {
    if (para.length === 0) return;
    out.push({ t: "p", text: para.join("\n") });
    para.length = 0;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      // An unclosed fence (still streaming) runs to the end — the text stays
      // visible as code rather than vanishing.
      flush();
      const close = new RegExp(`^ {0,3}${fence[1][0] === "`" ? "`" : "~"}{${fence[1].length},}\\s*$`);
      const buf: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) buf.push(lines[i++]);
      if (i < lines.length) i++;
      out.push({ t: "code", code: buf.join("\n") });
      continue;
    }
    if (line.trim() === "") {
      flush();
      i++;
      continue;
    }
    const h = HEAD.exec(line);
    if (h) {
      flush();
      out.push({ t: "h", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (HR.test(line)) {
      flush();
      out.push({ t: "hr" });
      i++;
      continue;
    }
    const q = QUOTE.exec(line);
    if (q) {
      flush();
      const buf: string[] = [];
      while (i < lines.length) {
        const qq = QUOTE.exec(lines[i]);
        if (qq) {
          buf.push(qq[1]);
          i++;
        } else if (lines[i].trim() !== "" && buf.length > 0 && !startsBlock(lines[i])) {
          buf.push(lines[i]); // lazy continuation — plain prose only
          i++;
        } else break;
      }
      out.push({ t: "quote", blocks: parseBlocks(buf, depth + 1) });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableDelim(lines[i + 1])) {
      flush();
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(cells(lines[i]));
        i++;
      }
      out.push({ t: "table", head, rows });
      continue;
    }
    if (UL.test(line) || OL.test(line)) {
      flush();
      const { block, next } = parseList(lines, i, depth);
      out.push(block);
      i = next;
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return out;
}

/* --------------------------------------------------------------- render */

function renderBlocks(blocks: Block[], key: string, trailing?: ReactNode): ReactNode[] {
  return blocks.map((b, i) => {
    const k = `${key}.${i}`;
    // The streaming cursor rides the last paragraph so it sits at the end of
    // the sentence, not on a line of its own.
    const tail = trailing !== undefined && i === blocks.length - 1 ? trailing : null;
    if (b.t === "p")
      return (
        <p key={k}>
          {inlineLines(b.text, k)}
          {tail}
        </p>
      );
    if (b.t === "h") {
      const H = (["h1", "h2", "h3", "h4", "h5", "h6"] as const)[Math.min(b.level, 6) - 1];
      return (
        <H key={k}>
          {inline(b.text, k)}
          {tail}
        </H>
      );
    }
    if (b.t === "code")
      return (
        <pre key={k}>
          <code>{b.code}</code>
          {tail}
        </pre>
      );
    if (b.t === "hr") return <hr key={k} />;
    if (b.t === "quote")
      return (
        <blockquote key={k}>
          {renderBlocks(b.blocks, k, tail ?? undefined)}
        </blockquote>
      );
    if (b.t === "list") {
      const inner = b.items.map((item, j) => (
        <li key={`${k}.${j}`}>
          {renderBlocks(item, `${k}.${j}`, j === b.items.length - 1 && tail ? tail : undefined)}
        </li>
      ));
      return b.ordered ? (
        <ol key={k} start={b.start}>
          {inner}
        </ol>
      ) : (
        <ul key={k}>{inner}</ul>
      );
    }
    // A row wider than the header keeps its extra cells (under a blank
    // heading) rather than losing them.
    const cols = b.rows.reduce((n, r) => Math.max(n, r.length), b.head.length);
    const span = Array.from({ length: cols }, (_, x) => x);
    return (
      <div className="mdtw" key={k}>
        <table>
          <thead>
            <tr>
              {span.map((x) => (
                <th key={x}>{inline(b.head[x] ?? "", `${k}.h${x}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((row, j) => (
              <tr key={j}>
                {span.map((x) => (
                  <td key={x}>{inline(row[x] ?? "", `${k}.${j}.${x}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {tail}
      </div>
    );
  });
}

/** Can the streaming cursor land inside this block, or would its branch drop
 *  it? A rule, or an empty quote/item, has nowhere to put it. */
function holdsTail(b: Block): boolean {
  if (b.t === "hr") return false;
  if (b.t === "quote") return b.blocks.length > 0 && holdsTail(b.blocks[b.blocks.length - 1]);
  if (b.t === "list") {
    const item = b.items[b.items.length - 1];
    return item !== undefined && item.length > 0 && holdsTail(item[item.length - 1]);
  }
  return true;
}

/** Render one agent message. `trailing` (the streaming cursor) lands inside
 *  the last block so it reads as part of the sentence — and beside it when
 *  that block cannot hold it, never nowhere. */
function MarkdownBody(props: { text: string; trailing?: ReactNode }) {
  const blocks = parseBlocks(props.text.replace(/\r\n?/g, "\n").split("\n"));
  if (blocks.length === 0) return <>{props.trailing}</>;
  const inside = props.trailing !== undefined && holdsTail(blocks[blocks.length - 1]);
  return (
    <div className="md">
      {renderBlocks(blocks, "b", inside ? props.trailing : undefined)}
      {inside ? null : props.trailing}
    </div>
  );
}

/** Memoized: a streaming turn re-renders the whole transcript on every tick,
 *  and settled messages must not re-parse with it. */
export const Markdown = memo(MarkdownBody);
