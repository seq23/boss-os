/**
 * TIME-2-READ GROUPS & INSTITUTIONS — Monique's duty (owner, 31 Oct 2026: "Monique should do inst
 * sales and i want to find like home school pods and institutions too").
 *
 * The rules, pure, shared by the Worker (src/worker/boss/outreach/groups.ts, the send path) and the
 * Mac job (scripts/ops/t2r-groups.mjs, research, NeverBounce and the codes). Pinned by
 * tests/t2rGroups.test.ts and tests/boss/t2rGroups.test.ts, which read the CLAUDE.md section.
 *
 *   · Tiers are DATA (`t2r_group_tiers`, migration 0324). Tier 3 — schools and districts — is off
 *     until the setting flips, because Phase 8 (teacher dashboard, rosters, privacy agreements,
 *     reading-gain proof) is not built. `TIER_KINDS` below only names what each tier means for the
 *     research prompt; whether a tier may be written to is read from the table, every time.
 *   · Public sources only; every prospect keeps the page its address was published on; role or
 *     published addresses only, never a guessed one.
 *   · Outbound words: no price, no call ask, no "no screens" / anti-AI, no medical claims, and no
 *     claim of other languages (the stories are English).
 *   · One follow-up, at most. NeverBounce "valid" before the first send. Never a bounced address.
 *   · A reply that asks the price, or wants to pay, goes to her with a suggested price; Monique
 *     never quotes one.
 */

/** The business key in the outreach catalog. One sender, one route: st@time-2-read.com. */
export const GROUPS_KEY = "time2read_groups";
/** New groups written to per weekday, at most (owner, 31 Oct 2026: "start ≤10"). */
export const NEW_GROUPS_PER_WEEKDAY = 10;
/** The sequence: a first email and ONE follow-up. Never a third. */
export const MAX_FOLLOW_UPS = 1;
/** The follow-up goes this many days after the first email. */
export const FOLLOW_UP_AFTER_DAYS = 5;
/** The group trial: the existing time-2-read access-code mechanism, 15 days (like HOMESCHOOL15). */
export const GROUP_TRIAL_DAYS = 15;

/** What each tier means, for the research prompt only. Whether it is ON is the table's word. */
export const TIER_KINDS = Object.freeze({
  1: Object.freeze(["homeschool pod", "homeschool co-op", "microschool"]),
  2: Object.freeze(["public library youth services", "after-school program", "literacy nonprofit", "tutoring center"]),
  3: Object.freeze(["school", "school district"]),
});

/** Every kind a prospect row may carry, and the tier it belongs to. */
export function tierOfKind(kind) {
  const k = String(kind ?? "").trim().toLowerCase();
  for (const [tier, kinds] of Object.entries(TIER_KINDS)) if (kinds.includes(k)) return Number(tier);
  return null;
}

// ─── Outbound words ─────────────────────────────────────────────────────────

const PRICE = /\$\s?\d|\b\d+(?:\.\d+)?\s?(?:dollars?|usd)\b|\bper\s+(?:month|year|student|family|child|seat)\b|\/\s?(?:mo|month|yr|year)\b|\bpric(?:e|es|ing)\b|\bcosts?\b|\bdiscount|\bpaid plan\b|\bsubscription fee/i;
const CALL_ASK = /\b(?:call|phone|zoom|meeting|hop on|calendar|book a time|schedule (?:a|some) time|quick chat)\b/i;
const FORBIDDEN_CLAIM = /\bno[- ]screens?\b|\bscreen[- ]free\b|\bwithout (?:a )?screens?\b|\banti[- ]?ai\b|\bai[- ]free\b|\bno ai\b|\bnot ai\b|\bcures?\b|\btreat(?:s|ment)?\b|\btherap|\bdiagnos|\bclinical(?:ly)?\b|\bmedical\b|\bdyslexi|\badhd\b|\bspanish\b|\bbilingual\b|\bmultilingual\b|\bany language\b|\bin \d+ languages\b/i;

/** Every reason these outbound words may not go, by name. `[]` = fit to send. Pure. */
export function outboundProblems(text) {
  const t = String(text ?? "");
  const p = [];
  const price = PRICE.exec(t);
  if (price) p.push(`names a price ("${price[0]}"): Monique never quotes`);
  const call = CALL_ASK.exec(t);
  if (call) p.push(`asks for a call ("${call[0]}"): never suggest a call`);
  const claim = FORBIDDEN_CLAIM.exec(t);
  if (claim) p.push(`makes a claim we never make ("${claim[0]}")`);
  return p;
}

// ─── Replies ────────────────────────────────────────────────────────────────

const WANTS_PRICE = /\bhow much\b|\bpric(?:e|es|ing)\b|\bcosts?\b|\bfees?\b|\brates?\b|\bquote\b|\binvoice\b|\bbudget\b|\bpurchase\b|\bbuy\b|\bpay(?:ing|ment)?\b|\bsubscri(?:be|ption)\b|\blicen[cs]e\b|\bper (?:student|family|child|seat)\b|\bafter the (?:trial|15 days)\b/i;

/** A reply that asks what it costs, or wants to pay. Goes to her with a suggested price. Pure. */
export function wantsPrice(words) {
  return WANTS_PRICE.test(String(words ?? ""));
}

/**
 * THE PRICE SHE IS SHOWN, NEVER SENT BY MONIQUE. A suggestion for her to accept, change or ignore,
 * from the list price (brain: $12.99/month, $99/year) and the size of the group when they said it.
 * Her institution ladder above $10K/month is still hers to set; this is the small-group rung only.
 */
export function suggestedPrice(groupSize = null) {
  const n = Number(groupSize);
  if (Number.isFinite(n) && n >= 25) return `Suggested: $6.99 per family a month (or $69 a year) for ${n} families, billed to the group — about half the list price for a group this size.`;
  if (Number.isFinite(n) && n >= 5) return `Suggested: $8.99 per family a month (or $79 a year) for ${n} families, billed to the group — about 30% under the list price.`;
  return "Suggested: $8.99 per family a month (or $79 a year) for groups of five or more families, billed to the group — about 30% under the $12.99 list price.";
}

/** "We have about 40 families" → 40. Null when they did not say. Pure. */
export function groupSizeIn(words) {
  const m = /\b(\d{1,4})\s+(?:families|kids|children|students|members|readers|learners|kiddos)\b/i.exec(String(words ?? ""));
  return m ? Number(m[1]) : null;
}

// ─── Prospects ──────────────────────────────────────────────────────────────

const ROLE_LOCAL = /^(?:info|hello|contact|office|admin|director|coordinator|board|leaders?|youth|teens?|kids|children|childrens|programs?|literacy|reading|learning|education|outreach|community|enroll(?:ment)?|admissions|membership|connect|inquiries|questions|team|staff|support|ask|reference|librarian|youthservices|youth\.services|homeschool|coop|co-op|pod)(?:[._-]?[a-z0-9]*)?$/i;

const FREE_MAIL = /^(?:gmail|googlemail|yahoo|outlook|hotmail|icloud|aol|proton|protonmail)\./;
const GROUP_WORD = /coop|co-op|homeschool|home-school|pod|school|academy|library|reading|readers|learn|literacy|club|group|kids|famil|tutor|program|ministry|collective|cooperative|network|association|society|circle|village|commons|enrichment/;
const STOP_WORDS = new Set(["the", "and", "for", "group", "home", "school", "kids", "learning", "center", "centre", "program", "inc"]);

/**
 * A published group mailbox, never a person's: a role local part (info@, youth@, coordinator@…) on
 * any domain; or, on a free-mail domain where most co-ops and pods live, a local part that names the
 * group (a group word, or a word of its own name: "maplegrovecoop@gmail.com"). Pure.
 */
export function isRoleEmail(email, orgName = "") {
  const [local = "", domain = ""] = String(email ?? "").toLowerCase().split("@");
  if (ROLE_LOCAL.test(local)) return true;
  if (!FREE_MAIL.test(domain)) return false;
  if (GROUP_WORD.test(local)) return true;
  const words = String(orgName ?? "").toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
  return words.some((w) => local.includes(w));
}

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const https = (u) => { try { return new URL(String(u)).protocol === "https:"; } catch { return false; } };

/**
 * A prospect the research may hand in: a real kind (so a tier), an organisation, a published role
 * address and the public https page it was published on. Anything else is refused. Pure.
 */
export function groupProspectProblems(row) {
  const p = [];
  if (!row || typeof row !== "object") return ["not a row"];
  if (!String(row.org_name ?? "").trim()) p.push("no organisation name");
  if (tierOfKind(row.kind) === null) p.push(`"${row.kind}" is not a kind of group we write to`);
  const email = String(row.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) p.push("no email address");
  else if (!isRoleEmail(email, row.org_name)) p.push(`${email} is not a published role or group address`);
  if (!https(row.source_url)) p.push("no public https page the address was published on");
  return p;
}

/**
 * THE GROUP'S OWN CODE, so each group's redemptions can be counted. Letters of its name, then 15
 * (the trial), then three unambiguous characters: "Maple Grove Homeschool Co-op" → MAPLEG15K7Q.
 * Stored the way access_codes demands (upper case, no whitespace, 4–30 characters). Pure.
 */
export function groupCodeFor(orgName, rand = Math.random) {
  const letters = String(orgName ?? "").toUpperCase().replace(/[^A-Z ]/g, "").split(/\s+/).filter(Boolean)
    .filter((w) => !["THE", "OF", "AND", "A", "AN", "FOR"].includes(w));
  let prefix = (letters[0] ?? "").slice(0, 5) + (letters[1] ?? "").slice(0, 1);
  if (prefix.length < 3) prefix = "GROUP";
  const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let tail = "";
  for (let i = 0; i < 3; i++) tail += ALPHA[Math.floor(rand() * ALPHA.length) % ALPHA.length];
  return `${prefix}${GROUP_TRIAL_DAYS}${tail}`;
}

// ─── What she reads ─────────────────────────────────────────────────────────

/** Monday's one line in Simone's email (owner, 31 Oct 2026). Pure. */
export function weeklyLine({ emailed = 0, replied = 0, codesInUse = null } = {}) {
  const codes = codesInUse === null || codesInUse === undefined ? "codes in use not tracked yet" : `${codesInUse} code${codesInUse === 1 ? "" : "s"} in use`;
  return `Time-2-Read groups: ${emailed} emailed, ${replied} replied, ${codes}`;
}
