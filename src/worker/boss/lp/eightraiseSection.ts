/** Daily ledger copy: the Mac may replace it with a live balance later. */
import type { Env } from "../env";
import { dayIdInZone, OWNER_TIMEZONE } from "../../../shared/boss/timezone";
import { MORNING_SECTIONS, morningSectionProblems } from "../../../shared/boss/mail/morningSections.mjs";
import { EIGHTRAISE_BUDGET, MONIQUE_MONTHLY, eightRaiseFooter, monthOf, monthSpent, type LedgerRow } from "../../../shared/boss/lp/plan.mjs";

export async function runEightraiseDaily(env: Env, now = Date.now()) {
  const section = "eightraise";
  if (!MORNING_SECTIONS.includes(section)) return { ran: false, reason: "NAMED STOP [EIGHTRAISE_SECTION_UNREGISTERED]" };
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: OWNER_TIMEZONE, hour: "numeric", hourCycle: "h23" }).format(new Date(now)));
  if (hour < 5) return { ran: false, reason: "before 05:00 Central" };
  const today = dayIdInZone(now);
  const prev = await env.DB.prepare(`SELECT day, job FROM morning_sections WHERE section = ?`).bind(section).first<{ day: string; job: string }>();
  // Preserve a Mac's more complete copy too: later ticks must not erase its live balance.
  if (prev?.day === today) return { ran: false, reason: "already written today" };
  const month = monthOf(now);
  const { results } = await env.DB.prepare(`SELECT month, purpose, credits FROM eightraise_ledger WHERE month = ?`).bind(month).all<LedgerRow>();
  const used = monthSpent(results ?? [], month);
  const obj = { section, at: new Date(now).toISOString(), decide: [], rows: [], lines: [eightRaiseFooter(used)], credits: { used, budget: MONIQUE_MONTHLY, kept: EIGHTRAISE_BUDGET.floor } };
  const problems = morningSectionProblems(obj);
  if (problems.length) return { ran: false, reason: `NAMED STOP [EIGHTRAISE_SECTION_REFUSED] ${problems.join("; ")}` };
  await env.DB.prepare(
    `INSERT INTO morning_sections (section, job, day, body, status, told_at, created_at, updated_at) VALUES (?,?,?,?,'fresh',NULL,?,?)
     ON CONFLICT(section) DO UPDATE SET job = excluded.job, day = excluded.day, body = excluded.body, status = 'fresh', told_at = NULL, updated_at = excluded.updated_at WHERE morning_sections.day != excluded.day`,
  ).bind(section, "eightraise", today, JSON.stringify(obj), now, now).run();
  return { ran: true, used };
}
