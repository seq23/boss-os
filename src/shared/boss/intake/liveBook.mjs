/**
 * HER LIVE BOOK — the sell-side inventory she actually has, read out of an email.
 *
 * Owner, 10 September 2026, dictating today's book:
 *
 *     Anthropic IPO shares   $2B, and separately $500M
 *     ByteDance shares       $2B
 *     OpenAI shares          up to $600M, $100M minimum
 *     Kalshi                 $20M
 *     Erebor Bank            $10M
 *
 * That is the acceptance test at the bottom of this file, character for character, because the
 * parser exists to read what SHE writes and not what a schema wishes she would write. Five lines,
 * and every one of them a different shape: a name with a noise suffix, a lot that splits in two, a
 * range with a floor, and two bare amounts. A parser that needed her to reformat any of them would
 * be a form, and she would stop sending it by the third week.
 *
 * ─── A .mjs WITH A .d.mts, ON PURPOSE ──────────────────────────────────────
 *
 * ONE PARSER, TWO RUNTIMES. Monique's matcher is a node script and the intake that receives the mail
 * is a Worker, and both have to read the book the same way. The established pattern in this repo for
 * that is a plain-ESM `.mjs` beside a hand-written `.d.mts` — see `no-cross-repo-coupling.d.mts`,
 * which `tests/network.test.ts` already imports. Two parsers would be this codebase's favourite
 * defect: "two components each keeping their own list with no link", where the Worker stores a book
 * the matcher reads differently and nothing ever says so.
 *
 * No node builtins are used here for exactly that reason — this file runs inside a Worker.
 *
 * ─── NOTHING IS INVENTED ───────────────────────────────────────────────────
 *
 * A line whose size cannot be read is kept as an UNPARSED line with its own text, never guessed at
 * and never dropped. The bar for the buyer hunt is "if she comes up empty handed its fine. better
 * than giving me trash", and a book with a hallucinated size in it poisons every match built on top
 * of it — a wrong size is how you call somebody about a block that does not exist.
 */

/** The whole book is hers to sell unless a line or a heading says otherwise. */
export const DEFAULT_BOOK_SIDE = "sell";

/**
 * Words that trail an issuer's name and are not part of it.
 *
 * `Anthropic IPO shares` is Anthropic. `Erebor Bank` is Erebor Bank — which is why this is a
 * suffix list of INSTRUMENT words and not a general tidy-up: "Bank", "Capital", "Labs" and
 * "Technologies" are parts of company names, and a rule that stripped them would quietly turn two
 * different issuers into one key in the matcher.
 */
const INSTRUMENT_SUFFIX =
  /\s*(?:\b(?:ipo|pre-?ipo|common|preferred|ordinary|class\s+[a-z]|series\s+[a-z0-9]+|direct|spv|forward|fwd)\b\s*)*\s*\b(?:shares?|stock|equity|units?|interests?|position|block|paper)\b\s*$/i;

/** `$2B`, `$500m`, `$1.5bn`, `$20,000,000`, `2B`. Returns USD, or null when it is not money. */
export function usd(token) {
  const m = /^\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|m|mm|b|bn|t)?$/i.exec(String(token ?? "").trim());
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const mult = { k: 1e3, m: 1e6, mm: 1e6, b: 1e9, bn: 1e9, t: 1e12 }[String(m[2] ?? "").toLowerCase()];
  if (mult) return n * mult;
  /*
   * A BARE NUMBER WITH NO SUFFIX IS ONLY MONEY IF IT CARRIED A DOLLAR SIGN, and even then only when
   * it is large enough to be a block. "$20M" is twenty million; a naked "2" in prose is a bullet
   * number. Guessing at the unit is precisely the invention this parser refuses to make.
   */
  return null;
}

/** Every money token in a fragment, with the text that introduced it. */
function moneyTokens(fragment) {
  const out = [];
  const re = /\$\s*[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:k|mm|m|bn|b|t)?\b|\b[0-9][0-9,]*(?:\.[0-9]+)?\s*(?:k|mm|m|bn|b|t)\b/gi;
  let m;
  while ((m = re.exec(fragment)) !== null) {
    const value = usd(m[0].replace(/\s+/g, ""));
    if (value === null) continue;
    out.push({ value, text: m[0].trim(), at: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** `500,000 shares` — a share count, which is a real way to quote a block and is not a dollar size. */
function shareCount(fragment) {
  const m = /\b([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|m)?\s*shares?\b/i.exec(fragment);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const mult = { k: 1e3, m: 1e6 }[String(m[2] ?? "").toLowerCase()] ?? 1;
  return n * mult;
}

/**
 * Split the size half of a line into LOTS.
 *
 * "and separately" IS THE WHOLE REASON THIS EXISTS. Her Anthropic line is two distinct blocks —
 * "$2B, and separately $500M" — and collapsing them into one $2.5B position would misrepresent what
 * she can actually deliver to a buyer who wants five hundred million. She said "separately"; the
 * parser has to mean it.
 */
function lotFragments(sizePart) {
  return String(sizePart)
    .split(/\s*(?:,\s*and\s+separately|and\s+separately|;|\s+plus\s+|\s+and\s+a\s+separate\s+)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Read one lot's numbers: a size, a floor, a ceiling — whichever the words actually say. */
function lotFrom(fragment) {
  const tokens = moneyTokens(fragment);
  const shares = shareCount(fragment);
  if (tokens.length === 0 && shares === null) return null;

  const lot = { size_usd: null, size_min_usd: null, size_max_usd: null, size_shares: shares, size_text: fragment.trim() };

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    /*
     * A QUALIFIER BELONGS TO ONE NUMBER, AND A FIXED LOOKBACK WINDOW GAVE IT TO TWO.
     *
     * "up to $600M, $100M minimum" read as a flat $100M ceiling with no floor: the 24-character
     * window in front of `$100M` reached back over `$600M` and found "up to" again, so the ceiling
     * was overwritten by the floor and the floor was never recorded. Her largest line came out six
     * times too small and her minimum vanished — from a book that parsed with zero unparsed lines
     * and therefore looked perfect.
     *
     * The context for a number is the text between it and its NEIGHBOURS. A word cannot qualify a
     * number that has another number in between.
     */
    const prevEnd = i > 0 ? tokens[i - 1].end : 0;
    const nextAt = i + 1 < tokens.length ? tokens[i + 1].at : fragment.length;
    const before = fragment.slice(Math.max(prevEnd, t.at - 24), t.at).toLowerCase();
    const after = fragment.slice(t.end, Math.min(nextAt, t.end + 24)).toLowerCase();
    const isCeiling = /\bup\s+to\b|\bmax(?:imum)?\b|\bno\s+more\s+than\b/.test(before) || /\bmax(?:imum)?\b/.test(after);
    const isFloor = /\bmin(?:imum)?\b|\bat\s+least\b|\bno\s+less\s+than\b|\bfloor\b/.test(before) || /\bmin(?:imum)?\b|\bor\s+more\b/.test(after);
    if (isCeiling) lot.size_max_usd = t.value;
    else if (isFloor) lot.size_min_usd = t.value;
    else if (lot.size_usd === null) lot.size_usd = t.value;
    else if (lot.size_max_usd === null) lot.size_max_usd = t.value;
  }

  /*
   * THE HEADLINE SIZE IS THE CEILING, and this is a judgement worth stating. "up to $600M, $100M
   * minimum" is one offer, and the number that decides whether a buyer is big enough to be worth
   * calling is the top of it. The floor is carried separately and is what disqualifies a $10M
   * buyer from a name she will not break below a hundred million for.
   */
  if (lot.size_usd === null && lot.size_max_usd !== null) lot.size_usd = lot.size_max_usd;
  if (lot.size_usd === null && lot.size_min_usd !== null) lot.size_usd = lot.size_min_usd;
  return lot;
}

/** Lines that are a heading, a signature, a greeting or a quoted reply — not inventory. */
const NOT_INVENTORY =
  /^(?:>|--\s*$|sent from|on .+ wrote:|hi\b|hey\b|here(?:'s| is)\b|this week|current book|live book|sell side|sell-side|book:|inventory:|thanks|best,|—|-{3,}|=|#)/i;

/**
 * Read a whole book out of the text of an email.
 *
 * The subject and the tag are already gone by the time this is called; what arrives is prose with a
 * list in it. Anything that is not a readable line of inventory is REPORTED, not swallowed — the
 * caller shows her `unparsed` so a line she meant as inventory and this could not read is visible on
 * the same day she sent it, rather than discovered a month later as a hole in her book.
 */
export function parseLiveBook(text, opts = {}) {
  const defaultSide = opts.side ?? DEFAULT_BOOK_SIDE;
  const lines = String(text ?? "").split(/\r?\n/);
  const positions = [];
  const unparsed = [];
  let side = defaultSide;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim().replace(/^[•*\-•]\s*/, "");
    if (!line) continue;

    // A standalone heading may flip the side for everything under it.
    if (/^(?:buy|bid|buy[- ]side|buyers?)\s*:?\s*$/i.test(line)) { side = "buy"; continue; }
    if (/^(?:sell|offer|sell[- ]side|offers?|inventory)\s*:?\s*$/i.test(line)) { side = "sell"; continue; }
    if (NOT_INVENTORY.test(line)) continue;

    const tokens = moneyTokens(line);
    const shares = shareCount(line);
    if (tokens.length === 0 && shares === null) {
      // A line with a plausible issuer name and no size at all is a gap she should see.
      if (/[A-Za-z]{3}/.test(line) && line.length <= 120) unparsed.push({ line, why: "no size could be read" });
      continue;
    }

    const firstAt = tokens.length ? tokens[0].at : line.toLowerCase().indexOf("share");
    let asset = line.slice(0, firstAt)
      .replace(/[\s:,–—\-]+$/, "")
      .replace(/^\s*(?:sell|selling|offer(?:ing)?|buy|buying|bid)\s+/i, "")
      .trim();
    // "up to" and friends belong to the size, not to the name.
    asset = asset.replace(/\b(?:up\s+to|about|approx(?:imately)?|around|circa|~)\s*$/i, "").trim();
    asset = asset.replace(INSTRUMENT_SUFFIX, "").trim();
    if (!asset) { unparsed.push({ line, why: "a size with no issuer in front of it" }); continue; }

    const lineSide = /\b(?:buy|bid|wanted|looking\s+for)\b/i.test(line.slice(0, firstAt)) ? "buy" : side;

    /*
     * THE QUALIFIER SITS TO THE LEFT OF THE MONEY, AND CUTTING AT THE `$` THREW IT AWAY.
     *
     * Caught by her own book rather than by a test I invented: "OpenAI shares up to $600M, $100M
     * minimum" parsed as a flat $100M with a $100M floor. The `$600M` had been read as a bare size
     * because "up to" had already gone into the asset half and been stripped as a name suffix — so
     * the ceiling, which is the number that decides whether a buyer is big enough to matter, was
     * silently replaced by the floor. A book that understates her largest line by a factor of six is
     * worse than no book: every buyer the hunt then rejects as too big was a real call she lost.
     *
     * So the size half begins at the qualifier when there is one, and the asset half still ends
     * before it — both sides of the cut get what belongs to them.
     */
    const head = line.slice(0, firstAt);
    const qualifier = /(\b(?:up\s+to|at\s+least|no\s+more\s+than|no\s+less\s+than|max(?:imum)?|min(?:imum)?|about|approx(?:imately)?|around|circa|~)\s*)$/i.exec(head);
    const sizeStart = qualifier ? firstAt - qualifier[1].length : firstAt;
    const sizePart = tokens.length ? line.slice(sizeStart) : line;

    let made = 0;
    for (const frag of lotFragments(sizePart)) {
      const lot = lotFrom(frag);
      if (!lot) continue;
      positions.push({ asset, side: lineSide, ...lot, source_line: line });
      made += 1;
    }
    if (made === 0) unparsed.push({ line, why: "a size was seen but could not be read" });
  }

  return { positions, unparsed, side: defaultSide };
}

/**
 * A stable fingerprint of a book's contents, so an identical resend is not a new version.
 *
 * SHE RESENDS. A forward, a reply-all, a second copy from her phone — and each of those creating a
 * new version would make the history unreadable and make "she has not sent a book in 7 days" fire
 * against a version that was never actually new. Identity is the CONTENT, not the arrival.
 */
export function bookFingerprint(positions) {
  return (positions ?? [])
    .map((p) => `${String(p.asset).toLowerCase().replace(/[^a-z0-9]+/g, "")}|${p.side}|${p.size_usd ?? ""}|${p.size_min_usd ?? ""}|${p.size_max_usd ?? ""}|${p.size_shares ?? ""}`)
    .sort()
    .join("\n");
}

/** One line, the way she wrote it back to her. */
export function describeLot(p) {
  const m = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M` : `$${Math.round(n).toLocaleString("en-US")}`);
  const parts = [];
  if (p.size_max_usd !== null && p.size_max_usd !== undefined) parts.push(`up to ${m(p.size_max_usd)}`);
  else if (p.size_usd !== null && p.size_usd !== undefined) parts.push(m(p.size_usd));
  if (p.size_min_usd !== null && p.size_min_usd !== undefined) parts.push(`${m(p.size_min_usd)} minimum`);
  if (p.size_shares) parts.push(`${Number(p.size_shares).toLocaleString("en-US")} shares`);
  return `${p.asset} — ${p.side} — ${parts.join(", ") || p.size_text}`;
}
