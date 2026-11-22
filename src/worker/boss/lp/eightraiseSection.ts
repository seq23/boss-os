/** Daily ledger copy: the Mac may replace it with a live balance later. */
import { putMorningSection } from "../mail/morningSection";
import type { Env } from "../env";
import { dayIdInZone, OWNER_TIMEZONE } from "../../../shared/boss/timezone";
import { MORNING_SECTIONS } from "../../../shared/boss/mail/morningSections.mjs";
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
  const problems = await putMorningSection(env.DB, { section, job: "eightraise", day: today, obj, now, onceADay: true });
  if (problems.length) return { ran: false, reason: `NAMED STOP [EIGHTRAISE_SECTION_REFUSED] ${problems.join("; ")}` };
  return { ran: true, used };
}
