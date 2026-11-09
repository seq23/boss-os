/**
 * "HAVE AN AGENT RUN A DRIP CAMPAIGN TO THESE PEOPLE" — HER EMAIL, READ BY RULE (owner, 8 Nov 2026:
 * "if i emailed this to boss@ i need them to take this and do it end 2 end").
 *
 * Before this, her first partner-campaign request (a pasted list of named contacts, titles and best-use notes)
 * reached triage, which split it by keyword: the contact list went to Danielle ("matched repo", from
 * "docs in repo") and one best-use line to the systems desk ("matched integration, software").
 * Monique, who runs outreach, never saw it, and nothing could turn a pasted list into a sequence.
 *
 * This file is the pure half: is this a campaign ask, for which business, and who in the list may be
 * written to. No model is asked and nothing guesses: a request with no business we sell, or no
 * address, is not a campaign. The Worker half is src/worker/boss/outreach/campaign.ts.
 *
 * The rules, carried here, not remembered:
 *   · an address that appears only inside a note ("the fallback … is purchaseorders@…") is not a
 *     contact; a purchase-order, billing, support or no-reply inbox is never pitched;
 *   · every named person is written to, the top executive too (owner, 8 Nov 2026: "no one is held"),
 *     pitched on a wider alliance;
 *   · several people at one company are written to one at a time, STAGGER_DAYS apart, each in their
 *     own thread, never cc'd; any reply from anyone there stops every sequence at that company;
 *   · NeverBounce "valid" before any first send (the Mac checks; the Worker queues only "valid").
 * Plain ESM with a hand-written .d.mts, like its neighbours. Pinned by tests/boss/campaign.test.ts.
 */

/** Days between the first email to one person at a company and the first email to the next. */
export const STAGGER_DAYS = 7;

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Inboxes that are never a pitch address, whatever the list says. */
const NEVER_PITCH_LOCAL = /^(?:t?[a-z0-9]{0,6}?(?:purchase[-_.]?orders?|po|purchasing|procurement)|billing|invoices?|accounts?(?:[-_.]?payable)?|ap|ar|accounting|finance|payments?|orders?|support|help|helpdesk|customer[-_.]?(?:service|care|support)|service|noreply|no[-_.]?reply|donotreply|do[-_.]?not[-_.]?reply|privacy|legal|compliance|careers|jobs|hr|abuse|postmaster|webmaster|unsubscribe)$/i;

/** Why an inbox is never pitched, or null. Pure. */
export function neverPitchReason(email) {
  const local = String(email ?? "").toLowerCase().split("@")[0] ?? "";
  if (/purchase|^po$|procure|purchasing/.test(local)) return "a purchase-order inbox, not a pitch address";
  if (NEVER_PITCH_LOCAL.test(local)) return "a billing, support or no-reply inbox, not a pitch address";
  return null;
}

/** The top executive (pitched on a wider alliance). Vice presidents are not. Pure. */
export function isTopExec(title) {
  const t = String(title ?? "");
  if (/\b(?:vice|vp|svp|evp|avp)\b/i.test(t)) return false;
  return /\b(?:president|ceo|chief executive|founder|co-?founder|owner|chair(?:man|woman|person)?|managing director|general manager)\b/i.test(t);
}

/** "Time 2 Read", "time2read", "Time-2-Read" → "time2read". Pure. */
const squash = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * IS THIS A CAMPAIGN ASK? A campaign word, a selling word and at least one address. All three, or it
 * is ordinary mail. Pure.
 */
export function isCampaignAsk(text) {
  const t = String(text ?? "");
  if (!/\b(?:drip|campaign|email sequence|outreach sequence|cold emails?|sequence of emails)\b/i.test(t)) return false;
  if (!/\b(?:sell|selling|pitch|pitching|partnership|partner|offer|reach out|prospects?|outreach)\b/i.test(t)) return false;
  return (t.match(EMAIL_RE) ?? []).length > 0;
}

/**
 * WHICH BUSINESS. `businesses` is the outreach catalog's partner sequences, `{ key, brand, domain }`;
 * the brand or the domain must appear in her words (spaces and dashes ignored: "time 2 read").
 * Exactly one, or null. Pure.
 */
export function businessIn(text, businesses) {
  const t = squash(text);
  const hits = (businesses ?? []).filter((b) => t.includes(squash(b.brand)) || t.includes(squash(String(b.domain ?? "").replace(/\.[a-z]+$/i, ""))));
  return hits.length === 1 ? hits[0] : null;
}

/** The brand she named, against every brand outreach knows (to say "no partner sequence for X yet"). */
export function brandNamedIn(text, brands) {
  const t = squash(text);
  return (brands ?? []).find((b) => t.includes(squash(b))) ?? null;
}

/** "SVP, Revenue & Growth Marketing" → which pitch fits: brand/co-marketing or distribution/integration. */
const BRAND_WORDS = /\b(?:marketing|brand|brands|sponsor\w*|audience|co-?market\w*|growth|alliances?|awareness|campaigns?|content|community|partnership marketing)\b/gi;
const DISTRIBUTION_WORDS = /\b(?:business development|distribution|bundles?|integrat\w*|resell\w*|channel|tools?|district\w*|licens\w*|curriculum|platform|product|b2b|packages?)\b/gi;

/** "brand" or "distribution", from the note first and the title on a tie. Pure. */
export function angleFor({ title = "", note = "" } = {}) {
  const count = (re, s) => (String(s).match(re) ?? []).length;
  const b = count(BRAND_WORDS, note) * 2 + count(BRAND_WORDS, title);
  const d = count(DISTRIBUTION_WORDS, note) * 2 + count(DISTRIBUTION_WORDS, title);
  if (b === d) return /develop|product|distribut|partner/i.test(title) ? "distribution" : "brand";
  return b > d ? "brand" : "distribution";
}

const BULLET = /^[\s•·\-*–—>\t]+/;

/**
 * ONE CONTACT LINE: "Dana Example (SVP, Growth Marketing): dana.example@acme.example", or
 * "Name, Title — email", or "Name <email>". The address must be ON the line; the name is what comes
 * before the title. Null when the line is not a contact (a note that mentions an inbox). Pure.
 */
export function contactLine(line) {
  const raw = String(line ?? "").replace(BULLET, "").trim();
  const emails = raw.match(EMAIL_RE) ?? [];
  if (emails.length !== 1) return null;
  const email = emails[0].toLowerCase();
  const before = raw.slice(0, raw.toLowerCase().indexOf(email)).replace(/[<:\-–—,|\s]+$/, "").trim();
  if (/^(?:note|fallback|best use|cc|also)\b/i.test(before) || /\b(?:fallback|address for|inbox|is)\s*$/i.test(before)) return null;
  let name = before; let title = "";
  const paren = /^(.+?)\s*\(([^)]+)\)\s*$/.exec(before);
  if (paren) { name = paren[1]; title = paren[2]; }
  else {
    const parts = before.split(/\s*[,–—|]\s*|\s+-\s+/);
    if (parts.length >= 2) { name = parts[0]; title = parts.slice(1).join(", "); }
  }
  name = name.replace(/["“”]/g, "").trim();
  // A name is two to four capitalised words; anything else is a sentence that happens to hold an address.
  if (!/^[A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){1,3}$/u.test(name)) return null;
  return { name, first: name.split(/\s+/)[0], title: title.trim(), email };
}

/** The company's name as she wrote it ("AcmeLearn"), else its domain's first label. Pure. */
export function orgNameFor(domain, text) {
  const label = String(domain ?? "").toLowerCase().split(".")[0] ?? "";
  const word = (String(text ?? "").match(/[A-Za-z0-9][A-Za-z0-9&'-]*/g) ?? []).find((w) => w.toLowerCase() === label && /[A-Z]/.test(w));
  return word ?? (label ? label[0].toUpperCase() + label.slice(1) : "");
}

/**
 * THE WHOLE PLAN, FROM HER EMAIL ALONE. `{ business, org, orgDomain, contacts, skipped, problems }`:
 *   contacts — every named person, in her order, each role "send" with `order` (0 first);
 *   skipped  — addresses that are never pitched (in a note, or a purchase-order/billing inbox).
 * `problems` non-empty = nothing may be queued (no business, no one to write to). Pure.
 */
export function campaignPlan(text, businesses) {
  const t = String(text ?? "");
  const business = businessIn(t, businesses);
  const lines = t.replace(/\r/g, "").split("\n");
  const contacts = [];
  const skipped = [];
  const seen = new Set();
  let current = null;
  for (const line of lines) {
    const c = contactLine(line);
    if (c && !seen.has(c.email)) {
      seen.add(c.email);
      const never = neverPitchReason(c.email);
      if (never) { skipped.push({ email: c.email, why: never }); current = null; continue; }
      current = { ...c, note: "" };
      contacts.push(current);
      continue;
    }
    for (const e of (line.match(EMAIL_RE) ?? []).map((x) => x.toLowerCase())) {
      if (seen.has(e)) continue;
      seen.add(e);
      skipped.push({ email: e, why: neverPitchReason(e) ?? "named only in a note, not as a person to write to" });
    }
    const note = line.replace(BULLET, "").trim();
    if (current && /^(?:best use|use for|angle|pitch|focus|good for)\s*:/i.test(note)) current.note = `${current.note} ${note.replace(/^[^:]+:\s*/, "")}`.trim();
  }
  const domains = [...new Set(contacts.map((c) => c.email.split("@")[1]))];
  const orgDomain = domains.length === 1 ? domains[0] : null;
  // Her order, with the top executive last (owner, 8 Nov 2026: day 0, +7, then the president +14).
  const queue = [...contacts.filter((c) => !isTopExec(c.title)), ...contacts.filter((c) => isTopExec(c.title))];
  const planned = queue.map((c, order) => ({ ...c, role: "send", order, angle: isTopExec(c.title) ? "alliance" : angleFor(c) }));
  const problems = [];
  if (!business) problems.push("it names no business with a partner sequence");
  if (!planned.some((c) => c.role === "send")) problems.push("no named person in it may be written to");
  if (domains.length > 1) problems.push(`the people are at ${domains.length} different companies; send one company per email`);
  return { business, org: orgDomain ? orgNameFor(orgDomain, t) : null, orgDomain, contacts: planned, skipped, problems };
}

/** The day a contact's first email may go, counted from the first contact's first email. Pure. */
export function firstSendOffsetDays(order) {
  return Math.max(0, Number(order) || 0) * STAGGER_DAYS;
}

/**
 * "HOLD THESE ORGS FOR LATER, AFTER ACMELEARN" (owner, 8 Nov 2026). The organisations a business
 * targets next, in her order, with no contacts yet. `{ orgs, after }` or null when it is not that ask.
 * One per line (bullets or numbers) or a comma list on the line after the ask. Pure.
 */
export function holdOrgsIn(text) {
  const t = String(text ?? "").replace(/\r/g, "");
  const ask = /\b(?:hold|queue|keep|line up|save)\b[^.\n]{0,40}\b(?:orgs?|organi[sz]ations?|companies|partners?|targets?)\b[^\n]{0,80}?\b(?:later|next|after)\b[^\n]*/i.exec(t);
  if (!ask) return null;
  const after = /\bafter\s+(?:the\s+)?([A-Z0-9][\w&'’.-]*(?:\s+[A-Za-z0-9&'’.-]+){0,5}?)(?:\s+(?:campaign|one|is done|ends|finishes)\b|\s*[:.,;\n]|$)/.exec(ask[0]);
  const inline = ask[0].includes(":") ? ask[0].slice(ask[0].indexOf(":") + 1).trim() : "";
  const rest = [...(inline ? [inline] : []), ...t.slice(ask.index + ask[0].length).split("\n").map((l) => l.trim()).filter(Boolean)];
  const orgs = [];
  for (const l of rest) {
    const item = l.replace(/^(?:[-•·*–—>]|\d+[.)])\s*/, "").trim();
    if (!item) continue;
    if (!/^(?:[-•·*–—>]|\d+[.)])/.test(l) && orgs.length) break;
    // A comma list splits on commas (and a last "and"); one name per line is kept whole ("The Good and the Beautiful").
    const names = item.includes(",") ? item.split(/\s*,\s*(?:and\s+)?|\s*,?\s+and\s+(?=[^,]*$)/) : [item];
    for (const name of names) {
      const n = name.replace(/[.;]+$/, "").trim();
      if (n && n.length <= 80 && /[A-Za-z]/.test(n) && !orgs.some((o) => o.toLowerCase() === n.toLowerCase())) orgs.push(n);
    }
  }
  return orgs.length ? { orgs, after: after ? after[1].trim() : null } : null;
}

/** A published address's person, read from research: role from the title, angle from the title. Pure. */
export function researchedContact(row) {
  const name = String(row?.name ?? "").trim();
  const email = String(row?.email ?? "").trim().toLowerCase();
  const title = String(row?.title ?? "").trim();
  if (!/^[A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){1,3}$/u.test(name) || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return null;
  if (neverPitchReason(email)) return null;
  return { name, first: name.split(/\s+/)[0], title, email, note: "", angle: isTopExec(title) ? "alliance" : angleFor({ title }), role: "send" };
}

/**
 * WHAT THE PRODUCT DOES TODAY, READ FROM ITS OWN REPO AT BUILD TIME (owner, 8 Nov 2026: the first
 * one-pager missed adaptive difficulty because its words were a copy frozen here). The capabilities
 * document's claim table: the "Permitted description" (or "Description") column of every row whose
 * status is live, never one marked planned, proposal, not built or not merged. `[]` = unreadable,
 * and nothing is queued on an empty list. Pure.
 */
export function capabilitiesFrom(md) {
  const lines = String(md ?? "").replace(/\r/g, "").split("\n");
  // First choice: the buyer-words section, "## Live today" (or "## What <it> does today"), one bullet per feature.
  const h = lines.findIndex((l) => /^#{2,3}\s+(?:live today|what\b.*\bdoes today|today)\s*$/i.test(l.trim()));
  if (h >= 0) {
    const bullets = [];
    for (let k = h + 1; k < lines.length && !/^#{1,3}\s/.test(lines[k]); k++) {
      const m = /^\s*[-*]\s+(.+)$/.exec(lines[k]);
      if (!m) continue;
      const text = m[1].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").trim();
      if (text && !/\b(?:planned|proposal|proposed|not built|not merged|coming soon)\b/i.test(text)) bullets.push(text.endsWith(".") ? text : `${text}.`);
    }
    if (bullets.length) return bullets;
  }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i];
    if (!/^\s*\|/.test(head) || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) continue;
    const cols = head.split("|").slice(1, -1).map((c) => c.trim().toLowerCase());
    const di = cols.findIndex((c) => /permitted description|^description$|what it does|claim we may make/.test(c));
    if (di < 0) continue;
    const si = cols.findIndex((c) => /^status$|availability|live\?/.test(c));
    for (let k = i + 2; k < lines.length && /^\s*\|/.test(lines[k]); k++) {
      const cells = lines[k].split("|").slice(1, -1).map((c) => c.trim());
      const text = (cells[di] ?? "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").trim();
      const status = si >= 0 ? (cells[si] ?? "") : "";
      if (!text || /\b(?:planned|proposal|proposed|not built|not merged|unverified|roadmap|coming soon)\b/i.test(`${text} ${status}`)) continue;
      if (si >= 0 && status && !/\b(?:live|built|available|shipped|yes|production)\b/i.test(status)) continue;
      out.push(text.endsWith(".") ? text : `${text}.`);
    }
    if (out.length) break;
  }
  return out;
}

const NAMED_APPS = /\b(?:epic!?|reading eggs|raz-?kids|abc ?mouse|hooked on phonics|starfall|homer|lexia|reading iq|vooks|khan academy kids|teach your monster|duolingo|readworks|newsela|bookshark|beanstack|amira|ello|readability tutor|footsteps2brilliance)\b/i;
const MONEY_FIGURE = /\$\s?\d|\b\d+(?:\.\d+)?\s?(?:%|percent\b|per ?cent\b)|\b\d+(?:\.\d+)?\s?(?:dollars?|usd)\b/i;
const SUPERLATIVE = /\b(?:superior|the best|best[- ]in[- ]class|#1|number one|better than|beats)\b/i;

/**
 * THE ONE-PAGER'S OWN RULE (owner, 8 Nov 2026, time-2-read brain, partner-offer): unlike an email, it
 * may NAME partner pricing and a revenue share, but never a figure (no $, no %), never a named
 * reading app, never "superior" or "best". Every other outbound rule holds (no call ask, no claim we
 * never make). `[]` = fit to publish. Pure.
 */
export function pageProblems(text, outbound) {
  const t = String(text ?? "");
  const p = (outbound ? outbound(t) : []).filter((x) => !/names a price/.test(x));
  const money = MONEY_FIGURE.exec(t);
  if (money) p.push(`names a figure ("${money[0]}"): terms are agreed once they reply`);
  const app = NAMED_APPS.exec(t);
  if (app) p.push(`names another reading app ("${app[0]}"): compare with kinds of app, never a brand`);
  const sup = SUPERLATIVE.exec(t);
  if (sup) p.push(`claims to be better ("${sup[0]}"): show the difference, never "best"`);
  return p;
}
