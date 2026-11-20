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
      <p className="brain-saved">Rebuilt {new Date(book.built_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}. Private: never share this page or paste it anywhere but Claude on Sequoia's Mac.</p>
      <Contents markdown={book.markdown} />
      {mdBlocks(book.markdown.replace(/<!--[\s\S]*?-->/g, ""))}
    </article>
  );
}

/** An anchor id for a heading: "5. First day, …" → "s-5-first-day". */
export const headingId = (text: string) => `s-${text.toLowerCase().replace(/\*\*/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}`;

/** The sub-sections he needs fastest, linked under their section in the contents. */
const KEY_SUBSECTIONS = /^(How to get into each account|Social accounts matrix|App Store apps|First day|First week|First month|Every automatic email|If the Mac dies|Domains to keep|Bills that must stay paid|Scheduled jobs and how to pause them)/;

/**
 * The book is long on a phone: its sections, one tap away, with the key sub-sections on one short line
 * under their section, so every section fits above the tab bar (shared review, 20 Nov 2026).
 */
function Contents({ markdown }: { markdown: string }) {
  const sections: { text: string; subs: string[] }[] = [];
  for (const m of markdown.matchAll(/^(##|###)\s+(.+)$/gm)) {
    const text = m[2]!.trim();
    if (m[1] === "##") sections.push({ text, subs: [] });
    else if (KEY_SUBSECTIONS.test(text) && sections.length) sections[sections.length - 1]!.subs.push(text);
  }
  const short = (t: string) => t.replace(/\s*\(.*\)$/, "");
  return (
    <nav className="succession-toc" aria-label="Contents">
      <p className="succession-toc-h">Contents</p>
      <ul>
        {sections.map((it) => (
          <li key={it.text}>
            <a href={`#${headingId(it.text)}`}>{short(it.text)}</a>
            {it.subs.length > 0 && (
              <span className="succession-toc-subs">
                {it.subs.map((sub) => <a key={sub} href={`#${headingId(sub)}`}>{short(sub)}</a>)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A command he types: shown as code, with a Copy button (the Terminal lines in section 0). */
function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="succession-code">
      <pre><code>{code}</code></pre>
      <button type="button" className="succession-copy" onClick={() => { void navigator.clipboard?.writeText(code).then(() => setCopied(true)); }}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
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
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) code.push(lines[i++]!.trim());
      i++;
      out.push(<CodeBlock key={`c${i}`} code={code.join("\n")} />);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length;
      const body = mdInline(h[2]!);
      out.push(level === 1 ? <h2 key={i} className="brain-title">{body}</h2>
        : level === 2 ? <h3 key={i} id={headingId(h[2]!)} className="brain-section-h succession-h2">{body}</h3>
        : <h4 key={i} id={headingId(h[2]!)} className="succession-h3">{body}</h4>);
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
          <table className={`brain-table${(head?.length ?? 0) > 2 ? " phone-cards" : ""}`}>
            {head && <thead><tr>{head.map((c, j) => <th key={j}>{mdInline(c)}</th>)}</tr></thead>}
            <tbody>{body.map((r, n) => <tr key={n}>{r.map((c, j) => <td key={j} data-label={head?.[j]?.replace(/\*\*/g, "")}>{mdInline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (LIST.test(raw)) {
      const items: ListItem[] = [];
      while (i < lines.length && LIST.test(lines[i]!)) {
        const m = LIST.exec(lines[i]!)!;
        items.push({ depth: Math.floor(m[1]!.length / 2), numbered: /\d/.test(m[2]!), start: parseInt(m[2]!, 10) || 1, text: lines[i]!.slice(m[0].length) });
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

type ListItem = { depth: number; numbered: boolean; start: number; text: string };

/** A numbered list keeps its own numbers when a code block splits it (section 0: steps 5, then 6). */
function listTree(items: ListItem[], depth: number): ReactNode {
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
  return items[0]?.numbered ? <ol className="brain-ol" start={items[0].start}>{lis}</ol> : <ul className="brain-ul">{lis}</ul>;
}
