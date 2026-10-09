/**
 * REFERRAL CODES AND THE MONTHLY PAYOUT LEDGER (affiliates: 30% of the referred customer's first
 * year of revenue).
 *
 * ─── How a sale reaches the ledger ──────────────────────────────────────────
 * A partner shares `https://<product>/?ref=<CODE>`. The product's Stripe Checkout carries the code
 * as `metadata[ref]`, beside the `metadata[sku]` ApprovalPrep already writes, and the sale is posted
 * here (`POST /api/boss/outreach/referrals/conversions`, one row per order, idempotent on the order).
 *
 * ─── Payouts are never sent by code ─────────────────────────────────────────
 * On the 1st (America/Chicago) last month's rows are computed into `referral_payouts` as
 * 'computed'. The FIRST time any payout exists, a card goes in front of the owner; nothing here
 * moves money, and no route does either.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import type { Business } from "./catalog";
import { chicagoParts, DAY_MS } from "./brakes";

const PREFIX: Record<string, string> = {
  time2read: "T2R", aplayermode: "APM", approvalprep: "AP", weddingchecklist: "WED",
};
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function makeCode(businessKey: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const tail = [...bytes].map((x) => ALPHABET[x % ALPHABET.length]).join("");
  return `${PREFIX[businessKey] ?? "REF"}-${tail}`;
}

export async function ensurePartner(db: D1Database, b: Business, p: { id: string; email: string; org_name?: string | null }, now: number) {
  const existing = await db.prepare(`SELECT * FROM referral_partners WHERE business_key = ? AND email = ?`).bind(b.key, p.email).first<any>();
  if (existing) return existing as { id: string; code: string };
  for (let i = 0; i < 5; i++) {
    const code = makeCode(b.key);
    const r = await db.prepare(
      `INSERT INTO referral_partners (id, business_key, prospect_id, email, name, code, share_bps, created_at)
       VALUES (?,?,?,?,?,?,3000,?) ON CONFLICT DO NOTHING`,
    ).bind(newId("rfp"), b.key, p.id, p.email, p.org_name ?? null, code, now).run();
    if ((r.meta?.changes ?? 0) > 0) return (await db.prepare(`SELECT * FROM referral_partners WHERE code = ?`).bind(code).first<any>()) as { id: string; code: string };
  }
  throw new Error("Could not mint a unique referral code in five tries.");
}

export interface ConversionInput {
  code: string;
  order_ref: string;
  customer_ref?: string | null;
  amount_cents: number;
  occurred_at?: number;
}

export async function recordConversion(db: D1Database, c: ConversionInput, now = Date.now()) {
  const code = String(c.code ?? "").trim().toUpperCase();
  const partner = await db.prepare(`SELECT * FROM referral_partners WHERE code = ?`).bind(code).first<any>();
  if (!partner) throw new Error(`No partner holds the code ${code}.`);
  if (!c.order_ref || !Number.isInteger(c.amount_cents) || c.amount_cents < 0) throw new Error("A conversion needs order_ref and a non-negative integer amount_cents.");
  const r = await db.prepare(
    `INSERT INTO referral_conversions (id, code, business_key, order_ref, customer_ref, amount_cents, occurred_at, recorded_at)
     VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(order_ref) DO NOTHING`,
  ).bind(newId("rfc"), code, partner.business_key, c.order_ref, c.customer_ref ?? null, c.amount_cents, c.occurred_at ?? now, now).run();
  return { recorded: (r.meta?.changes ?? 0) > 0, business_key: partner.business_key };
}

/** "2026-10" for the Chicago month containing `now`, and the month before it. */
export function months(now: number): { current: string; previous: string } {
  const day = chicagoParts(now).day;
  const [y = 1970, m = 1] = day.split("-").map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return { current: `${y}-${String(m).padStart(2, "0")}`, previous: prev };
}

/**
 * The partner's share of one period: 30% of each conversion in that month whose customer's FIRST
 * conversion with this code is less than a year old.
 */
export async function computePeriod(db: D1Database, period: string, now: number) {
  const rows = await db.prepare(
    `SELECT c.*, p.id AS partner_id, p.share_bps FROM referral_conversions c JOIN referral_partners p ON p.code = c.code`,
  ).all<any>();
  const firstSeen = new Map<string, number>();
  for (const r of rows.results ?? []) {
    const k = `${r.code}|${r.customer_ref ?? r.order_ref}`;
    firstSeen.set(k, Math.min(firstSeen.get(k) ?? Infinity, r.occurred_at));
  }
  const byPartner = new Map<string, { cents: number; n: number }>();
  for (const r of rows.results ?? []) {
    if (months(r.occurred_at).current !== period) continue;
    const first = firstSeen.get(`${r.code}|${r.customer_ref ?? r.order_ref}`) ?? r.occurred_at;
    if (r.occurred_at - first >= 365 * DAY_MS) continue;
    const acc = byPartner.get(r.partner_id) ?? { cents: 0, n: 0 };
    acc.cents += Math.floor((r.amount_cents * r.share_bps) / 10_000);
    acc.n += 1;
    byPartner.set(r.partner_id, acc);
  }
  let written = 0;
  for (const [partner, v] of byPartner) {
    const r = await db.prepare(
      `INSERT INTO referral_payouts (id, partner_id, period, amount_cents, conversions, state, created_at)
       VALUES (?,?,?,?,?,'computed',?) ON CONFLICT(partner_id, period) DO NOTHING`,
    ).bind(newId("rpo"), partner, period, v.cents, v.n, now).run();
    written += r.meta?.changes ?? 0;
  }
  return { period, partners: byPartner.size, written };
}

export async function runMonthlyPayouts(env: Env, now: number) {
  const db = env.DB;
  const { previous } = months(now);
  const done = await db.prepare(`SELECT COUNT(*) AS n FROM referral_payouts WHERE period = ?`).bind(previous).first<any>();
  const anyConv = await db.prepare(`SELECT COUNT(*) AS n FROM referral_conversions`).first<any>();
  if ((done?.n ?? 0) > 0 || (anyConv?.n ?? 0) === 0) return { skipped: true, reason: (anyConv?.n ?? 0) === 0 ? "no conversions recorded yet" : `${previous} already computed` };
  const computed = await computePeriod(db, previous, now);
  const surfacedBefore = await db.prepare(`SELECT COUNT(*) AS n FROM referral_payouts WHERE state != 'computed'`).first<any>();
  if (computed.written > 0 && (surfacedBefore?.n ?? 0) === 0) {
    const total = await db.prepare(`SELECT SUM(amount_cents) AS c, COUNT(*) AS n FROM referral_payouts WHERE period = ?`).bind(previous).first<any>();
    const { raiseJudgementCall } = await import("../approvals/raise");
    await raiseJudgementCall(env, {
      title: `First referral payout run: ${previous}`,
      question:
        `Monique computed the first affiliate payouts: ${total?.n ?? 0} partner(s), $${((total?.c ?? 0) / 100).toFixed(2)} in total for ${previous} ` +
        `(30% of each referred customer's first-year revenue). Nothing has been paid; payouts are never sent automatically. ` +
        `Approve to mark this run as reviewed; pay partners from the business account yourself.`,
      resumeKind: "outreach_first_payout",
      employeeId: "emp_relationship",
      lane: "ops",
      risk: "medium",
      resumeDetail: { period: previous },
    }, now);
    await db.prepare(`UPDATE referral_payouts SET state = 'surfaced' WHERE period = ?`).bind(previous).run();
  }
  return computed;
}
