import type { Env } from "../env";
import { businessByKey } from "../outreach/catalog";
import { HOLD_KEY, holdText, outreachStopText } from "../outreach/engine";

/**
 * A ROUTE-READY OUTREACH BUSINESS THAT SENDS NOTHING IS ON TODAY (16 Oct 2026).
 *
 * Memphis Senior Care Homes was refused every hour for two days for a missing postal address and the
 * only record was a line in a tick log nobody reads. The tick now writes the cause on the business's
 * row (`outreach_domain_state.stop_reason`, see outreach/engine.ts) and this reads it, on the surface
 * she already opens, beside the other read-time producers. The row clears itself when a tick sends
 * for that business or finds nothing missing, or when she sets the address.
 */
export interface OutreachStopAlert {
  severity: "high";
  text: string;
  source_type: string;
  source_id: string | null;
}

export async function outreachStopAlerts(env: Env): Promise<OutreachStopAlert[]> {
  const rows = await env.DB.prepare(
    `SELECT business_key, stop_reason FROM outreach_domain_state WHERE stop_at IS NOT NULL AND stop_reason IS NOT NULL ORDER BY stop_at`,
  ).all<{ business_key: string; stop_reason: string }>();
  const out: OutreachStopAlert[] = [];
  for (const r of rows.results ?? []) {
    const b = businessByKey(r.business_key);
    if (!b) continue;
    out.push({ severity: "high", text: outreachStopText(b, r.stop_reason), source_type: "outreach", source_id: b.key });
  }
  // Replies the model could not read hold their own addresses (engine.ts recordHold): counts only.
  const held = await env.DB.prepare(`SELECT value FROM outreach_settings WHERE key = ?`).bind(HOLD_KEY).first<{ value: string }>();
  if (held) {
    let value: { replies: number; addresses: number; why: string } | null = null;
    try { value = JSON.parse(held.value); } catch { /* an unreadable hold is still a hold */ }
    out.push({
      severity: "high", source_type: "outreach", source_id: HOLD_KEY,
      text: value && Number.isSafeInteger(value.replies) ? holdText(value) : "Monique's outreach is holding replies it could not read; the count is unreadable.",
    });
  }
  return out;
}
