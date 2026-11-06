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
import { layoutEmail } from "../mail/plain.mjs";

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
  return layoutEmail({
    who, subject, refs,
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
