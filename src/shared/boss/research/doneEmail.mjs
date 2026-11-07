/**
 * THE "DONE" EMAIL FOR A RESEARCH PAGE, WHOEVER WROTE IT (repair, 6 Nov 2026).
 *
 * The deep research for Valerie (tsk_m6pq1seyd1qp8j45) was filed by the Claude seat after the free
 * rungs and she was never told: only the free rung wrote a Done notice, and the seat's follow-through
 * (`service/afterResult.ts`) writes one only for a task she sent by email. Now `fileResearchPage`,
 * the one place every rung and seat files a page, writes the notice, and this module is its words.
 *
 * Her standard (owner-email, make-it-calm): readable on a phone with no clicking around. The answer,
 * the 1-minute summary, the key numbers and the gaps are in the body; ONE link opens the full page.
 * A partial page says "partial" and names its gaps in one line.
 */
import { refCode, NOTHING_TO_DO } from "../mail/plain.mjs";
import { ownerEmail, ownerLine } from "../mail/ownerLayout.mjs";

const strip = (s) => String(s ?? "")
  .replace(/\[([^\]]+)\]\((?:https?:)?[^)]*\)/g, "$1")   // [text](url) → text
  .replace(/\s*\[\d+\]/g, "")                             // [1] citation marks
  .replace(/\*\*|__|`/g, "")
  .replace(/(^|\s)\*(\S[^*]*\S|\S)\*(?=\s|$|[.,;:])/g, "$1$2")
  .replace(/\s+/g, " ")
  .trim();

/** Sentences of a plain text block. A sentence ends at . ! ? before a capital; "Tenn. Code" does not. */
const sentencesOf = (text) => String(text ?? "").split(/(?<=[a-z0-9)%]{2}[.!?])\s+(?=[A-Z“"])/).map((x) => x.trim()).filter(Boolean);

/** The section bodies of a page, by heading. */
const sectionsOf = (markdown) => String(markdown ?? "").split(/\n(?=#{1,3}\s)/).map((sec) => {
  const m = /^#{1,3}\s+([^\n]*)\n?([\s\S]*)$/.exec(sec);
  return m ? { heading: m[1].trim(), body: m[2] } : { heading: "", body: sec };
});

const ANSWER_HEADING = /^(?:the\s+)?(?:answer|short answer|bottom line)\b/i;

/** The first two sentences under "## The answer" (or the page's first paragraph), plain. */
export function answerOf(markdown) {
  const secs = sectionsOf(markdown);
  const sec = secs.find((x) => ANSWER_HEADING.test(x.heading)) ?? secs.find((x) => x.body.trim()) ?? { body: "" };
  const para = sec.body.split(/\n\s*\n/).map((x) => x.trim()).find((x) => x && !/^[|>#-]/.test(x)) ?? "";
  return sentencesOf(strip(para)).slice(0, 2).join(" ");
}

/** The one answer block: the 1-minute summary, or the page's own answer when there is none. */
export function answerBlockOf(page) {
  return strip(page?.summary) || answerOf(page?.markdown);
}

export const MAX_KEY_NUMBERS = 4;
const MAX_KEY_LINE = 150;
const FIGURE = /\$\s?\d|\d\s?%/;
const UNKNOWN = /\b(?:not published|no \w+ publishes|isn[’']t published|not confirmed|could not confirm|not stated)\b/i;
const MONEY_WORD = /\b(?:fee|fees|price|cost|costs|pay|pays|paid|rate|income|wage)\b/i;
const EXAMPLE = /\b(?:for example|e\.g\.|example|such as|competitor|competitors|franchise)\b/i;
const NUMBERS_HEADING = /\b(?:numbers|costs?|money|income|pric|budget|fees?)\b/i;

/**
 * What the decision rests on, at most four whole lines (owner's coordinator review, 6 Nov 2026): the
 * money figures and the money unknown in the summary, the page's numbers or cost sections and its
 * cost tables, then its answer. Example and competitor prices are not key numbers. A line is a whole
 * sentence or clause, never cut; one too long to stand alone is left out, and a figure already given
 * is not given twice.
 */
export function keyNumbersOf(page, max = MAX_KEY_NUMBERS) {
  const secs = sectionsOf(page?.markdown);
  const pool = [];
  const fromProse = (text) => {
    for (const sent of sentencesOf(strip(text))) {
      pool.push(sent);
      // "Selling direct is different: … (a mobile firm charges $265–$305 for a legal test) …" → its lead and the figure.
      const lead = /^([^:()]{3,40}?)(?:\s+is different)?:\s/.exec(sent)?.[1];
      const paren = /\(([^()]*(?:\$\s?\d|\d\s?%)[^()]*)\)/.exec(sent)?.[1];
      if (lead && paren && sent.length > MAX_KEY_LINE) pool.push(`${lead}: ${paren}`);
      for (const clause of sent.split(/,\s(?:but|so|while|and)\s|;\s/).slice(sent.includes(", ") || sent.includes("; ") ? 0 : 1)) pool.push(clause);
    }
  };
  fromProse(page?.summary);
  for (const sec of secs.filter((x) => NUMBERS_HEADING.test(x.heading))) {
    for (const raw of sec.body.split("\n")) if (!raw.trim().startsWith("|")) fromProse(raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""));
  }
  // Cost tables anywhere: a row's first cell and its Cost / Fee / Price cell.
  for (const sec of secs) {
    const rows = sec.body.split("\n").filter((l) => l.trim().startsWith("|"));
    if (rows.length < 3) continue;
    const head = rows[0].split("|").map((c) => strip(c)).filter(Boolean);
    const col = head.findIndex((h) => /^(?:cost|fee|price)s?\b/i.test(h));
    if (col < 1) continue;
    for (const r of rows.slice(2)) {
      const cells = r.split("|").map((c) => strip(c)).filter(Boolean);
      if (cells[col] && FIGURE.test(cells[col])) pool.push(`${cells[0]}: ${cells[col]}`);
    }
  }
  for (const sec of secs.filter((x) => ANSWER_HEADING.test(x.heading))) fromProse(sec.body.split(/\n\s*\n/).find((x) => x.trim() && !/^[|>-]/.test(x.trim())) ?? "");

  const out = [];
  const seenFigures = new Set();
  let unknownGiven = false;
  for (const raw of pool) {
    if (out.length >= max) break;
    let line = raw.replace(/\s+/g, " ").trim().replace(/[,;:]$/, "");
    if (!line || line.length > MAX_KEY_LINE || EXAMPLE.test(line)) continue;
    const figures = line.match(/\$\s?[\d,.]+(?:\s?[–-]\s?\$?[\d,.]+)?|\d+\s?%/g) ?? [];
    const unknown = !figures.length && UNKNOWN.test(line) && MONEY_WORD.test(line);
    if (!figures.length && !unknown) continue;
    if (unknown && unknownGiven) continue;
    if (figures.length && figures.every((f) => seenFigures.has(f.replace(/\s/g, "")))) continue;
    figures.forEach((f) => seenFigures.add(f.replace(/\s/g, "")));
    if (unknown) unknownGiven = true;
    line = line.charAt(0).toUpperCase() + line.slice(1);
    out.push(/[.!?]$/.test(line) ? line : `${line}.`);
  }
  return out;
}

export const MAX_GAPS_NAMED = 3;
const MONEY_GAP = /\b(?:fee|fees|pay|pays|paid|price|cost|income|insurance|revenue|rate)\b/i;

/** The gaps as ONE line: the three that matter most (money first, in the page's order), then "and N more in the report". */
export function gapsLineOf(gaps, max = MAX_GAPS_NAMED) {
  const names = (Array.isArray(gaps) ? gaps : []).map((g) => strip(g))
    .map((g) => g.replace(/\s*\([^)]*\)/g, "").split(/:\s|\s[—–]\s|;\s|(?<=[a-z]{4})\.\s/)[0].replace(/[.:;]+$/, "").trim())
    .filter(Boolean);
  if (!names.length) return "";
  const ranked = [...names.filter((n) => MONEY_GAP.test(n)), ...names.filter((n) => !MONEY_GAP.test(n))];
  const COMMON = /^(?:The|A|An|How|Whether|What|Which|Who|When|Where|Full|Most|Fee|Fees|Tests?|Liability|Insurance|Swab|Month|Monthly|Price|Prices|Visits?|Any|Each|Every)\b/;
  const lower = (x) => (COMMON.test(x) ? x.charAt(0).toLowerCase() + x.slice(1) : x);
  const shown = ranked.slice(0, max).map((n, i) => (i ? lower(n) : n));
  const rest = names.length - shown.length;
  return `${shown.join("; ")}${rest > 0 ? `; and ${rest} more in the report` : ""}.`;
}

/** Everything the email says, from the filed page. */
export function researchDoneParts(page) {
  const gaps = Array.isArray(page?.gaps) ? page.gaps : [];
  const partial = String(page?.status ?? "") !== "complete" || gaps.length > 0;
  return {
    title: strip(page?.title) || "Your research",
    partial,
    answer: answerBlockOf(page),
    numbers: keyNumbersOf(page),
    gapCount: gaps.length,
    gapsLine: gapsLineOf(gaps),
    sourceCount: Array.isArray(page?.sources) ? page.sources.length : 0,
  };
}

export function researchDoneSubject(page) {
  const p = researchDoneParts(page);
  return `${p.partial ? "Done (partial)" : "Done"}: ${p.title.slice(0, 120)}`;
}

const happenedOf = (p) => p.partial
  ? `Your research is ready, partial: ${p.gapCount} thing${p.gapCount === 1 ? "" : "s"} I could not confirm.`
  : "Your research is ready.";

/**
 * The notice row's body: the same email as plain lines. Stored so the row reads on its own and the
 * sender has a fallback when the page cannot be read at send time.
 */
export function researchDoneLines(page, url) {
  const p = researchDoneParts(page);
  return [
    happenedOf(p),
    "",
    "The answer:", p.answer,
    ...(p.numbers.length ? ["", "Key numbers:", ...p.numbers.map((n) => `- ${n}`)] : []),
    ...(p.partial ? ["", `Partial. Not confirmed: ${p.gapsLine || "the page lists what is missing."}`] : []),
    "",
    `Open the full report: ${url}`,
    `${p.sourceCount} sources, each fact tied to one.`,
  ];
}

/** The laid-out email (`layoutEmail`): what her Mac's sender posts for a research Done notice. */
export function researchDoneLayout({ who, subject, page, url, refs = [] }) {
  const p = researchDoneParts(page);
  return ownerEmail({
    who, subject, refs, layout: "delivered", why: happenedOf(p),
    happened: happenedOf(p),
    sections: [
      { title: "The answer", tone: "done", items: [p.answer] },
      ...(p.numbers.length ? [{ title: "Key numbers", items: p.numbers }] : []),
      ...(p.partial ? [{ title: `Partial: ${p.gapCount} gap${p.gapCount === 1 ? "" : "s"}`, items: [p.gapsLine || "The page lists what is missing."] }] : []),
      { title: "The full report", items: [`${p.sourceCount} sources, each fact tied to one.`], link: { label: "Open the full report ›", url } },
    ],
    footer: "Reply to this email and your answer goes straight back to this job.",
  });
}

/** A research page id named in a notice body (`…/research/rpg_…`), or null. */
export function researchPageIdIn(text) {
  return /\/research\/(rpg_[A-Za-z0-9_-]{3,60})\b/.exec(String(text ?? ""))?.[1] ?? null;
}

/*
 * THE WHOLE REPORT, IN THE EMAIL (owner, 6 Nov 2026: "why did i get a partial email that wasnt
 * helpful it was noting like the artifact i received at first"). The Done email for a research page
 * carries the page itself: the 1-minute answer in a box, then every section with its headings,
 * tables and links, then what could not be confirmed, then one "Open in Boss OS ›" button. It is
 * built here, not by `layoutEmail`, because that layout is for short owner notes (a 9,000-character
 * cap, Decide cards, plain-line cleaning) and turned this report into a stub. No Decide section: a
 * finished report waits on nothing. Words keep their case. Inline styles only, so Gmail keeps them.
 */
export const FULL_EMAIL_MAX_HTML = 95_000; // under Gmail's 102 KB clip, with room for the headers

const STYLE = {
  h2: "font-size:19px;line-height:1.3;margin:26px 0 8px;font-weight:700;color:#1f1d1a",
  h3: "font-size:16px;line-height:1.35;margin:20px 0 6px;font-weight:700;color:#1f1d1a",
  h4: "font-size:15px;line-height:1.35;margin:16px 0 6px;font-weight:700;color:#1f1d1a",
  p: "margin:0 0 12px",
  ul: "margin:0 0 12px;padding-left:20px",
  ol: "margin:0 0 12px;padding-left:22px",
  li: "margin:0 0 6px",
  table: "border-collapse:collapse;width:100%;margin:8px 0 16px;font-size:13px",
  th: "border:1px solid #e4dfd4;padding:6px 8px;text-align:left;vertical-align:top;background:#f6f4ef;font-weight:700",
  td: "border:1px solid #e4dfd4;padding:6px 8px;text-align:left;vertical-align:top",
  a: "color:#1d4ed8",
};
const styled = (html) => html.replace(/<(h2|h3|h4|p|ul|ol|li|table|th|td|a)(\s|>)/g, (_, t, after) => `<${t} style="${STYLE[t]}"${after}`);
const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Markdown → the plain-text part: same words, links as "text (url)", no Markdown marks. */
export function researchPlainText(md) {
  return String(md ?? "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/^#{1,4}\s+(.*)$/gm, (_, h) => `\n${String(h).toUpperCase()}`)
    .replace(/^\s*\|?\s*:?-{3,}[-|:\s]*$/gm, "")
    .replace(/^\s*\|(.*)\|\s*$/gm, (_, row) => `- ${row.split("|").map((c) => c.trim()).filter(Boolean).join(" · ")}`)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split the report at its "## " headings, so a report too long for one email keeps whole sections. */
function reportSectionsOf(md) {
  const out = [];
  for (const line of String(md ?? "").split(/\r?\n/)) {
    if (/^##\s/.test(line) || out.length === 0) out.push([]);
    out[out.length - 1].push(line);
  }
  return out.map((l) => l.join("\n"));
}

/**
 * The research Done email with the full report: `{ subject, text, html, refs, kind }`, the shape
 * `employeeMail` sends as `prelaid`. Pure. `markdownToHtml` is the same renderer the Boss OS page uses.
 */
export function researchFullEmail({ who, subject, page, url, refs = [], markdownToHtml }) {
  const p = researchDoneParts(page);
  const name = String(who ?? "").trim() || "Camille";
  const gaps = Array.isArray(page?.gaps) ? page.gaps.map((g) => String(g)) : [];
  const sources = Array.isArray(page?.sources) ? page.sources : [];
  const partialLine = p.partial && gaps.length
    ? `${gaps.length} thing${gaps.length === 1 ? "" : "s"} couldn't be confirmed (listed at the end).`
    : null;
  // The owner layout (7 Nov 2026), "here's what you asked for" (D): line 1 says why and that she has nothing to do.
  const why = `The research you asked for is ready: ${p.title}`;
  const lead = ownerLine(why, NOTHING_TO_DO);
  const button = `<p style="margin:22px 0 8px"><a href="${escHtml(url)}" style="display:inline-block;background:#1f1d1a;color:#ffffff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:8px">Open in Boss OS ›</a></p>`;
  // The report usually ends with its own "What I could not confirm" section; never list the gaps twice.
  const ownGaps = /^#{1,4}\s+.*(could not|couldn.t) confirm/im.test(String(page?.markdown ?? ""));
  const gapHtml = gaps.length && !ownGaps ? `<h2 style="${STYLE.h2}">What couldn't be confirmed</h2><ul style="${STYLE.ul}">${gaps.map((g) => `<li style="${STYLE.li}">${escHtml(g)}</li>`).join("")}</ul>` : "";
  const srcHtml = sources.length ? `<h2 style="${STYLE.h2}">Sources (${sources.length})</h2><ol style="${STYLE.ol}">${sources.map((s) => `<li style="${STYLE.li}"><a href="${escHtml(s?.url)}" style="${STYLE.a}">${escHtml(s?.title || s?.url)}</a></li>`).join("")}</ol>` : "";
  const head = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f6f4ef"><div style="max-width:640px;margin:0 auto;padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f1d1a;background:#ffffff">`
    + `<p style="margin:0 0 12px;font-size:16px;font-weight:600">${escHtml(lead)}</p>`
    + `<h1 style="font-size:23px;line-height:1.25;margin:4px 0 6px">${escHtml(p.title)}</h1>`
    + `<p style="margin:0 0 14px;color:#6b665e;font-size:13px">Research by ${escHtml(name)}${partialLine ? ` · ${escHtml(partialLine)}` : ""}</p>`
    + (p.answer ? `<div style="background:#fbf6ea;border:1px solid #eadfc4;border-radius:8px;padding:12px 14px;margin:0 0 8px"><p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8a5a00">In one minute</p><p style="margin:0;font-weight:600">${escHtml(p.answer)}</p></div>` : "")
    + button;
  const foot = `${gapHtml}${srcHtml}${button}<p style="margin:16px 0 0;color:#6b665e;font-size:13px">Reply to this email and your answer goes straight back to this job.</p><p style="margin:12px 0 0">— ${escHtml(name)}</p></div></body></html>`;

  // Whole sections until the email would be clipped; the rest is named, never silently dropped.
  const parts = reportSectionsOf(page?.markdown);
  let body = "";
  let shown = 0;
  for (const s of parts) {
    const next = styled(markdownToHtml(s));
    if ((head + body + next + foot).length > FULL_EMAIL_MAX_HTML && shown > 0) break;
    body += next;
    shown += 1;
  }
  const cut = parts.length - shown;
  const cutHtml = cut ? `<p style="${STYLE.p};font-weight:600">${cut} more section${cut === 1 ? "" : "s"} in Boss OS ›</p>` : "";
  const html = head + body + cutHtml + foot;

  const text = [
    lead, "", p.title, `Research by ${name}${partialLine ? ` · ${partialLine}` : ""}`, "",
    ...(p.answer ? ["IN ONE MINUTE", p.answer, ""] : []),
    `Open in Boss OS: ${url}`, "",
    researchPlainText(parts.slice(0, shown).join("\n")),
    ...(cut ? ["", `${cut} more section${cut === 1 ? "" : "s"} in Boss OS: ${url}`] : []),
    ...(gaps.length && !ownGaps ? ["", "WHAT COULDN'T BE CONFIRMED", ...gaps.map((g) => `- ${g}`)] : []),
    ...(sources.length ? ["", `SOURCES (${sources.length})`, ...sources.map((s, i) => `${i + 1}. ${s?.title || s?.url} (${s?.url})`)] : []),
    "", "Reply to this email and your answer goes straight back to this job.", "", `— ${name}`,
  ].join("\n");
  const subj = String(subject ?? "").replace(/\s*\[?tsk_[a-z0-9]+\]?\s*$/i, "").trim() || researchDoneSubject(page);
  // The task travels in the X-Boss-Ref header (refs), never in the subject she reads.
  return { subject: subj.slice(0, 90), text, html, refs: refs ?? [], kind: "report", layout: "delivered", minimum: { why, act: NOTHING_TO_DO, ref: refs?.[0] ? refCode(refs[0]) : null, refShown: false, declared: true } };
}
