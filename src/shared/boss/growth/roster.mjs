/**
 * THE GROWTH ROSTER (Growth Director, 21 Nov 2026): one entry per business the Director serves, kept
 * in the "## Growth" section of that business's brain (Porch & Party in `porch-and-party`; the five
 * Spry Labs apps and the paused YouTube channels in `spry`). Adding or removing a business is one
 * `### <Name>` entry there; nothing in this public repo holds the content.
 *
 * Each entry is `- field: value` lines:
 *   key, buyer, offer, money number, channels, languages, voice, design skill, limits, season,
 *   linked to-dos, paused
 * `channels` is the APPROVED list: `instagram [reel, photo-set] · tiktok [reel] · ...`. A channel or
 * format not written there is NOT approved: the Director may only propose it to her (mayAct).
 *
 * WHAT THE DIRECTOR MAY DO (mayAct), in code, never by judgment:
 *   - spend anything (ads, boosts, paid tools, paid models, purchases): NAMED STOP [NEVER_SPEND];
 *   - create an account (R-AI-02): NAMED STOP [NO_NEW_ACCOUNTS];
 *   - retire or delete an account, pipeline or post: never (it proposes, with evidence);
 *   - anything for a paused business, or for a half-written, misspelled or doubled entry: refused;
 *   - post on a channel/format not in the roster: refused → her decision.
 *
 * PRIVATE DATA: the Director reads this section (growthSection) and her rulings (rulingsFor, below),
 * nothing else of any brain. A Growth section carrying a confidential mark, or lying inside a span
 * from another section, is refused whole (fail closed); her rulings are read from the brain with
 * every confidential span cut first (stripConfidential over the whole document, then split), and the
 * router cuts again and refuses a message that still carries a mark. Every cycle then checks each
 * decision prompt it built before the model call (promptLeak, privacy.mjs): no word her brains keep
 * only inside a private span, and no personal mail address; `npm run growth:privacy` runs it on a copy.
 *
 * HER RULINGS (her words, 22 Nov 2026: "yea let it read the settled decisions"). Each entry's model
 * input carries its own brain's "## Settled decisions": for a Spry Labs business, the "### " groups
 * whose heading starts with its label plus the SHARED_RULINGS groups (All apps, Pinterest and KDP only
 * for a business whose roster has that channel); for Porch & Party, the whole section. Matching is on headings only; the
 * model reads what a ruling means. A missing group is a named problem; a missing section, or a brain
 * that could not be read, is "rulings not read" and the business is held, never decided without them.
 */
import { sectionBody, hasConfidential, stripConfidential } from "../brains/brain.mjs";

export const GROWTH_BRAINS = Object.freeze(["porch-and-party", "spry"]);
export const FIELDS = Object.freeze(["key", "buyer", "offer", "money number", "channels", "languages", "voice", "design skill", "limits", "season", "linked to-dos", "paused"]);
export const REQUIRED = Object.freeze(["key", "buyer", "offer", "money number", "channels", "languages", "limits"]);
export const SPEND_ACTIONS = Object.freeze(["ad", "boost", "paid-tool", "paid-model", "purchase", "subscription", "promotion"]);
export const NEVER_ACTIONS = Object.freeze({ "create-account": "NO_NEW_ACCOUNTS", "retire-account": "PROPOSE_ONLY", "delete-post": "PROPOSE_ONLY", "retire-pipeline": "PROPOSE_ONLY" });

/** The Growth section of one brain, or a named refusal. Only the growth brains are ever read. */
export function growthSection(slug, md) {
  if (!GROWTH_BRAINS.includes(slug)) throw Object.assign(new Error(`NAMED STOP [NOT_A_GROWTH_BRAIN] the Director never reads the ${slug} brain.`), { code: "NOT_A_GROWTH_BRAIN" });
  const body = sectionBody(md, "Growth");
  if (body == null || !body.trim() || body.trim() === "[MISSING]") return null;
  // A mark inside the section, or a span from another section that runs over it (its own text then
  // carries no mark), both stop it: the section must read the same with the brain's private parts cut.
  if (hasConfidential(body) || sectionBody(stripConfidential(md), "Growth") !== body) throw Object.assign(new Error(`NAMED STOP [PRIVATE_IN_GROWTH] the ${slug} brain's Growth section carries a confidential mark; it is not read at all.`), { code: "PRIVATE_IN_GROWTH" });
  return body;
}

const list = (v) => String(v ?? "").split(/\s*[,;]\s*/).map((x) => x.trim()).filter(Boolean);

/** `instagram [reel, photo-set] · tiktok [reel]` → [{ channel, formats }]. */
export function parseChannels(v) {
  return String(v ?? "").split(/\s*·\s*|\s*\|\s*/).map((part) => {
    const m = /^([a-z0-9][a-z0-9-]*)\s*(?:\[([^\]]*)\])?\s*(?:\(([^)]*)\))?$/i.exec(part.trim());
    return m ? { channel: m[1].toLowerCase(), formats: list(m[2]).map((f) => f.toLowerCase()), note: m[3] ?? null } : null;
  }).filter(Boolean);
}

/** Every `### Name` entry of a Growth section: [{ label, key, ..., channels, languages, limits, paused, problems }]. */
export function parseRoster(body, brain) {
  const out = [];
  let cur = null;
  for (const line of String(body ?? "").split("\n")) {
    const h = /^###\s+(.+?)\s*$/.exec(line);
    if (h) { cur = { label: h[1], brain, fields: {}, unknown: [] }; out.push(cur); continue; }
    const f = /^\s*-\s*([a-z][a-z -]*?)\s*:\s*(.*)$/i.exec(line);
    if (cur && f) { const k = f[1].toLowerCase().trim(); if (FIELDS.includes(k)) cur.fields[k] = f[2].trim(); else cur.unknown.push(k); }
  }
  const seen = new Map();
  for (const e of out) if (e.fields.key) seen.set(e.fields.key, (seen.get(e.fields.key) ?? 0) + 1);
  return out.map(({ label, brain: b, fields, unknown }) => {
    const pausedText = fields.paused ?? "no";
    const paused = /^(no|false|-)?$/i.test(pausedText.trim()) ? null : pausedText;
    return {
      label, brain: b, key: fields.key ?? null, buyer: fields.buyer ?? null, offer: fields.offer ?? null, money: fields["money number"] ?? null,
      channels: parseChannels(fields.channels), languages: list(fields.languages).map((l) => l.toLowerCase()), voice: fields.voice ?? null,
      design: fields["design skill"] ?? null, limits: (fields.limits ?? "").match(/R-[A-Z]+-\d+/g) ?? [], season: fields.season ?? null,
      linked: (fields["linked to-dos"] ?? "").match(/olp_[a-z0-9]+/g) ?? [],
      // "olp_x (what it is)": the words the Director reads about older work come from the roster, never
      // from the Open Loops row itself (that table is LOCAL_ONLY: no row text goes to a model).
      linkedNotes: Object.fromEntries([...(fields["linked to-dos"] ?? "").matchAll(/(olp_[a-z0-9]+)\s*\(([^)]+)\)/g)].map((m) => [m[1], m[2].trim()])),
      paused,
      problems: [
        ...REQUIRED.filter((k) => !fields[k]).map((k) => `${label}: no ${k}`),
        ...unknown.map((k) => `${label}: "${k}" is not a roster field (one of ${FIELDS.join(", ")})`),
        ...(fields.key && seen.get(fields.key) > 1 ? [`${label}: key ${fields.key} is listed twice`] : []),
      ],
    };
  });
}

/** What is wrong with the whole roster, by name. Zero entries is a problem (the Director would serve no one). */
export function rosterProblems(entries) {
  const out = [];
  if (!entries.length) out.push("NAMED STOP [ROSTER_EMPTY] no Growth section lists a business");
  for (const e of entries) {
    out.push(...e.problems);
    if (!e.paused && !e.channels.length) out.push(`${e.label}: no approved channel`);
  }
  return out;
}

/**
 * May the Director do this? `{ ok: true }` or `{ ok: false, stop, why }`. The ONLY gate between a
 * decision and any act; anything refused here can only become a proposal to her.
 *   action: "post" (on an approved channel/format), "propose", or a spend/never action.
 */
export function mayAct(roster, { business, channel, format, action = "post" }) {
  if (SPEND_ACTIONS.includes(action)) return { ok: false, stop: "NEVER_SPEND", why: "agents never spend money; she pays, from a prepared checkout" };
  if (NEVER_ACTIONS[action]) return { ok: false, stop: NEVER_ACTIONS[action], why: action === "create-account" ? "agents never create accounts (R-AI-02)" : "the Director never retires or deletes; it proposes with evidence" };
  const mine = roster.filter((x) => x.key === business);
  const e = mine[0];
  if (!e) return { ok: false, stop: "NOT_ON_ROSTER", why: `${business} has no Growth roster entry` };
  // A broken entry acts on nothing: a missing limits line would leave its drafts unchecked.
  if (mine.length > 1 || e.problems.length) return { ok: false, stop: "ROSTER_BROKEN", why: mine.length > 1 ? `${business} is listed twice in the roster` : e.problems.join("; ") };
  if (e.paused) return { ok: false, stop: "PAUSED", why: `${e.label} is paused: ${e.paused}` };
  if (action === "propose") return { ok: true };
  if (action !== "post") return { ok: false, stop: "UNKNOWN_ACTION", why: `no action called ${action}` };
  const c = e.channels.find((x) => x.channel === String(channel ?? "").toLowerCase());
  if (!c) return { ok: false, stop: "NOT_APPROVED", why: `${channel} is not an approved channel for ${e.label}` };
  if (!format || !c.formats.includes(String(format).toLowerCase())) return { ok: false, stop: "NOT_APPROVED", why: `${format ?? "(no format)"} is not an approved format on ${e.label}'s ${channel}` };
  return { ok: true };
}

/**
 * The spry Settled groups a Spry Labs business reads, matched by the START of the "### " heading
 * ("Growth" is "### Growth (Shoestring Growth Plan, 21 Nov 2026)"). Listed most needed first: when the
 * prompt is over its budget, the Director leaves them out from the END of this list, never its own group.
 * The channel groups come last and are read only by a business whose roster lists that channel
 * (CHANNEL_RULINGS): "All apps" with app-store, "Pinterest" with pinterest, "KDP" with kdp.
 */
export const SHARED_RULINGS = Object.freeze(["Growth", "Umbrella, scope and money", "Brand and social", "Search, sites and freshness", "All apps", "Pinterest", "KDP"]);
export const CHANNEL_RULINGS = Object.freeze({ "All apps": "app-store", Pinterest: "pinterest", KDP: "kdp" });
const SINGLE_BUSINESS_BRAINS = Object.freeze(["porch-and-party"]);
/** Her words for the two growth brains, so a problem reads as a business, never a slug. */
export const BRAIN_NAMES = Object.freeze({ "porch-and-party": "Porch & Party", spry: "Spry Labs" });

/** "### heading" groups of a section body, in order: [{ heading, body }]. */
export function headingGroups(body) {
  const out = []; let cur = null;
  for (const line of String(body ?? "").split("\n")) {
    const m = /^###\s+(.+?)\s*$/.exec(line);
    if (m) { cur = { heading: m[1], lines: [] }; out.push(cur); } else if (cur) cur.lines.push(line);
  }
  return out.map((g) => ({ heading: g.heading, body: g.lines.join("\n").trim() }));
}

/**
 * One roster entry's rulings from its brain's markdown (null = the brain was not read):
 * { notRead, own: [{ heading, body }], shared: [{ heading, body }], problems }.
 * The brain's private spans are cut from the WHOLE document before it is split, so a span that wraps
 * a "### " or "## " heading takes the text under it too (cut per group, the text below the heading
 * would keep no mark and reach the model).
 */
export function rulingsFor(entry, md) {
  const name = BRAIN_NAMES[entry?.brain] ?? entry?.brain;
  const none = (why) => ({ notRead: why, own: [], shared: [], problems: [`${entry.label}: rulings not read (${why})`] });
  if (md == null) return none(`the ${name} brain could not be read`);
  const written = (b) => Boolean(b) && b !== "[MISSING]";
  const body = sectionBody(stripConfidential(md), "Settled decisions")?.trim();
  if (!written(body)) {
    return none(written(sectionBody(md, "Settled decisions")?.trim())
      ? `the ${name} brain's Settled decisions sit inside a confidential mark`
      : `the ${name} brain has no Settled decisions section`);
  }
  if (SINGLE_BUSINESS_BRAINS.includes(entry.brain)) return { notRead: null, own: [{ heading: "Settled decisions", body }], shared: [], problems: [] };
  const groups = headingGroups(body);
  const starts = (h, w) => h.toLowerCase().startsWith(String(w).toLowerCase());
  const problems = [];
  const own = groups.filter((g) => starts(g.heading, entry.label));
  if (!own.length) problems.push(`${entry.label} has no "### ${entry.label}" group in the ${name} brain's Settled decisions; it reads the shared rulings only`);
  const has = new Set((entry.channels ?? []).map((c) => c.channel));
  const shared = [];
  for (const w of SHARED_RULINGS) {
    if (CHANNEL_RULINGS[w] && !has.has(CHANNEL_RULINGS[w])) continue;
    const g = groups.find((x) => starts(x.heading, w));
    if (g) shared.push(g); else problems.push(`the ${name} brain's Settled decisions has no "### ${w}" group`);
  }
  return { notRead: null, own, shared, problems };
}
