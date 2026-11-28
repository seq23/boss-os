/**
 * "SENT" AND "FORWARDED" COUNT ONLY WHEN THE RECEIVING END SAYS IT ARRIVED (owner, 28 Nov 2026: Porch &
 * Party office replies were marked forwarded and never reached her, and no check caught it).
 *
 * One rule for every agent's mail. An item is ARRIVED only on a receiving-end receipt:
 *   - the copy found in the destination mailbox by its Message-ID, or
 *   - the mail provider's own delivery event (Resend `delivered`, or a later event that needs one:
 *     opened, clicked, complained).
 * A handed-off send ("sent", "queued", a Cloudflare forward that resolved) is never arrival. Past the
 * grace period with no receipt it is NOT ARRIVED; a receipt that could not be read is UNKNOWN
 * ("couldn't check"), never arrived. A check that read nothing is never a pass (rule 0). Pure.
 */

export const ARRIVAL_GRACE_MS = 2 * 3_600_000;

const ARRIVED_EVENTS = new Set(["delivered", "opened", "clicked", "complained"]);
const FAILED_EVENTS = new Set(["bounced", "failed", "suppressed", "canceled", "cancelled"]);
const WAITING_EVENTS = new Set(["sent", "queued", "scheduled", "delivery_delayed"]);

/** Resend's `last_event` for one send → arrived | not_arrived | pending | unknown. */
export function resendArrival(event, sentAt, now = Date.now()) {
  const e = String(event ?? "").toLowerCase();
  if (ARRIVED_EVENTS.has(e)) return "arrived";
  if (FAILED_EVENTS.has(e)) return "not_arrived";
  if (WAITING_EVENTS.has(e)) return Number.isFinite(sentAt) && now - sentAt >= ARRIVAL_GRACE_MS ? "not_arrived" : "pending";
  return "unknown";
}

/** A destination-mailbox search: `true` found, `false` searched and absent, anything else unread. */
export function mailboxArrival(found, sentAt, now = Date.now()) {
  if (found === true) return "arrived";
  if (found === false) return Number.isFinite(sentAt) && now - sentAt >= ARRIVAL_GRACE_MS ? "not_arrived" : "pending";
  return "unknown";
}

/**
 * The verdict for one group of items (`{ arrival }` each), in the operating report's states:
 * missing (any NOT ARRIVED), unknown (any unread, or nothing read at all), nothing_due (only items
 * still inside the grace period), verified (every item arrived). `what` names the items in plain words.
 */
export function arrivalVerdict(items, what) {
  const n = { arrived: 0, not_arrived: 0, pending: 0, unknown: 0 };
  for (const i of items ?? []) n[i.arrival in n ? i.arrival : "unknown"]++;
  const total = (items ?? []).length;
  const tail = n.unknown ? `; ${n.unknown} couldn't be checked` : "";
  if (n.not_arrived) return { state: "missing", evidence: `Not arrived: ${n.not_arrived} of ${total} ${what}${tail}.` };
  if (n.unknown) return { state: "unknown", evidence: `Couldn't check ${n.unknown} of ${total} ${what}${n.arrived ? `; ${n.arrived} arrived` : ""}.` };
  if (!total) return { state: "unknown", evidence: `Read no ${what}, so nothing is proven.` };
  if (n.pending === total) return { state: "nothing_due", evidence: `${total} ${what} still inside the ${ARRIVAL_GRACE_MS / 3_600_000}-hour delivery window.` };
  return { state: "verified", evidence: `All ${n.arrived} ${what} arrived${n.pending ? `; ${n.pending} still inside the delivery window` : ""}.` };
}

/**
 * Each real reply reached her when a morning email that carried its Decide card arrived. `carriers`
 * are the kept mornings: `{ day, keys: [card keys], built_at, arrival }`, `arrival` that morning's own
 * receipt. A reply after the newest morning is pending until the next one is built (plus the grace).
 */
export function replyArrivals(replies, carriers, keyOf, now = Date.now()) {
  const mornings = [...(carriers ?? [])].sort((a, b) => Number(a.built_at) - Number(b.built_at));
  // No kept morning read at all proves nothing either way (rule 0).
  if (!mornings.length) return (replies ?? []).map((r) => ({ ...r, arrival: "unknown" }));
  return (replies ?? []).map((r) => {
    const at = Date.parse(r.at);
    const key = keyOf(r);
    const shown = mornings.filter((m) => (m.keys ?? []).includes(key));
    if (shown.some((m) => m.arrival === "arrived")) return { ...r, arrival: "arrived" };
    if (shown.some((m) => m.arrival === "unknown" || m.arrival === "pending")) return { ...r, arrival: shown.some((m) => m.arrival === "unknown") ? "unknown" : "pending" };
    // Not on any arrived morning: is a morning built after it, and past the grace, missing it?
    const after = mornings.filter((m) => Number(m.built_at) > at);
    const due = after.some((m) => now - Number(m.built_at) >= ARRIVAL_GRACE_MS);
    return { ...r, arrival: due ? "not_arrived" : "pending" };
  });
}
