/**
 * ☰ More → Succession Book (owner ruling 19 Nov 2026). Scooter's emergency book, read from
 * GET /api/boss/succession (behind the passcode; built monthly on her Mac by succession-book.mjs).
 * It renders the stored markdown and nothing else: headings, lists, tables, bold, code and links.
 */
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { Loading } from "../components/Shell";
import { ErrorNotice } from "../components/Notice";

export function Succession() {
  const [book, setBook] = useState<{ markdown: string; built_at: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { api.succession().then(setBook).catch(setError); }, []);
  if (error) return <ErrorNotice error={error} />;
  if (!book) return <Loading />;
  return (
    <article className="succession">
      <p className="brain-saved">Rebuilt {new Date(book.built_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}. Private: never share this page or paste it anywhere but Claude on Sequoia's Mac.</p>
      {mdBlocks(book.markdown.replace(/<!--[\s\S]*?-->/g, ""))}
    </article>
  );
}

/** Inline markdown: **bold**, `code`, [text](https://…) and bare https links. */
export function mdInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)<]+[^\s)<.,;:])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] != null) out.push(<strong key={k++}>{mdInline(m[1])}</strong>);
    else if (m[2] != null) out.push(<code key={k++}>{m[2]}</code>);
    else if (m[3] != null) out.push(<a key={k++} href={m[4]} target="_blank" rel="noreferrer">{m[3]}</a>);
    else out.push(<a key={k++} href={m[5]} target="_blank" rel="noreferrer">{m[5]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const LIST = /^(\s*)([-*]|\d+[.)])\s+/;

export function mdBlocks(md: string): ReactNode[] {
  const lines = md.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i]!;
    const line = raw.trim();
    if (!line) { i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      const body = mdInline(h[2]!);
      out.push(level === 1 ? <h2 key={i} className="brain-title">{body}</h2>
        : level === 2 ? <h3 key={i} className="brain-section-h succession-h2">{body}</h3>
        : <h4 key={i} className="succession-h3">{body}</h4>);
      i++;
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        const cells = lines[i]!.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div className="brain-tablewrap" key={`t${i}`}>
          <table className="brain-table">
            {head && <thead><tr>{head.map((c, j) => <th key={j}>{mdInline(c)}</th>)}</tr></thead>}
            <tbody>{body.map((r, n) => <tr key={n}>{r.map((c, j) => <td key={j}>{mdInline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (LIST.test(raw)) {
      const items: { depth: number; numbered: boolean; text: string }[] = [];
      while (i < lines.length && LIST.test(lines[i]!)) {
        const m = LIST.exec(lines[i]!)!;
        items.push({ depth: Math.floor(m[1]!.length / 2), numbered: /\d/.test(m[2]!), text: lines[i]!.slice(m[0].length) });
        i++;
      }
      out.push(<Fragment key={`l${i}`}>{listTree(items, 0)}</Fragment>);
      continue;
    }
    out.push(<p className="brain-p" key={`p${i}`}>{mdInline(line)}</p>);
    i++;
  }
  return out;
}

function listTree(items: { depth: number; numbered: boolean; text: string }[], depth: number): ReactNode {
  const lis: ReactNode[] = [];
  let n = 0;
  while (n < items.length) {
    const it = items[n]!;
    let j = n + 1;
    while (j < items.length && items[j]!.depth > it.depth) j++;
    const kids = items.slice(n + 1, j);
    lis.push(<li key={n}>{mdInline(it.text)}{kids.length ? listTree(kids, depth + 1) : null}</li>);
    n = j;
  }
  return items[0]?.numbered ? <ol className="brain-ol">{lis}</ol> : <ul className="brain-ul">{lis}</ul>;
}
