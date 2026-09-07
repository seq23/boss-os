/**
 * MATCHING FIRM NAMES ACROSS TWO LISTS THAT WERE NEVER MEANT TO BE COMPARED.
 *
 * She is raising a fund from family offices, endowments, foundations and pensions, and brokering
 * late-stage secondaries to family offices, endowments, foundations and pensions. Same universe,
 * two lists, never crossed. One is a Google Sheet of LP outreach; the other is
 * `sourcing_candidates` in D1. Neither was written with the other in mind, so "StepStone" in one
 * and "StepStone Group (VC Secondaries Fund VI)" in the other are the same institution and no
 * string comparison in either system would say so.
 *
 * ─── The asymmetry that decides every design choice here ─────────────────────
 *
 * A MISSED MATCH costs her nothing she is not already paying: she works the firm cold, which is
 * what she does today.
 *
 * A FALSE MATCH costs her the opening of a call. She rings a stranger believing there is a warm
 * relationship, references an outreach that never happened to them, and the first thirty seconds
 * are unrecoverable — with a counterparty in a small market who talks to other counterparties.
 *
 * So this file prefers precision over recall everywhere the two conflict, and it reports what it is
 * unsure about as a SEPARATE CLASS rather than as a weaker match. Near-misses are for her eyes, not
 * for her mouth.
 *
 * ─── Why token sets and not substrings, demonstrated ─────────────────────────
 *
 * While building this, a naive substring search for the candidate "W Capital Partners" matched an
 * LP firm called "Lakeview Capital Management", because "w capital" is literally inside "Lakeview
 * Capital". That is the whole argument for tokenising: "w" is a token of one name and no token of
 * the other, and a token comparison rejects the pair instantly. The `guard` case in the test suite
 * is that exact pair.
 *
 * ─── The two vocabularies, and why stripping the second one is dangerous ─────
 *
 * LEGAL suffixes (Ltd, LLC, Inc, GmbH) carry no identity at all: "Acme Ltd" and "Acme" are the same
 * firm and always were. Stripping them is free.
 *
 * DESCRIPTIVE words (Capital, Partners, Ventures, Group, Management, Family Office) DO carry
 * identity, just weakly — "Industry Ventures" and "Industry Partners" would be two different firms.
 * Stripping them produces the "core", which is the strongest available signal AND the most
 * dangerous one, because it reduces "W Capital Partners" to "w". So the core is used to PROPOSE a
 * match and never to confirm one on its own: a confirmation additionally requires that the full
 * names agree as token sets, one contained in the other.
 */

/** Suffixes that are pure legal wrapper. Removing one never changes which firm is meant. */
const LEGAL = new Set([
  "ltd", "limited", "llc", "lc", "pllc", "lp", "llp", "lllp", "inc", "incorporated", "plc",
  "gmbh", "ag", "sa", "sas", "nv", "bv", "ab", "oy", "co", "corp", "corporation", "company", "pte", "pty",
]);

/**
 * Words that describe what a firm IS rather than which firm it is. Removed only to build the core.
 *
 * `office`, `investment`, `endowment` and `foundation` are here because her LP list is largely
 * university endowments and private foundations, where they appear in almost every name — "Bowdoin
 * College Endowment", "Bowdoin College Investment Office" and "Bowdoin College" are one institution
 * under three spellings, and the core is what makes that visible.
 */
const DESCRIPTIVE = new Set([
  "capital", "partners", "partner", "ventures", "venture", "group", "holdings", "holding",
  "management", "managers", "mgmt", "advisors", "advisers", "advisory", "investments", "investment",
  "investing", "investors", "asset", "assets", "family", "office", "offices", "fo", "trust",
  "foundation", "endowment", "endowments", "fund", "funds", "associates", "the", "and", "of",
  "secondaries", "secondary", "equity", "private", "global", "international", "company", "companies",
]);

/**
 * Cores so generic that an exact match on one proves nothing.
 *
 * Every entry earned its place from the real data: "industry" is the core of the candidate
 * "Industry Ventures", "vintage" of "Vintage Investment Partners", "committed" of "Committed
 * Advisors". Each is an ordinary English word that could plausibly be the core of an unrelated
 * institution, and a confident match on one of them is exactly the false positive that costs her a
 * phone call. They are still allowed to produce NEAR rows — she can look — but never `confirmed`.
 */
const GENERIC_CORES = new Set([
  "industry", "vintage", "committed", "national", "american", "united", "first", "new", "next",
  "north", "south", "east", "west", "central", "state", "city", "general", "strategic", "heritage",
  "legacy", "pioneer", "summit", "horizon", "liberty", "freedom", "premier", "select", "core",
]);

/** Lowercase, de-accent, drop parentheticals, expand "&", reduce punctuation to spaces. */
export function normalise(name) {
  return String(name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The full name with legal wrappers removed. Identity-preserving. */
export function tokens(name) {
  return normalise(name).split(" ").filter((w) => w && !LEGAL.has(w));
}

/** The distinctive core: the name with legal wrappers AND descriptive words removed. */
export function core(name) {
  return tokens(name).filter((w) => !DESCRIPTIVE.has(w));
}

/**
 * Is this core strong enough to be worth anything?
 *
 * A single short token ("w", "g", "ijp") is not. Two tokens are, because the chance of two firms
 * sharing both distinctive words and not being the same firm is small. A single token qualifies
 * only if it is long enough to be a proper name rather than a word — six characters is where
 * "hamilton", "stepstone" and "pinegrove" sit and "core", "next" and "west" do not.
 */
export function coreIsDistinctive(coreTokens) {
  if (coreTokens.length === 0) return false;
  if (coreTokens.some((t) => GENERIC_CORES.has(t))) return false;
  if (coreTokens.length >= 2) return coreTokens.every((t) => t.length >= 2);
  return coreTokens[0].length >= 6;
}

const setOf = (list) => new Set(list);
const subset = (a, b) => [...a].every((x) => b.has(x));

/** Levenshtein, capped at a small ceiling: it is only ever asked "is this one or two typos apart". */
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Compare one candidate name against one LP firm name.
 *
 * Returns `null` for no relationship at all, or `{ confidence, method, core }`.
 *
 *   confirmed / core_exact_subset — the distinctive cores are identical AND one full name's tokens
 *                                   are contained in the other's. "StepStone" ⊂ "StepStone Group".
 *                                   This is the only verdict she is invited to act on.
 *   near / core_exact             — the cores agree but the full names diverge on a descriptive word
 *                                   ("Industry Ventures" vs "Industry Partners"). Plausible, and
 *                                   plausible is not the same as true.
 *   near / core_typo              — the cores are one edit apart on a long token. Catches a
 *                                   misspelling in a hand-maintained sheet without inventing a firm.
 */
export function compareFirms(candidateName, lpFirmName) {
  const candTokens = tokens(candidateName);
  const lpTokens = tokens(lpFirmName);
  if (candTokens.length === 0 || lpTokens.length === 0) return null;

  const candCore = core(candidateName);
  const lpCore = core(lpFirmName);

  /*
   * A NAME WHOSE CORE IS EMPTY is entirely descriptive — "Capital Partners", "Family Office". There
   * is nothing distinctive left to match on, so the only honest answer is no verdict. Falling back
   * to the full tokens here would match every "… Family Office" to every other one.
   */
  if (candCore.length === 0 || lpCore.length === 0) return null;

  const candCoreKey = candCore.join(" ");
  const lpCoreKey = lpCore.join(" ");
  const distinctive = coreIsDistinctive(candCore) && coreIsDistinctive(lpCore);

  if (candCoreKey === lpCoreKey) {
    if (!distinctive) return null;
    const a = setOf(candTokens);
    const b = setOf(lpTokens);
    if (subset(a, b) || subset(b, a)) {
      return { confidence: "confirmed", method: "core_exact_subset", core: candCoreKey };
    }
    return { confidence: "near", method: "core_exact", core: candCoreKey };
  }

  /*
   * TYPO TOLERANCE, DELIBERATELY NARROW. Only when both cores are a single long token and they are
   * one edit apart. Two edits on an eight-letter word is a different word often enough to matter,
   * and this is a sheet maintained by hand rather than an OCR feed.
   */
  if (candCore.length === 1 && lpCore.length === 1 && distinctive) {
    const a = candCore[0];
    const b = lpCore[0];
    if (Math.min(a.length, b.length) >= 7 && editDistance(a, b) === 1) {
      return { confidence: "near", method: "core_typo", core: `${a}~${b}` };
    }
  }

  return null;
}

/**
 * Every relationship between a list of candidates and a list of LP firms.
 *
 * Returns confirmed and near SEPARATELY rather than one sorted list, because the caller must not be
 * able to treat them as one by accident. That is the same reason the endpoint returns two arrays
 * and the screen renders the near ones behind a disclosure that says what they are.
 */
export function crossMatch(candidates, lpFirms) {
  const confirmed = [];
  const near = [];
  for (const candidate of candidates) {
    for (const lp of lpFirms) {
      const verdict = compareFirms(candidate.name, lp.firm);
      if (!verdict) continue;
      const row = { candidate, lp, ...verdict };
      (verdict.confidence === "confirmed" ? confirmed : near).push(row);
    }
  }
  return { confirmed, near };
}
