import type { Env } from "../env";
import { newId } from "../lib/id";
import { logEvent } from "../lib/log";
import { dayIdInZone, weekIdInZone } from "@shared/boss/timezone";

/**
 * WRITING THE EXECUTIVE INTELLIGENCE REPORT, WHICH NOTHING ANYWHERE USED TO DO.
 *
 * The table has existed since migration 0176. `today.ts` reads it on every page load. The duty
 * fires at 06:30 Central. And `grep -rl "INSERT INTO executive_reports" src/worker/boss` returned
 * nothing at all — there was no writer, so the Executive Briefing block on Today had rendered its
 * "no report yet" state every morning since the table was created, exactly as designed, for ever.
 *
 * WHY IT LANDS ON `/backends/report` RATHER THAN AN ENDPOINT OF ITS OWN. That path is already
 * authenticated for the device, already the only way a run finishes, and already carries the
 * runner's evidence. A second endpoint would be a second contract to keep in step with the first,
 * which is the failure this codebase has now hit twice in one morning.
 *
 * THE REPORT IS WRITTEN IMMEDIATELY AND THE APPROVAL IS STILL RAISED. Those are different
 * questions and collapsing them breaks one of them. The approval is about the RUN — what the
 * backend did on her machine, whether it touched anything it should not have. The report is a
 * document that was researched and delivered. Gating the reading of it behind an approval would
 * mean opening Boss OS at 7am to a decision instead of a report, which is the entire thing the duty
 * exists to prevent. Nothing about the run's proposal contract is weakened: it still ends as a
 * proposal, and this writes alongside it.
 *
 * A PARTIAL REPORT IS A REAL OUTCOME. The owner's instruction for this duty is explicit: "on
 * failure just say so and name the gaps". A report that refuses to appear teaches her to stop
 * looking at 7am; one that names what is missing keeps the habit and stays honest. So `status`
 * carries partial and failed as first-class values and a failed run still writes a row.
 */

export interface DeliveredReport {
  status?: unknown;
  summary?: unknown;
  sections?: unknown;
  gaps?: unknown;
  sources?: unknown;
  corrections?: unknown;
  day_id?: unknown;
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asText = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Turn one reported run into the day's report row, when the task it came from was contracted to
 * deliver one.
 *
 * Returns the row id, or null when this run delivers nothing — which is the ordinary case for every
 * other kind of backend work and must not be treated as an error.
 */
/**
 * The brokerage sourcing list, delivered the same way the report is.
 *
 * WHY IT SHARES THE PATH. One delivery contract, one place a run's structured output lands, one
 * `input.delivers` key deciding which table it is for. A second endpoint or a second convention
 * would be the drift that has already bitten this codebase twice in one day.
 *
 * NOTHING IS PROMOTED AUTOMATICALLY. Every row lands as `new` and stays there until she reviews it.
 * A web-found firm silently becoming a "relationship" would put a stranger into the daily touch
 * list and make the system lie about who she knows.
 *
 * A CANDIDATE WITHOUT A SOURCE IS DROPPED, and that is the load-bearing rule: the whole failure mode
 * of automated sourcing is a plausible name nobody can check, and checking one costs her a phone
 * call. The run is told this and it is enforced here as well, because being told is not a guarantee.
 */
export async function deliverSourcingCandidates(
  env: Env,
  args: { taskId: string; runId: string; payload: Record<string, unknown> | null; runStatus: string; now?: number },
): Promise<{ inserted: number; skipped: number } | null> {
  const now = args.now ?? Date.now();

  const task = await env.DB
    .prepare(`SELECT id, input FROM tasks WHERE id = ?`).bind(args.taskId)
    .first<{ id: string; input: string | null }>();
  if (!task) return null;

  let input: Record<string, unknown> = {};
  try { input = task.input ? (JSON.parse(task.input) as Record<string, unknown>) : {}; } catch { input = {}; }
  if (input.delivers !== "sourcing_candidates") return null;
  if (args.runStatus !== "succeeded") return { inserted: 0, skipped: 0 };

  const rows = Array.isArray(args.payload?.candidates) ? (args.payload!.candidates as Record<string, unknown>[]) : [];
  let inserted = 0;
  let skipped = 0;

  for (const c of rows) {
    const name = typeof c?.name === "string" ? c.name.trim() : "";
    const sourceUrl = typeof c?.source_url === "string" ? c.source_url.trim() : "";
    // No name, or no source that can be checked, means it does not enter the list at all.
    if (!name || !sourceUrl) { skipped++; continue; }

    const readAt = typeof c?.read_at === "string" ? Date.parse(c.read_at) : NaN;
    const floor = Number(c?.ticket_floor_usd);

    await env.DB
      .prepare(
        `INSERT INTO sourcing_candidates
           (id, name, kind, ticket_floor_usd, thesis, source_url, source_name, read_at, origin, status, run_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,'public_research','new',?,?,?)
         ON CONFLICT(name, kind) DO UPDATE SET
           thesis = excluded.thesis,
           source_url = excluded.source_url,
           source_name = excluded.source_name,
           read_at = excluded.read_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        newId("src"), name,
        typeof c?.kind === "string" && ["buyer", "seller", "intermediary"].includes(c.kind) ? c.kind : "buyer",
        Number.isFinite(floor) ? Math.floor(floor) : null,
        typeof c?.thesis === "string" ? c.thesis : null,
        sourceUrl,
        typeof c?.source_name === "string" ? c.source_name : null,
        Number.isFinite(readAt) ? readAt : null,
        args.runId, now, now,
      )
      .run();
    inserted++;
  }

  await logEvent(env.DB, {
    level: "info", scope: "duties", event: "sourcing_delivered", entityId: args.taskId,
    detail: { inserted, skipped, run_id: args.runId },
  });

  return { inserted, skipped };
}

/**
 * Prospects and practice, delivered the same way everything else is.
 *
 * ONE CONTRACT, NOT FOUR. `input.delivers` names the table; a run's `delivers.json` carries the
 * payload; this decides where it lands. A second convention per duty is the drift that has already
 * cost this codebase two separate days.
 *
 * A PROSPECT WITHOUT A URL IS DROPPED, for the identical reason a buyer without a source is: the
 * failure mode of automated prospecting is a plausible-sounding page that costs her an hour to
 * discover is dead. The run is told; being told is not a guarantee.
 */
export async function deliverLinkProspects(
  env: Env,
  args: { taskId: string; runId: string; payload: Record<string, unknown> | null; runStatus: string; now?: number },
): Promise<{ inserted: number; skipped: number } | null> {
  const now = args.now ?? Date.now();
  const task = await env.DB.prepare(`SELECT id, input FROM tasks WHERE id = ?`).bind(args.taskId)
    .first<{ id: string; input: string | null }>();
  if (!task) return null;

  let input: Record<string, unknown> = {};
  try { input = task.input ? (JSON.parse(task.input) as Record<string, unknown>) : {}; } catch { input = {}; }
  if (input.delivers !== "link_prospects") return null;
  if (args.runStatus !== "succeeded") return { inserted: 0, skipped: 0 };

  const rows = Array.isArray(args.payload?.prospects) ? (args.payload!.prospects as Record<string, unknown>[]) : [];
  let inserted = 0;
  let skipped = 0;
  const KINDS = ["resource_page", "directory", "unlinked_mention", "guest_post", "profile", "other"];

  for (const p of rows) {
    const url = typeof p?.url === "string" ? p.url.trim() : "";
    const property = typeof p?.property === "string" ? p.property.trim() : "";
    if (!url || !property) { skipped++; continue; }

    await env.DB.prepare(
      `INSERT INTO link_prospects
         (id, property, url, site_name, kind, rationale, approach, authority_note, status, run_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?, 'new', ?,?,?)
       ON CONFLICT(property, url) DO UPDATE SET
         rationale = excluded.rationale,
         approach = excluded.approach,
         authority_note = excluded.authority_note,
         updated_at = excluded.updated_at`,
    ).bind(
      newId("lnk"), property, url,
      typeof p?.site_name === "string" ? p.site_name : null,
      typeof p?.kind === "string" && KINDS.includes(p.kind) ? p.kind : "other",
      typeof p?.rationale === "string" ? p.rationale : null,
      typeof p?.approach === "string" ? p.approach : null,
      // Never estimated on this side either: absent stays absent.
      typeof p?.authority_note === "string" ? p.authority_note : null,
      args.runId, now, now,
    ).run();
    inserted++;
  }

  await logEvent(env.DB, {
    level: "info", scope: "duties", event: "link_prospects_delivered", entityId: args.taskId,
    detail: { inserted, skipped, run_id: args.runId },
  });
  return { inserted, skipped };
}

/**
 * Kendra's tool suggestions.
 *
 * THE VENDOR CANNOT BE THE EVIDENCE, and that is enforced here rather than only requested. A row
 * whose `evidence_url` shares a host with the product's own URL is stored with its evidence
 * stripped and its verdict marked unproven — because a suggestion sourced from marketing copy is a
 * repost, and the owner's whole question was "I don't know if it's good."
 */
export async function deliverToolSuggestions(
  env: Env,
  args: { taskId: string; runId: string; payload: Record<string, unknown> | null; runStatus: string; now?: number },
): Promise<{ inserted: number; skipped: number; unproven: number } | null> {
  const now = args.now ?? Date.now();
  const task = await env.DB.prepare(`SELECT id, input FROM tasks WHERE id = ?`).bind(args.taskId)
    .first<{ id: string; input: string | null }>();
  if (!task) return null;

  let input: Record<string, unknown> = {};
  try { input = task.input ? (JSON.parse(task.input) as Record<string, unknown>) : {}; } catch { input = {}; }
  if (input.delivers !== "tool_suggestions") return null;
  if (args.runStatus !== "succeeded") return { inserted: 0, skipped: 0, unproven: 0 };

  const rows = Array.isArray(args.payload?.tools) ? (args.payload!.tools as Record<string, unknown>[]) : [];
  const SERVES = ["brokerage", "west_peek", "ads", "saas", "digital_products", "youtube", "practice", "ops"];
  let inserted = 0;
  let skipped = 0;
  let unproven = 0;

  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };

  for (const t of rows) {
    const name = typeof t?.name === "string" ? t.name.trim() : "";
    const url = typeof t?.url === "string" ? t.url.trim() : "";
    const what = typeof t?.what_it_does === "string" ? t.what_it_does.trim() : "";
    if (!name || !url || !what) { skipped++; continue; }

    let evidence = typeof t?.evidence === "string" ? t.evidence : null;
    let evidenceUrl = typeof t?.evidence_url === "string" ? t.evidence_url : null;
    let verdict = typeof t?.verdict === "string" ? t.verdict : null;

    // Same host as the product, or no evidence at all: the verdict is unproven and says so.
    const selfSourced = Boolean(evidenceUrl && host(evidenceUrl) && host(evidenceUrl) === host(url));
    if (selfSourced || !evidenceUrl) {
      unproven++;
      evidence = selfSourced ? "The only source found was the vendor's own site." : evidence ?? "No independent source found.";
      evidenceUrl = null;
      verdict = `UNPROVEN — ${verdict ?? "no independent evidence found"}.`;
    }

    await env.DB.prepare(
      `INSERT INTO tool_suggestions
         (id, name, url, serves, what_it_does, price_note, free_tier, instead_of, verdict, evidence, evidence_url, status, run_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, 'new', ?,?,?)
       ON CONFLICT(url) DO UPDATE SET
         verdict = excluded.verdict, evidence = excluded.evidence, evidence_url = excluded.evidence_url,
         price_note = excluded.price_note, instead_of = excluded.instead_of, updated_at = excluded.updated_at`,
    ).bind(
      newId("tol"), name, url,
      typeof t?.serves === "string" && SERVES.includes(t.serves) ? t.serves : "ops",
      what,
      // Never defaulted to a number: a hidden price stays hidden.
      typeof t?.price_note === "string" ? t.price_note : null,
      t?.free_tier === true ? 1 : 0,
      typeof t?.instead_of === "string" ? t.instead_of : null,
      verdict, evidence, evidenceUrl, args.runId, now, now,
    ).run();
    inserted++;
  }

  await logEvent(env.DB, {
    level: "info", scope: "duties", event: "tools_delivered", entityId: args.taskId,
    detail: { inserted, skipped, unproven, run_id: args.runId },
  });
  return { inserted, skipped, unproven };
}

/**
 * Imani's week of practice — the fifth delivery, and the one that had nowhere to land.
 *
 * WHAT THIS FIXES. `duty_practice_week` has declared `delivers: 'practice_week'` since 0192 and
 * nothing here handled that key. The duty fired every Sunday at 17:00 Central, spent its ~$0.15,
 * wrote its `delivers.json`, and the payload was dropped on the floor with no error anywhere —
 * `input.delivers` simply matched none of the four handlers and every one of them returned null,
 * which is the ordinary and correct answer for a run that delivers something else. Succeeding at
 * the wrong thing, again. `0202`'s validator is the guard that makes this class of gap loud.
 *
 * IT FOLLOWS THE REPORT, NOT THE LISTS. Sourcing, prospects and tools deliver MANY rows and each
 * one is a candidate she reviews. The practice week is ONE document for one week, with a status and
 * named gaps — structurally the executive report on a weekly clock — so it upserts a single row and
 * borrows the report's honesty rules rather than inventing a third convention.
 *
 * A FAILED RUN STILL WRITES A ROW, for the reason the report gives: the difference between "the
 * week's practice has not been prepared" and "nothing has ever run" is the whole value of the block,
 * and it costs one row to say.
 *
 * "complete" WITH GAPS IS DOWNGRADED, identically to the report. 0192's prompt tells the run an
 * honest short week is fine; a run that names what it could not source and then calls itself
 * complete has redefined the word rather than done the work.
 */
export async function deliverPracticeWeek(
  env: Env,
  args: { taskId: string; runId: string; payload: Record<string, unknown> | null; runStatus: string; now?: number },
): Promise<string | null> {
  const now = args.now ?? Date.now();

  const task = await env.DB.prepare(`SELECT id, input FROM tasks WHERE id = ?`).bind(args.taskId)
    .first<{ id: string; input: string | null }>();
  if (!task) return null;

  let input: Record<string, unknown> = {};
  try { input = task.input ? (JSON.parse(task.input) as Record<string, unknown>) : {}; } catch { input = {}; }
  if (input.delivers !== "practice_week") return null;

  /*
   * THE WEEK IT IS FOR, IN HER ZONE. Sunday is the last day of an ISO week: the scheduled 17:00
   * Central run is 22:00 UTC and still Sunday, but any retry past 19:00 Central is already Monday
   * in UTC and therefore the NEXT week — so a re-run after a bad Sunday would file the week-ahead
   * brief under the week that just ended, with a plausible-looking number. The runner may name the
   * week explicitly; otherwise it is computed in Central.
   */
  const forWeek = asText(args.payload?.week_id) ?? weekIdInZone(now);

  const reported = asText(args.payload?.status);
  const status =
    args.runStatus !== "succeeded" ? "failed"
    : reported === "complete" || reported === "partial" || reported === "failed" ? reported
    // Succeeded and named no status: it delivered SOMETHING, and calling that complete would be a
    // claim the runner never made. Partial is the honest floor.
    : "partial";

  const gaps = asArray(args.payload?.gaps);
  const honest = status === "complete" && gaps.length > 0 ? "partial" : status;

  /*
   * RITUALS ARE ALLOWED TO BE EMPTY AND THAT IS NOT A FAILURE. Most weeks hold no new or full moon.
   * 0192's prompt is explicit that inventing an occasion is how this becomes noise, so an empty
   * array is stored as an empty array and the screen says the sky offered nothing this week.
   */
  const rituals = asArray(args.payload?.rituals);
  const practice = args.payload?.practice && typeof args.payload.practice === "object" ? args.payload.practice : null;
  const body = args.payload?.body && typeof args.payload.body === "object" ? args.payload.body : null;

  const id = newId("prw");

  await env.DB
    .prepare(
      `INSERT INTO practice_week
         (id, week_id, generated_at, task_id, backend_run_id, status, rituals, practice, body, gaps)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(week_id) DO UPDATE SET
         generated_at = excluded.generated_at,
         task_id = excluded.task_id,
         backend_run_id = excluded.backend_run_id,
         status = excluded.status,
         rituals = excluded.rituals,
         practice = excluded.practice,
         body = excluded.body,
         gaps = excluded.gaps`,
    )
    .bind(
      id, forWeek, now, args.taskId, args.runId, honest,
      JSON.stringify(rituals),
      practice ? JSON.stringify(practice) : null,
      body ? JSON.stringify(body) : null,
      JSON.stringify(gaps),
    )
    .run();

  await logEvent(env.DB, {
    level: honest === "failed" ? "warn" : "info",
    scope: "duties", event: "practice_week_delivered", entityId: args.taskId,
    detail: { week_id: forWeek, status: honest, rituals: rituals.length, gaps: gaps.length, run_id: args.runId },
  });

  return id;
}

export async function deliverExecutiveReport(
  env: Env,
  args: { taskId: string; runId: string; report: DeliveredReport | null; runStatus: string; now?: number },
): Promise<string | null> {
  const now = args.now ?? Date.now();

  const task = await env.DB
    .prepare(`SELECT id, input FROM tasks WHERE id = ?`).bind(args.taskId)
    .first<{ id: string; input: string | null }>();
  if (!task) return null;

  let input: Record<string, unknown> = {};
  try { input = task.input ? (JSON.parse(task.input) as Record<string, unknown>) : {}; } catch { input = {}; }
  if (input.delivers !== "executive_reports") return null;

  /*
   * THE DAY IT IS FOR, IN HER ZONE, NOT THE DAY IT WAS WRITTEN. A report generated at 06:30 for the
   * 7th belongs to the 7th even if a retry writes it at 09:00 — and 06:30 Central is already the
   * next day in UTC for half the year, which is precisely how a report would silently file itself
   * under tomorrow. The runner may name the day explicitly; otherwise this computes it in Central.
   */
  const forDay = asText(args.report?.day_id) ?? dayIdInZone(now);

  /*
   * A RUN THAT FAILED STILL WRITES A ROW. The block on Today can then say when the last good report
   * was, rather than rendering an unexplained blank that looks identical to "nothing ran".
   */
  const reported = asText(args.report?.status);
  const status =
    args.runStatus !== "succeeded" ? "failed"
    : reported === "complete" || reported === "partial" || reported === "failed" ? reported
    // A run that succeeded and named no status delivered SOMETHING, and calling that complete would
    // be a claim the runner never made. Partial is the honest floor.
    : "partial";

  const gaps = asArray(args.report?.gaps);
  const sections = asArray(args.report?.sections);

  /*
   * SAYING "complete" WITH GAPS IS NOT ALLOWED. The spec's success criterion is that anything
   * unverified is listed as a gap rather than omitted, and a report that lists gaps and calls
   * itself complete has quietly redefined the word. Downgraded here rather than trusted.
   */
  const honest = status === "complete" && gaps.length > 0 ? "partial" : status;

  const summary =
    asText(args.report?.summary) ??
    (honest === "failed"
      ? "The research run did not produce a usable report. Nothing here is a finding."
      : null);

  const id = newId("xrp");

  /*
   * ONE ROW PER DAY, REPLACED RATHER THAN DUPLICATED. `idx_report_day` is unique on `day_id`, so a
   * retry after a partial morning overwrites it with the better answer instead of failing the whole
   * report path on a constraint the caller cannot see.
   */
  await env.DB
    .prepare(
      `INSERT INTO executive_reports
         (id, day_id, generated_at, task_id, backend_run_id, status, summary, sections, gaps, sources, corrections)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(day_id) DO UPDATE SET
         generated_at = excluded.generated_at,
         task_id = excluded.task_id,
         backend_run_id = excluded.backend_run_id,
         status = excluded.status,
         summary = excluded.summary,
         sections = excluded.sections,
         gaps = excluded.gaps,
         sources = excluded.sources,
         corrections = excluded.corrections`,
    )
    .bind(
      id, forDay, now, args.taskId, args.runId, honest, summary,
      JSON.stringify(sections),
      JSON.stringify(gaps),
      JSON.stringify(asArray(args.report?.sources)),
      JSON.stringify(asArray(args.report?.corrections)),
    )
    .run();

  await logEvent(env.DB, {
    level: honest === "failed" ? "warn" : "info",
    scope: "duties", event: "executive_report_delivered", entityId: args.taskId,
    detail: { day_id: forDay, status: honest, sections: sections.length, gaps: gaps.length, run_id: args.runId },
  });

  return id;
}
