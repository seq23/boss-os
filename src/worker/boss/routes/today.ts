import { Hono, type Context } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import {
  MAX_TURNS, EXIT_PHRASES, FORWARDED_TURNS, isExit, consentFor, grantConsent, revokeConsent,
  setDayMode, buildCoachingPrompt,
} from "../coaching/session";
import { assertMayReachExternalModel } from "../policy/airlock";
import { runCoachingTurn } from "../coaching/run";
import { WIRING_BY_BACKEND } from "../router/backends";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { runPromotionSweep } from "./memory";
import { applyLoopActionToFollowUp, surfaceOverdueFollowUps } from "../relationships/follow_ups";
import { spiritSignal } from "../spirit/day";

export const today = new Hono<{ Bindings: Env; Variables: Vars }>();

const DAY_MS = 86_400_000;

/**
 * Canon §5 Cognitive Load Budget. These are not style preferences; a gate that
 * accepts a fourth priority has stopped being a gate.
 */
export const MAX_MORNING_PRIORITIES = 3;
export const MAX_MIDDAY_CHECKS = 3;
export const MAX_NIGHT_REVIEW_PROMPTS = 3;

/**
 * Canon §15 lists Today's contents exactly. Thirteen elements, in this order,
 * and the build plan is explicit that Phase 11 adds no fourteenth. The order
 * here is the order the briefing reads in.
 */
export const TODAY_BLOCKS = [
  { key: "todays_contract", title: "Today's Contract", source: "manual" },
  { key: "executive_briefing", title: "Executive Briefing", source: "tasks" },
  { key: "day_flow", title: "Day Flow", source: "manual" },
  { key: "meetings", title: "Meetings", source: "calendar" },
  { key: "open_loops", title: "Open Loops", source: "manual" },
  { key: "critical_alerts", title: "Critical Alerts", source: "tasks" },
  { key: "spirit_signal", title: "Spirit Signal", source: "spirit" },
  { key: "coaching_focus", title: "Coaching Focus", source: "coaching" },
  { key: "daily_thinking_lens", title: "Daily Thinking Lens", source: "coaching" },
  { key: "approval_inbox", title: "Approval Inbox", source: "approvals" },
  { key: "employee_status", title: "AI Employee Status", source: "tasks" },
  { key: "continuity_status", title: "Continuity Status", source: "memory" },
  { key: "trading_status", title: "Trading Status", source: "trading" },
] as const;

export type BlockKey = (typeof TODAY_BLOCKS)[number]["key"];

/**
 * Some of the thirteen elements have no substrate in the schema yet: their
 * tables arrive in later phases. Canon still requires the element, so the block
 * is rendered and persisted with its absence stated. An absent input is
 * recorded as absent — never defaulted to a guess, and never dressed up as
 * data that does not exist.
 *
 * Meetings left this list in Phase 13, when it got real tables to read.
 */
const AWAITING_SUBSTRATE: Partial<Record<BlockKey, { phase: number; reason: string }>> = {
  coaching_focus: {
    phase: 12,
    reason: "No coaching faculty exists yet. The daily panel lands in Phase 12.",
  },
  daily_thinking_lens: {
    phase: 12,
    reason: "No mental model library exists yet. The daily lens lands in Phase 12.",
  },
};

// ─── Day identity ─────────────────────────────────────────────────────────────

/** Epoch ms at 00:00 UTC of the day containing `ts`. */
export function dayStart(ts: number): number {
  return Math.floor(ts / DAY_MS) * DAY_MS;
}

/** `YYYY-MM-DD` in UTC. The primary key of `days`. */
export function dayId(ts: number): string {
  return new Date(dayStart(ts)).toISOString().slice(0, 10);
}

function parseDayId(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}

export interface DayRow {
  id: string;
  date_ts: number;
  created_at: number;
  morning_completed_at: number | null;
  morning_priorities: string | null;
  morning_state: string | null;
  morning_agenda: string | null;
  morning_contract: string | null;
  midday_completed_at: number | null;
  midday_checks: string | null;
  midday_adjustments: string | null;
  night_completed_at: number | null;
  night_attention: string | null;
  night_promotions: string | null;
  night_evidence: string | null;
  night_tomorrow_seed: string | null;
  day_flow_json: string | null;
  open_loops_count: number;
  gate_entries_count: number;
}

/**
 * A day row is created on first sight of the day, by whichever request or cron
 * run notices first — the same rule the budget windows already follow.
 */
export async function ensureDay(db: D1Database, id: string): Promise<DayRow> {
  const dateTs = parseDayId(id);
  if (dateTs === null) throw badRequest("A day is identified as YYYY-MM-DD in UTC", `Received "${id}"`);

  await db
    .prepare(`INSERT INTO days (id, date_ts, created_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING`)
    .bind(id, dateTs, Date.now())
    .run();

  const row = await db.prepare(`SELECT * FROM days WHERE id = ?`).bind(id).first<DayRow>();
  if (!row) throw notFound("The day could not be read back after being created");
  return row;
}

function json<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ─── Block assembly ───────────────────────────────────────────────────────────

/** One meeting as the Meetings block reads it: the room, the tie, and what is prepared. */
interface MeetingBlockRow {
  id: string;
  title: string;
  purpose: string | null;
  scheduled_at: number;
  duration_min: number | null;
  location: string | null;
  status: string;
  person_id: string;
  full_name: string;
  organization_name: string | null;
  brief_id: string | null;
  briefed_at: number | null;
  capture_id: string | null;
  captured_at: number | null;
  relationship_health: number | null;
  trust_level: number | null;
  strategic_importance: number | null;
}

interface Block {
  key: BlockKey;
  title: string;
  order: number;
  content: unknown;
  source_type: string;
  source_id: string | null;
  is_empty: boolean;
}

/**
 * Reads the real state of every subsystem that already exists and renders the
 * thirteen canon elements from it. This function decides nothing: canon §15
 * says what Today contains, Phase 12 decides what belongs in it. What happens
 * here is rendering and persistence, from live tables only.
 */
/**
 * Read a JSON column without letting a bad row take the screen down.
 *
 * These are TEXT columns written by a research run. A malformed value is a reason to render the
 * rest of the day, not to throw inside the assembler that builds every block — the failure mode
 * this repo already met once, where one endpoint's unexpected shape unmounted the whole app.
 */
function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export async function assembleDayFlow(env: Env, day: DayRow): Promise<Block[]> {
  /*
   * Today's report, and the last good one.
   *
   * Both, in one pass: the block must be able to say "no report today, the last was Tuesday"
   * rather than rendering an unexplained blank, and that sentence needs the second row. A report is
   * keyed to the day it is FOR, not the day it was written, so a retry at 09:00 still fills the
   * 06:30 slot rather than creating a second Tuesday.
   */
  const [report, lastReport] = await Promise.all([
    env.DB
      .prepare(`SELECT * FROM executive_reports WHERE day_id = ? LIMIT 1`)
      .bind(day.id)
      .first<any>(),
    env.DB
      .prepare(`SELECT generated_at FROM executive_reports WHERE status != 'failed' ORDER BY generated_at DESC LIMIT 1`)
      .first<{ generated_at: number }>(),
  ]);

  const db = env.DB;
  const now = Date.now();
  const from = day.date_ts;
  const to = day.date_ts + DAY_MS;

  /*
   * Canon §40: an overdue follow-up is an open loop. This runs before the loops
   * are read, so a commitment that came due since the screen was last opened is
   * on the screen now rather than at the next cron tick.
   *
   * A day in the future never takes them. A follow-up is surfaced once, so
   * looking ahead at tomorrow would otherwise move today's overdue commitments
   * onto a day that has not happened — and off the screen the Boss is on.
   */
  if (day.date_ts <= dayStart(now)) {
    await surfaceOverdueFollowUps(db, day.id, Math.min(now, to - 1), now);
  }

  const [
    taskCounts,
    openTasks,
    todaysTasks,
    approvalsByRisk,
    oldestApproval,
    expiringApprovals,
    employeeCounts,
    busiestEmployees,
    spend,
    captures,
    proposedPromotions,
    lastSnapshot,
    lastCron,
    openDeadLetters,
    errorEvents,
    tradingAuthority,
    openPositions,
    liveOrders,
    openIncidents,
    loops,
    todaysMeetings,
    heldNotCaptured,
    overdueFollowUps,
    dueTouches,
    spirit,
  ] = await Promise.all([
    db.prepare(`SELECT status, COUNT(*) AS n FROM tasks GROUP BY status`).all<{ status: string; n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE status IN ('queued','running','awaiting_approval')`)
      .first<{ n: number }>(),
    db.prepare(`SELECT status, COUNT(*) AS n FROM tasks WHERE created_at >= ? AND created_at < ? GROUP BY status`)
      .bind(from, to).all<{ status: string; n: number }>(),
    db.prepare(`SELECT risk, COUNT(*) AS n FROM approvals WHERE status = 'pending' GROUP BY risk`)
      .all<{ risk: string; n: number }>(),
    db.prepare(`SELECT id, title, risk, requested_at FROM approvals WHERE status = 'pending' ORDER BY requested_at ASC LIMIT 1`)
      .first<{ id: string; title: string; risk: string; requested_at: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?`)
      .bind(now + DAY_MS).first<{ n: number }>(),
    db.prepare(`SELECT status, COUNT(*) AS n FROM employees GROUP BY status`).all<{ status: string; n: number }>(),
    db.prepare(
      `SELECT e.id, e.name, e.role, e.lane, COUNT(t.id) AS open_tasks
         FROM employees e
         LEFT JOIN tasks t ON t.employee_id = e.id AND t.status IN ('queued','running','awaiting_approval')
        WHERE e.status = 'active'
        GROUP BY e.id
        ORDER BY open_tasks DESC, e.name ASC
        LIMIT 5`,
    ).all<{ id: string; name: string; role: string; lane: string; open_tasks: number }>(),
    db.prepare(`SELECT COALESCE(SUM(cost_micros),0) AS micros FROM usage_ledger WHERE ts >= ? AND ts < ?`)
      .bind(from, to).first<{ micros: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM memory_items WHERE created_at >= ? AND created_at < ?`)
      .bind(from, to).first<{ n: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS n FROM promotion_events p
        WHERE p.outcome = 'proposed'
          AND EXISTS (SELECT 1 FROM approvals a WHERE a.id = p.approval_id AND a.status = 'pending')`,
    ).first<{ n: number }>(),
    db.prepare(`SELECT id, ts, label, status, bytes FROM vault_snapshots ORDER BY ts DESC LIMIT 1`)
      .first<{ id: string; ts: number; label: string; status: string; bytes: number }>(),
    db.prepare(`SELECT id, started_at, finished_at, status FROM cron_runs ORDER BY started_at DESC LIMIT 1`)
      .first<{ id: string; started_at: number; finished_at: number | null; status: string }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM dead_letters WHERE status = 'open'`).first<{ n: number }>(),
    db.prepare(`SELECT id, ts, scope, event FROM system_events WHERE level = 'error' AND ts >= ? ORDER BY ts DESC LIMIT 5`)
      .bind(now - DAY_MS).all<{ id: string; ts: number; scope: string; event: string }>(),
    db.prepare(`SELECT live_enabled, kill_switch, max_open_positions FROM trading_authority LIMIT 1`)
      .first<{ live_enabled: number; kill_switch: number; max_open_positions: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM trading_positions WHERE qty <> 0 AND closed_at IS NULL`)
      .first<{ n: number }>(),
    db.prepare(`SELECT status, COUNT(*) AS n FROM trading_orders WHERE status IN ('draft','awaiting_approval','sent') GROUP BY status`)
      .all<{ status: string; n: number }>(),
    db.prepare(`SELECT id, ts, kind, severity, summary FROM trading_incidents WHERE resolved_at IS NULL ORDER BY ts DESC LIMIT 5`)
      .all<{ id: string; ts: number; kind: string; severity: string; summary: string }>(),
    listLoops(db, day),
    // ── Phase 13 substrate: meetings, their briefs and their captures ──
    db.prepare(
      `SELECT m.id, m.title, m.purpose, m.scheduled_at, m.duration_min, m.location, m.status,
              p.id AS person_id, p.full_name, o.name AS organization_name,
              b.id AS brief_id, b.generated_at AS briefed_at,
              c.id AS capture_id, c.captured_at,
              r.relationship_health, r.trust_level, r.strategic_importance
         FROM meetings m
         JOIN people p ON p.id = m.person_id
    LEFT JOIN organizations o ON o.id = m.organization_id
    LEFT JOIN meeting_briefs b ON b.meeting_id = m.id
    LEFT JOIN meeting_captures c ON c.meeting_id = m.id
    LEFT JOIN relationships r ON r.id = m.relationship_id
        WHERE m.scheduled_at >= ? AND m.scheduled_at < ? AND m.status <> 'cancelled'
        ORDER BY m.scheduled_at ASC`,
    ).bind(from, to).all<MeetingBlockRow>(),
    db.prepare(
      `SELECT m.id, m.title, m.scheduled_at, p.full_name
         FROM meetings m
         JOIN people p ON p.id = m.person_id
    LEFT JOIN meeting_captures c ON c.meeting_id = m.id
        WHERE m.scheduled_at < ? AND m.scheduled_at >= ? AND m.status <> 'cancelled' AND c.id IS NULL
        ORDER BY m.scheduled_at DESC LIMIT 10`,
    ).bind(from, from - 7 * DAY_MS).all<{ id: string; title: string; scheduled_at: number; full_name: string }>(),
    db.prepare(
      `SELECT COUNT(*) AS n FROM follow_ups WHERE status = 'open' AND due_at < ?`,
    ).bind(to).first<{ n: number }>(),
    db.prepare(
      `SELECT r.id, p.full_name, r.next_touch_due_at, r.relationship_health, r.cadence_days
         FROM relationships r
         JOIN people p ON p.id = r.person_id
        WHERE r.status = 'active' AND r.next_touch_due_at IS NOT NULL AND r.next_touch_due_at < ?
        ORDER BY r.strategic_importance DESC LIMIT 5`,
    ).bind(to).all<{ id: string; full_name: string; next_touch_due_at: number; relationship_health: number; cadence_days: number }>(),
    // Phase 16 substrate: computed sky, real practice, and canon §5.2's
    // reality-priority read, assembled by the same function the Spirit screen
    // calls, so the two can never disagree.
    spiritSignal(db, day.id, now),
  ]);

  const byStatus = (rows: { status: string; n: number }[] | undefined) =>
    Object.fromEntries((rows ?? []).map((r) => [r.status, r.n]));

  const tasksAll = byStatus(taskCounts.results);
  const tasksToday = byStatus(todaysTasks.results);
  const pendingByRisk = Object.fromEntries((approvalsByRisk.results ?? []).map((r) => [r.risk, r.n]));
  const pendingTotal = Object.values(pendingByRisk).reduce((a, b) => a + b, 0);
  const employeeStatus = byStatus(employeeCounts.results);
  const orderStatus = byStatus(liveOrders.results);

  const openTaskCount = openTasks?.n ?? 0;
  const openedToday = Object.values(tasksToday).reduce((a, b) => a + b, 0);
  const spendToday = spend?.micros ?? 0;
  const captureCount = captures?.n ?? 0;

  const priorities = json<{ text: string; order: number }[]>(day.morning_priorities, []);
  const contract = json<Record<string, unknown> | null>(day.morning_contract, null);
  const middayChecks = json<{ text: string; done?: boolean }[]>(day.midday_checks, []);
  const attention = json<{ focus_area: string; pct: number; note?: string }[]>(day.night_attention, []);
  const tomorrowSeed = json<Record<string, unknown> | null>(day.night_tomorrow_seed, null);

  // ── Critical alerts: real failures only, never volume for its own sake ──
  const alerts: { severity: string; text: string; source_type: string; source_id: string | null }[] = [];
  if (tradingAuthority?.kill_switch) {
    alerts.push({ severity: "critical", text: "The trading kill switch is engaged. Nothing in that lane executes.", source_type: "trading", source_id: null });
  }
  for (const inc of openIncidents.results ?? []) {
    if (inc.severity === "high" || inc.severity === "critical") {
      alerts.push({ severity: inc.severity, text: `Trading incident open: ${inc.summary}`, source_type: "trading", source_id: inc.id });
    }
  }
  if ((openDeadLetters?.n ?? 0) > 0) {
    alerts.push({
      severity: "high",
      text: `${openDeadLetters!.n} task${openDeadLetters!.n === 1 ? "" : "s"} gave up after retrying and need triage.`,
      source_type: "tasks", source_id: null,
    });
  }
  if ((tasksAll.failed ?? 0) > 0) {
    alerts.push({ severity: "medium", text: `${tasksAll.failed} task${tasksAll.failed === 1 ? "" : "s"} failed and have not been requeued or cancelled.`, source_type: "tasks", source_id: null });
  }
  if (lastCron && lastCron.status !== "complete" && lastCron.status !== "running") {
    alerts.push({ severity: "high", text: `The last nightly run finished ${lastCron.status}.`, source_type: "tasks", source_id: lastCron.id });
  }
  if (!lastCron) {
    alerts.push({ severity: "medium", text: "No nightly run has ever been recorded.", source_type: "tasks", source_id: null });
  }
  if ((expiringApprovals?.n ?? 0) > 0) {
    alerts.push({
      severity: "medium",
      text: `${expiringApprovals!.n} approval${expiringApprovals!.n === 1 ? "" : "s"} expire within a day. An expired approval cancels its origin.`,
      source_type: "approvals", source_id: null,
    });
  }
  for (const ev of errorEvents.results ?? []) {
    alerts.push({ severity: "medium", text: `${ev.scope}: ${ev.event}`, source_type: "tasks", source_id: ev.id });
  }

  // ── Continuity: relevant when the vault is missing, stale or broken ──
  const snapshotAgeMs = lastSnapshot ? now - lastSnapshot.ts : null;
  const continuityRelevant =
    !lastSnapshot || lastSnapshot.status !== "complete" || (snapshotAgeMs !== null && snapshotAgeMs > 2 * DAY_MS);

  // ── Trading: relevant when the lane holds anything or is stopped ──
  const openOrderCount = Object.values(orderStatus).reduce((a, b) => a + b, 0);
  const tradingRelevant =
    Boolean(tradingAuthority?.kill_switch) ||
    (openPositions?.n ?? 0) > 0 ||
    openOrderCount > 0 ||
    (openIncidents.results?.length ?? 0) > 0;

  const carried = loops.filter((l) => l.carried_from !== null).length;

  // ── Meetings, canon §15's fourth element and canon §40's unit of work ──
  const meetingsToday = (todaysMeetings.results ?? []).map((m) => ({
    ...m,
    briefed: m.brief_id !== null,
    captured: m.capture_id !== null,
  }));
  const unbriefed = meetingsToday.filter((m) => !m.briefed && !m.captured);

  const built: Record<BlockKey, { content: unknown; isEmpty: boolean; sourceId?: string | null }> = {
    todays_contract: {
      content: contract
        ? { contract, priorities, agreed_at: day.morning_completed_at }
        : { reason: "The Morning Gate has not run. Today has no contract yet." },
      isEmpty: !contract,
    },
    /*
     * THE EXECUTIVE BRIEFING IS THE REPORT NOW, AND THAT REMOVED DUPLICATION RATHER THAN ADDING
     * ANYTHING.
     *
     * It used to print four lines of internal system status, and three of them were already on this
     * screen: `pendingTotal` is the exact variable block 10 (Approval Inbox) renders, tasks in
     * flight is what block 11 (AI Employee Status) shows, and captures belong to Memory. It was a
     * status line wearing a briefing's name, and it said the same things twice.
     *
     * Canon calls this element a BRIEFING, and a briefing is what an analyst hands a principal about
     * the world — not a count of her own inbox. Camille's Executive Intelligence Report fills it,
     * the duplication goes, and Today keeps exactly thirteen elements with no fourteenth. Model
     * spend, the one figure that was not duplicated, moved to Settings beside the ledger
     * reconciliation, which is where a number you audit rather than act on belongs.
     *
     * A PARTIAL REPORT STILL RENDERS, AND NAMES ITS GAPS. The owner's instruction: "on failure just
     * say so and name the gaps". A report that refuses to appear teaches her to stop looking at 7am.
     * A missing report says when the last good one was, so a blank is never unexplained.
     */
    executive_briefing: {
      content: report
        ? {
            status: report.status,
            summary: report.summary,
            sections: parseJson(report.sections, []),
            gaps: parseJson(report.gaps, []),
            corrections: parseJson(report.corrections, []),
            sources: parseJson(report.sources, []),
            generated_at: report.generated_at,
          }
        : {
            reason: lastReport
              ? `No report for today yet. The last one arrived ${new Date(lastReport.generated_at).toLocaleString()}.`
              : "No Executive Intelligence Report has been produced yet. Camille delivers it at 06:30 America/Chicago.",
            last_report_at: lastReport?.generated_at ?? null,
          },
      isEmpty: !report,
    },
    day_flow: {
      content: {
        stages: [
          { stage: "Morning Gate", done: Boolean(day.morning_completed_at), at: day.morning_completed_at },
          {
            stage: "Agenda Calculation",
            done: false,
            absent: true,
            reason: "The agenda engine lands in Phase 12. Priorities come from the Morning Gate until then.",
          },
          { stage: "Today's Contract", done: Boolean(contract), at: day.morning_completed_at },
          { stage: "Midday Reset", done: Boolean(day.midday_completed_at), at: day.midday_completed_at },
          { stage: "Night Gate", done: Boolean(day.night_completed_at), at: day.night_completed_at },
        ],
        priorities,
        midday_checks: middayChecks,
      },
      isEmpty: !day.morning_completed_at && !day.midday_completed_at && !day.night_completed_at,
    },
    meetings: {
      content: {
        meetings: meetingsToday,
        total: meetingsToday.length,
        unbriefed: unbriefed.length,
        next: meetingsToday.find((m) => m.scheduled_at >= now) ?? null,
        held_not_captured: heldNotCaptured.results ?? [],
        follow_ups_overdue: overdueFollowUps?.n ?? 0,
        touches_due: dueTouches.results ?? [],
      },
      isEmpty:
        meetingsToday.length === 0 &&
        (heldNotCaptured.results?.length ?? 0) === 0 &&
        (overdueFollowUps?.n ?? 0) === 0 &&
        (dueTouches.results?.length ?? 0) === 0,
      sourceId: meetingsToday[0]?.id ?? null,
    },
    open_loops: {
      content: {
        loops: loops.slice(0, 10),
        total: loops.length,
        carried_forward: carried,
      },
      isEmpty: loops.length === 0,
    },
    critical_alerts: { content: { alerts }, isEmpty: alerts.length === 0 },
    spirit_signal: {
      content: {
        advisory: true,
        note: spirit.note,
        reality_priority: spirit.reality_priority,
        moon: {
          phase: spirit.astro.phase,
          sign: spirit.astro.moon_sign,
          cusp: spirit.astro.cusp,
          next_sign: spirit.astro.next_sign,
          illumination_bps: spirit.astro.illumination_bps,
          waxing: spirit.astro.waxing,
        },
        windows: spirit.astro.windows,
        rituals_due: spirit.rituals_due,
        contribution: spirit.contribution,
        ancestors: spirit.ancestors,
        manifestations: spirit.manifestations,
      },
      // Canon §15 keeps the element on the screen; it is never "empty" in the
      // sense the other blocks are, because the sky is always something.
      isEmpty: false,
    },
    coaching_focus: { content: absent("coaching_focus"), isEmpty: true },
    daily_thinking_lens: { content: absent("daily_thinking_lens"), isEmpty: true },
    approval_inbox: {
      content: {
        pending: pendingTotal,
        by_risk: { high: pendingByRisk.high ?? 0, medium: pendingByRisk.medium ?? 0, low: pendingByRisk.low ?? 0 },
        expiring_within_a_day: expiringApprovals?.n ?? 0,
        oldest: oldestApproval ?? null,
      },
      isEmpty: pendingTotal === 0,
      sourceId: oldestApproval?.id ?? null,
    },
    employee_status: {
      content: {
        by_status: { active: employeeStatus.active ?? 0, paused: employeeStatus.paused ?? 0, retired: employeeStatus.retired ?? 0 },
        busiest: busiestEmployees.results ?? [],
      },
      isEmpty: (employeeStatus.active ?? 0) === 0,
    },
    continuity_status: {
      content: {
        relevant: continuityRelevant,
        last_snapshot: lastSnapshot ?? null,
        age_ms: snapshotAgeMs,
        proposed_promotions_awaiting_decision: proposedPromotions?.n ?? 0,
        note: !lastSnapshot
          ? "No snapshot has ever been taken. Nothing here would survive a rebuild."
          : lastSnapshot.status !== "complete"
            ? `The last snapshot ended ${lastSnapshot.status}.`
            : continuityRelevant
              ? "The last snapshot is more than two days old."
              : "The vault is current.",
      },
      isEmpty: !continuityRelevant,
      sourceId: lastSnapshot?.id ?? null,
    },
    trading_status: {
      content: {
        relevant: tradingRelevant,
        kill_switch: Boolean(tradingAuthority?.kill_switch),
        live_enabled: Boolean(tradingAuthority?.live_enabled),
        open_positions: openPositions?.n ?? 0,
        orders: orderStatus,
        open_incidents: openIncidents.results ?? [],
      },
      isEmpty: !tradingRelevant,
    },
  };

  const blocks: Block[] = TODAY_BLOCKS.map((spec, index) => ({
    key: spec.key,
    title: spec.title,
    order: index + 1,
    content: built[spec.key].content,
    source_type: spec.source,
    source_id: built[spec.key].sourceId ?? null,
    is_empty: built[spec.key].isEmpty,
  }));

  await persistBlocks(db, day.id, blocks);

  const gateCount = await db
    .prepare(`SELECT COUNT(*) AS n FROM gate_entries WHERE day_id = ?`)
    .bind(day.id)
    .first<{ n: number }>();

  await db
    .prepare(
      `UPDATE days SET day_flow_json = ?, open_loops_count = ?, gate_entries_count = ? WHERE id = ?`,
    )
    .bind(JSON.stringify(blocks), loops.length, gateCount?.n ?? 0, day.id)
    .run();

  return blocks;
}

function absent(key: BlockKey) {
  const spec = AWAITING_SUBSTRATE[key]!;
  return { available: false, reason: spec.reason, arrives_in_phase: spec.phase };
}

async function persistBlocks(db: D1Database, dayIdValue: string, blocks: Block[]): Promise<void> {
  const now = Date.now();
  await db.batch(
    blocks.map((b) =>
      db
        .prepare(
          `INSERT INTO day_flow_blocks
             (id, day_id, block_key, block_order, title, content, source_type, source_id, is_empty, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(day_id, block_key) DO UPDATE SET
             block_order = excluded.block_order,
             title       = excluded.title,
             content     = excluded.content,
             source_type = excluded.source_type,
             source_id   = excluded.source_id,
             is_empty    = excluded.is_empty,
             updated_at  = excluded.updated_at`,
        )
        .bind(
          newId("dfb"), dayIdValue, b.key, b.order, b.title,
          JSON.stringify(b.content), b.source_type, b.source_id,
          b.is_empty ? 1 : 0, now, now,
        ),
    ),
  );
}

interface LoopRow {
  id: string;
  day_id: string;
  kind: string;
  title: string;
  detail: string | null;
  source_type: string | null;
  source_id: string | null;
  priority: number;
  status: string;
  created_at: number;
  carried_from: string | null;
}

/**
 * Today's open loops, plus every loop still open from an earlier day. A loop
 * that silently stopped being shown because the date rolled over is the exact
 * failure the "what must not be forgotten" question exists to prevent.
 */
async function listLoops(db: D1Database, day: DayRow): Promise<LoopRow[]> {
  const rows = await db
    .prepare(
      `SELECT l.id, l.day_id, l.kind, l.title, l.detail, l.source_type, l.source_id,
              l.priority, l.status, l.created_at,
              CASE WHEN l.day_id = ? THEN NULL ELSE l.day_id END AS carried_from
         FROM open_loops l
         JOIN days d ON d.id = l.day_id
        WHERE l.status = 'open' AND d.date_ts <= ?
        ORDER BY l.priority ASC, l.created_at ASC`,
    )
    .bind(day.id, day.date_ts)
    .all<LoopRow>();
  return rows.results ?? [];
}

// ─── Today ────────────────────────────────────────────────────────────────────

async function resolveDay(c: Context<{ Bindings: Env; Variables: Vars }>): Promise<DayRow> {
  const requested = c.req.query("date");
  const id = requested ? String(requested) : dayId(Date.now());
  return ensureDay(c.env.DB, id);
}

/** The default screen. One request returns the whole briefing. */
today.get("/", async (c) => {
  const day = await resolveDay(c);
  const blocks = await assembleDayFlow(c.env, day);
  const fresh = await c.env.DB.prepare(`SELECT * FROM days WHERE id = ?`).bind(day.id).first<DayRow>();
  const gates = await c.env.DB
    .prepare(`SELECT gate, completed_at FROM gate_entries WHERE day_id = ? ORDER BY completed_at ASC`)
    .bind(day.id)
    .all<{ gate: string; completed_at: number }>();

  return ok(c, {
    day: fresh,
    blocks,
    gates: gates.results ?? [],
    limits: {
      morning_priorities: MAX_MORNING_PRIORITIES,
      midday_checks: MAX_MIDDAY_CHECKS,
      night_review_prompts: MAX_NIGHT_REVIEW_PROMPTS,
    },
  });
});

today.get("/days", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT id, date_ts, morning_completed_at, midday_completed_at, night_completed_at,
              open_loops_count, gate_entries_count
         FROM days ORDER BY date_ts DESC LIMIT 60`,
    )
    .all();
  return ok(c, rows.results ?? []);
});

today.get("/gates", async (c) => {
  const day = await resolveDay(c);
  const rows = await c.env.DB
    .prepare(`SELECT * FROM gate_entries WHERE day_id = ? ORDER BY completed_at ASC`)
    .bind(day.id)
    .all();
  return ok(c, rows.results ?? []);
});

// ─── Open loops ───────────────────────────────────────────────────────────────

const LOOP_KINDS = new Set([
  "follow_up", "decision_pending", "meeting_prep", "memory_candidate", "relationship", "trading", "other",
]);

today.get("/loops", async (c) => {
  const day = await resolveDay(c);
  return ok(c, await listLoops(c.env.DB, day));
});

today.post("/loops", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!b?.title) throw badRequest("An open loop needs a title");
  const kind = b.kind ?? "other";
  if (!LOOP_KINDS.has(kind)) {
    throw badRequest(`"${kind}" is not a kind of open loop`, `One of: ${[...LOOP_KINDS].join(", ")}`);
  }
  const priority = Number(b.priority ?? 3);
  if (![1, 2, 3].includes(priority)) throw badRequest("Priority is 1 (high), 2 (medium) or 3 (low)");

  const day = await ensureDay(c.env.DB, b.day_id ? String(b.day_id) : dayId(Date.now()));
  const id = newId("loop");
  const now = Date.now();

  await c.env.DB
    .prepare(
      `INSERT INTO open_loops (id, day_id, kind, title, detail, source_type, source_id, priority, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,'open',?,?)`,
    )
    .bind(
      id, day.id, kind, String(b.title),
      b.detail === undefined ? null : JSON.stringify(b.detail),
      b.source_type ?? "manual", b.source_id ?? null, priority, now, now,
    )
    .run();

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "open_loop", entityId: id, action: "opened", detail: { day: day.id, kind } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM open_loops WHERE id = ?`).bind(id).first(), 201);
});

/**
 * Resolving, dismissing or deferring. A deferred loop is carried onto tomorrow
 * as a new loop rather than having its date quietly rewritten: today's record
 * should still say the loop was open today and was not closed.
 */
today.post("/loops/:id/:action", async (c) => {
  const id = c.req.param("id");
  const action = c.req.param("action");
  if (action !== "resolve" && action !== "dismiss" && action !== "defer") {
    throw badRequest(`"${action}" is not something you can do to an open loop`, "One of: resolve, dismiss, defer");
  }
  const body = await c.req.json<any>().catch(() => ({}));

  const loop = await c.env.DB.prepare(`SELECT * FROM open_loops WHERE id = ?`).bind(id).first<any>();
  if (!loop) throw notFound("No open loop with that id");
  if (loop.status !== "open") throw conflict(`That loop is already ${loop.status}`);

  const now = Date.now();
  const status = action === "resolve" ? "resolved" : action === "dismiss" ? "dismissed" : "deferred";

  const statements = [
    c.env.DB
      .prepare(`UPDATE open_loops SET status = ?, resolved_at = ?, updated_at = ? WHERE id = ?`)
      .bind(status, now, now, id),
  ];

  let carriedId: string | null = null;
  if (action === "defer") {
    const tomorrow = await ensureDay(c.env.DB, dayId(now + DAY_MS));
    carriedId = newId("loop");
    statements.push(
      c.env.DB
        .prepare(
          `INSERT INTO open_loops (id, day_id, kind, title, detail, source_type, source_id, priority, status, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,'open',?,?)`,
        )
        .bind(
          carriedId, tomorrow.id, loop.kind, loop.title, loop.detail,
          loop.source_type, loop.source_id, loop.priority, now, now,
        ),
    );
  }

  await c.env.DB.batch(statements);

  /*
   * A loop raised by a follow-up is that follow-up on the screen. Closing one
   * without the other would let a kept commitment stay open in the ledger, or a
   * dropped one keep costing relationship health after the Boss decided it was
   * finished.
   */
  if (loop.source_type === "relationship" && loop.source_id) {
    await applyLoopActionToFollowUp(c.env.DB, loop.source_id, action, carriedId, now);
  }

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "open_loop", entityId: id, action: status,
    detail: { note: body?.note ?? null, carried_to: carriedId },
  });

  return ok(c, {
    loop: await c.env.DB.prepare(`SELECT * FROM open_loops WHERE id = ?`).bind(id).first(),
    carried: carriedId
      ? await c.env.DB.prepare(`SELECT * FROM open_loops WHERE id = ?`).bind(carriedId).first()
      : null,
  });
});

// ─── Gates ────────────────────────────────────────────────────────────────────

/**
 * A gate runs once a day. This is checked before the handler does any work that
 * writes — the Night Gate runs the promotion sweep, and a refusal that had
 * already proposed promotions would be a refusal in name only.
 */
async function refuseSecondRun(
  env: Env,
  dayIdValue: string,
  gate: "morning" | "midday" | "night",
): Promise<void> {
  const existing = await env.DB
    .prepare(`SELECT id FROM gate_entries WHERE day_id = ? AND gate = ?`)
    .bind(dayIdValue, gate)
    .first<{ id: string }>();
  if (existing) {
    throw conflict(
      `The ${gate} gate has already run for ${dayIdValue}`,
      "A gate is a moment, not a form. Re-running it would overwrite what you actually said.",
    );
  }
}

async function recordGate(
  env: Env,
  day: DayRow,
  gate: "morning" | "midday" | "night",
  payload: unknown,
  columns: Record<string, string | number | null>,
): Promise<{ id: string; completed_at: number }> {
  await refuseSecondRun(env, day.id, gate);

  const id = newId("gte");
  const completedAt = Date.now();
  const keys = Object.keys(columns);

  try {
    await env.DB.batch([
      env.DB
        .prepare(`INSERT INTO gate_entries (id, day_id, gate, completed_at, payload, created_at) VALUES (?,?,?,?,?,?)`)
        .bind(id, day.id, gate, completedAt, JSON.stringify(payload), completedAt),
      env.DB
        .prepare(`UPDATE days SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
        .bind(...keys.map((k) => columns[k]), day.id),
    ]);
  } catch (err) {
    // Two submissions in the same moment both pass the check above; the unique
    // index is what actually decides. The loser is a second run, not a 500.
    await refuseSecondRun(env, day.id, gate);
    throw err;
  }

  await audit(env.DB, { actor: "boss", lane: "ops", entityType: "day", entityId: day.id, action: `${gate}_gate`, detail: { gate_entry: id } });
  await logEvent(env.DB, { level: "info", scope: "executive", event: `${gate}_gate_completed`, entityId: day.id });

  return { id, completed_at: completedAt };
}

function textList(value: unknown, max: number, what: string): { text: string; order: number }[] {
  if (!Array.isArray(value) || value.length === 0) throw badRequest(`The gate needs at least one ${what}`);
  if (value.length > max) {
    throw badRequest(
      `Canon §5 caps this at ${max} ${what}${max === 1 ? "" : "s"}; ${value.length} were sent`,
      "The cap is the point. Choosing three is the work.",
    );
  }
  return value.map((v, i) => {
    const text = typeof v === "string" ? v : String(v?.text ?? "");
    if (!text.trim()) throw badRequest(`An empty ${what} is not a ${what}`);
    return { text: text.trim(), order: i + 1 };
  });
}

/**
 * The same cap, for a list canon does not require. Nothing sent and an empty
 * list mean the same thing — there was nothing to record — and the form sends
 * the empty list. Refusing it would make an optional field mandatory.
 */
function optionalTextList(value: unknown, max: number, what: string): { text: string; order: number }[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value) && value.length === 0) return [];
  return textList(value, max, what);
}

/**
 * Morning Gate — canon §17. Eight steps in, and the outputs canon names that
 * this phase can honestly produce: priorities, state, and the contract.
 */
today.post("/gates/morning", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!b) throw badRequest("The morning gate needs a body");

  const priorities = textList(b.priorities, MAX_MORNING_PRIORITIES, "priority");
  const state = {
    identity_cue: b.identity_cue ? String(b.identity_cue) : null,
    state: b.state ? String(b.state) : null,
    body_floor: b.body_floor ? String(b.body_floor) : null,
    revenue_reality: b.revenue_reality ? String(b.revenue_reality) : null,
  };

  const day = await ensureDay(c.env.DB, b.day_id ? String(b.day_id) : dayId(Date.now()));

  // Step 6 of canon §17 is the approval inbox scan, so the contract records what
  // was actually waiting when the day was agreed to.
  const pending = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'`)
    .first<{ n: number }>();

  const contract = {
    priorities: priorities.map((p) => p.text),
    commitment: b.commitment ? String(b.commitment) : null,
    approvals_waiting_at_gate: pending?.n ?? 0,
    agreed_at: Date.now(),
  };

  const payload = { priorities, state, contract, inbox_scan: { pending: pending?.n ?? 0 } };
  const entry = await recordGate(c.env, day, "morning", payload, {
    morning_completed_at: Date.now(),
    morning_priorities: JSON.stringify(priorities),
    morning_state: JSON.stringify(state),
    // The agenda engine is Phase 12. Recording its absence is the honest
    // rendering; a fabricated agenda would be worse than none.
    morning_agenda: JSON.stringify({ available: false, reason: "The agenda engine lands in Phase 12.", arrives_in_phase: 12 }),
    morning_contract: JSON.stringify(contract),
  });

  const refreshed = await ensureDay(c.env.DB, day.id);
  const blocks = await assembleDayFlow(c.env, refreshed);
  return ok(c, { gate: entry, day: refreshed, blocks }, 201);
});

/**
 * Midday Reset — canon §16 (15.2) and the approval sweep it names. At most
 * three checks, and the sweep records what was actually waiting at midday.
 */
today.post("/gates/midday", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!b) throw badRequest("The midday reset needs a body");

  const rawChecks = Array.isArray(b.checks) ? b.checks : [];
  const checks = textList(rawChecks, MAX_MIDDAY_CHECKS, "check").map((chk, i) => ({
    ...chk,
    done: Boolean(rawChecks[i]?.done),
  }));

  const day = await ensureDay(c.env.DB, b.day_id ? String(b.day_id) : dayId(Date.now()));

  const sweep = await c.env.DB
    .prepare(
      `SELECT risk, COUNT(*) AS n FROM approvals WHERE status = 'pending' GROUP BY risk`,
    )
    .all<{ risk: string; n: number }>();
  const pendingByRisk = Object.fromEntries((sweep.results ?? []).map((r) => [r.risk, r.n]));
  const stillOpen = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM open_loops WHERE status = 'open'`)
    .first<{ n: number }>();

  const adjustments = {
    note: b.adjustments ? String(b.adjustments) : null,
    dropped: Array.isArray(b.dropped) ? b.dropped.map(String) : [],
  };
  const approvalSweep = {
    pending_by_risk: pendingByRisk,
    open_loops: stillOpen?.n ?? 0,
    swept_at: Date.now(),
  };

  const entry = await recordGate(c.env, day, "midday", { checks, adjustments, approval_sweep: approvalSweep }, {
    midday_completed_at: Date.now(),
    midday_checks: JSON.stringify(checks),
    midday_adjustments: JSON.stringify({ ...adjustments, approval_sweep: approvalSweep }),
  });

  const refreshed = await ensureDay(c.env.DB, day.id);
  const blocks = await assembleDayFlow(c.env, refreshed);
  return ok(c, { gate: entry, day: refreshed, blocks, approval_sweep: approvalSweep }, 201);
});

/**
 * Night Gate — canon §16 (15.3): attention allocation, memory promotion
 * candidates, evidence capture, tomorrow seed.
 *
 * The promotion candidates come from the existing sweep. Canon has one
 * promotion gate and the build plan is explicit that the Night Gate feeds it
 * rather than running a second one beside it.
 */
today.post("/gates/night", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!b) throw badRequest("The night gate needs a body");

  const attentionRaw = Array.isArray(b.attention) ? b.attention : [];
  if (attentionRaw.length === 0) throw badRequest("The night gate needs the day's attention allocation");
  const attention = attentionRaw.map((a: any) => {
    const focus = String(a?.focus_area ?? "").trim();
    const pct = Number(a?.pct);
    if (!focus) throw badRequest("Each attention entry needs a focus area");
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw badRequest("Attention is a percentage between 1 and 100");
    return { focus_area: focus, pct, note: a?.note ? String(a.note) : null };
  });
  const total = attention.reduce((sum: number, a: { pct: number }) => sum + a.pct, 0);
  if (total > 100) {
    throw badRequest(`Attention allocation totals ${total}%`, "A day cannot hold more than one day of attention.");
  }

  const review = optionalTextList(b.review, MAX_NIGHT_REVIEW_PROMPTS, "review prompt");
  const seedPriorities = optionalTextList(b.tomorrow_seed?.priorities, MAX_MORNING_PRIORITIES, "seeded priority");

  const day = await ensureDay(c.env.DB, b.day_id ? String(b.day_id) : dayId(Date.now()));

  // Refused before the sweep, not after it: the sweep proposes promotions and
  // raises approvals, and a second run must leave none of that behind.
  await refuseSecondRun(c.env, day.id, "night");

  // The one promotion gate, not a parallel one.
  const sweep = await runPromotionSweep(c.env);
  const candidates = await c.env.DB
    .prepare(
      `SELECT p.id, p.item_id, p.from_tier, p.to_tier, p.approval_id, m.title
         FROM promotion_events p
         JOIN memory_items m ON m.id = p.item_id
         JOIN approvals a ON a.id = p.approval_id
        WHERE p.outcome = 'proposed' AND a.status = 'pending'
        ORDER BY p.ts DESC LIMIT 20`,
    )
    .all<{ id: string; item_id: string; from_tier: string; to_tier: string; approval_id: string; title: string }>();

  const evidence = {
    note: b.evidence?.note ? String(b.evidence.note) : null,
    wins: Array.isArray(b.evidence?.wins) ? b.evidence.wins.map(String) : [],
    friction: Array.isArray(b.evidence?.friction) ? b.evidence.friction.map(String) : [],
  };

  const tomorrowId = dayId(day.date_ts + DAY_MS);
  const tomorrow = await ensureDay(c.env.DB, tomorrowId);

  const seed = {
    day_id: tomorrowId,
    priorities: seedPriorities.map((p) => p.text),
    notes: b.tomorrow_seed?.notes ? String(b.tomorrow_seed.notes) : null,
  };

  const promotions = {
    sweep,
    candidates: candidates.results ?? [],
  };

  const entry = await recordGate(c.env, day, "night", { attention, review, evidence, tomorrow_seed: seed, promotions }, {
    night_completed_at: Date.now(),
    night_attention: JSON.stringify(attention),
    night_promotions: JSON.stringify(promotions),
    night_evidence: JSON.stringify({ ...evidence, review }),
    night_tomorrow_seed: JSON.stringify(seed),
  });

  /*
   * A seed that only lives in tonight's JSON is a note to nobody. Each seeded
   * priority becomes a real open loop on tomorrow, so it is on the screen
   * before the Morning Gate runs.
   */
  const now = Date.now();
  if (seedPriorities.length > 0) {
    await c.env.DB.batch(
      seedPriorities.map((p) =>
        c.env.DB
          .prepare(
            `INSERT INTO open_loops (id, day_id, kind, title, detail, source_type, source_id, priority, status, created_at, updated_at)
             VALUES (?,?,'follow_up',?,?,'manual',?,?, 'open',?,?)`,
          )
          .bind(
            newId("loop"), tomorrowId, p.text,
            JSON.stringify({ seeded_by: "night_gate", from_day: day.id }),
            day.id, 1, now, now,
          ),
      ),
    );
  }

  const refreshed = await ensureDay(c.env.DB, day.id);
  const blocks = await assembleDayFlow(c.env, refreshed);
  // Tomorrow now has seeded loops on it, so its blocks are rebuilt too rather
  // than waiting for someone to open the screen.
  await assembleDayFlow(c.env, await ensureDay(c.env.DB, tomorrow.id));

  return ok(c, { gate: entry, day: refreshed, blocks, promotions, tomorrow_seed: seed }, 201);
});

// ─── Morning coaching ─────────────────────────────────────────────────────────

/**
 * Where the day stands on coaching: consented or not, and why not.
 *
 * The reason is a sentence rather than a code because it is shown to her, and because the honest
 * version of "not approved" needs explaining: what she types is never stored by this system, and a
 * model still has to read it. Both halves are true and only saying one of them would mislead.
 */
today.get("/coaching", async (c) => {
  const day = dayId(Date.now());
  const consent = await consentFor(c.env, day);
  const row = await c.env.DB
    .prepare(`SELECT day_mode, day_mode_source FROM days WHERE id = ?`)
    .bind(day)
    .first<{ day_mode: string | null; day_mode_source: string | null }>();

  /*
   * WHICH BACKENDS COULD ACTUALLY ANSWER HER, asked of the database rather than assumed by the
   * screen. The client used to carry a hardcoded backend id, which is the two-lists defect in its
   * plainest form: the button said one thing and the router would have done another. The rule for
   * appearing here is the same one the run enforces — enabled, a cloud model, and carrying at
   * least one enabled model row — so consenting to something in this list cannot fail for want of
   * a model, and something absent from it is absent for a reason the row can state.
   */
  const [enabledBackends, modelsByProvider] = await Promise.all([
    c.env.DB
      .prepare(`SELECT id, display_name FROM execution_backends WHERE status = 'enabled' AND class = 'cloud_model'`)
      .all<{ id: string; display_name: string }>(),
    c.env.DB
      .prepare(
        `SELECT m.provider_id, COUNT(*) AS models, MAX(m.in_micros_1k + m.out_micros_1k) AS dearest
           FROM models m JOIN providers p ON p.id = m.provider_id
          WHERE m.enabled = 1 AND p.enabled = 1
          GROUP BY m.provider_id`,
      )
      .all<{ provider_id: string; models: number; dearest: number }>(),
  ]);

  /*
   * BACKEND TO PROVIDER COMES FROM THE WIRING, NOT FROM A STRING MATCH. The registry stores
   * `binding:AI` as Workers AI's credential_ref while the provider row stores the binding's name,
   * `AI` — two true statements about the same credential that a SQL join on those columns would
   * have quietly declared unequal, dropping the one free backend from the list.
   */
  const byProvider = new Map((modelsByProvider.results ?? []).map((r) => [r.provider_id, r]));
  const backends = (enabledBackends.results ?? [])
    .map((b) => {
      const stats = byProvider.get(WIRING_BY_BACKEND.get(b.id)?.providerId ?? "");
      return stats
        ? { id: b.id, display_name: b.display_name, models: stats.models, free: stats.dearest === 0 }
        : null;
    })
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .sort((a, b) => Number(b.free) - Number(a.free) || a.display_name.localeCompare(b.display_name));

  return ok(c, {
    day_id: day,
    consent,
    max_turns: MAX_TURNS,
    exit_phrases: EXIT_PHRASES,
    backends,
    day_mode: row?.day_mode ?? null,
    day_mode_source: row?.day_mode_source ?? null,
    /*
     * SAID OUT LOUD IN THE PAYLOAD, not only in a comment, because the client renders it and she
     * should be able to read the promise on the screen where she is deciding.
     */
    storage: "Nothing you type here is stored by Boss OS. The conversation lives only in this browser.",
  });
});

/** One deliberate act, scoped to one day and one backend. */
today.post("/coaching/consent", async (c) => {
  const day = dayId(Date.now());
  const body = await c.req.json<{ backend_id?: string; revoke?: boolean }>().catch(() => ({}) as { backend_id?: string; revoke?: boolean });

  if (body.revoke) {
    await revokeConsent(c.env, day);
    await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "coaching_consent", entityId: day, action: "revoked" });
    return ok(c, await consentFor(c.env, day));
  }

  const backendId = body.backend_id;
  if (!backendId) throw badRequest("Name the backend you are approving.", "Consent to one backend is not consent to another.");

  await grantConsent(c.env, day, backendId);
  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "coaching_consent", entityId: day,
    action: "granted", detail: { backend_id: backendId },
  });
  return ok(c, await consentFor(c.env, day));
});

/**
 * One exchange. Stores nothing.
 *
 * THE AIRLOCK IS ASKED, NOT ASSUMED. `assertMayReachExternalModel` runs with the consent as its
 * `approved` argument, so if `coaching_turns` were ever classified LOCAL_ONLY on the processing
 * axis this refuses even with consent in hand — which is correct, and is the difference between a
 * governed path and a bypass with a nicer name.
 */
today.post("/coaching/turn", async (c) => {
  const day = dayId(Date.now());
  const body = await c.req.json<{ text?: string; turn?: number; recent?: { role: string; text: string }[] }>()
    .catch(() => ({}) as any);

  const text = String(body.text ?? "").trim();
  if (!text) throw badRequest("Nothing was said.", "Type something, or use an exit phrase to finish.");

  // An exit phrase ends the coaching without reaching a model at all. Her own words, her own rule,
  // and no reason to spend a call on them.
  if (isExit(text)) return ok(c, { ended: true, reason: "exit_phrase", reply: null });

  const turn = Number(body.turn ?? 1);
  if (turn > MAX_TURNS) {
    return ok(c, { ended: true, reason: "max_turns", reply: null });
  }

  const consent = await consentFor(c.env, day);
  if (!consent.granted || !consent.backend_id) {
    throw conflict(consent.reason ?? "Coaching is not approved for today.", "Approve it once for today, on the Today screen.");
  }

  await assertMayReachExternalModel(c.env.DB, "coaching_turns", null, true);

  const dayRow = await c.env.DB
    .prepare(`SELECT morning_contract, day_mode FROM days WHERE id = ?`)
    .bind(day)
    .first<{ morning_contract: string | null; day_mode: string | null }>();
  const [loops, approvals] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM open_loops WHERE status = 'open'`).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'`).first<{ n: number }>(),
  ]);

  const system = buildCoachingPrompt({
    anchor: dayRow?.morning_contract ?? null,
    openLoops: loops?.n ?? 0,
    approvalsWaiting: approvals?.n ?? 0,
    turn,
    dayMode: (dayRow?.day_mode as any) ?? null,
  });

  // Only the current turn and at most two prior exchanges travel. A morning is not a transcript.
  const recent = (body.recent ?? []).slice(-FORWARDED_TURNS * 2);

  const result = await runCoachingTurn(c.env, consent.backend_id, system, recent, text);
  return ok(c, { ended: false, reply: result.reply, backend_id: consent.backend_id, degraded: result.degraded });
});

/** How the day should be RUN. The one thing the conversation leaves behind. */
today.post("/coaching/mode", async (c) => {
  const day = dayId(Date.now());
  const body = await c.req.json<{ mode?: string; source?: string }>().catch(() => ({}) as { mode?: string; source?: string });
  const mode = body.mode;
  if (mode !== "full" && mode !== "mvd" && mode !== "recovery") {
    throw badRequest("A day is full, mvd, or recovery.", "Nothing else is a mode this system knows.");
  }
  const source = body.source === "coaching" ? "coaching" : "declared";
  await ensureDay(c.env.DB, day);
  await setDayMode(c.env, day, mode, source);
  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "day", entityId: day,
    action: "mode_set", detail: { mode, source },
  });
  return ok(c, { day_id: day, day_mode: mode, day_mode_source: source });
});
