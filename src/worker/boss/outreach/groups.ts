/**
 * TIME-2-READ GROUPS & INSTITUTIONS, THE WORKER'S HALF (owner, 31 Oct 2026). Monique's duty.
 *
 * The Mac job (scripts/ops/t2r-groups.mjs) researches public pages, asks NeverBounce and makes each
 * group's own 15-day code in time-2-read's code table; it reports each step here. A group reaches the
 * outreach engine (business `time2read_groups`, st@time-2-read.com) only when ALL of these hold, and
 * the engine checks them again before every send (`groupSendGate`):
 *   · its tier is ON in `t2r_group_tiers` (tier 3, schools and districts, is off until Phase 8);
 *   · NeverBounce said "valid";
 *   · its code is live.
 * The rules themselves are src/shared/boss/t2rGroups/rules.mjs.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { logEvent } from "../lib/log";
import { chicagoParts } from "./brakes";
import { randomToken } from "./lists";
import { isSuppressed } from "./suppression";
import { saveBrain } from "../brains/store";
import { setNumber } from "../../../shared/boss/brains/brain.mjs";
import {
  GROUPS_KEY, groupCodeFor, groupProspectProblems, tierOfKind, weeklyLine,
} from "../../../shared/boss/t2rGroups/rules.mjs";

const FREE_MAIL = /^(gmail|googlemail|yahoo|outlook|hotmail|icloud|aol|proton|protonmail)\./;

export interface TierRow { tier: number; label: string; kinds: string; enabled: number; why_off: string | null }

export async function tiers(db: D1Database): Promise<TierRow[]> {
  return (await db.prepare(`SELECT tier, label, kinds, enabled, why_off FROM t2r_group_tiers ORDER BY tier`).all<TierRow>()).results ?? [];
}

async function enabledTiers(db: D1Database): Promise<Set<number>> {
  return new Set((await tiers(db)).filter((t) => t.enabled === 1).map((t) => t.tier));
}

/**
 * THE SETTING THAT FLIPS A TIER (tier 3 waits for Phase 8). Turning one off says why; the gate reads
 * the row before every send, so a flip takes effect on the next tick.
 */
export async function setTier(db: D1Database, tier: number, enabled: boolean, whyOff: string | null, now: number) {
  const r = await db.prepare(`UPDATE t2r_group_tiers SET enabled = ?, why_off = ?, updated_at = ? WHERE tier = ?`)
    .bind(enabled ? 1 : 0, enabled ? null : (whyOff ?? "Turned off."), now, tier).run();
  return { changed: (r.meta.changes ?? 0) > 0 };
}

/** What the research may look for, and whom it must not hand in again. */
export async function plan(db: D1Database) {
  const all = await tiers(db);
  const known = (await db.prepare(`SELECT email_domain FROM t2r_groups UNION SELECT email_domain FROM outreach_prospects`).all<{ email_domain: string }>()).results ?? [];
  const waiting = await db.prepare(`SELECT COUNT(*) AS n FROM t2r_groups WHERE state IN ('found','verified','coded')`).first<{ n: number }>();
  const queued = await db.prepare(`SELECT COUNT(*) AS n FROM outreach_prospects WHERE business_key = ? AND state = 'new'`).bind(GROUPS_KEY).first<{ n: number }>();
  return {
    tiers: all.map((t) => ({ tier: t.tier, label: t.label, kinds: JSON.parse(t.kinds) as string[], enabled: t.enabled === 1, why_off: t.why_off })),
    // Free-mail domains are shared by thousands of groups: never "known", or the research would skip them all.
    known_domains: [...new Set(known.map((k) => k.email_domain.toLowerCase()))].filter((d) => !FREE_MAIL.test(d)),
    waiting: waiting?.n ?? 0,
    queued: queued?.n ?? 0,
  };
}

/** Research rows in. Refused by name: an unfit row, a tier that is off, an address already known or suppressed. */
export async function importGroups(db: D1Database, rows: any[], now: number) {
  const on = await enabledTiers(db);
  const refused: Array<{ email: string; why: string }> = [];
  let recorded = 0;
  for (const r of rows) {
    const email = String(r?.email ?? "").trim().toLowerCase();
    const problems = groupProspectProblems(r);
    if (problems.length) { refused.push({ email, why: problems.join("; ") }); continue; }
    const tier = tierOfKind(r.kind)!;
    if (!on.has(tier)) { refused.push({ email, why: `tier ${tier} is off` }); continue; }
    const domain = email.split("@")[1]!;
    const free = FREE_MAIL.test(domain);
    const seen = await db.prepare(
      `SELECT 1 FROM t2r_groups WHERE email = ? ${free ? "" : "OR email_domain = ?"} UNION ALL SELECT 1 FROM outreach_prospects WHERE email = ? ${free ? "" : "OR email_domain = ?"} LIMIT 1`,
    ).bind(...(free ? [email, email] : [email, domain, email, domain])).first();
    if (seen) { refused.push({ email, why: "already known" }); continue; }
    if (await isSuppressed(db, email)) { refused.push({ email, why: "on the do-not-contact list" }); continue; }
    await db.prepare(
      `INSERT INTO t2r_groups (id, tier, kind, org_name, email, email_domain, region, source_url, found_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(email) DO NOTHING`,
    ).bind(newId("t2g"), tier, String(r.kind).toLowerCase(), String(r.org_name).trim().slice(0, 160), email, domain,
      r.region ? String(r.region).slice(0, 80) : null, String(r.source_url), now, now).run();
    recorded += 1;
  }
  return { recorded, refused };
}

export async function toVerify(db: D1Database, cap = 25): Promise<string[]> {
  const r = await db.prepare(`SELECT email FROM t2r_groups WHERE state = 'found' AND nb_verdict IS NULL ORDER BY found_at LIMIT ?`).bind(cap).all<{ email: string }>();
  return (r.results ?? []).map((x) => x.email);
}

/** NeverBounce's word. Only "valid" goes on; anything else is skipped, for ever. */
export async function recordVerdicts(db: D1Database, verdicts: Array<{ email: string; result: string }>, now: number) {
  let recorded = 0;
  for (const v of verdicts) {
    const valid = v.result === "valid";
    const r = await db.prepare(
      `UPDATE t2r_groups SET nb_verdict = ?, nb_checked_at = ?, state = ?, skip_reason = ?, updated_at = ? WHERE email = ? AND state = 'found'`,
    ).bind(String(v.result), now, valid ? "verified" : "skipped", valid ? null : `NeverBounce said ${v.result}`, now, String(v.email).toLowerCase()).run();
    recorded += r.meta.changes ?? 0;
  }
  return { recorded };
}

/** Verified groups without a working code: each gets its own, kept, so a retry makes the same one. */
export async function codesDue(db: D1Database, now: number, rand: () => number = Math.random) {
  const r = await db.prepare(`SELECT id, org_name, code FROM t2r_groups WHERE state = 'verified' AND code_state != 'live' ORDER BY updated_at LIMIT 20`).all<any>();
  const out: Array<{ id: string; code: string; label: string }> = [];
  for (const g of r.results ?? []) {
    let code = g.code as string | null;
    for (let i = 0; !code && i < 5; i++) {
      const c = groupCodeFor(g.org_name, rand);
      const clash = await db.prepare(`SELECT 1 FROM t2r_groups WHERE code = ?`).bind(c).first();
      if (!clash) {
        code = c;
        await db.prepare(`UPDATE t2r_groups SET code = ?, updated_at = ? WHERE id = ?`).bind(c, now, g.id).run();
      }
    }
    if (code) out.push({ id: g.id, code, label: `Time2Read group: ${String(g.org_name).slice(0, 60)}` });
  }
  return out;
}

/** The code table's answer. `already` means the code existed before this group: not ours, so made again. */
export async function recordCode(db: D1Database, id: string, res: { ok: boolean; already?: boolean; detail?: string }, now: number) {
  if (res.ok && res.already) {
    await db.prepare(`UPDATE t2r_groups SET code = NULL, code_state = 'none', code_detail = 'that code was taken; a new one is made next run', updated_at = ? WHERE id = ?`).bind(now, id).run();
    return { live: false };
  }
  await db.prepare(
    `UPDATE t2r_groups SET code_state = ?, code_detail = ?, state = CASE WHEN ? THEN 'coded' ELSE state END, updated_at = ? WHERE id = ? AND state = 'verified'`,
  ).bind(res.ok ? "live" : "failed", res.detail ?? null, res.ok ? 1 : 0, now, id).run();
  return { live: res.ok };
}

/** How each group's code has done, from time-2-read's access_code_signups view. */
export async function recordUsage(db: D1Database, codes: Array<{ code: string; checkouts_started?: number; signups?: number }>, now: number) {
  let matched = 0;
  for (const c of codes) {
    const r = await db.prepare(`UPDATE t2r_groups SET checkouts_started = ?, signups = ?, usage_read_at = ?, updated_at = ? WHERE code = ?`)
      .bind(Number(c.checkouts_started ?? 0), Number(c.signups ?? 0), now, now, String(c.code).toUpperCase()).run();
    matched += r.meta.changes ?? 0;
  }
  return { matched };
}

/** Coded, valid, tier-on groups become prospects of the outreach engine. Idempotent. */
export async function queueReady(db: D1Database, now: number): Promise<number> {
  const on = await enabledTiers(db);
  const r = await db.prepare(
    `SELECT * FROM t2r_groups WHERE state = 'coded' AND code_state = 'live' AND nb_verdict = 'valid' AND prospect_id IS NULL LIMIT 50`,
  ).all<any>();
  let queued = 0;
  for (const g of r.results ?? []) {
    if (!on.has(g.tier)) continue;
    const id = newId("opr");
    const ins = await db.prepare(
      `INSERT INTO outreach_prospects (id, business_key, email, email_domain, org_name, segment, metro, website, source, source_url,
         mx_verified_at, state, step, unsub_token, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,NULL,'t2r_groups_research',?,?,'new',0,?,?,?) ON CONFLICT(business_key, email) DO NOTHING`,
    ).bind(id, GROUPS_KEY, g.email, g.email_domain, g.org_name, g.kind, g.region ?? "", g.source_url, g.nb_checked_at ?? now, randomToken(), now, now).run();
    const pid = (ins.meta.changes ?? 0) > 0
      ? id
      : (await db.prepare(`SELECT id FROM outreach_prospects WHERE business_key = ? AND email = ?`).bind(GROUPS_KEY, g.email).first<{ id: string }>())?.id ?? null;
    await db.prepare(`UPDATE t2r_groups SET prospect_id = ?, state = 'queued', updated_at = ? WHERE id = ?`).bind(pid, now, g.id).run();
    queued += 1;
  }
  return queued;
}

/**
 * THE LAST CHECK BEFORE A GROUP EMAIL GOES, read fresh every send. A refusal is a reason; a pass
 * carries the group's code for the email.
 */
export async function groupSendGate(db: D1Database, prospectId: string): Promise<{ code: string } | { refuse: string }> {
  const g = await db.prepare(
    `SELECT g.code, g.code_state, g.nb_verdict, g.tier, t.enabled FROM t2r_groups g JOIN t2r_group_tiers t ON t.tier = g.tier WHERE g.prospect_id = ?`,
  ).bind(prospectId).first<any>();
  if (!g) return { refuse: "no group row behind this prospect" };
  if (g.enabled !== 1) return { refuse: `tier ${g.tier} is off` };
  if (g.nb_verdict !== "valid") return { refuse: "NeverBounce has not said valid" };
  if (g.code_state !== "live" || !g.code) return { refuse: "the group's code is not live" };
  return { code: g.code };
}

const HUMAN = `classification NOT IN ('bounce','auto_reply')`;

/** The counts she reads: emailed, replied, in talks, codes in use (null = never read). */
export async function summary(db: D1Database) {
  const emailed = await db.prepare(`SELECT COUNT(*) AS n FROM outreach_prospects WHERE business_key = ? AND step >= 1`).bind(GROUPS_KEY).first<{ n: number }>();
  const replied = await db.prepare(`SELECT COUNT(DISTINCT prospect_id) AS n FROM outreach_replies WHERE business_key = ? AND ${HUMAN}`).bind(GROUPS_KEY).first<{ n: number }>();
  const talks = await db.prepare(`SELECT COUNT(DISTINCT prospect_id) AS n FROM outreach_replies WHERE business_key = ? AND classification = 'interested'`).bind(GROUPS_KEY).first<{ n: number }>();
  const read = await db.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN checkouts_started > 0 THEN 1 ELSE 0 END) AS used FROM t2r_groups WHERE usage_read_at IS NOT NULL`).first<{ n: number; used: number | null }>();
  const found = await db.prepare(`SELECT COUNT(*) AS n FROM t2r_groups`).first<{ n: number }>();
  const codesInUse = (read?.n ?? 0) > 0 ? Number(read?.used ?? 0) : null;
  const out = { found: found?.n ?? 0, emailed: emailed?.n ?? 0, replied: replied?.n ?? 0, in_talks: talks?.n ?? 0, codes_in_use: codesInUse };
  return { ...out, line: weeklyLine({ emailed: out.emailed, replied: out.replied, codesInUse }) };
}

/** Human replies this calendar month (Chicago) to every time-2-read outreach, the affiliate pitch included. */
async function repliesThisMonth(db: D1Database, now: number): Promise<number> {
  const month = chicagoParts(now).day.slice(0, 7);
  const r = await db.prepare(
    `SELECT received_at FROM outreach_replies WHERE business_key IN ('time2read', ?) AND ${HUMAN} AND received_at >= ?`,
  ).bind(GROUPS_KEY, now - 32 * 86_400_000).all<{ received_at: number }>();
  return (r.results ?? []).filter((x) => chicagoParts(x.received_at).day.slice(0, 7) === month).length;
}

export const PIPELINE_METRIC = "Institutional pipeline";
export const REPLIES_METRIC = "Outreach replies";

/**
 * THE SCOREBOARD, FED FROM THIS DUTY. Two rows of the time-2-read brain's Numbers table. A revision
 * is written only when a value changed, so the hourly tick never floods the brain's history.
 */
export async function feedScoreboard(env: Env, now: number): Promise<{ changed: boolean }> {
  const brain = await env.DB.prepare(`SELECT body_md FROM brains WHERE slug = 'time-2-read'`).first<{ body_md: string }>();
  if (!brain) return { changed: false };
  const s = await summary(env.DB);
  const day = chicagoParts(now).day;
  const pipeline = `${s.in_talks} in talks · ${s.emailed} groups emailed · ${s.codes_in_use === null ? "codes not read yet" : `${s.codes_in_use} codes in use`}`;
  const replies = String(await repliesThisMonth(env.DB, now));
  const source = "Boss OS: Monique's Time-2-Read groups duty";
  const sameValue = (md: string, metric: string, v: string) => new RegExp(`^\\|\\s*${metric}\\s*\\|[^\\n]*\\|\\s*${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|[^|\\n]*\\|\\s*$`, "mi").test(md);
  if (sameValue(brain.body_md, PIPELINE_METRIC, pipeline) && sameValue(brain.body_md, REPLIES_METRIC, replies)) return { changed: false };
  let md = setNumber(brain.body_md, PIPELINE_METRIC, pipeline, day, {
    definition: "Groups and institutions in talks (a real reply with interest), groups emailed, and group codes in use", source,
  });
  md = setNumber(md, REPLIES_METRIC, replies, day, { definition: "Human replies to Monique's outreach from st@time-2-read.com this month", source });
  await saveBrain(env, "time-2-read", md, "emp_relationship", "Time-2-Read groups duty: scoreboard numbers", now);
  await logEvent(env.DB, { level: "info", scope: "outreach", event: "t2r_scoreboard", detail: { pipeline, replies } }).catch(() => {});
  return { changed: true };
}
