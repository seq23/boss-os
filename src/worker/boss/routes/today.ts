import { editionStamp } from "../duties/briefingSpec";
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
// One statement of which tiers a vendor gives away, shared with the router and the guard.
import { routeIsBilled } from "../backends/guard";
import { dayIdInZone, wallClock, zonedTime } from "../../../shared/boss/timezone";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { runPromotionSweep } from "./memory";
import { applyLoopActionToFollowUp, surfaceOverdueFollowUps } from "../relationships/follow_ups";
import { spiritSignal } from "../spirit/day";
import { batchReads } from "../lib/batchReads";
import { pendingApprovals } from "../approvals/pending";
import { ensureRunOfShow, readRunOfShow, closeBlocksForGate, RUN_OF_SHOW } from "../today/runOfShow";
import { coachingFocus, lensFor } from "../today/faculty";
import { deliverableAlerts } from "../today/deliverables";
import { bookNagAlerts } from "../capital/bookNag";
import { unansweredQuestionAlerts } from "../intake/questions";
import { credentialAlerts } from "../today/credentials";
import { diary } from "../today/diary";
import { alertKey, applyDismissals, dedupeAlerts, dismissalsStatement } from "../today/alerts";
import { gradientState, notifySentence } from "../router/gradient";
import { spendLeverState } from "../router/spend";
import {
  groupErrorEvents,
  errorAlertText,
  failedTaskAlertText,
  type ErrorEventRow,
} from "../today/errorAlerts";
import { TERMINAL_CHECKS } from "../today/deliverables";
import { buildBodyContract, buildBodyContractWithState, selectSomatic, logSomatic, markSomaticDone } from "../today/body";
import { buildPillars, wealthContract } from "../today/pillars";
import {
  BRIEFING_SECTIONS, orderSections, missingSections, groundInsight,
  withheldForSourcing, reportStanding,
} from "../today/briefing";
import { dutyStaleness } from "../duties/staleness";
import { roster, type EmployeeDutyRow, type EmployeeRow } from "../today/roster";
import { adjustToday } from "../today/adjust";
import { anchorStreak, stalledDeals } from "../today/close";
import { weeklyPacket, packetIsDue } from "../today/packet";
import { scoreDay, FLOORS } from "../today/verdict";

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
  /*
   * THE KEY STAYS `day_flow`, THE TITLE DOES NOT. Renaming the key would orphan every persisted
   * `day_flow_blocks` row and every client that reads it; the title is what she actually reads, and
   * "Day Flow" was the name of the five machine stages this block no longer contains. Seen on the
   * live site with the heading saying one thing and the conflict rule beneath it — "if the Run of
   * Show conflicts with the Pillar Contracts" — saying another.
   */
  { key: "day_flow", title: "Run of Show", source: "manual" },
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
  /*
   * EMPTY, AND THAT IS THE POINT. Coaching Focus and the Daily Thinking Lens sat here waiting on a
   * "Phase 12" that was never going to arrive, because the substrate was never missing — §10's five
   * Tracks and §11's three Modes are a fixed set the owner had already written down. The blocks were
   * waiting on a document, not on a build. See src/worker/boss/today/faculty.ts.
   */
};

// ─── Day identity ─────────────────────────────────────────────────────────────

/**
 * Epoch ms at LOCAL midnight of the day containing `ts`.
 *
 * MOVED WITH `dayId`, BECAUSE HALF A BOUNDARY IS WORSE THAN THE OLD ONE. When `dayId` became
 * zone-aware and this did not, the two disagreed for six hours every evening: the day's LABEL was
 * hers and its START was UTC's. Four tests caught it immediately, and they were right to — a day
 * whose id says the 6th and whose window opens on the 7th is a day nothing can be counted against.
 */
export function dayStart(ts: number): number {
  return startOfDayId(dayIdInZone(ts));
}

/** The instant local midnight opens on a given `YYYY-MM-DD`. */
export function startOfDayId(id: string): number {
  const [y, m, d] = id.split("-").map(Number) as [number, number, number];
  return zonedTime(y, m, d, 0);
}

/**
 * The date string one day after `id`.
 *
 * ADDING 86,400,000ms IS NOT ADDING A DAY. `dayId(day.date_ts + DAY_MS)` computed "tomorrow" that
 * way and, once the boundary moved, returned TODAY — because local midnight plus 24 hours is still
 * inside the same local date on the two days a year the clocks move, and lands an hour off the rest
 * of the time. Tomorrow is a date, so it is calculated on the date.
 */
export function nextDayId(id: string): string {
  const [y, m, d] = id.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` in UTC. The primary key of `days`. */
/**
 * HER DAY, NOT UTC'S.
 *
 * This read the UTC date, so her day rolled over at 7pm Central — six hours early, every day.
 * At 9pm on a Sunday the Run of Show was already showing Monday's plan: West Peek instead of the
 * weekend build order, a fresh empty set of blocks, and the evening she was actually living in
 * filed under tomorrow. Seen on the live page.
 *
 * EVERYTHING KEYS OFF THIS ONE FUNCTION, which is what makes the change safe: the day's id, the
 * gates, the Run of Show, the coaching consent and the verdict all derive from it, so they move
 * together. Rows written under the old boundary keep their ids and stay readable — a day is still
 * a `YYYY-MM-DD` string, it is simply the right one now.
 */
export function dayId(ts: number): string {
  return dayIdInZone(ts);
}

function parseDayId(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  // Local midnight, matching `dayStart`. Storing UTC midnight here while the id means a local date
  // is the same half-moved boundary, one table down.
  const ms = startOfDayId(value);
  return Number.isFinite(ms) ? ms : null;
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
  // Added by 0177 (the morning coaching) and 0178 (the Night Gate verdict).
  day_mode: string | null;
  day_mode_source: string | null;
  verdict: string | null;
  verdict_floors: string | null;
  verdict_at: number | null;
}

/**
 * A day row is created on first sight of the day, by whichever request or cron
 * run notices first — the same rule the budget windows already follow.
 */
export async function ensureDay(db: D1Database, id: string): Promise<DayRow> {
  const dateTs = parseDayId(id);
  if (dateTs === null) throw badRequest("A day is identified as YYYY-MM-DD in UTC", `Received "${id}"`);

  // One read on the ordinary path. The day exists on every request after the first, and a
  // request costs about a millisecond of CPU per statement on this runtime — see lib/batchReads.ts.
  const existing = await db.prepare(`SELECT * FROM days WHERE id = ?`).bind(id).first<DayRow>();
  if (existing) return existing;

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

/**
 * WHY TODAY'S BRIEFING IS NOT HERE — a named reason, never a blank.
 *
 * The owner's complaint on 8 September 2026 was that Today showed her nothing. It was not showing
 * nothing; it was showing "No report for today yet", which is the same thing wearing a sentence.
 * The useful question at 7am is not *whether* the report arrived, it is **what to do about it**,
 * and that depends entirely on which of these mornings it is:
 *
 *   · it is 06:12 and the run is not due for another eighteen minutes — do nothing
 *   · the run fired and the task is still queued — the Mac agent is not running
 *   · the run fired hours ago and is still `running` — something claimed it and did not finish
 *   · the task failed — read the error
 *   · the duty is suspended — she suspended it
 *   · the duty has never fired at all — it was never wired
 *
 * Each is a different sentence and each names the next move. A blank screen names none of them,
 * which is why it is the failure she actually described.
 *
 * COMPUTED ON READ. Nothing here is written by a cron, so a cron that did not run cannot make this
 * wrong — it is true at the moment she looks, which is the only moment that matters.
 */
/**
 * WHEN THE MAC NEXT LOOKS FOR WORK, in Central wall-clock minutes-from-midnight.
 *
 * These are the `StartCalendarInterval` slots of `com.seq.boss-agent` in
 * `scripts/ops/install-agent-launchd.sh`, and `the-briefing-is-on-par.mjs` fails the build if the two
 * lists disagree — the one link between them, so a failed-run notice can name a retry time that is
 * actually when the retry happens.
 */
export const MAC_CLAIM_SLOTS_CT: { h: number; m: number }[] = [
  { h: 6, m: 5 }, { h: 6, m: 35 }, { h: 6, m: 50 }, { h: 7, m: 10 }, { h: 12, m: 35 }, { h: 18, m: 35 },
];

/** "07:10 Central" for the next slot after `now`, or the first slot tomorrow. */
export function nextClaimSlot(now: number): string {
  const wc = wallClock(now);
  const minutes = wc.h * 60 + wc.min;
  const next = MAC_CLAIM_SLOTS_CT.find((s) => s.h * 60 + s.m > minutes) ?? MAC_CLAIM_SLOTS_CT[0]!;
  const tomorrow = !MAC_CLAIM_SLOTS_CT.some((s) => s.h * 60 + s.m > minutes);
  return `${String(next.h).padStart(2, "0")}:${String(next.m).padStart(2, "0")} Central${tomorrow ? " tomorrow" : ""}`;
}

export function reportStaleness(
  duty: {
    suspended: number; last_run_at: number | null; next_due_at: number | null;
    task_status: string | null; task_error: string | null;
    local_hour?: number | null; local_minute?: number | null;
  } | null,
  showingDay: string | null,
  todayId: string,
  now: number,
): string {
  const carried = showingDay !== null && showingDay !== todayId
    ? `This is the briefing for ${showingDay}, carried over because today's has not arrived. `
    : "";
  /*
   * THE TIME IS THE DUTY'S, NOT A LITERAL. Every sentence here said "06:30" while the row said
   * 06:30, and would have gone on saying it after 0257 moved the duty to 06:00.
   */
  const at = duty && typeof duty.local_hour === "number"
    ? `${String(duty.local_hour).padStart(2, "0")}:${String(duty.local_minute ?? 0).padStart(2, "0")}`
    : "06:00";

  if (!duty) {
    return `${carried}There is no Executive Intelligence Report duty in the system at all, so nothing is scheduled to produce one.`;
  }
  if (duty.suspended) {
    return `${carried}The ${at} report duty is suspended, so no report will be produced until it is resumed.`;
  }
  if (duty.last_run_at === null) {
    return `${carried}The ${at} report duty has never fired.`;
  }
  if (duty.task_status === "failed") {
    /*
     * A FAILED RUN NAMES ITS REASON AND ITS RETRY. The retry is real: the duty is re-materialised on
     * delivery of a failed report (see `deliverReport.ts`), and the Mac's next slot is when the new
     * task is claimed. A notice that says "failed" and stops teaches her to stop looking at 7am.
     */
    return `${carried}The ${at} run failed: ${duty.task_error ?? "no error was recorded"}. A retry is queued for your Mac's next slot, ${nextClaimSlot(now)}.`;
  }
  if (duty.task_status === "cancelled") {
    return `${carried}The ${at} run was cancelled: ${duty.task_error ?? "no reason was recorded"}.`;
  }
  if (duty.task_status === "queued") {
    const hours = Math.floor((now - duty.last_run_at) / 3_600_000);
    return `${carried}The ${at} run fired ${hours}h ago and its task is still queued — nothing on your Mac has claimed it yet. Its next slot is ${nextClaimSlot(now)}; if that passes too, the agent job is not running.`;
  }
  if (duty.task_status === "running") {
    const hours = Math.floor((now - duty.last_run_at) / 3_600_000);
    return `${carried}The ${at} run has been running for ${hours}h without reporting back.`;
  }
  if (duty.next_due_at !== null && duty.next_due_at > now) {
    const mins = Math.max(1, Math.round((duty.next_due_at - now) / 60_000));
    return `${carried}Today's report is not due for another ${mins} minute${mins === 1 ? "" : "s"}.`;
  }
  return `${carried}The ${at} run has not delivered today's report yet and its task is not waiting anywhere — dispatch it by hand if you need it now.`;
}

/**
 * THE THIRTEEN BLOCKS, IN SEVEN REQUESTS.
 *
 * This Worker runs on the Cloudflare Free plan, which allows 10 ms of CPU per request, and the
 * owner's decision (13 September 2026) is that it stays there. Assembling all thirteen blocks in
 * one request — forty-odd D1 reads, the report's JSON parsed three ways, the sky computed — cost
 * ~18 ms by Cloudflare's own accounting, and the platform killed it: `outcome: exceededCpu`, a 403
 * on Today and a blank Spirit. Nothing was wrong with any block; there were just too many of them
 * in one CPU budget.
 *
 * So the screen asks for the blocks in groups, in parallel, and each group is its own request with
 * its own 10 ms. NOTHING IS CUT: the same thirteen blocks, the same content, the same order — the
 * client stitches the groups back into canon §15's list. The groups are chosen so that the reads
 * a block needs sit with it: everything Critical Alerts consumes is in `alerts`, the roster and
 * the duty rows are in `status`, and the two coaching blocks ride with the contract because they
 * are computed from the same day mode.
 *
 * `assembleDayFlow` with no `only` still builds every block in one pass — that is what the nightly
 * cron does, where the budget is the cron's and a whole day is written at once.
 */
export const TODAY_GROUPS = {
  contract: ["todays_contract"],
  flow: ["day_flow", "coaching_focus", "daily_thinking_lens"],
  briefing: ["executive_briefing"],
  meetings: ["meetings", "open_loops"],
  alerts: ["critical_alerts"],
  spirit: ["spirit_signal"],
  status: ["approval_inbox", "employee_status", "continuity_status", "trading_status"],
} as const satisfies Record<string, readonly BlockKey[]>;

export type TodayGroup = keyof typeof TODAY_GROUPS;

export function parseBlockKeys(raw: string | undefined): BlockKey[] | undefined {
  if (!raw) return undefined;
  const known = new Set<string>(TODAY_BLOCKS.map((b) => b.key));
  const keys = raw.split(",").map((k) => k.trim()).filter((k) => known.has(k)) as BlockKey[];
  if (keys.length === 0) {
    throw badRequest(
      "No known block was named",
      `blocks= takes a comma-separated subset of: ${TODAY_BLOCKS.map((b) => b.key).join(", ")}`,
    );
  }
  return keys;
}

export async function assembleDayFlow(env: Env, day: DayRow, only?: readonly BlockKey[]): Promise<Block[]> {
  // Every block when nothing is named; otherwise exactly the named ones. A read a block does not
  // need is not made — that, not caching, is what keeps each group inside its budget.
  const keys = new Set<BlockKey>(only ?? TODAY_BLOCKS.map((b) => b.key));
  const want = (...k: BlockKey[]) => k.some((x) => keys.has(x));
  /*
   * THE MEETING PACKET, on the two days it is worth having and null on the other five.
   *
   * Computed rather than researched: every figure in it is already in her own record — anchors
   * kept, deals advanced, candidates reviewed, touches logged — so an agent run would cost money
   * and minutes to fetch what a query returns instantly, and could be wrong about facts the
   * database holds exactly.
   */
  /*
   * THE PACKET IS NO LONGER ASSEMBLED FOR THIS SCREEN. It is served whole at
   * `/api/boss/packets/page` and fetched by the reminder at `/today/packet/:counterpart`; rendering
   * it into the Meetings section was the thing she objected to. `packetIsDue` still governs the
   * reminder's own day, and `weeklyPacket` still answers that route — this assembler just stopped
   * doing work whose only consumer has been deleted.
   */
  /*
   * THE COMPACT POINTER, WHICH IS WHAT SHE ASKED FOR.
   *
   * "or at least an artifact in the web page that seems to be more space efficient" — she does not
   * want the whole packet dumped into Today, she wants a short line that opens the document. So the
   * block carries the meeting, the date, the one blocking headline and a link; the page carries
   * every agenda newest-first.
   *
   * `filed` NULL IS RENDERED, NOT HIDDEN. A Wednesday where the job did not run must look like a
   * Wednesday where the job did not run — her rule from this morning is that the screen never shows
   * an empty section for something that exists.
   */
  /*
   * ── THE DIARY, WHICH IS WHAT THIS SECTION IS FOR ──────────────────────────
   *
   * "this tab is suppose to show what meetings i have upcoming."
   *
   * Its summary line comes back WITH the rows and is computed from them, because the defect she
   * screenshotted was a collapsed line reading "Nothing in the diary" over a full agenda — one
   * sentence counting the CRM table while the body rendered the packet. They cannot disagree now.
   */
  const db = env.DB;
  // Every plain read in this assembler goes into ONE batch per stage — see lib/batchReads.ts for
  // the measurement that makes this the whole difference between a screen and a 403.
  const reads = batchReads(db);

  const theDiaryP = want("meetings") ? diary(env, Date.now()).catch(() => null) : Promise.resolve(null);
  const filedPacketP = reads.first<any>(want("meetings"), () => env.DB
    .prepare(
      `SELECT id, counterpart, day_id, headline, blocking, published_at
         FROM meeting_packets ORDER BY day_id DESC, published_at DESC LIMIT 1`,
    )).catch(() => null);

  /*
   * Today's report, and the last good one.
   *
   * Both, in one pass: the block must be able to say "no report today, the last was Tuesday"
   * rather than rendering an unexplained blank, and that sentence needs the second row. A report is
   * keyed to the day it is FOR, not the day it was written, so a retry at 09:00 still fills the
   * 06:30 slot rather than creating a second Tuesday.
   */
  const B = want("executive_briefing");
  const reportP = reads.first<any>(B, () => env.DB
      .prepare(`SELECT * FROM executive_reports WHERE day_id = ? AND archived_at IS NULL LIMIT 1`)
      .bind(day.id));
    /*
     * THE WHOLE ROW, NOT JUST ITS TIMESTAMP — which is the fix.
     *
     * This used to select `generated_at` alone, because all the block did with the last report was
     * print the date it arrived. So on any morning the 06:30 run had not landed, a briefing that
     * EXISTED, in this database, with its sections and its sources, was replaced by the sentence
     * "No report for today yet." She read that as an empty screen, and she was right to: a report
     * she cannot read is not a report.
     *
     * A day-old briefing is worth more than a blank one every time. It is shown, labelled with the
     * day it is for and how old it is, and Today never renders nothing where a report exists.
     */
  const lastReportP = reads.first<any>(B, () => env.DB
      .prepare(`SELECT * FROM executive_reports WHERE status != 'failed' AND archived_at IS NULL ORDER BY generated_at DESC LIMIT 1`));
  const reportDutyP = reads.first<{
        id: string; name: string; suspended: number; last_run_at: number | null;
        next_due_at: number | null; last_task_id: string | null;
        local_hour: number | null; local_minute: number | null;
        task_status: string | null; task_error: string | null;
      }>(B, () => env.DB
      .prepare(
        `SELECT d.id, d.name, d.suspended, d.last_run_at, d.next_due_at, d.last_task_id,
                d.local_hour, d.local_minute,
                t.status AS task_status, t.error AS task_error
           FROM standing_duties d
           LEFT JOIN tasks t ON t.id = d.last_task_id
          WHERE d.id = 'duty_exec_intel'`,
      ));

  const now = Date.now();
  const from = day.date_ts;
  const to = startOfDayId(nextDayId(day.id));

  /*
   * Canon §40: an overdue follow-up is an open loop. This runs before the loops
   * are read, so a commitment that came due since the screen was last opened is
   * on the screen now rather than at the next cron tick.
   *
   * A day in the future never takes them. A follow-up is surfaced once, so
   * looking ahead at tomorrow would otherwise move today's overdue commitments
   * onto a day that has not happened — and off the screen the Boss is on.
   */
  if (want("open_loops") && day.date_ts <= dayStart(now)) {
    await surfaceOverdueFollowUps(db, day.id, Math.min(now, to - 1), now);
  }

  // A read no wanted block consumes resolves to null instead of being made.
  const when = <T,>(wanted: boolean, read: () => Promise<T>, fallback: T): Promise<T> =>
    wanted ? read() : Promise.resolve(fallback);
  const A = want("critical_alerts");
  const S = want("employee_status");

  /*
   * FIVE READS THAT NO BLOCK CONSUMED are gone from this list — task counts by status, open tasks,
   * tasks opened today, spend today, captures today. They were computed on every render and used
   * by nothing on the screen; in a 10 ms budget a read nobody consumes is not free.
   */
  const [
    approvalsByRisk,
    oldestApproval,
    expiringApprovals,
    employeeCounts,
    busiestEmployees,
    proposedPromotions,
    lastSnapshot,
    lastCron,
    openDeadLetters,
    unresolvedFailures,
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
    /*
     * THE ONE SOURCE, NOT A FIFTH ANSWER. This block used to count pending approvals with its own
     * GROUP BY and sum the buckets; `system.ts` counted them again; the list route selected them a
     * third time with a cap the counts did not have. That is how "Approval Inbox - 9 waiting" ended
     * up above an Inbox holding nothing. See `approvals/pending.ts`.
     */
    when(want("approval_inbox"), () => pendingApprovals(db), null as Awaited<ReturnType<typeof pendingApprovals>> | null),
    reads.first<{ id: string; title: string; risk: string; requested_at: number }>(want("approval_inbox"), () => db.prepare(`SELECT id, title, risk, requested_at FROM approvals WHERE status = 'pending' ORDER BY requested_at ASC LIMIT 1`)
      ),
    reads.first<{ n: number }>(want("approval_inbox") || A, () => db.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?`)
      .bind(now + DAY_MS)),
    reads.all<{ status: string; n: number }>(S, () => db.prepare(`SELECT status, COUNT(*) AS n FROM employees GROUP BY status`)),
    /*
     * EVERY ACTIVE EMPLOYEE, WITH NO LIMIT ON THE LIST.
     *
     * "the ai employee status section does not have an accurate list of who is on duty"
     *
     * What stood here ordered by `open_tasks DESC` and took the top FIVE. Eight employees are
     * active, so three were missing from "who is on duty" at any moment and WHICH three moved with
     * the queue — while the summary line above the list correctly said eight. A roster sorted by
     * busyness with a cut-off hides exactly the employees doing nothing, which is the state most
     * worth seeing. `today/roster.ts` sorts by HEALTH instead, worst first, and cuts nobody.
     */
    reads.all<EmployeeRow>(S, () => db.prepare(
      `SELECT e.id, e.name, e.role, e.lane, COUNT(t.id) AS open_tasks
         FROM employees e
         LEFT JOIN tasks t ON t.employee_id = e.id AND t.status IN ('queued','running','awaiting_approval')
        WHERE e.status = 'active'
        GROUP BY e.id
        ORDER BY e.name ASC`,
    )),
    reads.first<{ n: number }>(want("continuity_status"), () => db.prepare(
      `SELECT COUNT(*) AS n FROM promotion_events p
        WHERE p.outcome = 'proposed'
          AND EXISTS (SELECT 1 FROM approvals a WHERE a.id = p.approval_id AND a.status = 'pending')`,
    )),
    reads.first<{ id: string; ts: number; label: string; status: string; bytes: number }>(want("continuity_status"), () => db.prepare(`SELECT id, ts, label, status, bytes FROM vault_snapshots ORDER BY ts DESC LIMIT 1`)
      ),
    reads.first<{ id: string; started_at: number; finished_at: number | null; status: string }>(A, () => db.prepare(`SELECT id, started_at, finished_at, status FROM cron_runs ORDER BY started_at DESC LIMIT 1`)
      ),
    reads.first<{ n: number }>(A, () => db.prepare(`SELECT COUNT(*) AS n FROM dead_letters WHERE status = 'open'`)),
    /*
     * FAILURES NOTHING HAS SINCE SUCCEEDED AT. A duty's task carries the duty's own `task_title`,
     * so a later `done` task with the same title in the same lane IS the same work having worked.
     * Matching on title rather than on a foreign key because `tasks` has never carried one, and
     * inventing a column here would leave every historical row unlinked and the alert still wrong.
     */
    reads.first<{ n: number }>(A, () => db.prepare(
      `SELECT COUNT(*) AS n FROM tasks f
        WHERE f.status = 'failed'
          AND NOT EXISTS (
            SELECT 1 FROM tasks s
             WHERE s.title = f.title AND s.lane = f.lane
               AND s.status = 'done' AND s.created_at > f.created_at)`,
    )),
    /*
     * `detail` IS SELECTED BECAUSE IT IS THE ONLY COLUMN THAT SAYS WHAT HAPPENED, and for five
     * renders it was left unread while `scope` and `event` were printed at her as prose.
     *
     * The limit is 200 rather than 5 because these rows are GROUPED now: a limit of five over an
     * unknown number produced a count that was neither complete nor a sample, and "5 times" has to
     * be the truth about the day or it is worse than no number. One day of error rows is small —
     * production held five — and the cap only exists so a storm cannot cost the whole render.
     */
    reads.all<ErrorEventRow>(A, () => db.prepare(
      /*
       * AN ERROR ABOUT A TASK THAT IS NO LONGER FAILING IS HISTORY, NOT AN ALERT.
       *
       * Five `queue/task_failed` rows on her screen were all the SAME task, tsk_m2bk7zfffhjatvsf,
       * hitting the capability wall on 12 September — "3 of 4 refused at capability" — which the
       * 70B promotion has since removed. The task is not failed any more. The rows are the record
       * of what happened that evening and they belong in Diagnostics; presenting them at 7am as a
       * present condition is reading history as news, which is how a screen fills with things she
       * cannot act on.
       */
      `SELECT id, ts, scope, event, detail FROM system_events e
        WHERE e.level = 'error' AND e.ts >= ?
          AND NOT (e.scope = 'queue' AND e.event = 'task_failed'
                   AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = e.entity_id AND t.status <> 'failed'))
        ORDER BY e.ts DESC LIMIT 200`,
    ).bind(now - DAY_MS)),
    reads.first<{ live_enabled: number; kill_switch: number; max_open_positions: number }>(want("trading_status") || A, () => db.prepare(`SELECT live_enabled, kill_switch, max_open_positions FROM trading_authority LIMIT 1`)
      ),
    reads.first<{ n: number }>(want("trading_status"), () => db.prepare(`SELECT COUNT(*) AS n FROM trading_positions WHERE qty <> 0 AND closed_at IS NULL`)
      ),
    reads.all<{ status: string; n: number }>(want("trading_status"), () => db.prepare(`SELECT status, COUNT(*) AS n FROM trading_orders WHERE status IN ('draft','awaiting_approval','sent') GROUP BY status`)
      ),
    reads.all<{ id: string; ts: number; kind: string; severity: string; summary: string }>(want("trading_status") || A, () => db.prepare(`SELECT id, ts, kind, severity, summary FROM trading_incidents WHERE resolved_at IS NULL ORDER BY ts DESC LIMIT 5`)
      ),
    when(want("open_loops"), () => listLoops(db, day), [] as LoopRow[]),
    // ── Phase 13 substrate: meetings, their briefs and their captures ──
    reads.all<MeetingBlockRow>(want("meetings"), () => db.prepare(
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
    ).bind(from, to)),
    reads.all<{ id: string; title: string; scheduled_at: number; full_name: string }>(want("meetings"), () => db.prepare(
      `SELECT m.id, m.title, m.scheduled_at, p.full_name
         FROM meetings m
         JOIN people p ON p.id = m.person_id
    LEFT JOIN meeting_captures c ON c.meeting_id = m.id
        WHERE m.scheduled_at < ? AND m.scheduled_at >= ? AND m.status <> 'cancelled' AND c.id IS NULL
        ORDER BY m.scheduled_at DESC LIMIT 10`,
    ).bind(from, from - 7 * DAY_MS)),
    reads.first<{ n: number }>(want("meetings"), () => db.prepare(
      `SELECT COUNT(*) AS n FROM follow_ups WHERE status = 'open' AND due_at < ?`,
    ).bind(to)),
    reads.all<{ id: string; full_name: string; next_touch_due_at: number; relationship_health: number; cadence_days: number }>(want("meetings"), () => db.prepare(
      `SELECT r.id, p.full_name, r.next_touch_due_at, r.relationship_health, r.cadence_days
         FROM relationships r
         JOIN people p ON p.id = r.person_id
        WHERE r.status = 'active' AND r.next_touch_due_at IS NOT NULL AND r.next_touch_due_at < ?
        ORDER BY r.strategic_importance DESC LIMIT 5`,
    ).bind(to)),
    // Phase 16 substrate: computed sky, real practice, and canon §5.2's
    // reality-priority read, assembled by the same function the Spirit screen
    // calls, so the two can never disagree.
    when(want("spirit_signal"), () => spiritSignal(db, day.id, now), null),
    // Sends every read recorded above as one batch; nothing above resolves until it runs.
    reads.flush(),
  ]);
  const [theDiary, filedPacket, report, lastReport, reportDuty] = await Promise.all([
    theDiaryP, filedPacketP, reportP, lastReportP, reportDutyP,
  ]);

  const byStatus = (rows: { status: string; n: number }[] | undefined) =>
    Object.fromEntries((rows ?? []).map((r) => [r.status, r.n]));

  const pendingByRisk = approvalsByRisk?.by_risk ?? { high: 0, medium: 0, low: 0 };
  const pendingTotal = approvalsByRisk?.total ?? 0;
  const employeeStatus = byStatus(employeeCounts.results);
  const orderStatus = byStatus(liveOrders.results);


  const priorities = json<{ text: string; order: number }[]>(day.morning_priorities, []);
  const contract = json<Record<string, unknown> | null>(day.morning_contract, null);
  const middayChecks = json<{ text: string; done?: boolean }[]>(day.midday_checks, []);

  /*
   * THE THREE PIECES THE OWNER'S CONTRACT REQUIRES AND THIS ASSEMBLER DID NOT HAVE.
   *
   * The Run of Show rows are created on first render of the day rather than at the Morning Gate,
   * because §15.5 calls it a rendering aid for the WHOLE day — a day she opens at noon without
   * having run a gate still has seven blocks, and showing her none would be the screen deciding she
   * had no day.
   */
  if (want("day_flow")) await ensureRunOfShow(env, day.id);
  /*
   * Duty health, read here rather than on a cron, so it is true at the moment she looks rather than
   * at the moment something last checked.
   */
  const [staleDuties, stuckDuties, auditFindings, lastNetworkRefresh, agentBudget, warnSetting] = await Promise.all([
    reads.all<EmployeeDutyRow>(A || S, () => env.DB.prepare(
      /*
       * `COALESCE(last_run_at, created_at)`, NOT `COALESCE(last_run_at, 0)`.
       *
       * A duty that has never run was being measured against the epoch, so 0 < now − 14 days is
       * true for every brand-new weekly duty and it raised a HIGH alert on Today from the moment it
       * was created. Seen immediately: `duty_mailbox_sweep` deployed on 8 September and its first
       * run is the following Sunday, and Today announced "has never fired since it was created" as
       * a fault before it was even due.
       *
       * That is the exact failure OPERATIONS names as the reason two local jobs are NOT duty rows —
       * "a false alarm, which is worse than the gap, because a screen that cries wolf is one you
       * stop reading." Measured from creation, a new duty is given its own cadence to fire in and
       * only then goes loud.
       */
      /*
       * ── THE SHAPE IS READ HERE AND JUDGED IN `duties/staleness.ts` ─────────
       *
       * What stood here was a WHERE clause built out of `cadence` alone:
       *
       *     COALESCE(last_run_at, created_at) < now − (daily ? 2 : weekly ? 14 : 62) days
       *
       * and it produced a HIGH alert on her Sunday morning reading "Brokerage Sourcing Sweep
       * (Mon/Wed/Fri) has not fired for 2 days. Its clock says it should have." Its clock said no
       * such thing: that duty is `cadence = 'daily'` with `weekdays = [1,3,5]`, it ran on Friday as
       * designed, and its next occurrence was Monday. `weekdays` was added so a duty could run two
       * or three times a week; this check was never taught about it, so every weekday-restricted
       * duty went loud every weekend.
       *
       * SQL cannot answer "when does this duty's own schedule next fire" — that needs the IANA
       * database and the same `nextDueAt` the cron materialises from. So the rows come back whole
       * and `dutyStaleness()` decides, which also means the ALERT and the employee health dot are
       * one piece of logic rather than two copies drifting apart.
       */
      `SELECT d.id, d.name, d.employee_id, d.cadence, d.weekday, d.weekdays,
              d.local_hour, d.local_minute, d.timezone,
              d.suspended, d.last_run_at, d.created_at, t.status AS last_task_status
         FROM standing_duties d
    LEFT JOIN tasks t ON t.id = d.last_task_id
        WHERE d.suspended = 0`,
    )),

    /*
     * A DUTY WHOSE LAST TASK NEVER FINISHED. `queued` means nothing sent it; `running` for a long
     * time means nothing on her Mac claimed it. Both look identical from the duty's own record,
     * which is exactly how the report duty stayed broken.
     */
    reads.all<{ id: string; name: string; status: string }>(A, () => env.DB.prepare(
      `SELECT d.id, d.name, t.status
         FROM standing_duties d
         JOIN tasks t ON t.id = d.last_task_id
        WHERE d.suspended = 0
          AND t.status IN ('queued', 'running')
          AND t.created_at < ? - 86400000`,
    ).bind(Date.now())),

    /*
     * ── WHAT DANIELLE'S AHREFS PASS FOUND AND COULD NOT FIX ──────────────────
     *
     * THE DUTY RUNNING IS NOT THE SAME FACT AS THE WORK BEING DONE, and until this read existed
     * only the first of those two had a home. `staleDuties` above goes loud when the pass stops
     * firing; nothing anywhere went loud when it fired, worked correctly, and handed back findings
     * that need a person. So the moment the pass ran, the duty's alert fell silent and the findings
     * became invisible — a screen reporting health while the work sat untouched.
     *
     * MEASURED, NOT ASSUMED. The first real pass, 17 September 2026, returned two `no_repo` rows:
     * 118 confirmed errors on porchandparty901.com and 3 on uscisexam.com, neither domain claimed
     * by any REPO_IDENTITY.md. `GET /site-audit-findings` served them and NO CLIENT SCREEN CALLED
     * IT — "exists but nothing invokes it", this repository's own named defect, at the delivery end
     * of a duty whose whole purpose is to be read.
     *
     * ONLY THE DISPOSITIONS THAT NEED A HUMAN. `fixed_pr` already produced a pull request she will
     * see in GitHub, and `none` is a correctly empty pass — alerting on either would train her to
     * ignore the surface, which is the failure mode this file has been corrected for twice.
     *
     * AND IT IS AN ALERT, NEVER A CONTRACT LINE. Her rule, 13 September 2026: "something not
     * working should never be in today's contract it should be in the inbox."
     */
    reads.all<{ disposition: string; n: number; worst_project: string; worst_errors: number | null }>(A, () => env.DB.prepare(
      `SELECT disposition,
              COUNT(*) AS n,
              project AS worst_project,
              MAX(COALESCE(errors, 0)) AS worst_errors
         FROM site_audit_findings
        WHERE archived_at IS NULL
          AND status = 'new'
          AND disposition IN ('no_repo', 'surfaced', 'off_limits')
        GROUP BY disposition`,
    )),

    reads.first<{ ts: number }>(A, () => env.DB.prepare(
      `SELECT ts FROM system_events WHERE event = 'network_refreshed' ORDER BY ts DESC LIMIT 1`,
    )),

    reads.first<{ monthly_ceiling_micros: number; spent_micros: number; window_started_at: number | null }>(A, () => env.DB.prepare(
      `SELECT monthly_ceiling_micros, spent_micros, window_started_at FROM execution_backends WHERE id = 'bk_claude_code'`,
    )),

    reads.first<{ value: string }>(A, () => env.DB.prepare(`SELECT value FROM settings WHERE key = 'agent_budget_warn_pct'`)
      ),
    reads.flush(),
  ]);

  // A window from a previous month is last month's total, not this month's spend.
  const monthStartUtc = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
  const warnPct = Number(warnSetting?.value ?? 70) || 70;

  /*
   * THE DAY, DERIVED, WHEN THE GATE HAS NOT RUN. See the `todays_contract` block below for why.
   *
   * Skipped entirely once the gate HAS run: her agreed contract wins, and computing a second answer
   * beside it is exactly the "two things that must agree with no link between them" defect this
   * repository is written against.
   *
   * IT DEGRADES INTO A REASON RATHER THAN A BLANK. A builder that throws — a missing project list,
   * an empty movement lane — must not take the whole of Today down with it, so the failure becomes
   * `null` here and a named fault on screen.
   */
  const dayWeekday = new Date(`${day.id}T12:00:00Z`).getUTCDay();

  /*
   * ── WHAT SHE HAD TO ASK A PERSON TO FIND OUT ──────────────────────────────
   *
   *   "explain to me how the morning gate mid day and night gates work im confused. maybe a UX
   *    issue and the 'today's contract' needs the date there and what happens to yesterday it just
   *    disappears? if nothing is clicked does it track which days were skipped?"
   *
   * Every answer already existed — in `runOfShow.ts`, in `close.ts`, in comments only a developer
   * reads. That she had to ask is the defect, not that she forgot. So all four answers are on the
   * block: the date, what each gate closes, what happened yesterday, and the distinction between a
   * day she skipped and a day she simply never closed.
   */
  const yesterdayId = new Date(Date.parse(`${day.id}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const yesterday = !want("todays_contract") ? null : await env.DB
    .prepare(
      `SELECT id, anchor_outcome, morning_completed_at, midday_completed_at, night_completed_at, morning_contract
         FROM days WHERE id = ?`,
    )
    .bind(yesterdayId)
    .first<any>()
    .catch(() => null);

  const contractContext = {
    /** She asked for this directly. A screen with no date cannot say whether it is today's. */
    day_id: day.id,
    day_label: new Date(`${day.id}T12:00:00Z`).toLocaleDateString("en-GB", {
      weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
    }),
    /*
     * ONE LINE PER GATE, NAMING WHAT IT CLOSES. Straight from the model in `runOfShow.ts`, which
     * has always known this and never said it anywhere she could see.
     */
    gates: [
      {
        name: "Morning Gate",
        closes: "Morning Launch",
        what: "You agree today's contract — the anchor and the priorities — or override what was proposed. Until you run it, what you see is a proposal.",
      },
      {
        name: "Midday Gate",
        closes: "Midday Stabiliser",
        what: "A check that the day still matches the contract, and a chance to change it while there is still a day left to change.",
      },
      {
        name: "Night Gate",
        closes: "Evening Close and Night Reset",
        what: "You answer whether the anchor actually happened. That answer is the only thing that decides done or missed — nothing is inferred from database activity.",
      },
    ],
    gates_note:
      "The gates are evidence, not a second to-do list. Nothing else in this system may claim the anchor happened; only your answer at the Night Gate can.",
    /*
     * WHAT HAPPENS TO YESTERDAY — which had no answer on any screen while the row sat in the
     * database the whole time.
     */
    yesterday: yesterday
      ? {
          day_id: yesterday.id,
          anchor_outcome: yesterday.anchor_outcome ?? "unknown",
          /*
           * THE MOST CAREFUL DECISION IN THE SYSTEM, AND IT WAS INVISIBLE. `close.ts`: an unanswered
           * day "is not quietly counted as a miss, because a night she was too tired to close the
           * gate is not the same as a day she skipped the work." That distinction is what makes the
           * streak trustworthy, so she should be able to see it rather than take it on faith.
           */
          verdict:
            yesterday.anchor_outcome === "done"
              ? "You did the first money move."
              : yesterday.anchor_outcome === "missed"
                ? "You said the first money move did not happen."
                : yesterday.morning_completed_at
                  ? "You opened the day and never closed the Night Gate, so nobody knows. That is recorded as unknown rather than as a miss — a night you were too tired to answer is not a day you skipped the work."
                  : "You never opened the day. Recorded as unknown, and counted in the window rather than dropped out of it.",
          gates_run: [
            yesterday.morning_completed_at ? "Morning" : null,
            yesterday.midday_completed_at ? "Midday" : null,
            yesterday.night_completed_at ? "Night" : null,
          ].filter(Boolean),
        }
      : {
          day_id: yesterdayId,
          anchor_outcome: "unknown",
          verdict: "There is no record of yesterday at all — the day was never opened. Unknown, not missed.",
          gates_run: [],
        },
  };

  // Derived for the contract block only. The Run of Show also needs the anchor when no contract is
  // agreed, but the anchor is the wealth pillar's action alone — computing all four pillars for it
  // was what put `day_flow` over the budget, so the flow group asks for just that one below.
  const derivedContract = contract || !want("todays_contract")
    ? null
    : await (async () => {
        try {
          const [pillars, bodyContract] = await Promise.all([
            buildPillars(env, day.id, (day as { day_mode?: string | null }).day_mode ?? null, dayWeekday),
            buildBodyContract(env, day.id, (day as { day_mode?: string | null }).day_mode ?? null),
          ]);
          return {
            contract: {
              priorities: pillars.proposed.map((p) => p.text),
              commitment: pillars.wealth.action,
              anchor_source: "derived — the first money move",
              priorities_source: "derived from projects",
            },
            priorities: pillars.proposed.map((p) => ({ text: p.text, source: p.source })),
            agenda: {
              anchor: pillars.wealth.action,
              pillars: {
                body: bodyContract, spirit: pillars.spirit,
                wealth: pillars.wealth, execution: pillars.execution,
              },
              proposed: pillars.proposed,
              overridden: false,
              warning: pillars.warning,
            },
          };
        } catch (err) {
          await logEvent(env.DB, {
            level: "error", scope: "today", event: "agenda_derivation_failed", entityId: day.id,
            detail: { error: err instanceof Error ? err.message : String(err) },
          }).catch(() => {});
          return null;
        }
      })();

  const anchor: string | null =
    (contract as { commitment?: string } | null)?.commitment ??
    derivedContract?.contract.commitment ??
    (want("day_flow") && !contract
      ? (await wealthContract(env, dayWeekday).catch(() => null))?.action ?? null
      : null);
  const [runOfShow, focus] = await Promise.all([
    when(want("day_flow"), () => readRunOfShow(env, day.id, {
      dayMode: (day as { day_mode?: string | null }).day_mode ?? null,
      anchor,
    }), [] as Awaited<ReturnType<typeof readRunOfShow>>),
    when(want("coaching_focus"), () => coachingFocus(env, day.id, (day as { day_mode?: string | null }).day_mode ?? null), null),
  ]);
  const lens = lensFor(day.id);
  const attention = json<{ focus_area: string; pct: number; note?: string }[]>(day.night_attention, []);
  const tomorrowSeed = json<Record<string, unknown> | null>(day.night_tomorrow_seed, null);

  // ── Critical alerts: real failures only, never volume for its own sake ──
  //
  // Dismissals are applied at the very end, after every producer has contributed, so nothing can be
  // silenced by a producer accidentally omitting it — the list she does not see is derived from the
  // list she would have seen, and both are returned.
  const alerts: { severity: string; text: string; source_type: string; source_id: string | null }[] = [];

  /*
   * OWNED WORK COMES FIRST, ABOVE EVERY OTHER ALERT.
   *
   * Her rule: "if there is any block she needs to tell me immediately and keep reminding me until
   * its done. she canot drop it. that goes for all employees when i give them something to own."
   *
   * So it is on the surface she already opens rather than on a page she would have to remember, and
   * it leads rather than sitting under a stale-duty notice — a block on something she personally
   * handed someone outranks a nightly run that finished in a funny state.
   *
   * EVALUATED ON READ, WHICH IS THE POINT. Nothing schedules this. A cron that stopped firing would
   * take the escalation with it, and the whole rule is that a commitment must outlive the machinery
   * meant to be keeping it. See `today/deliverables.ts`.
   */
  // The four read-time producers run in parallel, and only when the alerts block is wanted: each
  // is its own handful of reads, and in series they were the slowest stretch of the assembler.
  // The credential, question and dismissal reads ride in one batch with each other; the deliverable
  // producer keeps its own two (it writes between them) and the book nag reads no table.
  const alertReads = batchReads(db);
  const dismissalsP = A ? alertReads.all<any>(true, () => dismissalsStatement(env, now)) : undefined;
  const produced = !A ? [] : (await Promise.all([
    deliverableAlerts(env, now).catch(() => []),
    credentialAlerts(env, now, alertReads).catch(() => []),
    bookNagAlerts(env, now).catch(() => []),
    unansweredQuestionAlerts(env, now, alertReads).catch(() => []),
    alertReads.flush(),
  ])).slice(0, 4) as { severity: string; text: string; source_type: string; source_id: string | null }[][];
  for (const list of produced) alerts.push(...list);

  /*
   * WHERE THE MONTH SITS ON HER SPEND LADDER. Read here, next to the other producers, and only when
   * the alerts block is wanted. It reads the lever first because the gradient's own answer depends
   * on it: at FREE_ONLY and OPEN the gradient does not apply, and claiming it does would be telling
   * her the system is being careful when she has told it not to be.
   */
  const spendLever = A ? await spendLeverState(db) : null;
  const spendGradient = spendLever ? await gradientState(db, spendLever.position) : null;
  /*
   * A DEAD LOGIN IS A CRITICAL ALERT, NOT A LOG LINE.
   *
   * She changed her Google password, which revoked the claude.ai Gmail connector instantly, and
   * nothing said so for days. Simone's watch and Monique's sweep both went blind, and the only
   * reason it surfaced at all is that a human ran a script by hand. This is the channel that does
   * not share a failure mode with the work: the report reaches her whether or not the mailbox does.
   */
  /*
   * MONIQUE ASKING FOR THE BOOK. Evaluated on read, beside the other two, for the same reason: a
   * standing ask that depends on a cron dies with the cron and says nothing. See capital/bookNag.ts
   * for why this is not an `owned_deliverables` row — that mechanism completes, and this condition
   * comes back every week.
   */
  /*
   * AN EMPLOYEE WAITING ON AN ANSWER. Same mechanism and the same reason: a question asked by mail
   * and never answered is work that is not happening, and the polite reply that asked it is
   * indistinguishable from a job well done until somebody looks. See intake/questions.ts.
   */
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
  /*
   * A DUTY THAT STOPPED WORKING SAYS SO, which nothing did until now.
   *
   * The Executive Intelligence Report duty fired on time for weeks and produced nothing, and the
   * only reason it was ever caught is that she opened the page and said "I have no report". Every
   * other duty can fail the same way: the clock advances, `last_run_at` updates, and the work
   * silently never lands. That is the defect class this whole system keeps producing, and here it
   * is in its most expensive form — a duty is the thing that runs when nobody is watching.
   *
   * TWO DIFFERENT FAILURES, NAMED SEPARATELY. A duty that has not fired at all is a broken clock. A
   * duty firing normally whose last task never finished is a broken worker — most likely nothing on
   * her Mac claimed it. Reporting both as "something is wrong with duties" would send her to the
   * wrong place.
   *
   * THE THRESHOLD IS TWICE THE CADENCE, so a daily duty is quiet until it has missed two mornings.
   * One missed run is a laptop that was closed; two is a fault.
   */
  for (const d of staleDuties.results ?? []) {
    const late = dutyStaleness(d, now);
    if (!late.stale) continue;
    alerts.push({
      severity: "high",
      text: d.last_run_at
        ? `${late.reason} Its next scheduled run is ${late.next_expected ? new Date(late.next_expected).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "not computable"}.`
        : `"${d.name}" has never fired since it was created, and ${late.missed} scheduled run${late.missed === 1 ? "" : "s"} have gone by.`,
      source_type: "tasks", source_id: d.id,
    });
  }
  /*
   * ── AND WHAT THE PASS FOUND THAT SHE HAS TO DECIDE ────────────────────────
   *
   * One line per KIND of unfinished business rather than one per finding. A hundred rows would
   * bury the thirty machinery items already here, and within a kind the next move is identical —
   * so the count and the worst-hit site are what make it actionable in a glance.
   *
   * EACH SENTENCE SAYS WHAT A NON-ENGINEER DOES NEXT. A finding with no next move is an
   * observation, and an alert that only names a defect class sends her to ask somebody what it
   * means.
   */
  for (const f of auditFindings.results ?? []) {
    const site = f.worst_project;
    const many = f.n === 1 ? "" : ` (${f.n} sites in all)`;
    const errs = (f.worst_errors ?? 0) > 0 ? `${f.worst_errors} errors` : "errors";
    if (f.disposition === "no_repo") {
      alerts.push({
        severity: "high",
        text: `Danielle found ${errs} on ${site}${many} and no repository claims that domain, so she could not fix it. Tell her which project owns the site, or say it is not one of ours.`,
        source_type: "tasks", source_id: "duty_site_audit_repair",
      });
    } else if (f.disposition === "off_limits") {
      alerts.push({
        severity: "medium",
        text: `Danielle found ${errs} on ${site}${many} in a repository she is not allowed to change while it is being worked on. Somebody working in it has to fix these by hand.`,
        source_type: "tasks", source_id: "duty_site_audit_repair",
      });
    } else {
      alerts.push({
        severity: "medium",
        text: `Danielle found ${errs} on ${site}${many} that she could not safely fix on her own and left for a person to decide.`,
        source_type: "tasks", source_id: "duty_site_audit_repair",
      });
    }
  }

  /*
   * THE BUDGET, WHERE SHE WILL SEE IT.
   *
   * Her instruction: "if we are out of budget or dangerously so i get notified." Dangerously comes
   * first — a warning that only arrives at the stop is a warning that arrives when the only option
   * left is to stop.
   *
   * THE FIGURE IS CLAUDE MAX CAPACITY, NOT A BILL, and the wording says so. She and the employees
   * draw on the same subscription, so running out does not produce an invoice: it produces a week
   * where she cannot use Claude Code for her own work because her staff spent it.
   */
  if (agentBudget && (agentBudget.monthly_ceiling_micros ?? 0) > 0) {
    const ceiling = agentBudget.monthly_ceiling_micros;
    const spent = agentBudget.window_started_at && agentBudget.window_started_at >= monthStartUtc
      ? (agentBudget.spent_micros ?? 0)
      : 0;
    const pct = Math.round((spent / ceiling) * 100);
    const money = (m: number) => `$${(m / 1e6).toFixed(2)}`;

    if (spent >= ceiling) {
      alerts.push({
        severity: "high",
        text: `The agents have spent this month's budget — ${money(spent)} of ${money(ceiling)}. Scheduled duties are paused. Anything you ask for directly still runs.`,
        source_type: "tasks", source_id: "bk_claude_code",
      });
    } else if (pct >= warnPct) {
      alerts.push({
        severity: "medium",
        text: `The agents are at ${pct}% of this month's budget (${money(spent)} of ${money(ceiling)}). That is Claude Max capacity you also use, not a bill.`,
        source_type: "tasks", source_id: "bk_claude_code",
      });
    }
  }

  /*
   * ─── HER $50 LINE, AND THE DECISION THAT COMES WITH IT ────────────────────
   *
   * Her ladder: at $50 she is NOTIFIED, with the bypass decision in front of her; at $75 it stops.
   * A notice that only says "you have spent $52" is a fact she then has to go and do something
   * about; `notifySentence` carries the amount, the stop it is heading for, and the one instrument
   * that moves it, so the decision arrives with the news.
   *
   * AND APPROACHING IT IS VISIBLE BEFORE IT BITES. The medium line fires once the month is PACING
   * past the cautious rung — that is the gradient tightening on its own, and she should learn it
   * from this screen rather than from work quietly getting cheaper.
   *
   * THE LEVER IS READ, NOT ASSUMED. At OPEN the gradient does not apply and saying "the system is
   * being careful" would be false; the money lines still fire, because money is money at every
   * lever position.
   */
  if (spendGradient && (spendGradient.notify || spendGradient.hardStop)) {
    alerts.push({
      severity: spendGradient.hardStop ? "critical" : "high",
      text: notifySentence(spendGradient),
      source_type: "tasks", source_id: "spend_gradient",
    });
  } else if (spendGradient?.applies && spendGradient.band === "CAUTIOUS") {
    alerts.push({
      severity: "medium",
      text: `${spendGradient.sentence} ${spendGradient.capabilityCost}`,
      source_type: "tasks", source_id: "spend_gradient",
    });
  }

  /*
   * MONIQUE'S NETWORK REFRESH IS WATCHED THE SAME WAY A DUTY IS, even though a scheduled local job
   * executes it rather than an agent. The touch list is only as true as its last refresh: a
   * relationship silent for 200 days stays at 200 in the record until something re-reads the
   * mailbox, and the entire instrument exists to catch decay nobody can see. A decaying decay
   * detector is the joke this alarm prevents.
   */
  if (lastNetworkRefresh) {
    const refreshDays = Math.floor((now - lastNetworkRefresh.ts) / 86_400_000);
    if (refreshDays > 10) {
      alerts.push({
        severity: "high",
        text: `Monique has not refreshed the network in ${refreshDays} days, so who has gone quiet is ${refreshDays} days out of date.`,
        source_type: "tasks", source_id: "emp_relationship",
      });
    }
  }

  for (const d of stuckDuties.results ?? []) {
    alerts.push({
      severity: "high",
      text: `"${d.name}" fired, but its last task is still ${d.status} — nothing picked it up.`,
      source_type: "tasks", source_id: d.id,
    });
  }

  /*
   * ── FAILURES, AS ONE FACT PER CAUSE ───────────────────────────────────────
   *
   * She opened this screen and found ELEVEN alerts, FIVE of them the literal text
   * `queue: task_failed` — a key pair printed as a sentence, five times, with the actual cause
   * unread in the `detail` column beside it, and duplicating the failed-task count two lines up.
   *
   * `today/errorAlerts.ts` carries the whole rule and the evidence behind it. Here there are two
   * calls and one guarantee: the failed-task count and the failed-task reason are ONE alert.
   */
  const errorGroups = groupErrorEvents(errorEvents.results ?? []);
  const failedTaskGroup = errorGroups.find((g) => g.scope === "queue" && g.event === "task_failed") ?? null;

  /*
   * A FAILURE THE SAME WORK HAS SINCE SUCCEEDED AT IS NOT A LIVE FAULT.
   *
   * Her screen said "2 tasks failed and have not been requeued or cancelled" at MEDIUM. Both rows
   * were from 9 September, both read `stdout was not JSON`, and BOTH duties — Brokerage Sourcing
   * Sweep and the Executive Intelligence Report — have run successfully since. The count was
   * reading four-day-old history as a present condition, which is the same defect as the stale
   * duty clock in a different table.
   *
   * THE ROWS ARE NOT DELETED, and that is a deliberate choice over the quicker one. They are the
   * record of what actually happened on 9 September, `task_events` and `backend_runs` hang off
   * them, and a system that tidies away its own failures cannot answer "has this broken before".
   * What changes is that the ALERT asks the right question: is anything still broken NOW. That also
   * makes it self-maintaining — the next success closes the next failure with nobody running a
   * DELETE — where a one-off cleanup would have left the same query to raise the same false alert
   * the next time a run failed and recovered.
   */
  const liveFailed = unresolvedFailures?.n ?? 0;
  if (liveFailed > 0) {
    alerts.push({
      severity: "medium",
      text: failedTaskAlertText(liveFailed, failedTaskGroup),
      source_type: "tasks", source_id: null,
    });
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
  for (const g of errorGroups) {
    // Already spoken, inside the count it belongs to. Never both.
    if (g === failedTaskGroup && liveFailed > 0) continue;
    alerts.push({
      severity: "medium",
      text: errorAlertText(g),
      /*
       * THE IDENTITY IS THE CAUSE, NOT THE ROW.
       *
       * This carried `g.newest_id` — an `evt_…` primary key, unique per occurrence — and
       * `alertKey()` builds a dismissal key out of `source_type:source_id`. So a dismissal was dead
       * on arrival by construction: the same condition recurring writes a new event with a new id,
       * and the next render sails straight past the snooze she set. She dismisses it, it comes
       * back tomorrow, and the button looks broken because for this class of alert it was.
       *
       * The grouping already established what this alert is ABOUT — one `scope`+`event` cause — so
       * that is its identity. Prefixed `evtclass:` rather than `evt_` so it can never be mistaken
       * for a row id by anything that looks one up.
       */
      source_type: "tasks", source_id: `evtclass:${g.scope}:${g.event}`,
    });
  }

  /*
   * ── APPLIED LAST, OVER THE COMPLETE LIST ──────────────────────────────────
   *
   * A dismissal removes an alert she has chosen not to look at for a while, and it is deliberately
   * NOT a filter each producer applies to itself: the list she does not see is derived from the list
   * she would have seen, and both are returned. An alert that has become LOUDER than it was when she
   * put it aside comes back anyway — deciding not to look at a medium is not deciding not to look at
   * the critical it turns into.
   */
  /*
   * Collapsed BEFORE dismissals, so a dismissal applies to the one alert she actually sees rather
   * than to one of several identical copies of it.
   */
  const distinctAlerts = dedupeAlerts(alerts);

  const { shown: shownAlerts, dismissed: dismissedAlerts } = !A
    ? { shown: distinctAlerts, dismissed: [] as { key: string; text: string; reason: string; until: number }[] }
    : await applyDismissals(env, distinctAlerts, now, dismissalsP).catch(() => ({
        shown: distinctAlerts,
        dismissed: [] as { key: string; text: string; reason: string; until: number }[],
      }));
  {
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

  const builders: Record<BlockKey, () => { content: unknown; isEmpty: boolean; sourceId?: string | null }> = {
    /*
     * THE AGENDA IS THERE BEFORE SHE ASKS. IT NO LONGER WAITS FOR A BUTTON.
     *
     * Her words, 8 September 2026: "the today screen needs an overhaul. i should get an automated
     * exec intelligence report and i should get a morning agenda each day without doing anything
     * what the fuck?!"
     *
     * She was right, and the shape of the bug is one this repository has hit repeatedly: the work
     * was BUILT AND NOTHING INVOKED IT. `buildPillars` and `buildBodyContract` already derive the
     * whole day from her projects, her arcs, her practice and her real record — the Morning Gate
     * stopped requiring her to type anything back in September. But they were only ever called
     * INSIDE `POST /today/gates/morning`, so opening Today at 7am showed "The Morning Gate has not
     * run. Today has no contract yet." A day plan that exists and is only computed if she presses
     * something is not a day plan; it is a form.
     *
     * DERIVED ON READ, so a failed cron and an unclicked button cannot produce an empty screen.
     * Both builders are pure reads — `logSomatic`, the one write in that path, stays in the gate,
     * because recording which movement was chosen belongs to the moment she agrees to it.
     *
     * PROPOSED IS NOT AGREED, and the difference is kept. `agreed_at` stays null and `state` reads
     * `proposed` until she runs the gate; what the gate then does is record her assent and let her
     * override, which is a real act with a real record. What it no longer does is decide whether
     * she gets to SEE her day.
     */
    todays_contract: () => ({
      /*
       * ── THE DATE, AND WHAT A GATE ACTUALLY IS ────────────────────────────
       *
       * Two of her questions, and both were defects in the screen rather than gaps in her memory:
       *
       *   "the 'today's contract' needs the date there and what happens to yesterday it just
       *    disappears?"
       *   "AND ARE U FIXING THE FACT THAT I HAD TO ASK WHAT MORNING MID DAY AND EVENING GATES WERE?
       *    AND HOW THEY WORK?"
       *
       * The model was already written down — `runOfShow.ts` says which block each gate closes, and
       * `close.ts` explains exactly why an unanswered day stays unknown. ALL OF IT WAS IN COMMENTS,
       * where only a developer would ever read it. Institutional memory that never reaches the
       * person operating the system is the same defect as a table with no reader.
       *
       * So the block carries its own date, an explanation of each gate in one line, and yesterday's
       * verdict — because "what happens to yesterday" had no answer on any screen and the data was
       * there the whole time.
       */
      content: contract
        ? { contract, priorities, agreed_at: day.morning_completed_at, state: "agreed", ...contractContext }
        : derivedContract
          ? {
              contract: derivedContract.contract,
              priorities: derivedContract.priorities,
              agenda: derivedContract.agenda,
              agreed_at: null,
              state: "proposed",
              note: "Derived from your projects and your record. Run the Morning Gate to agree to it, or to override it.",
              ...contractContext,
            }
          : {
              reason:
                "Today's agenda could not be derived. This is a fault, not an empty day — the " +
                "pillar builders threw rather than returning a thin day, and the reason is in Systems → Diagnostics.",
              ...contractContext,
            },
      // An empty day is now only ever a genuine failure to compute one.
      isEmpty: !contract && !derivedContract,
    }),
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
    executive_briefing: () => {
      /*
       * THE REPORT ARRIVES BY ITSELF, AND A BLANK IS NEVER THE ANSWER.
       *
       * Three things were wrong here and they compounded into the thing she saw:
       *
       *   1. The report was raised as an APPROVAL. See `backends/needsDecision.ts` — a briefing is
       *      delivered work, not a decision, and it no longer reaches the Inbox at all.
       *   2. Today rendered only TODAY'S report. If the 06:30 run had not landed, a briefing that
       *      existed and was one day old was replaced by "No report for today yet."
       *   3. When there was nothing to show, the block said so without saying WHY. "No report" and
       *      "the run never fired" and "the run fired and nothing on your Mac claimed it" are three
       *      different mornings with three different answers, and the screen gave one sentence.
       *
       * So: today's if there is one; otherwise the most recent one, shown in full and labelled as
       * carried over; and in both cases a named `staleness` explaining the state of the 06:30 run.
       * The block is `isEmpty` only when there has never been a report at all — which is the one
       * time an empty state is the truth.
       */
      const shown = report ?? lastReport ?? null;
      const carried = !report && Boolean(lastReport);
      // Parsed once; the sections are seventeen kilobytes and were being decoded three times.
      const filedSections = shown ? parseJson<unknown[]>(shown.sections, []) : [];

      return {
        content: shown
          ? {
              status: shown.status,
              /*
               * 0205. The answer, then the evidence. `headline` is one line and it is what the
               * collapsed block shows; before it existed that line was the first sentence of a
               * five-sentence summary made of stacked figures, which is the "formatted for a
               * machine not for human eyes" she described.
               */
              /*
               * THE FALLBACK RUNS ON READ AS WELL AS ON WRITE. Reports written before 0205 have no
               * headline, and there is no backfill that could invent one — but a block that showed
               * a five-sentence paragraph on its one collapsed line for every historical day would
               * make the fix look like it had not shipped. The first sentence is a worse headline
               * than a headline and a far better one than a wall of text.
               */
              headline:
                shown.headline ??
                (typeof shown.summary === "string" && shown.summary.trim()
                  ? shown.summary.trim().split(/(?<=[.!?])\s+/)[0]!.slice(0, 160)
                  : null),
              summary: shown.summary,
              /*
               * ─── §5's ELEVEN SECTIONS, IN §5's ORDER, AND THE ABSENT ONES NAMED ──
               *
               * "the executive breifing section is missing some sections ... like major news (top 5
               * headlines) a one min summary section, markets dashboard a tech section a cpaital
               * markets secondary ipo m&A section....."
               *
               * Every one of those is already required by the spec the duty is handed. The old
               * `slice(0, 4)` here threw away research she paid for, and the run was only filing
               * three thematic essays anyway because 0205's prompt told it to ignore §5's
               * structure. The producer is fixed in migration 0223; this end orders what arrives
               * and, crucially, SAYS WHAT IS NOT HERE.
               *
               * `status: "partial"` now means something she can see. A section that is absent —
               * because §2.1 forbids inventing the data that would have filled it — is absent WITH
               * A REASON, which is the difference between an honest short report and one that
               * looks complete because it never mentioned what it could not get.
               */
              /*
               * ── A FIGURE CARRIES ITS SOURCE, OR THE SECTION DOES NOT PRINT ──
               *
               * Friday's report published Brent at ~$72/bbl against an actual close of $104.61 — a
               * 45% error in a headline figure — and nothing caught it. The duty's own success
               * criterion says "every figure carries a named source and the time it was read", and
               * `success_criteria` is a TEXT COLUMN that no code has ever evaluated. Worse, even an
               * enforced criterion had nothing to check: `sources` is report-level, figures live in
               * sections, and nothing related one to the other.
               *
               * Withheld rather than dropped, so the absence is named on the screen with its reason.
               */
              ...(() => {
                const filed = filedSections;
                const sourcing = withheldForSourcing(filed, { sources: parseJson(shown.sources, []) });
                const missing = missingSections(sourcing.kept, parseJson(shown.gaps, []));
                /* A section withheld for want of a source is missing, and says which of the two it is. */
                const allMissing = [...missing.filter((m) => !sourcing.withheld.some((w) => w.key === m.key)), ...sourcing.withheld];
                return {
                  sections: sourcing.kept,
                  spec_sections: BRIEFING_SECTIONS,
                  missing_sections: allMissing,
                  withheld_for_sourcing: sourcing.withheld,
                  /*
                   * SAID ONCE, NOT ONCE PER SECTION. A report written before per-section sources
                   * existed is rendered whole with this one line under it — the alternative,
                   * briefly live, was ten identical paragraphs where her morning used to be.
                   */
                  pre_rule_sources: sourcing.pre_rule,
                };
              })(),
              /*
               * THE INSIGHT IS CHECKED BEFORE IT IS SHOWN. Numbers are obviously fabricable and
               * everyone watches them; reasoning is fabricable in a way that reads like insight. An
               * insight whose facts are not in today's report is withheld with its reason, rather
               * than printed with a hedge, on the page she reads before she trades.
               */
              insight: groundInsight({
                headline: shown.headline,
                summary: shown.summary,
                sections: filedSections,
              }),
              gaps: parseJson(shown.gaps, []),
              /* Forward-looking, and deliberately not a shortfall. */
              watching: parseJson(shown.watching, []),
              /* When it IS partial, which of the four reasons it is. */
              shortfalls: parseJson(shown.shortfalls, []),
              corrections: parseJson(shown.corrections, []),
              sources: parseJson(shown.sources, []),
              generated_at: shown.generated_at,
              for_day: shown.day_id,
              /*
               * THE EDITION, STAMPED FROM EVIDENCE. "Saturday, September 19, 2026 • Morning
               * Edition • Central Time / Information checked through 6:28 AM CT" — the file's
               * framing, with the time DERIVED from the newest source read and the market snapshot
               * rather than typed by the run. Rows written before 0257 carry no stamp and say so.
               */
              edition: editionStamp({ dayId: shown.day_id, checkedThrough: shown.checked_through ?? null }),
              prompt_version: shown.prompt_version ?? null,
              /*
               * WHO WROTE IT. Her Claude seat first, her Codex seat second, a free cloud rung after
               * both — and the block says which, so a rung's morning is never read as her seat's.
               */
              written_by: parseJson(shown.written_by, null),
              /* True when the dashboard was built from the live snapshot rather than typed by the run. */
              dashboard_from_feed: Boolean(shown.market_data),
              /* True when this is yesterday's briefing standing in for one that has not arrived. */
              carried_over: carried,
              staleness: carried ? reportStaleness(reportDuty, shown.day_id, day.id, now) : null,
            }
          : {
              reason: reportStaleness(reportDuty, null, day.id, now),
              last_report_at: null,
            },
        isEmpty: !shown,
      };
    },
    /*
     * THE RUN OF SHOW, WHICH IS WHAT THIS BLOCK WAS ALWAYS MEANT TO BE.
     *
     * It rendered five "stages" — Morning Gate, Agenda Calculation, Today's Contract, Midday Reset,
     * Night Gate — every one of which is a stage of THIS SYSTEM rather than a part of her day.
     * "0 of 5 stages complete" was a progress bar for the machinery, on the screen whose entire job
     * is telling her how far she has got. §15.2 has named seven blocks since the beginning.
     *
     * The gates are still here, under `gates`, because knowing which gates have run is genuinely
     * useful — it is just not the day.
     */
    day_flow: () => ({
      content: {
        blocks: runOfShow,
        complete: runOfShow.filter((b) => b.done).length,
        total: runOfShow.length,
        gates: {
          morning: day.morning_completed_at,
          midday: day.midday_completed_at,
          night: day.night_completed_at,
        },
        priorities,
        midday_checks: middayChecks,
        // §15.5, said on the screen rather than only enforced in code.
        conflict_rule: "If the Run of Show conflicts with the Pillar Contracts, the Pillar Contracts win.",
      },
      isEmpty: runOfShow.every((b) => !b.done),
    }),
    meetings: () => ({
      content: {
        /*
         * THE WEDNESDAY PACKET LIVES HERE RATHER THAN IN A FOURTEENTH BLOCK. This file states that
         * canon fixes thirteen elements and the build plan adds no fourteenth, and a meeting brief
         * is a meeting — this block was empty every day while the one recurring meeting she has was
         * prepared for out of memory.
         *
         * Present on Tuesday as well as Wednesday. Seeing "ask him for the Google grant" at 6am on
         * the day is seeing it as the meeting starts; seeing it on Tuesday is time to act first.
         */
        /*
         * THE PACKET IS NO LONGER RENDERED HERE. It was dumped inline — "Your week", the grant
         * steps, the whole document — into a section she opens to see what is on today. Her words:
         * "this stuff is unnecessary... if there is a packet or deliverable for a meeting i should
         * see that in a link". The document lives at one permanent URL and the row carries the link.
         */
        diary: theDiary?.rows ?? [],
        diary_summary: theDiary?.summary ?? "The diary could not be read, which is a fault rather than an empty week.",
        calendar: theDiary?.calendar ?? null,
        /*
         * WHAT THIS SECTION IS FOR, ON THE SECTION. She had to ask what her own gates were, and the
         * answer was in a source comment. The same defect was one step away here: a packet is
         * obvious to whoever built it and not to whoever opens it at 6am.
         */
        intent:
          "What you have coming up. Add anything that is not here — a diary you cannot write in is not a diary — " +
          "and where a meeting has a packet, the link opens it rather than the whole document landing on this screen.",
        agenda_page: "/api/boss/packets/page",
        filed_packet: filedPacket
          ? {
              ...filedPacket,
              download: `/api/boss/packets/${filedPacket.id}/download`,
              stale: filedPacket.day_id !== day.id,
            }
          : null,
        packet_absent_reason: filedPacket
          ? null
          : "No packet has been filed to the agenda page yet. The Wednesday job writes one at 07:00 and posts it — an empty page on a Wednesday afternoon is a job that did not run, not a quiet week.",
        meetings: meetingsToday,
        total: meetingsToday.length,
        unbriefed: unbriefed.length,
        next: meetingsToday.find((m) => m.scheduled_at >= now) ?? null,
        held_not_captured: heldNotCaptured.results ?? [],
        follow_ups_overdue: overdueFollowUps?.n ?? 0,
        touches_due: dueTouches.results ?? [],
      },
      /*
       * DERIVED FROM WHAT IS ACTUALLY INSIDE, which is the defect she caught. A section whose
       * collapsed state is computed from a different source than its body will eventually
       * contradict itself, and this one did: "Nothing in the diary", opening onto a full agenda.
       */
      isEmpty:
        (theDiary?.rows.length ?? 0) === 0 &&
        filedPacket === null &&
        meetingsToday.length === 0 &&
        (heldNotCaptured.results?.length ?? 0) === 0 &&
        (overdueFollowUps?.n ?? 0) === 0 &&
        (dueTouches.results?.length ?? 0) === 0,
      sourceId: meetingsToday[0]?.id ?? null,
    }),
    open_loops: () => ({
      content: {
        loops: loops.slice(0, 10),
        total: loops.length,
        carried_forward: carried,
      },
      isEmpty: loops.length === 0,
    }),
    critical_alerts: () => ({
      content: {
        alerts: shownAlerts,
        /*
         * ── WHAT SHE CAN DO WITH ONE ──────────────────────────────────────
         *
         * "i also need to be able to refresh critical alerts and / or dismiss / mark resolved?"
         * Until today the answer was: read it. That is why the KDP alert sat for a week saying
         * something untrue.
         *
         * The keys travel with the alerts so the screen can act on one without re-deriving its
         * identity — two places computing a key separately is how a dismissal silently misses.
         */
        keys: shownAlerts.map((a) => alertKey(a)),
        intent:
          "What is actually wrong, loudest first. Refresh re-runs the checks rather than re-reading " +
          "the answer; Resolved re-verifies and tells you if the records disagree; Dismiss is a snooze " +
          "with a reason, and it comes back if it gets worse.",
        checked_at: now,
        dismissed: dismissedAlerts,
      },
      isEmpty: shownAlerts.length === 0,
    }),
    spirit_signal: () => ({
      content: {
        advisory: true,
        note: spirit!.note,
        reality_priority: spirit!.reality_priority,
        moon: {
          phase: spirit!.astro.phase,
          sign: spirit!.astro.moon_sign,
          cusp: spirit!.astro.cusp,
          next_sign: spirit!.astro.next_sign,
          illumination_bps: spirit!.astro.illumination_bps,
          waxing: spirit!.astro.waxing,
        },
        windows: spirit!.astro.windows,
        rituals_due: spirit!.rituals_due,
        contribution: spirit!.contribution,
        ancestors: spirit!.ancestors,
        manifestations: spirit!.manifestations,
      },
      // Canon §15 keeps the element on the screen; it is never "empty" in the
      // sense the other blocks are, because the sky is always something.
      isEmpty: false,
    }),
    /*
     * BLOCKS 08 AND 09, BUILT FROM HER OWN DOCUMENTS AND FROM NO MODEL AT ALL.
     *
     * Both said "awaiting substrate, lands in Phase 12" since the port. The substrate was never
     * missing: §11's three Modes and §10's five Tracks are a fixed set she wrote down herself. A
     * rotating lens and a named mode are decidable from the day's state, so neither block spends an
     * inference call, and each says why it chose what it chose.
     */
    coaching_focus: () => ({
      content: {
        mode: focus!.mode.title,
        trigger: focus!.mode.trigger,
        rules: focus!.mode.rules,
        because: focus!.because,
        law: { n: focus!.law.n, title: focus!.law.title, text: focus!.law.text, because: focus!.law_because },
      },
      isEmpty: false,
    }),
    daily_thinking_lens: () => ({
      content: {
        track: lens.title,
        purpose: lens.purpose,
        prompts: lens.prompts,
        // §10's own framing, kept on the screen: a track is a filter, never a task list.
        note: "A filter for how today gets read, not a thing to do.",
      },
      isEmpty: false,
    }),
    approval_inbox: () => ({
      content: {
        pending: pendingTotal,
        by_risk: { high: pendingByRisk.high ?? 0, medium: pendingByRisk.medium ?? 0, low: pendingByRisk.low ?? 0 },
        expiring_within_a_day: expiringApprovals?.n ?? 0,
        oldest: oldestApproval ?? null,
      },
      isEmpty: pendingTotal === 0,
      sourceId: oldestApproval?.id ?? null,
    }),
    employee_status: () => {
      /*
       * THE DOT IS A VERDICT, AND IT SAYS WHAT IT ASSERTS.
       *
       * "there prob needs to be better UX showing a green dot showing they are working correctly
       * when they are and that changes to red when they are broken"
       *
       * Green means every duty they own is on schedule and none of their last runs failed. Red
       * means a duty is overdue against ITS OWN schedule — the same `dutyStaleness` the Critical
       * Alert uses, so the dot and the alert can never disagree — or its last task failed. Amber
       * means nothing has ever run, because grey-as-green is how a dead employee looks healthy.
       */
      const people = roster(busiestEmployees.results ?? [], staleDuties.results ?? [], now);
      const needing = people.filter((p) => p.health === "red");
      return {
        content: {
          by_status: { active: employeeStatus.active ?? 0, paused: employeeStatus.paused ?? 0, retired: employeeStatus.retired ?? 0 },
          roster: people,
          needing_you: needing.length,
          /* Kept so anything still reading the old shape sees the same people rather than nothing. */
          busiest: people,
        },
        isEmpty: people.length === 0,
      };
    },
    continuity_status: () => ({
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
    }),
    trading_status: () => ({
      content: {
        relevant: tradingRelevant,
        kill_switch: Boolean(tradingAuthority?.kill_switch),
        live_enabled: Boolean(tradingAuthority?.live_enabled),
        open_positions: openPositions?.n ?? 0,
        orders: orderStatus,
        open_incidents: openIncidents.results ?? [],
      },
      isEmpty: !tradingRelevant,
    }),
  };

  // Only the wanted blocks are built, so a builder never runs against reads that were not made.
  // `order` stays the canon position, not the position within this group: the client sorts on it
  // when it stitches the groups back together.
  const blocks: Block[] = TODAY_BLOCKS.flatMap((spec, index) => {
    if (!keys.has(spec.key)) return [];
    const b = builders[spec.key]();
    return [{
      key: spec.key,
      title: spec.title,
      order: index + 1,
      content: b.content,
      source_type: spec.source,
      source_id: b.sourceId ?? null,
      is_empty: b.isEmpty,
    }];
  });

  /*
   * PERSISTED IN THE SAME ROUND TRIP AS IT IS RENDERED. The blocks' upserts, the gate count, and
   * the day row's whole-day `day_flow_json` go out as ONE batch: the day column is re-stitched in
   * SQL from `day_flow_blocks` — so a group that built two blocks still leaves all thirteen in the
   * column, and a full build is the same statement. `open_loops_count` is written only by a build
   * that read the loops; the other groups leave it as it was.
   */
  await db.batch([
    ...persistStatements(db, day.id, blocks),
    db
      .prepare(
        `UPDATE days SET
           day_flow_json = (
             SELECT json_group_array(json_object(
               'key', b.block_key, 'title', b.title, 'order', b.block_order,
               'content', json(b.content), 'source_type', b.source_type, 'source_id', b.source_id,
               'is_empty', json(CASE WHEN b.is_empty THEN 'true' ELSE 'false' END)))
               FROM (SELECT * FROM day_flow_blocks WHERE day_id = ? ORDER BY block_order ASC) b),
           gate_entries_count = (SELECT COUNT(*) FROM gate_entries WHERE day_id = ?)
           ${keys.has("open_loops") ? ", open_loops_count = ?" : ""}
         WHERE id = ?`,
      )
      .bind(...(keys.has("open_loops") ? [day.id, day.id, loops.length, day.id] : [day.id, day.id, day.id])),
  ]);

  return blocks;
}

function absent(key: BlockKey) {
  const spec = AWAITING_SUBSTRATE[key]!;
  return { available: false, reason: spec.reason, arrives_in_phase: spec.phase };
}

function persistStatements(db: D1Database, dayIdValue: string, blocks: Block[]): D1PreparedStatement[] {
  const now = Date.now();
  return blocks.map((b) =>
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
  /*
   * THE DAY AND ITS GATES IN ONE ROUND TRIP, BEFORE THE BLOCKS. This route used to read the day,
   * build, then read the day again and the gates — three round trips of overhead on every one of
   * the screen's requests, on a runtime where each is most of a millisecond of a 10 ms budget. The
   * re-read existed to pick up the counts the assembler writes onto the day row, which nothing on
   * the screen reads; what the screen reads — the gate timestamps, the mode, the date — the
   * assembler never changes. A day that does not exist yet has no gate entries, so the empty
   * gates list is right for it without a second read.
   */
  const requested = c.req.query("date");
  const id = requested ? String(requested) : dayId(Date.now());
  const [dayRows, gateRows] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT * FROM days WHERE id = ?`).bind(id),
    c.env.DB
      .prepare(`SELECT gate, completed_at FROM gate_entries WHERE day_id = ? ORDER BY completed_at ASC`)
      .bind(id),
  ]);
  const day = (dayRows!.results as DayRow[])[0] ?? (await ensureDay(c.env.DB, id));
  // `?blocks=a,b` builds only those blocks — how the screen loads, seven requests in parallel, each
  // inside the Free plan's 10 ms. No parameter builds all thirteen in one pass, as the cron does.
  const blocks = await assembleDayFlow(c.env, day, parseBlockKeys(c.req.query("blocks")));

  return ok(c, {
    day,
    blocks,
    gates: (gateRows!.results as { gate: string; completed_at: number }[]) ?? [],
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
  /*
   * AN EMPTY BODY IS THE NORMAL CASE NOW. This used to reject a gate with no body, which made sense
   * when the body WAS the agenda. It no longer is: POST nothing and the system tells her what the
   * day is. Everything in the body is an override of something it would otherwise decide.
   */
  const b = (await c.req.json<any>().catch(() => null)) ?? {};

  const day = await ensureDay(c.env.DB, b.day_id ? String(b.day_id) : dayId(Date.now()));
  const weekday = new Date(`${day.id}T12:00:00Z`).getUTCDay();

  /*
   * THE GATE PROPOSES THE DAY. IT NO LONGER ASKS HER TO INVENT IT.
   *
   * This handler used to require `priorities` in the body — three blank fields at 6am. That is the
   * cognitive load the whole system exists to remove: an empty box is a demand to hold every
   * project in her head and rank them, which is precisely the work she asked to be relieved of.
   *
   * Her instruction, in her words: the system takes her inputs and decides her priorities each day,
   * and lets her make last-minute or emergency adjustments if something comes up. So the derived
   * day is the default and hers is an OVERRIDE — a normal event with a name, not an exception. What
   * she sends wins; what she omits is filled in from her projects, her arcs and her real record.
   */
  const pillars = await buildPillars(c.env, day.id, day.day_mode, weekday);

  /*
   * `optionalTextList`, NOT `textList`. The strict one throws "the gate needs at least one
   * priority" on an empty list — correct when the body WAS the agenda, and now exactly backwards:
   * sending nothing is the normal case and means "tell me what the day is". The cap of three still
   * applies to an override, because §17's cap is the point whoever wrote the list.
   */
  const sent = optionalTextList(b.priorities, MAX_MORNING_PRIORITIES, "priority");
  const overrode = sent.length > 0;
  const priorities = overrode
    ? sent
    : pillars.proposed.map((p) => ({ text: p.text, source: p.source }));

  const state = {
    identity_cue: b.identity_cue ? String(b.identity_cue) : null,
    state: b.state ? String(b.state) : null,
    body_floor: b.body_floor ? String(b.body_floor) : null,
    revenue_reality: b.revenue_reality ? String(b.revenue_reality) : null,
  };

  // Step 6 of canon §17 is the approval inbox scan, so the contract records what
  // was actually waiting when the day was agreed to.
  const pending = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'`)
    .first<{ n: number }>();

  /*
   * THE ANCHOR IS DERIVED TOO, and it is the first money move — §15.4's Daily Anchor is meant to be
   * the one thing the day is judged on, and §5.3 already decides what that is. Asking her for a
   * commitment and then separately computing a first money move would be two answers to one
   * question, which is how a screen starts disagreeing with itself.
   */
  const contract = {
    priorities: priorities.map((p) => p.text),
    commitment: b.commitment ? String(b.commitment) : pillars.wealth.action,
    anchor_source: b.commitment ? "owner" : "derived — the first money move",
    priorities_source: overrode ? "owner override" : "derived from projects",
    approvals_waiting_at_gate: pending?.n ?? 0,
    agreed_at: Date.now(),
  };

  /*
   * ALL FOUR PILLARS ARE REAL NOW.
   *
   * This block stored `{available: false, reason: "The agenda engine lands in Phase 12"}` on every
   * morning since the port, then three separate "not collected at this gate yet" reasons. Every one
   * of those was honest and every one was a consequence of the same thing: the gate collected
   * nothing to build them from, because the OS knew her pillars and her laws and did not know her
   * WORK. Spirit was the starkest — `spirit/practice.ts` had been composing the sentence and
   * holding the sequence the whole time, and nothing ever called it.
   */
  const { body: bodyContract, somatic_logged } = await buildBodyContractWithState(c.env, day.id, day.day_mode);
  if (!somatic_logged) await logSomatic(c.env, day.id, bodyContract.somatic);

  const agenda = {
    anchor: contract.commitment,
    pillars: {
      body: bodyContract,
      spirit: pillars.spirit,
      wealth: pillars.wealth,
      execution: pillars.execution,
    },
    proposed: pillars.proposed,
    overridden: overrode,
    // Null on almost every day. Present when the engine has been skipped long enough to be a
    // pattern rather than a bad week.
    warning: pillars.warning,
  };

  const payload = { priorities, state, contract, agenda, inbox_scan: { pending: pending?.n ?? 0 } };
  const entry = await recordGate(c.env, day, "morning", payload, {
    morning_completed_at: Date.now(),
    morning_priorities: JSON.stringify(priorities),
    morning_state: JSON.stringify(state),
    morning_agenda: JSON.stringify(agenda),
    morning_contract: JSON.stringify(contract),
  });

  // Morning Launch is Body + Spirit + first setup, which is exactly what this gate captured.
  await ensureRunOfShow(c.env, day.id);
  await closeBlocksForGate(c.env, day.id, "morning");

  const refreshed = await ensureDay(c.env.DB, day.id);
  const blocks = await assembleDayFlow(c.env, refreshed);
  return ok(c, { gate: entry, day: refreshed, blocks }, 201);
});

/**
 * The standing agenda for a recurring counterpart.
 *
 * WHAT THIS FIXES: an item said in passing on a Sunday has to survive in her head until Wednesday,
 * or it is gone. Filing it as an open loop would be wrong — a loop is time-shaped and goes overdue,
 * and this is person-shaped and simply waits for the next time those two are in a room.
 *
 * THE SYSTEM WRITES HERE TOO, which is the half a calendar note cannot do. A duty stalled on an
 * access grant only he can give belongs on this list the moment it is discovered.
 */
/**
 * ── REFRESH: RE-RUN THE CHECKS, DO NOT RE-READ THE ANSWER ──────────────────
 *
 * Today is computed on read, so a plain reload already re-reads the database and would tell her
 * exactly what it told her a minute ago. What makes an answer current is something going and
 * looking, so this re-evaluates every terminal check — closing anything the world has made true
 * since — and reports when each credential probe last actually ran.
 *
 * IT DOES NOT PRETEND TO RE-RUN THE PROBER. That lives on her Mac and uses credentials the Worker
 * does not hold; claiming a check happened is the defect, not a missing feature. So the answer says
 * how old each probe's evidence is and names the command that refreshes it.
 */
/**
 * SHE DID THE ROTATION. The write that did not exist.
 *
 * Every "because" line under the somatic lanes was a guess until this endpoint: `movement_log`
 * recorded which movement was OFFERED and nothing anywhere recorded her doing one, so the screen
 * said "Not done before." about five movements it could know nothing about.
 *
 * ONE MARK FOR THE ROTATION, NOT FIVE, and it undoes. No count, no streak, no progress — the
 * standing rule against guilt binds here exactly as it does on the contribution practice.
 */
today.post("/movement/done", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const done = b?.done === undefined ? true : Boolean(b.done);
  const id = dayId(Date.now());

  const result = await markSomaticDone(c.env, id, done);
  if (result.lanes === 0) {
    throw conflict(
      "Today's rotation has not been chosen yet",
      "Open Today or Spirit first — the day's movements are decided on the first read of the morning.",
    );
  }

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "movement_log", entityId: id,
    action: done ? "rotation_done" : "rotation_unmarked", detail: { lanes: result.lanes },
  });

  return ok(c, {
    day_id: id,
    done,
    lanes: result.lanes,
    note: done
      ? "Recorded. Tomorrow's rotation will move on from these five."
      : "Unmarked. Nothing is recorded for today either way.",
  });
});

today.post("/alerts/refresh", async (c) => {
  const now = Date.now();
  const open = await c.env.DB
    .prepare(`SELECT id, name, terminal_check FROM owned_deliverables WHERE state IN ('open','blocked')`)
    .all<{ id: string; name: string; terminal_check: string }>();

  const rechecked: { id: string; name: string; met: boolean; progress: string }[] = [];
  for (const d of open.results ?? []) {
    const check = TERMINAL_CHECKS[d.terminal_check];
    if (!check) continue;
    const outcome = await check(c.env).catch(() => null);
    if (!outcome) continue;
    rechecked.push({ id: d.id, name: d.name, met: outcome.met, progress: outcome.progress });
  }

  const probes = await c.env.DB
    .prepare(`SELECT id, label, state, checked_at FROM credential_probes ORDER BY id`)
    .all<any>()
    .catch(() => ({ results: [] as any[] }));

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "today", entityId: dayId(now),
    action: "alerts_refreshed", detail: { rechecked: rechecked.length },
  });

  return ok(c, {
    refreshed_at: now,
    rechecked,
    /*
     * NAMED HONESTLY. These are the only facts on the screen this endpoint cannot make current, and
     * saying so beats a refresh button that silently leaves half the answer as old as it was.
     */
    credentials: (probes as { results?: any[] }).results ?? [],
    credentials_note:
      "Credential answers come from the daily prober on your Mac, which this cannot run — it holds no Google keys. " +
      "Run npm run credentials:check to make those current.",
  });
});

/**
 * ── RESOLVED RE-VERIFIES. IT DOES NOT TAKE HER WORD ───────────────────────
 *
 * `TERMINAL_CHECKS` exists so that nothing can close a commitment by claiming it — an employee, a
 * run and a job are all refused. A HUMAN MARKING SOMETHING RESOLVED IS THE SAME CLAIM WEARING
 * DIFFERENT CLOTHES: if she marks the West Peek grant resolved and Scooter has not granted it, the
 * system believes a false thing and stops telling her, which is exactly the blindness this system
 * spent the day removing.
 *
 * So this runs the check. If the world agrees, it closes and says what it counted. IF THE CHECK
 * CONTRADICTS HER IT SAYS SO AND STAYS OPEN — she is not overruled, she is told what the records
 * say, and offered the dismissal, which is honest about not being a resolution.
 */
today.post("/alerts/resolve", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const id = String(b?.deliverable_id ?? "").trim();

  /*
   * ── EVERY ALERT CAN BE RE-TESTED, NOT JUST AN OWNED DELIVERABLE ───────────
   *
   *   "and the dimiss and mark resolved buttons dont work"
   *
   * "Mark resolved" was gated on `source_id?.startsWith("del_")`. Of the alerts actually on her
   * screen, NONE had a `del_` source id — so the button she was complaining about was not on the
   * page at all. A control that exists in the source and never on the screen is this repository's
   * most-repeated defect wearing a button.
   *
   * THE GENERAL RE-TEST IS RECOMPUTING. Every alert on Today is DERIVED ON READ from the records,
   * so "is this still true" has one honest answer for all of them: build the surface again and see
   * whether this alert is still raised. That needs no per-source registry to fall out of step with
   * the producers — a new alert type is re-testable the day it is written, which a registry could
   * never promise.
   *
   * THE DELIVERABLE PATH IS UNTOUCHED AND STILL WINS. `TERMINAL_CHECKS` does something recomputing
   * cannot: it refuses her assertion when the records disagree, and says so. That is the design
   * that stops an employee, a job — or she herself — closing work that is not finished, and it
   * stays exactly as it was.
   */
  if (!id.startsWith("del_")) {
    const key = String(b?.key ?? "").trim();
    if (!key) throw badRequest("An alert must name itself to be re-tested", "Pass the alert key the screen was given.");

    const day = await ensureDay(c.env.DB, dayId(Date.now()));
    const blocks = await assembleDayFlow(c.env, day);
    const alertsBlock = blocks.find((x) => x.key === "critical_alerts");
    const content = (alertsBlock?.content ?? {}) as { alerts?: { text: string }[]; keys?: string[] };
    const at = (content.keys ?? []).indexOf(key);

    await audit(c.env.DB, {
      actor: "boss", lane: "ops", entityType: "today", entityId: dayId(Date.now()),
      action: "alert_rechecked", detail: { key, still_raised: at !== -1 },
    });

    if (at === -1) {
      return ok(c, {
        closed: true,
        verdict: "Re-checked against the records: that condition is no longer true, so the alert is gone.",
      });
    }
    return ok(c, {
      closed: false,
      /*
       * SHOWN VERBATIM, INCLUDING THE PART THAT DISAGREES WITH HER. The alert text is recomputed,
       * so a condition that has changed shape says the new thing rather than the one she pressed.
       */
      verdict:
        `Still true — re-checked just now and the records say: ${content.alerts?.[at]?.text ?? "the alert stands."} ` +
        "Nothing here is closed by saying so. If you want it off the screen without it being fixed, dismiss it with a reason.",
    });
  }

  const row = await c.env.DB
    .prepare(`SELECT id, name, terminal_check, state FROM owned_deliverables WHERE id = ?`)
    .bind(id)
    .first<{ id: string; name: string; terminal_check: string; state: string }>();
  if (!row) throw notFound("No owned deliverable with that id");

  const check = TERMINAL_CHECKS[row.terminal_check];
  if (!check) {
    return ok(c, {
      closed: false,
      verdict: `"${row.name}" names a completion check this system does not have, so nothing can verify it either way. That is a fault to fix rather than something to close.`,
    });
  }

  const outcome = await check(c.env).catch(() => null);
  if (!outcome) {
    return ok(c, { closed: false, verdict: "The check could not be evaluated, so nothing was closed on the strength of it." });
  }

  if (!outcome.met) {
    return ok(c, {
      closed: false,
      /*
       * THE SENTENCE THAT MATTERS. She asked to close it; the records say otherwise, and saying so
       * plainly is the only outcome that leaves her better informed than before she pressed it.
       */
      verdict:
        `Not closed — the records disagree. ${outcome.progress} ` +
        "Nothing here can be marked done by saying it is; that is what stops an employee or a job closing your work. " +
        "If you want it off the screen without it being finished, dismiss it with a reason.",
    });
  }

  const now = Date.now();
  await c.env.DB
    .prepare(`UPDATE owned_deliverables SET state = 'done', done_at = ?, updated_at = ? WHERE id = ?`)
    .bind(now, now, id)
    .run();
  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "owned_deliverable", entityId: id,
    action: "verified_and_closed", detail: { progress: outcome.progress },
  });
  return ok(c, { closed: true, verdict: `Verified and closed. ${outcome.progress}` });
});

/**
 * ── DISMISS: A SNOOZE WITH A REASON, NEVER A MUTE ─────────────────────────
 *
 * "Stop showing me this, it is not resolved" is a real state and needs to exist. Three things stop
 * it becoming the silence it resembles: it EXPIRES (there is no way to express "never"), it BREAKS
 * IF THE ALERT GETS LOUDER, and it COSTS A REASON — so next week the same alert can say "you
 * dismissed this on the 9th because X" instead of arriving as though it were new, which is how the
 * grant item went unnoticed for three weeks.
 */
today.post("/alerts/dismiss", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const key = String(b?.key ?? "").trim();
  const text = String(b?.text ?? "").trim();
  const reason = String(b?.reason ?? "").trim();
  const severity = String(b?.severity ?? "medium").trim();

  if (!key || !text) throw badRequest("Name the alert being dismissed", "Without its key the dismissal cannot be matched on the next render.");
  if (reason.length < 3) {
    throw badRequest(
      "A dismissal needs a reason",
      "Not to make this tedious — so that when it comes back it can say why you put it aside, instead of arriving as if it were new.",
    );
  }

  const now = Date.now();
  const days = Math.min(30, Math.max(1, Number(b?.days ?? 7) || 7));
  await c.env.DB
    .prepare(
      `INSERT INTO alert_dismissals
         (id, alert_key, alert_text, reason, severity_at_dismissal, dismissed_at, until, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .bind(newId("dsm"), key, text.slice(0, 600), reason.slice(0, 300), severity, now, now + days * 86_400_000, now)
    .run();

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "alert", entityId: key,
    action: "dismissed", detail: { reason: reason.slice(0, 120), days },
  });
  return ok(c, { dismissed_until: now + days * 86_400_000, days }, 201);
});

/**
 * The packet on its own, so something outside the browser can deliver it.
 *
 * IT LIVES INSIDE THE MEETINGS BLOCK TOO, and that was the whole problem: a finished thing whose
 * only route to her is a page she has to remember to open is the same defect this system keeps
 * producing. `scripts/ops/packet-remind.mjs` reads this and puts it in front of her.
 *
 * Available on any day, unlike the block. A reminder that could only fetch the packet on the two
 * days it renders could not be tested on a Thursday, and a delivery path nobody can exercise is one
 * that silently breaks.
 */
today.get("/packet/:counterpart", async (c) => {
  const day = await ensureDay(c.env.DB, c.req.query("day_id") ?? dayId(Date.now()));
  return ok(c, await weeklyPacket(c.env, day.id, c.req.param("counterpart")));
});

today.get("/agenda/:counterpart", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT id, title, detail, source, status, priority, raised_at, created_at
         FROM meeting_agenda_items WHERE counterpart = ?
        ORDER BY status = 'open' DESC, priority ASC, created_at ASC`,
    )
    .bind(c.req.param("counterpart"))
    .all();
  return ok(c, { items: rows.results ?? [] });
});

today.post("/agenda/:counterpart", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const title = b?.title ? String(b.title).trim() : "";
  if (!title) throw badRequest("An agenda item needs a title", "Send { title, detail?, priority? }.");

  const priority = Number(b?.priority);
  const id = newId("mai");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO meeting_agenda_items (id, counterpart, title, detail, source, priority, section, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?, 'open', ?, ?)`,
    )
    .bind(id, c.req.param("counterpart"), title, b?.detail ? String(b.detail) : null,
          b?.source ? String(b.source) : "owner",
          [1, 2, 3].includes(priority) ? priority : 2,
          // `misc` is a one-off to have in the room; `raise` is something needing his decision.
          b?.section === "misc" ? "misc" : "raise", now, now)
    .run();
  return ok(c, { id, title }, 201);
});

/**
 * Mark an item as actually discussed.
 *
 * `raised` RATHER THAN DELETED, because an item that keeps coming back is a pattern — the same
 * request made three Wednesdays running is a different conversation from a fresh idea, and a
 * deleted row cannot tell her that.
 */
today.post("/agenda/:counterpart/:id/raised", async (c) => {
  const res = await c.env.DB
    .prepare(`UPDATE meeting_agenda_items SET status = 'raised', raised_at = ?, updated_at = ? WHERE id = ? AND counterpart = ? AND status = 'open'`)
    .bind(Date.now(), Date.now(), c.req.param("id"), c.req.param("counterpart"))
    .run();
  if (!res.meta.changes) throw notFound("No open agenda item with that id for that counterpart");
  return ok(c, { raised: true });
});

/**
 * Something came up.
 *
 * NOT A GATE, ON PURPOSE. Gates are rituals with times; an emergency is at 3pm on a Thursday. This
 * appends to today rather than recomputing it, so the morning contract still stands as the thing
 * the Night Gate scores against and the interruption is visible instead of erased. See
 * `today/adjust.ts` for why re-running the Morning Gate would have been the wrong shape.
 */
today.post("/adjust", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const what = b?.what ? String(b.what) : "";
  if (!what) {
    throw badRequest(
      "An adjustment needs to say what changed",
      'Send { what, kind } — kind is "emergency", "reprioritise", "added" or "dropped".',
    );
  }

  const kindRaw = b?.kind ? String(b.kind) : "added";
  const kinds = ["emergency", "reprioritise", "added", "dropped"] as const;
  if (!kinds.includes(kindRaw as (typeof kinds)[number])) {
    throw badRequest(`"${kindRaw}" is not an adjustment kind`, `One of: ${kinds.join(", ")}.`);
  }

  const day = await ensureDay(c.env.DB, b?.day_id ? String(b.day_id) : dayId(Date.now()));
  const result = await adjustToday(c.env, day.id, {
    kind: kindRaw as (typeof kinds)[number],
    what,
    instead_of: b?.instead_of ? String(b.instead_of) : null,
  });

  const refreshed = await ensureDay(c.env.DB, day.id);
  return ok(c, {
    ...result,
    day: refreshed,
    /*
     * SAID OUT LOUD WHEN THE ENGINE GETS DISPLACED. §5.3 gives the brokerage right of first refusal
     * on the first money move, so dropping it is a real decision rather than a scheduling detail —
     * and a week of quietly displaced anchors is exactly the thing she would otherwise only notice
     * in the revenue.
     */
    note: result.anchor_displaced
      ? "This displaced today's first money move. That is allowed, and it is recorded — §5.3 gives the brokerage right of first refusal, so a run of these is worth seeing."
      : "Recorded. The morning contract still stands as written; this sits beside it.",
  }, 201);
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

  /*
   * LAW 4 VERSUS THE MIDDAY RESET — the conflict the owner named, drawn where she asked for a line.
   *
   * "No Mid-Day Renegotiation: the day is an execution environment. Emotional spikes do not rewrite
   * the morning plan." And yet this gate exists to adjust the day. Both are right, and the
   * difference is not WHETHER the plan changes but WHY:
   *
   *   STABILISING is reality changing — a meeting moved, a deal landed, the body gave out. The
   *   Operator Discipline track states it exactly: "plans execute unless reality changes."
   *   RENEGOTIATING is the same plan looking harder than it did at 7am.
   *
   * So dropping a priority now requires `because`, in her own words, and the reset is REFUSED
   * without it. That is the track's other rule made mechanical — "renegotiation must be explicit" —
   * and it is deliberately not a block: she can still drop anything she likes, she just cannot do it
   * silently. A gate that quietly absorbed a dropped priority would let Law 4 be broken by default.
   */
  const dropped = Array.isArray(b.dropped) ? b.dropped.map(String).filter((d: string) => d.trim()) : [];
  const because = b.because ? String(b.because).trim() : "";
  if (dropped.length && !because) {
    throw badRequest(
      "Dropping something at midday needs a reason",
      "Law 4: the day is an execution environment. Plans execute unless REALITY changes — so name what changed. " +
        "Send { because }. If nothing changed and it just looks harder than it did this morning, that is the law talking, not the plan.",
    );
  }

  const adjustments = {
    note: b.adjustments ? String(b.adjustments) : null,
    dropped,
    because: because || null,
    // Recorded so a week of these can be read back. Repeated "reality changed" is itself a pattern.
    classification: dropped.length ? "stabilised" : "unchanged",
  };
  const approvalSweep = {
    pending_by_risk: pendingByRisk,
    open_loops: stillOpen?.n ?? 0,
    swept_at: Date.now(),
  };

  await ensureRunOfShow(c.env, day.id);
  await closeBlocksForGate(c.env, day.id, "midday");

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

  const tomorrowId = nextDayId(day.id);
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

  /*
   * THE VERDICT — §14, scored against §13's five floors.
   *
   * §14.2 is the rule that shapes this: "Ask what was completed before assigning a verdict. DO NOT
   * GUESS COMPLETION." So the floors come from the request — from her — and NOTHING here infers one
   * from the database. A closed Run of Show block is not evidence she manifested; a logged movement
   * is not evidence she reached ten minutes. A floor she does not answer stays `unknown`, and
   * `scoreDay` carries that forward as an open question rather than rounding it.
   *
   * NOT REQUIRED, DELIBERATELY. A night gate that refuses to close without five answers is one she
   * abandons at 11pm, and Law 2 puts continuity above completeness. An unscored day records that it
   * was unscored.
   */
  const verdict = b.floors ? scoreDay(b.floors as Record<string, unknown>) : null;

  /*
   * DID THE ANCHOR HAPPEN? The one question the Night Gate never asked, about the one line the
   * whole morning is built around.
   *
   * §14.2 APPLIES HERE EXACTLY AS IT DOES TO THE FLOORS: "DO NOT GUESS COMPLETION." This is read
   * from her answer and inferred from nothing — a closed Run of Show block is not evidence a touch
   * happened. Unanswered stays `unknown` rather than being counted as a miss, because a night she
   * was too tired to close the gate is not the same as a day she skipped the work, and conflating
   * the two would make the streak mean nothing.
   *
   * NOT REQUIRED, for the same reason the floors are not: a gate that refuses to close without it
   * is one she abandons at 11pm, and Law 2 puts continuity above completeness.
   */
  const anchorRaw = b.anchor;
  const anchorOutcome: "done" | "missed" | "unknown" =
    anchorRaw?.done === true ? "done" : anchorRaw?.done === false ? "missed" : "unknown";
  const anchorNote = anchorRaw?.note ? String(anchorRaw.note) : null;

  const entry = await recordGate(c.env, day, "night", { attention, review, evidence, tomorrow_seed: seed, promotions, verdict }, {
    night_completed_at: Date.now(),
    night_attention: JSON.stringify(attention),
    night_promotions: JSON.stringify(promotions),
    night_evidence: JSON.stringify({ ...evidence, review }),
    night_tomorrow_seed: JSON.stringify(seed),
    anchor_outcome: anchorOutcome,
    anchor_note: anchorNote,
    ...(verdict
      ? { verdict: verdict.verdict, verdict_floors: JSON.stringify(verdict.floors), verdict_at: Date.now() }
      : {}),
  });

  /*
   * THE PATTERN, NOT THE DAY. One missed anchor is a Tuesday and this says nothing about it;
   * treating a single miss as a failure is how a system teaches someone to stop telling it the
   * truth. A run of them is the thing she asked this to notice on her behalf, and it is surfaced
   * here — at the close, where she is already looking — rather than waiting for her to go and ask.
   */
  const streak = await anchorStreak(c.env, day.id);

  // Evening Close and Night Reset are what this gate is; both close with it.
  await ensureRunOfShow(c.env, day.id);
  await closeBlocksForGate(c.env, day.id, "night");

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

  return ok(c, {
    gate: entry, day: refreshed, blocks, promotions, tomorrow_seed: seed, verdict,
    anchor: { outcome: anchorOutcome, note: anchorNote, streak },
  }, 201);
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
        `SELECT m.provider_id, COUNT(*) AS models, GROUP_CONCAT(m.slug, CHAR(10)) AS slugs
           FROM models m JOIN providers p ON p.id = m.provider_id
          WHERE m.enabled = 1 AND p.enabled = 1
          GROUP BY m.provider_id`,
      )
      .all<{ provider_id: string; models: number; slugs: string | null }>(),
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
      if (!stats) return null;
      /*
       * FREE MEANS NOTHING IS BILLED, NOT THAT THE PRICE COLUMN SAYS ZERO.
       *
       * This read `MAX(in_micros_1k + out_micros_1k) === 0`, which was right only while nobody had
       * priced anything. Migration 0248 recorded Cloudflare's own published rates for the two
       * Workers AI models and this label immediately flipped to "not free" — for the one backend
       * she actually uses, whose calls still cost exactly nothing, because what makes them free is
       * the INCLUDED DAILY ALLOWANCE and not a number in a column.
       *
       * `routeIsBilled` is the single statement of which tiers a vendor gives away, read from
       * `backends/guard.ts`'s own FREE_ROUTES — the same function the router orders candidates by.
       * A backend is shown as free when every model she could reach on it is unbilled, so a
       * provider carrying one metered model is not advertised as free on the strength of the others.
       */
      const slugs = (stats.slugs ?? "").split("\n").filter(Boolean);
      const free = slugs.length > 0 && slugs.every((slug) => !routeIsBilled(b.id, slug));
      return { id: b.id, display_name: b.display_name, models: stats.models, free };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .sort((a, b) => Number(b.free) - Number(a.free) || a.display_name.localeCompare(b.display_name));

  /*
   * ── WHAT THIS IS, BEFORE ANY OF THE APPARATUS ────────────────────────────
   *
   * She screenshotted this section and said: "AND THIS IS THE COACHING SECTION? IT DOESNT LOOK LIKE
   * A COACHING SECTION AT FIRST GLANCE."
   *
   * She was right, and the defect is one of ORDER rather than content. The first thing on the screen
   * was a privacy disclaimer, the button named a Cloudflare product, and nothing anywhere said what
   * coaching would do for her. Every sentence was true and the section never stated its own point —
   * reassurance is not an introduction, and she cannot weigh a promise about data handling before
   * she knows what the thing is.
   *
   * So the payload now leads with purpose and the caveats follow. `LOCAL_ONLY` is gone from what she
   * reads: it is an internal classification constant and she is not its audience.
   */
  const chosen = await c.env.DB
    .prepare(`SELECT value FROM settings WHERE key = 'coaching_backend'`)
    .first<{ value: string }>()
    .catch(() => null);

  return ok(c, {
    day_id: day,
    heading: "Coaching",
    purpose:
      "Five minutes before you start, to find the thing you are avoiding and settle what today is actually for. " +
      "One question at a time, at most five, and you end it whenever you want by saying you are ready.",
    if_ignored: "Nothing happens. The day runs without it and nothing is recorded either way.",
    // The button says what pressing it causes, in her words. Not a vendor's product name.
    action_label: "Start coaching",
    /*
     * WHY IT ASKS EVERY DAY, SAID OUT LOUD. A gate with no stated reason reads as an obstacle, and
     * an obstacle is how a good feature ends up unused. It is daily rather than permanent because
     * the thing being consented to is a model READING WHAT SHE TYPES THAT MORNING — a standing
     * permission would be consent given once for words not yet written. She can also revoke it.
     */
    why_daily:
      "It asks once a day because what you are agreeing to is a model reading what you type this morning. " +
      "A permanent yes would be consent given in advance for words you have not written yet.",
    consent,
    max_turns: MAX_TURNS,
    exit_phrases: EXIT_PHRASES,
    backends,
    /*
     * WHICH BRAIN IS ANSWERING, NAMED ON THE SCREEN. A verified turn on 9 September was served by
     * Llama 3.1 8B while the button said "Workers AI" — two true statements that together tell her
     * nothing about what read her words. Her instruction is that this route gets the best model
     * available, so the screen says which one it currently is and what it would take to change it.
     */
    coaching_backend: chosen?.value ?? "bk_workers_ai",
    day_mode: row?.day_mode ?? null,
    day_mode_source: row?.day_mode_source ?? null,
    /*
     * SAID OUT LOUD IN THE PAYLOAD, not only in a comment, because the client renders it and she
     * should be able to read the promise on the screen where she is deciding.
     */
    storage: "Nothing you type here is stored by Boss OS. The conversation lives only in this browser.",
    cost_note:
      (chosen?.value ?? "bk_workers_ai") === "bk_workers_ai"
        ? "Free today: it runs on Cloudflare's included allowance. That also means a small model — a frontier one needs a key in the vault, and this is the one place worth paying for."
        : "This route is the deliberate exception to the cheap-by-default rule, at roughly a cent a morning. The budget never skips it: it is you asking directly.",
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
  // The coach is told the SAME number her badge shows. A model briefed on a count nobody else can
  // see would talk to her about an inbox that does not exist.
  const [loops, approvals] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM open_loops WHERE status = 'open'`).first<{ n: number }>(),
    pendingApprovals(c.env.DB),
  ]);

  const system = buildCoachingPrompt({
    anchor: dayRow?.morning_contract ?? null,
    openLoops: loops?.n ?? 0,
    approvalsWaiting: approvals.total,
    turn,
    dayMode: (dayRow?.day_mode as any) ?? null,
  });

  // Only the current turn and at most two prior exchanges travel. A morning is not a transcript.
  const recent = (body.recent ?? []).slice(-FORWARDED_TURNS * 2);

  const result = await runCoachingTurn(c.env, consent.backend_id, system, recent, text);
  // `off_route` travels too: it is the router's own view of the run, and a screen that showed
  // `degraded: false` while the ledger recorded a fallback would be two true statements that read
  // as a contradiction to anyone comparing them.
  return ok(c, {
    ended: false, reply: result.reply, backend_id: consent.backend_id,
    degraded: result.degraded, off_route: result.off_route,
  });
});

/**
 * Close (or reopen) a Run of Show block she owns.
 *
 * THE THREE BLOCKS NO GATE CAN SPEAK FOR: the two wealth blocks and the food check. Nothing this
 * system observes proves she made a brokerage move or ate in her lane, and marking them done because
 * a gate ran would be the system claiming to know something it does not.
 *
 * REOPENING IS ALLOWED, and it is not an edge case. A block ticked by accident at 9am and left wrong
 * all day is worse than one she can untick — and `done_source` records that she did it, so a
 * gate-closed block reopened by hand still reads as her decision.
 */
today.post("/run-of-show/:key", async (c) => {
  const key = c.req.param("key");
  const block = RUN_OF_SHOW.find((b) => b.key === key);
  if (!block) {
    throw notFound(`"${key}" is not one of the seven Run of Show blocks`);
  }

  const body = await c.req.json<{ done?: boolean; day_id?: string }>().catch(() => ({}) as { done?: boolean; day_id?: string });
  const day = await ensureDay(c.env.DB, body.day_id ? String(body.day_id) : dayId(Date.now()));
  await ensureRunOfShow(c.env, day.id);

  const done = body.done !== false;
  await c.env.DB
    .prepare(
      `UPDATE run_of_show SET done_at = ?, done_source = ? WHERE day_id = ? AND block_key = ?`,
    )
    .bind(done ? Date.now() : null, done ? "boss" : null, day.id, key)
    .run();

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "run_of_show", entityId: `${day.id}:${key}`,
    action: done ? "closed" : "reopened", detail: { block: block.title },
  });

  return ok(c, { day_id: day.id, blocks: await readRunOfShow(c.env, day.id) });
});

/**
 * The five floors, so the Night Gate form asks her §13.2's questions in §13.2's words.
 *
 * SERVED RATHER THAN RESTATED IN THE CLIENT. A screen that spelled the floors itself would be a
 * second copy of her contract, free to drift from the one that scores the day.
 */
today.get("/floors", (c) => ok(c, { floors: FLOORS }));

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
