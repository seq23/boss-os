/**
 * BOUNCES AND ADDRESS CHECKS FOR THE WEST PEEK MAILBOX (owner, 24 Oct 2026).
 *
 * Her words: "a lot of 2nd emails went out to emails that were already bounced or blocked" and
 * "u need to use my neverbounce when u can".
 *
 * Two systems write LP outreach from sequoia@westpeek.ventures:
 *   - Twin (twin.so), the pension / endowment / family-office drip. It logs every send on the
 *     "Sent Log" tab of the West Peek LP Outreach Log and stops a drip for any address on the
 *     "Reply Queue" tab. It never read the bounces: 58 follow-ups in 30 days went to 33 addresses
 *     that had already hard-bounced, because nothing put a bounced address on Reply Queue
 *     (lp-outcomes.mjs only changed the Status cell, which Twin does not read, and only on Tuesdays).
 *   - Monique's prospect sequence (lp-prospects.mjs), which suppresses its own bounces but never
 *     saw the ones Twin's sends produced in the same mailbox.
 *
 * The fix is ONE list, read every morning before either system sends (lp-bounces.mjs):
 *   every hard bounce in the mailbox → Twin's Reply Queue (drip stopped) AND Boss OS suppression
 *   (outreach_suppression, checked by prospectPlan before EVERY touch).
 * Only addresses one of the two systems wrote to are taken: the mailbox also carries other mail,
 * whose bounces are not ours to record.
 *
 * Everything here is pure, so the rules are tested with synthetic notices and fake addresses.
 */

const ADDRESS = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * Sender-side authentication failures (DMARC / SPF / DKIM on OUR domain). The recipient is fine;
 * suppressing them would punish an LP for our DNS. Everything else in 5.x.x is permanent.
 */
const OUR_FAULT = new Set(["5.7.23", "5.7.25", "5.7.26", "5.7.27"]);

/**
 * The addresses a delivery-status notice says failed PERMANENTLY. `text` is the notice decoded
 * (headers + every text part). Read from `Final-Recipient:` / `X-Failed-Recipients:`, the two
 * fields every provider writes; a notice whose only codes are 4.x.x (delayed, retrying) is soft
 * and returns nothing.
 */
export function hardBouncedAddresses(text) {
  const t = String(text ?? "");
  const codes = [...t.matchAll(/(?:^|[^\d.])([245])\.(\d{1,3})\.(\d{1,3})(?![\d.])/g)].map((m) => `${m[1]}.${m[2]}.${m[3]}`);
  const permanent = codes.filter((c) => c.startsWith("5.") && !OUR_FAULT.has(c));
  if (!permanent.length) return [];
  const out = new Set();
  for (const m of t.matchAll(/^Final-Recipient:\s*rfc822;\s*<?([^\s>]+)>?/gim)) out.add(m[1].toLowerCase());
  for (const m of t.matchAll(/^X-Failed-Recipients:\s*(.+)$/gim)) for (const a of m[1].match(ADDRESS) ?? []) out.add(a.toLowerCase());
  return [...out].filter((a) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(a));
}

/**
 * Twin's Sent Log rows → Reply Queue rows for the addresses that hard-bounced. One row per address,
 * never one already on Reply Queue (a queue that repeats itself is a queue nobody trusts). An
 * address already on "Blocked – Do Not Contact" IS queued: that tab did not stop the drip (24 Oct
 * 2026: 24 follow-ups in 30 days went to addresses already on it), and Reply Queue is the tab Twin's
 * own report names for it ("Add a row to Reply Queue to stop a drip"). Columns: Email, Full Name, Firm, Date Replied, Notes, Status — the tab's own
 * header; Status "new" is what Twin picks up and marks "Processed".
 *
 * `sentRows` are the Sent Log data rows (header removed): [date, first, last, firm, type, email, ...].
 * `hard` is Map(address → first bounce ms).
 */
export function twinReplyQueueRows({ sentRows, hard, queued = new Set() }) {
  const byAddress = new Map();
  for (const r of sentRows ?? []) {
    const a = String(r?.[5] ?? "").trim().toLowerCase();
    if (a.includes("@") && !byAddress.has(a)) byAddress.set(a, r);
  }
  const rows = [];
  for (const [a, at] of hard) {
    const r = byAddress.get(a);
    if (!r || queued.has(a)) continue;
    rows.push([
      a, `${r[1] ?? ""} ${r[2] ?? ""}`.trim(), r[3] ?? "", new Date(Number(at)).toISOString().slice(0, 10),
      "Hard bounce: the address does not accept mail. Stop the drip and never email it again.", "new",
    ]);
  }
  return rows;
}

/**
 * REPLIES STOP THE DRIP TOO (1 Nov 2026). The drip's sender honours Reply Queue (it marks each
 * "new" row "Processed" and closes the sequence), but replies only reached the tab from the Tuesday
 * lp-outcomes run: a call-ask that came in on a Friday got the final soft close on the Sunday.
 * lp-daily now queues every human reply each morning (06:15 Central, before the ~07:30 send).
 *
 * Which replies: the screened buckets a person wrote (call, warm, declined / asked to be removed,
 * left the firm, anything else they typed). Autoresponders are not a reply and are not queued.
 * `replies` = Map(address → { bucket, when }) from refreshPositive's `seenAddresses` (dropped
 * messages carry their drop reason as the bucket, so they fall out here), plus the running
 * positive list, which keeps every call / warm reply ever read, including ones the sender never
 * emailed. One row per address, never one already on the tab. Same columns as the bounce rows.
 *
 * Zero replies in is a NAMED STOP, not an empty success: the mailbox holds dozens of replies, so a
 * read that hands over none is a broken read. (All of them already queued → zero rows is correct.)
 */
export const REPLY_BUCKETS = new Set(["call", "warm", "negative", "departed", "other"]);
const REPLY_NOTE = {
  call: "Replied asking for a call: stop the drip; she answers and schedules it.",
  warm: "Replied with interest: stop the drip; she answers in person.",
  negative: "Declined or asked to be removed: stop the drip and never email again.",
  departed: "Replied that the person has left the firm: stop the drip.",
  other: "Replied: stop the drip; she answers in person.",
};
export function twinReplyQueueFromReplies({ sentRows, replies, queued = new Set() }) {
  const usable = [...(replies ?? new Map())].filter(([a, r]) => String(a).includes("@") && REPLY_BUCKETS.has(r?.bucket));
  if (!usable.length) throw new Error("NAMED STOP [NO_REPLIES_READ] the morning read handed over zero replies; the drip would not be told about anyone who wrote back.");
  const byAddress = new Map();
  for (const r of sentRows ?? []) {
    const a = String(r?.[5] ?? "").trim().toLowerCase();
    if (a.includes("@") && !byAddress.has(a)) byAddress.set(a, r);
  }
  const rows = [];
  const seen = new Set(queued);
  for (const [raw, r] of usable) {
    const a = String(raw).trim().toLowerCase();
    if (seen.has(a)) continue;
    seen.add(a);
    const s = byAddress.get(a);
    rows.push([
      a, s ? `${s[1] ?? ""} ${s[2] ?? ""}`.trim() : String(r.name ?? ""), s?.[3] ?? "", String(r.when ?? "").slice(0, 10),
      REPLY_NOTE[r.bucket], "new",
    ]);
  }
  return rows;
}

/**
 * How many emails went to an address AFTER it had hard-bounced. `sends` = [{to: [addr], at: ms}].
 * The measurement behind this fix, and the number that must stay at zero.
 */
export function sendsAfterBounce(sends, hard) {
  const hits = [];
  for (const s of sends ?? []) for (const a of s.to ?? []) {
    const at = hard.get(String(a).toLowerCase());
    if (at != null && Number(s.at) > Number(at)) hits.push({ to: String(a).toLowerCase(), at: Number(s.at) });
  }
  return hits;
}

/* ─── NeverBounce (her account) ───────────────────────────────────────────── */

/**
 * What a NeverBounce single-check result means for a FIRST email:
 *   valid                → send
 *   catchall / unknown   → send, marked (the domain accepts everything or would not say)
 *   invalid / disposable → never send; suppressed like a bounce
 * Anything else (an error, no answer) → send unverified; the bounce read the next morning still
 * stops every later touch.
 */
export function neverBounceVerdict(result) {
  const r = String(result ?? "").toLowerCase();
  if (r === "valid") return { send: true, mark: "valid" };
  if (r === "catchall" || r === "unknown") return { send: true, mark: r };
  if (r === "invalid" || r === "disposable") return { send: false, mark: r };
  return { send: true, mark: "unverified" };
}

/** Cached results are good for 90 days: an address that was valid in the summer is checked again. */
export const NEVERBOUNCE_CACHE_DAYS = 90;
/** Credits are hers: at most this many checks a run (the sequence sends ≤20 first emails a day). */
export const NEVERBOUNCE_MAX_PER_RUN = 25;

/**
 * Check the addresses that have never been written to. `check(email)` returns the NeverBounce
 * `result` string (the caller does the HTTP, with the key injected by the vault). Cached results
 * are reused; past `cap` new checks the rest go unverified. Returns { verdicts: Map, cache, checked }.
 */
export async function verifyFirstSends(emails, { check, cache = {}, cap = NEVERBOUNCE_MAX_PER_RUN, now = Date.now() }) {
  const verdicts = new Map();
  const next = { ...cache };
  let checked = 0;
  for (const raw of emails ?? []) {
    const e = String(raw).toLowerCase();
    const hit = next[e];
    if (hit && now - Number(hit.at) < NEVERBOUNCE_CACHE_DAYS * 86_400_000) { verdicts.set(e, neverBounceVerdict(hit.result)); continue; }
    if (!check || checked >= cap) { verdicts.set(e, { send: true, mark: "unverified" }); continue; }
    checked++;
    const result = await check(e).catch(() => null);
    if (result) next[e] = { result, at: now };
    verdicts.set(e, neverBounceVerdict(result));
  }
  return { verdicts, cache: next, checked };
}
