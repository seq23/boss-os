/**
 * EVERY KEYWORD RULE JUDGES THE WHOLE SENTENCE ITS WORDS SIT IN (owner ruling, 19 Nov 2026; the same judge as
 * West Peek OS's src/shared/text/wholeSentence.ts).
 *
 * The first read (a free model) decides what her reply meant. The keyword rules are the logged last resort when no
 * first read answered, and even then a phrase never acts on its own: "no rush, approved" is not a hold, "if the
 * numbers are wrong, hold it" is not a hold yet, "approved?" is a question.
 *
 * A SENTENCE runs from the previous . ! ? ; or line break to the next one. A phrase found in it does NOT stand when the
 * rest of that sentence NEGATES it (not, never, no longer, cannot, any n't), CONDITIONS it (if, unless, when, whenever,
 * once, in case), REPORTS it (said, says, told, tells, mentioned, according to, last time, or the phrase sits inside
 * quotes) or ASKS it (the sentence ends with "?"). The phrase's own words never count against it. PURE.
 */

export const ALL_SHAPES = Object.freeze(["NEGATES", "CONDITIONS", "REPORTS", "ASKS"]);

const BOUNDARY = /[.!?;]+["”’')\]]*(?=\s|$)|\r?\n/g;

/** The sentences of a text, in order, each with where it starts. */
export function sentencesOf(text) {
  const s = String(text ?? "");
  const out = [];
  const push = (from, to) => {
    const raw = s.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t) out.push({ text: t, start: from + lead });
  };
  let from = 0;
  for (const m of s.matchAll(BOUNDARY)) {
    const at = m.index ?? 0;
    push(from, m[0].includes("\n") ? at : at + m[0].length);
    from = at + m[0].length;
  }
  push(from, s.length);
  return out;
}

const NEGATES = /\b(?:not|never|no longer|cannot)\b|n['’]t\b/i;
const CONDITIONS = /\b(?:if|unless|when|whenever|once|in case)\b/i;
const REPORTS = /\b(?:said|says|told|tells|mentioned|according to|last time)\b/i;
const ASKS = /\?["”’')\]]*$/;

function insideQuotes(sentence, at) {
  const before = sentence.slice(0, at);
  if (((before.match(/"/g) ?? []).length) % 2 === 1) return true;
  return before.lastIndexOf("“") > before.lastIndexOf("”");
}

/** Why the phrase at [from, to) of this sentence does not stand, or null when it does (no span: the whole sentence). */
export function vetoOf(sentence, span = null, shapes = ALL_SHAPES) {
  const s = String(sentence ?? "").trim();
  const rest = span ? `${s.slice(0, span.from)} ${" ".repeat(Math.max(0, span.to - span.from))} ${s.slice(span.to)}` : s;
  if (shapes.includes("ASKS") && ASKS.test(s)) return "ASKS";
  if (shapes.includes("REPORTS") && (REPORTS.test(rest) || (span ? insideQuotes(s, span.from) : false))) return "REPORTS";
  if (shapes.includes("NEGATES") && NEGATES.test(rest)) return "NEGATES";
  if (shapes.includes("CONDITIONS") && CONDITIONS.test(rest)) return "CONDITIONS";
  return null;
}

/** The first match of `re` in this ONE sentence that stands, or null. */
export function standingIn(sentence, re, shapes = ALL_SHAPES) {
  const s = String(sentence ?? "").trim();
  const all = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of s.matchAll(all)) {
    const from = m.index ?? 0;
    if (!vetoOf(s, { from, to: from + m[0].length }, shapes)) return m;
  }
  return null;
}

/** True when `re` finds a phrase in `text` that stands in its sentence. */
export function stands(text, re, shapes = ALL_SHAPES) {
  return sentencesOf(text).some((x) => standingIn(x.text, re, shapes) !== null);
}
