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
 *   - anything for a paused business: refused;
 *   - post on a channel/format not in the roster: refused → her decision.
 *
 * PRIVATE DATA: the Director reads ONLY this section (growthSection). A Growth section carrying a
 * confidential mark is refused whole (fail closed), so no private span can reach a free model.
 */
import { sectionBody } from "../brains/brain.mjs";

export const GROWTH_BRAINS = Object.freeze(["porch-and-party", "spry"]);
export const FIELDS = Object.freeze(["key", "buyer", "offer", "money number", "channels", "languages", "voice", "design skill", "limits", "season", "linked to-dos", "paused"]);
export const REQUIRED = Object.freeze(["key", "buyer", "offer", "money number", "channels", "languages", "limits"]);
export const SPEND_ACTIONS = Object.freeze(["ad", "boost", "paid-tool", "paid-model", "purchase", "subscription", "promotion"]);
export const NEVER_ACTIONS = Object.freeze({ "create-account": "NO_NEW_ACCOUNTS", "retire-account": "PROPOSE_ONLY", "delete-post": "PROPOSE_ONLY", "retire-pipeline": "PROPOSE_ONLY" });
const CONFIDENTIAL = /<!--\s*\/?\s*confidential\s*-->/i;

/** The Growth section of one brain, or a named refusal. Only the growth brains are ever read. */
export function growthSection(slug, md) {
  if (!GROWTH_BRAINS.includes(slug)) throw Object.assign(new Error(`NAMED STOP [NOT_A_GROWTH_BRAIN] the Director never reads the ${slug} brain.`), { code: "NOT_A_GROWTH_BRAIN" });
  const body = sectionBody(md, "Growth");
  if (body == null || !body.trim() || body.trim() === "[MISSING]") return null;
  if (CONFIDENTIAL.test(body)) throw Object.assign(new Error(`NAMED STOP [PRIVATE_IN_GROWTH] the ${slug} brain's Growth section carries a confidential mark; it is not read at all.`), { code: "PRIVATE_IN_GROWTH" });
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
    if (h) { cur = { label: h[1], brain, fields: {} }; out.push(cur); continue; }
    const f = /^\s*-\s*([a-z][a-z -]*?)\s*:\s*(.*)$/i.exec(line);
    if (cur && f) { const k = f[1].toLowerCase().trim(); if (FIELDS.includes(k)) cur.fields[k] = f[2].trim(); }
  }
  return out.map(({ label, brain: b, fields }) => {
    const pausedText = fields.paused ?? "no";
    const paused = /^(no|false|-)?$/i.test(pausedText.trim()) ? null : pausedText;
    return {
      label, brain: b, key: fields.key ?? null, buyer: fields.buyer ?? null, offer: fields.offer ?? null, money: fields["money number"] ?? null,
      channels: parseChannels(fields.channels), languages: list(fields.languages).map((l) => l.toLowerCase()), voice: fields.voice ?? null,
      design: fields["design skill"] ?? null, limits: (fields.limits ?? "").match(/R-[A-Z]+-\d+/g) ?? [], season: fields.season ?? null,
      linked: (fields["linked to-dos"] ?? "").match(/olp_[a-z0-9]+/g) ?? [], paused,
      problems: REQUIRED.filter((k) => !fields[k]).map((k) => `${label}: no ${k}`),
    };
  });
}

/** What is wrong with the whole roster, by name. Zero entries is a problem (the Director would serve no one). */
export function rosterProblems(entries) {
  const out = [];
  if (!entries.length) out.push("NAMED STOP [ROSTER_EMPTY] no Growth section lists a business");
  const keys = new Set();
  for (const e of entries) {
    out.push(...e.problems);
    if (e.key && keys.has(e.key)) out.push(`${e.label}: key ${e.key} is listed twice`);
    if (e.key) keys.add(e.key);
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
  const e = roster.find((x) => x.key === business);
  if (!e) return { ok: false, stop: "NOT_ON_ROSTER", why: `${business} has no Growth roster entry` };
  if (e.paused) return { ok: false, stop: "PAUSED", why: `${e.label} is paused: ${e.paused}` };
  if (action === "propose") return { ok: true };
  if (action !== "post") return { ok: false, stop: "UNKNOWN_ACTION", why: `no action called ${action}` };
  const c = e.channels.find((x) => x.channel === String(channel ?? "").toLowerCase());
  if (!c) return { ok: false, stop: "NOT_APPROVED", why: `${channel} is not an approved channel for ${e.label}` };
  if (!format || !c.formats.includes(String(format).toLowerCase())) return { ok: false, stop: "NOT_APPROVED", why: `${format ?? "(no format)"} is not an approved format on ${e.label}'s ${channel}` };
  return { ok: true };
}
