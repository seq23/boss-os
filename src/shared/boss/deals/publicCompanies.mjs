/**
 * A PUBLIC COMPANY IS NOT A LIVE DEAL (owner, 18 Nov 2026; brokerage brain, Settled decisions).
 *
 * Once a company is publicly listed, Boss OS makes no match on it, Monique and Camille never ask a
 * prospect or an LP about it, and it never appears in new deals, matches or "outside your email".
 * Open deals and matches on it are shown as closed "now public"; no business record is rewritten.
 *
 * ONE SOURCE OF TRUTH: this seed (public facts only) plus the Boss OS setting `public_companies`
 * (GET/POST /api/boss/capital/public), written three ways: her reply "X is public", the morning run
 * reading Camille's briefing headlines for an IPO, a first trade or a direct listing
 * (`publicFromHeadline`, with the date and the headline as evidence), and by hand. Every job that
 * matches, lists or features a company reads `isPublicCompany` against `publicList`. Pure.
 */

export const PUBLIC_SEED = Object.freeze([
  Object.freeze({ company: "Anthropic", since: "2026-11-18", evidence: "IPO priced (owner, 18 Nov 2026)", via: "owner" }),
  Object.freeze({ company: "SpaceX", since: "2026-11-18", evidence: "publicly listed (owner, 18 Nov 2026)", via: "owner" }),
]);

/** "Anthropic, PBC" → "anthropic"; "Space Exploration Technologies (SpaceX)" → "spaceexplorationtechnologies". */
export function companyNorm(name) {
  return String(name ?? "").toLowerCase()
    .replace(/\(([^)]*)\)/g, " ")
    .replace(/\b(?:inc|incorporated|corp|corporation|co|company|ltd|limited|llc|plc|pbc|holdings?|technologies|group)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

const GENERIC_NAME_WORDS = new Set("the a an its it their this that stock stocks share shares company companies startup startups firm firms lab labs offering ipo listing ai initial public artificial intelligence".split(" "));

/** A noun phrase made entirely of generic market words does not identify a company. */
export function isCompanyName(name) {
  return (String(name ?? "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .some((word) => !GENERIC_NAME_WORDS.has(word));
}

/** The seed and the stored rows, once each by name. `stored` is the setting's JSON (array) or null. */
export function publicList(stored = null) {
  let rows = [];
  try { rows = Array.isArray(stored) ? stored : JSON.parse(stored ?? "[]"); } catch { rows = []; }
  const out = new Map();
  for (const r of [...PUBLIC_SEED, ...(Array.isArray(rows) ? rows : [])]) {
    if (r?.via !== "owner" && r?.via !== "reply" && !isCompanyName(r?.company)) continue;
    const k = companyNorm(r?.company);
    if (k && !out.has(k)) out.set(k, { company: String(r.company).trim(), since: r.since ?? null, evidence: r.evidence ?? null, via: r.via ?? null });
  }
  return [...out.values()];
}

/** True when the company (or a "(also known as)" inside its name) is on the list. */
export function isPublicCompany(name, list = PUBLIC_SEED) {
  const raw = String(name ?? "").replace(/^[⭐\s]+/, "").replace(/\s*\(\+?\d+ (?:more|other)[^)]*\)\s*$/i, "");
  const keys = [companyNorm(raw), ...[...raw.matchAll(/\(([^)]+)\)/g)].map((m) => companyNorm(m[1]))].filter(Boolean);
  const listed = new Set((list ?? []).map((r) => companyNorm(typeof r === "string" ? r : r.company)).filter(Boolean));
  return keys.some((k) => listed.has(k));
}

/*
 * A HEADLINE THAT SAYS A COMPANY IS NOW PUBLIC. Priced its IPO, began trading, debuted or listed on an
 * exchange, a direct listing, "goes public". Returns the company as the headline names it, or null.
 * Deliberately narrow: "plans to IPO", "files for IPO", "considers listing" are not public yet.
 */
const PUBLIC_RES = [
  /^(.{2,60}?)\s+(?:prices?|priced)\s+(?:its\s+|an?\s+|upsized\s+)?(?:\$[\d.,]+\s*(?:[mb]n?|million|billion)\s+)?(?:ipo|initial public offering)\b/i,
  /^(.{2,60}?)['’]s\s+(?:ipo|initial public offering)\s+(?:prices?|priced|opens?|opened|soars?|jumps?|debuts?)\b/i,
  /^(.{2,60}?)\s+(?:begins?|began|starts?|started|opens?|opened)\s+trading\b/i,
  /^(.{2,60}?)\s+(?:debuts?|debuted|lists?|listed)\s+(?:on\s+(?:the\s+)?)?(?:nasdaq|nyse|new york stock exchange|lse|london stock exchange)\b/i,
  /^(.{2,60}?)\s+(?:completes?|completed|goes|went)\s+(?:its\s+)?(?:direct listing|public)\b/i,
  /^(.{2,60}?)\s+(?:shares?|stock)\s+(?:soar|jump|surge|rise|fall|slide)s?\s+in\s+(?:its\s+|their\s+)?(?:market\s+)?debut\b/i,
];
const NOT_YET = /\b(?:plans?|planning|files?|filed|filing|considers?|considering|weighs?|weighing|eyes|eyeing|prepares?|preparing|could|may|might|rumou?red|confidential(?:ly)?|delays?|postpones?)\b/i;
export function publicFromHeadline(text) {
  // A briefing line often starts with its section label ("Morning: Anthropic prices…"): the label is not the company.
  const t = String(text ?? "").replace(/[*_`]/g, "").replace(/^\W+/, "").replace(/^[A-Z][\w &/-]{1,24}:\s+/, "").trim();
  if (!t || NOT_YET.test(t.split(/[:—-]/)[0] ?? t)) return null;
  for (const re of PUBLIC_RES) {
    const m = re.exec(t);
    if (m) {
      const company = m[1].replace(/^(?:the\s+)?(?:ai\s+)?(?:startup|company|firm|lab)\s+/i, "").replace(/[,.;:]+$/, "").trim();
      if (isCompanyName(company) && company.split(/\s+/).length <= 5) return company;
    }
  }
  return null;
}

/** Her reply "X is public" / "X went public" / "X is listed now": the company, or null. Exact, whole line. */
export function publicFromReply(line) {
  const m = /^\s*(.{2,60}?)\s+(?:is|are|went|has gone|is now|are now)\s+(?:public|listed)(?:\s+now)?\s*[.!]?\s*$/i.exec(String(line ?? ""));
  if (!m || /^(?:it|this|that|he|she|they|which|who)$/i.test(m[1].trim())) return null;
  return m[1].trim();
}
