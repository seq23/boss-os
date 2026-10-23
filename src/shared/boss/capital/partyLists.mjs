/**
 * HER TWO LISTS OF PEOPLE: WHO IS RAINMAKER, AND WHO IS NEVER SUGGESTED. One definition, read by the
 * Worker (the Deals page, her plain-words replies) and by the deal scripts on her Mac.
 *
 * Owner, 23 Oct 2026 (contract rules 6 and 15):
 *   - Rainmaker is her own firm. The same-firm list is rainmakersecurities.com PLUS named people on
 *     other domains. A match is NEVER suggested when both sides are Rainmaker; their rows still show,
 *     tagged "Rainmaker". Rainmaker x outside is a valid match.
 *   - The do-not-suggest list holds people she has ruled out. They never appear in catch-ups,
 *     matches, intros, drafts, prospects or the deal grid.
 *
 * THE ENTRIES LIVE IN D1 (`capital_party_lists`), NEVER IN THIS REPOSITORY. The repo is public: the
 * only value written here is her firm's own domain, which is already public. She edits both lists by
 * replying in plain words to any Monique email; `parseListEdits` reads those words.
 */

/** Her firm. Built in, because it is the one same-firm entry that can never be removed. */
export const FIRM_DOMAIN = "rainmakersecurities.com";

/** Owner, 23 Oct 2026: "rough 6 month cut off". One constant for every inbox lookback. */
export const LOOKBACK_DAYS = 183;
const DAY = 86_400_000;

/** True when a YYYY-MM-DD (or ISO) date is inside the inbox lookback. An unreadable date is outside. */
export function withinLookback(date, now = Date.now()) {
  const t = Date.parse(String(date ?? ""));
  return Number.isFinite(t) && now - t <= LOOKBACK_DAYS * DAY;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const DOMAIN_RE = /^(?:@)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i;

const lower = (s) => String(s ?? "").toLowerCase().trim();

/** Every string on a row that could name a party: principal, addresses, sender, display name. */
export function partyStrings(row) {
  return [row?.principal, row?.principal_email, row?.intermediated_by, row?.from, row?.from_name, row?.from_text, row?.parties]
    .map(lower).filter(Boolean);
}

/** Does one list entry name this row's party? Email exact-in-string, domain on an address, name on a word boundary. */
export function entryMatches(entry, strings) {
  const v = lower(entry?.value);
  if (!v) return false;
  if (entry.kind === "email") return strings.some((s) => s.includes(v));
  if (entry.kind === "domain") {
    const d = v.replace(/^@/, "");
    return strings.some((s) => s.includes(`@${d}`) || s === d);
  }
  const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i");
  return strings.some((s) => re.test(s));
}

/** Rainmaker: her firm's domain, or any person on her same-firm list. */
export function isSameFirm(row, lists) {
  const strings = partyStrings(row);
  if (strings.some((s) => s.includes(`@${FIRM_DOMAIN}`))) return true;
  return (lists?.same_firm ?? []).some((e) => entryMatches(e, strings));
}

/** On her do-not-suggest list: never shown, never matched, never drafted to. */
export function isDoNotSuggest(row, lists) {
  const strings = partyStrings(row);
  return (lists?.do_not_suggest ?? []).some((e) => entryMatches(e, strings));
}

/** A pair she is never shown: both sides Rainmaker (rule 6), or either side ruled out (rule 15). */
export function pairAllowed(a, b, lists, { aIsHers = false, bIsHers = false } = {}) {
  if (isDoNotSuggest(a, lists) || isDoNotSuggest(b, lists)) return false;
  const aFirm = aIsHers || isSameFirm(a, lists);
  const bFirm = bIsHers || isSameFirm(b, lists);
  return !(aFirm && bFirm);
}

/**
 * Who a phrase names, as one list entry. An address wins; then a bare domain; then the person's name
 * (the words before " at " — "Steven Murphy at slm Ventures" is Steven Murphy, not all of slm).
 */
export function targetOf(phrase) {
  const p = String(phrase ?? "").trim().replace(/^["'“”]+|["'“”.]+$/g, "").trim();
  if (!p) return null;
  const email = EMAIL_RE.exec(p)?.[0];
  if (email) return { kind: "email", value: email.toLowerCase(), label: p };
  const dom = DOMAIN_RE.exec(p);
  if (dom) return { kind: "domain", value: dom[1].toLowerCase(), label: p };
  const name = p.split(/\s+(?:at|from|of)\s+/i)[0].replace(/\s*\(.*\)\s*$/, "").trim();
  if (name.length < 2 || name.length > 80 || name.split(/\s+/).length > 5) return null;
  if (/^(?:i|we|he|she|they|it|this|that|everyone|everybody|nobody|you|me|us|him|her|them)$/i.test(name)) return null;
  return { kind: "name", value: name.toLowerCase(), label: p };
}

const RULES = [
  { list: "same_firm", action: "remove", re: /^(?:please\s+)?(?:take|remove|drop)\s+(.+?)\s+(?:off|from)\s+(?:the\s+|my\s+)?rainmaker(?:\s+list)?$/i },
  { list: "same_firm", action: "remove", re: /^(.+?)\s+(?:is not|isn't|is no longer|are not|aren't)\s+(?:at\s+)?rainmaker$/i },
  { list: "same_firm", action: "add", re: /^(?:please\s+)?add\s+(.+?)\s+to\s+(?:the\s+|my\s+)?rainmaker(?:\s+list)?$/i },
  { list: "same_firm", action: "add", re: /^(.+?)\s+(?:is|are)\s+(?:also\s+)?(?:at\s+|with\s+)?rainmaker$/i },
  { list: "do_not_suggest", action: "remove", re: /^(?:please\s+)?(?:start\s+suggesting|you\s+can\s+suggest)\s+(.+?)(?:\s+again)?$/i },
  { list: "do_not_suggest", action: "remove", re: /^(?:please\s+)?(?:take|remove)\s+(.+?)\s+(?:off|from)\s+(?:the\s+|my\s+)?do[\s-]?not[\s-]?suggest(?:\s+list)?$/i },
  { list: "do_not_suggest", action: "add", re: /^(?:please\s+)?(?:stop|never|don'?t|do not)\s+suggest(?:ing)?\s+(.+?)(?:\s+again|\s+anymore|\s+any more)?$/i },
];

/**
 * Her plain words, read as list edits. Line by line, above any quoted reply; a line that is not an
 * edit is left alone. Returns [{ list, action, kind, value, label }].
 */
export function parseListEdits(text) {
  const out = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    // Quoted history or a forwarded message starts here: only her own words above it are read.
    if (/^>/.test(line) || /^on .+wrote:$/i.test(line) || /^-{2,}\s*forwarded message/i.test(line) || /^begin forwarded message/i.test(line)) break;
    for (const part of line.split(/[.;!]\s+|[.;!]$/)) {
      const s = part.trim().replace(/[.!;]+$/, "");
      if (!s || s.length > 200) continue;
      for (const r of RULES) {
        const m = r.re.exec(s);
        if (!m) continue;
        const t = targetOf(m[1]);
        if (t && !/^(?:rainmaker|the rainmaker list)$/i.test(t.value)) out.push({ list: r.list, action: r.action, ...t });
        break;
      }
    }
  }
  return out;
}

/** Monique's one-line confirmation of one edit. */
export function confirmEdit(e) {
  const who = e.label || e.value;
  if (e.list === "same_firm") {
    return e.action === "add"
      ? `Done: ${who} counts as Rainmaker now, so I will not suggest a match between them and anyone else at Rainmaker.`
      : `Done: ${who} is off the Rainmaker list.`;
  }
  return e.action === "add"
    ? `Done: I will not suggest ${who} again, for deals or catch-ups.`
    : `Done: ${who} can be suggested again.`;
}
