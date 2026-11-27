import type { Env } from "../env";
import { newId, sha256Hex } from "../lib/id";
import { AppError } from "../lib/http";
import { SIMONE, SIMONE_AVAILABLE, type SimoneMessage } from "./simone";
import { accessCodeIn, addressesIn, bookingWhen, confirmLine, errandDateIn, errandProblems, freeErrandRecipient, ERRAND_MONEY_RE, DEFAULT_MAILBOX, OWNER_TZ } from "../../../shared/boss/commands/parse.mjs";
import { audit, auditOfPrevious } from "../lib/audit";
import { answerMeetingPrep, getCommand, runInvite, verifiedBookingChannels } from "../commands/run";
import { calendarAgenda, cancelCalendarBlock, clashes, editCalendarBlock, mailboxAllowed, putOnCalendar, type CalendarBlockPeriod,
  type CalendarBlockVersion } from "../commands/google";
import { parseMail } from "../../../shared/mail/parseMail.mjs";
import { readEverything, readWorkspaceDriveFile, searchWorkspaceDrive } from "../intake/readFiles";
import { headline, MAX_BODY_BYTES } from "../intake/inboundMail";
import { partiesAnswer } from "../capital/grid";
import { amendLiveBook, removeFromLiveBook, storeLiveBook } from "../capital/book";
import { readJsonObject } from "../router/types";
import { stopDeliverable } from "../today/deliverables";
import { OUTREACH_MAILBOX } from "../outreach/catalog";
import { simoneAccountGate, simoneAccounts, simoneWorkspace } from "./simoneAccounts";
import { GmailSession } from "../outreach/gmail";
import { brainEditsFromMail, oneBrain } from "../brains/store";
import { DISMISS_CODE_RE, dismissMatch, tapByCode } from "../capital/dismiss";
import { recordConstraints } from "../service/constraints";
import { commandOf } from "../../../shared/boss/mail/morningReply.mjs";
import { morningReplyFromMail } from "../intake/morningReply";
import { campaignFromMail } from "../outreach/campaign";
import { steerRound } from "../service/round";
import { appendDutyInstruction, repoInstructions, saveDutyPause, SIMONE_DUTY_PAUSE_REASON, type OwnedDuty } from "../duties/ownerEdits";
import { routeFixedDutyChange } from "../duties/editByMail";
import { dayOf } from "../../../shared/boss/schedule/clock.mjs";
import { readKdpCaseChecks, readKdpPublishAttempts } from "../kdp/history";
import { containsCredential } from "../../../shared/boss/service/secretLines.mjs";
import { quoteStands } from "../../../shared/boss/text/wholeSentence.mjs";
import { OPERATIONS_ENABLED, operatingStopped } from "../lib/operatingStop";
import { operatingReport } from "./simoneOperations";
import { reviewedFreeDrafts } from "../router/experience";
import { isIntakeKind } from "../../../shared/boss/governance";
import { jobClassOf, SHORT } from "../../../shared/boss/aiRoles.mjs";
import { SIMONE_MANAGED_SEATS, SIMONE_TOOL_STEPS, simoneRoutePreference } from "./simoneAuthority";

export const SIMONE_RECORD_READS = {
  morning: `SELECT day, updated_at, sent_at FROM morning_digests ORDER BY day DESC LIMIT 3`,
  invitations: `SELECT id, title, starts_at, ends_at, status FROM owner_invitations ORDER BY starts_at DESC LIMIT 30`,
  errands: `SELECT id, state, updated_at FROM boss_commands WHERE kind = 'errand' ORDER BY updated_at DESC LIMIT 30`,
  meeting_prep: `SELECT id, state, updated_at, json_extract(spec, '$.who') AS attendee,
    json_extract(spec, '$.event.title') AS title, json_extract(spec, '$.event.start') AS start
    FROM boss_commands WHERE kind = 'meeting_prep' ORDER BY updated_at DESC LIMIT 30`,
  kdp: `SELECT title_ref, label, state, updated_at FROM kdp_titles ORDER BY updated_at DESC LIMIT 30`,
  kdp_watch: readKdpCaseChecks,
  kdp_publish_attempts: (db: D1Database) => readKdpPublishAttempts(db, 12),
  mail_tail: `SELECT id, received_at, authorised, subject, outcome, reply_state FROM boss_inbound_mail ORDER BY received_at DESC LIMIT 30`,
  duties: (db: D1Database) => db.prepare(`SELECT d.id, d.name, e.name AS employee, d.executor, d.suspended,
    d.suspended_reason IS ? AS paused_by_simone, d.last_outcome, d.last_outcome_at FROM standing_duties d
    JOIN employees e ON e.id = d.employee_id WHERE d.removed_at IS NULL ORDER BY e.name, d.name`)
    .bind(SIMONE_DUTY_PAUSE_REASON).all().then(({ results }) => results),
  commitments: `SELECT id, name, state, current_status FROM owned_deliverables
    WHERE employee_id = 'emp_chief' AND state IN ('open','blocked') ORDER BY updated_at DESC LIMIT 50`,
  team: `SELECT t.id, t.title, t.status, t.started_at, t.finished_at, e.name AS employee FROM tasks t
    JOIN employees e ON e.id = t.employee_id WHERE t.lane = 'ops' AND t.employee_id <> 'emp_chief'
      AND t.status IN ('failed','running','queued') ORDER BY t.created_at DESC LIMIT 30`,
} as const;

const OFFSET_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;
const SIMONE_LIVE_RUN = `tasks.id = ? AND employee_id = ? AND status = 'running'
  AND attempts = ? AND CASE WHEN json_valid(input) THEN json_extract(input, '$.agent') END = 'simone'
  AND ${SIMONE_AVAILABLE} AND ${OPERATIONS_ENABLED}`;

function dateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = Date.parse(value);
  return Number.isFinite(instant) && dayOf(instant, "UTC") === value;
}

async function fileCommand(env: Env, kind: "access_code" | "errand" | "invite", task: string, mail: string | null,
  spec: Record<string, unknown>, now: number, errandLease?: number) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${kind}:${task}`));
  const key = Array.from(new Uint8Array(hash).slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const id = `cmd_${key}`;
  const errandGuard = errandLease === undefined ? "" : `WHERE EXISTS (SELECT 1 FROM tasks WHERE ${SIMONE_LIVE_RUN})
    AND EXISTS (SELECT 1 FROM boss_inbound_mail WHERE id = ? AND task_id = ? AND authorised = 1
      AND dmarc_pass = 1 AND outcome = 'SIMONE_QUEUED')`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO boss_commands (id, mail_id, kind, state, spec, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ? ${errandGuard} ON CONFLICT(id) DO NOTHING`)
      .bind(id, mail, kind, kind === "invite" ? "new" : "queued",
        JSON.stringify(kind === "invite" ? { ...spec, provider_event_id: key } : spec), now, now,
        ...(errandLease === undefined ? [] : [task, SIMONE, errandLease, mail, task])),
    ...(errandLease === undefined ? [] : [auditOfPrevious(env.DB, {
      actor: "owner", lane: "ops", entityType: "boss_command", entityId: id, action: "errand_approved_by_her_email",
      detail: { mail_id: mail, simone_run: task, previous_booking: spec.previous_booking },
    }, "rows", { onlyIfChanged: true })]),
    ...(mail ? [env.DB.prepare(`UPDATE boss_inbound_mail SET command_id = ? WHERE id = ? AND task_id = ? AND authorised = 1
      AND EXISTS (SELECT 1 FROM boss_commands WHERE id = ?)
      ${errandLease === undefined ? "" : `AND EXISTS (SELECT 1 FROM tasks WHERE ${SIMONE_LIVE_RUN})`}`)
      .bind(id, mail, task, id, ...(errandLease === undefined ? [] : [task, SIMONE, errandLease]))] : []),
  ]);
  return { id };
}

function inviteSpec(value: unknown, ownerText: string) {
  try {
    if (typeof value !== "string" || value.length > 2000) return null;
    const { guest, name, at, minutes, zone, calendar = DEFAULT_MAILBOX } = JSON.parse(value);
    if (typeof guest !== "string" || !addressesIn(ownerText).includes(guest.toLowerCase())) return null;
    if (typeof at !== "string" || !OFFSET_TIMESTAMP.test(at)) return null;
    const start = Date.parse(at);
    if (!Number.isFinite(start) || !Number.isInteger(minutes) || minutes < 1 || minutes > 480) return null;
    if (typeof calendar !== "string" || (calendar !== "personal" && !mailboxAllowed(calendar))) return null;
    if (calendar !== DEFAULT_MAILBOX && calendar !== "personal" && !ownerText.toLowerCase().includes(calendar.toLowerCase())) return null;
    const guestName = typeof name === "string" && name.length <= 80 && ownerText.includes(name.trim()) ? name.trim() : null;
    const tz = new Intl.DateTimeFormat("en-US", { timeZone: typeof zone === "string" ? zone : OWNER_TZ }).resolvedOptions().timeZone;
    return { start, minutes, tz, calendar, guest_email: guest.toLowerCase(), guest_name: guestName, title: `Meeting with ${guestName || guest}` };
  } catch {
    return null;
  }
}

export async function simoneTool(env: Env, request: { id: string; lease: number; tool: string; task?: unknown }, now = Date.now()) {
  if (await operatingStopped(env.DB)) return { ok: false, code: "OWNER_STOPPED_OPERATIONS" } as const;
  const activeRun = SIMONE_LIVE_RUN;
  const lease = [request.id, SIMONE, request.lease] as const;
  const active = await env.DB.prepare(`UPDATE tasks SET input = json_set(input, '$.simone_tool_steps',
      COALESCE(json_extract(input, '$.simone_tool_steps'), 0) + 1)
    WHERE ${activeRun} AND COALESCE(json_extract(input, '$.simone_tool_steps'), 0) < ?
    RETURNING id, input, created_at`)
    .bind(...lease, SIMONE_TOOL_STEPS).first<{ id: string; input: string; created_at: number }>();
  if (!active) {
    const exhausted = await env.DB.prepare(`SELECT 1 FROM tasks WHERE ${activeRun}
      AND json_extract(input, '$.simone_tool_steps') >= ?`).bind(...lease, SIMONE_TOOL_STEPS).first();
    return { ok: false, code: exhausted ? "SIMONE_STEP_CAP" : "STALE_SIMONE_RUN" } as const;
  }
  switch (request.tool) {
    case "github": {
      const message: SimoneMessage = JSON.parse(active.input);
      const trusted = message.source === "boss_page" || message.source === "tell_simone" || message.source === "simone_daily" ||
        (message.source === "boss_inbound_mail" && message.mail_id && await env.DB.prepare(`SELECT id FROM boss_inbound_mail
          WHERE id = ? AND task_id = ? AND authorised = 1 AND dmarc_pass = 1 AND outcome = 'SIMONE_QUEUED'`)
          .bind(message.mail_id, request.id).first());
      if (!trusted || !await env.DB.prepare(`SELECT 1 FROM tasks WHERE ${activeRun}
        AND json_extract(input, '$.steer_pending') IS NULL`).bind(...lease).first()) {
        return { ok: false, code: "GITHUB_NOT_AUTHORIZED" } as const;
      }
      return { ok: true } as const;
    }
    case "google_accounts":
      return { ok: true, rows: (await simoneAccounts(env, now)).filter(({ enabled }) => enabled) } as const;
    case "gmail": case "calendar": case "drive": case "docs": case "sheets":
      return { ...await simoneWorkspace(env, request.tool, request.task, now) };
  }
  if (request.tool === "pause_failed_duty" || request.tool === "resume_recovered_duty") {
    const paused = request.tool === "pause_failed_duty";
    const timestampKey = paused ? "failed_at" : "recovered_at";
    const invalid = paused ? "DUTY_FAILURE_REQUIRED" : "DUTY_RECOVERY_REQUIRED";
    const refused = paused ? "DUTY_NOT_PAUSABLE" : "DUTY_NOT_RESUMABLE";
    const args = typeof request.task === "string" && request.task.length <= 500 ? readJsonObject(request.task) : null;
    const id = args?.id;
    const outcomeAt = args?.[timestampKey];
    if (typeof id !== "string" || !id || id.length > 160 ||
        typeof outcomeAt !== "number" || !Number.isSafeInteger(outcomeAt) || outcomeAt <= 0 || outcomeAt > now ||
        Object.keys(args ?? {}).some((key) => key !== "id" && key !== timestampKey)) {
      return { ok: false, code: invalid } as const;
    }
    const operation = `dv_simone_${paused ? "pause" : "resume"}_${await sha256Hex(JSON.stringify([request.id, id, outcomeAt]))}`;
    const duty = await env.DB.prepare(`SELECT * FROM standing_duties
      WHERE id = ? AND lane = 'ops' AND employee_id IN (${SIMONE_MANAGED_SEATS}) AND removed_at IS NULL`)
      .bind(id).first<OwnedDuty>();
    if (!duty || containsCredential(duty.name, env)) return { ok: false, code: refused } as const;
    const liveRun = `${activeRun} AND json_extract(input, '$.steer_pending') IS NULL`;
    const changeAllowed = paused ? {
      sql: `NOT EXISTS (SELECT 1 FROM duty_versions
        WHERE duty_id = ? AND action IN ('resume', 'undo') AND suspended = 0 AND created_at >= ?)`,
      args: [id, outcomeAt],
    } : {
      sql: `EXISTS (SELECT 1 FROM standing_duties WHERE id = ? AND suspended_reason = ?)
        AND EXISTS (SELECT 1 FROM duty_versions WHERE duty_id = ? AND action = 'pause'
          AND created_at < ? AND version = (SELECT MAX(version) FROM duty_versions WHERE duty_id = ?))`,
      args: [id, SIMONE_DUTY_PAUSE_REASON, id, outcomeAt, id],
    };
    const saved = Boolean(duty.suspended) === paused ? null : await saveDutyPause(env, duty, paused, now, {
      operation, run: request.id, outcomeAt,
      check: {
        sql: `EXISTS (SELECT 1 FROM tasks WHERE ${liveRun})
          AND EXISTS (SELECT 1 FROM standing_duties
            WHERE id = ? AND lane = 'ops' AND employee_id IN (${SIMONE_MANAGED_SEATS}) AND last_outcome = ? AND last_outcome_at = ?)
          AND ${changeAllowed.sql}`,
        args: [...lease, id, paused ? "failed" : "ok", outcomeAt, ...changeAllowed.args],
      },
    });
    const version = saved ?? await env.DB.prepare(`SELECT v.version FROM standing_duties d
        JOIN duty_versions v ON v.duty_id = d.id
      WHERE d.id = ? AND d.removed_at IS NULL AND d.suspended = ? AND v.id = ?
        AND v.version = (SELECT MAX(version) FROM duty_versions WHERE duty_id = d.id)
        AND EXISTS (SELECT 1 FROM tasks WHERE ${liveRun})`).bind(id, Number(paused), operation, ...lease).first<number>("version");
    if (version === null) return { ok: false, code: refused } as const;
    return { ok: true, receipt: operation, duty: id, name: duty.name, state: paused ? "paused" : "scheduled", version } as const;
  }
  if (request.tool === "model_routing") {
    const args = typeof request.task === "string" && request.task.length <= 500 ? readJsonObject(request.task) : null;
    const employeeId = args?.employee;
    const kind = args?.kind;
    const choice = args?.model;
    if (typeof employeeId !== "string" || !isIntakeKind(kind) || kind === "research" ||
        jobClassOf({ intakeKind: kind }) !== SHORT ||
        (choice !== undefined && typeof choice !== "string") ||
        Object.keys(args ?? {}).some((key) => !["employee", "kind", "model"].includes(key))) {
      return { ok: false, code: "REVIEWED_DRAFT_SCOPE_REQUIRED" } as const;
    }
    const employeeName = await env.DB.prepare(`SELECT name FROM employees WHERE id = ? AND id IN (${SIMONE_MANAGED_SEATS})`)
      .bind(employeeId).first<string>("name");
    if (!employeeName) return { ok: false, code: "MANAGED_AGENT_REQUIRED" } as const;
    const candidates = await reviewedFreeDrafts(env.DB, kind);
    const key = simoneRoutePreference(employeeId, kind);
    if (choice === undefined) {
      return { ok: true, current: await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<string>("value") ?? "subscription",
        models: candidates.map(({ model, record }) => ({ id: model.id, name: model.display_name, outcomes: record.sentence })) } as const;
    }
    const match = candidates.find(({ model }) => model.id === choice);
    if (choice !== "subscription" && !match) return { ok: false, code: "FREE_MODEL_NOT_PROVEN" } as const;
    const line = match
      ? `Simone moved ${employeeName}'s reviewed ${kind} work to ${match.model.display_name} after ${match.record.succeeded} of ${match.record.runs} measured outputs passed.`
      : `Simone returned ${employeeName}'s reviewed ${kind} work to a subscription seat.`;
    const [written] = await env.DB.batch([
      env.DB.prepare(`INSERT INTO settings (key, value, updated_at)
        SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM tasks WHERE ${activeRun} AND json_extract(input, '$.steer_pending') IS NULL)
          AND EXISTS (SELECT 1 FROM employees WHERE id = ? AND id IN (${SIMONE_MANAGED_SEATS}))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE value <> excluded.value`)
        .bind(key, choice, now, ...lease, employeeId),
      env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail)
        SELECT ?, ?, ?, 'simone_route_changed', ? WHERE changes() > 0`)
        .bind(newId("tev"), request.id, now, JSON.stringify({ line })),
    ]);
    if (!written?.meta.changes) {
      const current = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?
        AND EXISTS (SELECT 1 FROM tasks WHERE ${activeRun} AND json_extract(input, '$.steer_pending') IS NULL)`)
        .bind(key, ...lease).first<string>("value");
      if (current !== choice) return { ok: false, code: "STALE_ROUTING_CHANGE" } as const;
    }
    return { ok: true, receipt: "model_routing", changed: Boolean(written?.meta.changes), selected: choice } as const;
  }
  if (request.tool === "operations") {
    const page = request.task == null ? 0 : Number(request.task);
    if (!Number.isSafeInteger(page) || page < 0 || page >= 100) {
      return { ok: false, code: "OPERATIONS_PAGE_REQUIRED" } as const;
    }
    const report = await operatingReport(env.DB, now);
    if (!report) return { ok: false, code: "OPERATIONS_NOT_CHECKED_TODAY" } as const;
    const start = page * 20;
    return { ok: true, receipt: "operations", day: report.day, total: report.rows.length,
      issues: page === 0 ? report.issues.slice(0, 12) : [], issueCount: report.issues.length, proposal: report.proposal,
      rows: report.rows.slice(start, start + 20), nextPage: start + 20 < report.rows.length ? page + 1 : null } as const;
  }
  if (Object.hasOwn(SIMONE_RECORD_READS, request.tool)) {
    const read = SIMONE_RECORD_READS[request.tool as keyof typeof SIMONE_RECORD_READS];
    const rows = typeof read === "string" ? (await env.DB.prepare(read).all()).results : await read(env.DB);
    return { ok: true, rows } as const;
  }
  if (request.tool === "team_task") {
    if (typeof request.task !== "string" || !request.task || request.task.length > 160) {
      return { ok: false, code: "TASK_REQUIRED" } as const;
    }
    const task = await env.DB.prepare(`SELECT t.id, t.title, t.status, t.attempts, e.name AS employee,
        t.error, t.started_at, t.finished_at, r.backend_id, r.status AS runner_status,
        r.claimed_at AS runner_claimed_at, r.finished_at AS runner_finished_at,
        c.repo, c.phase AS repo_phase, c.pr_url, c.checks_state, c.failure AS repo_failure,
        a.last_at AS stale_checked_at, a.task_id AS repair_task_id, repair.status AS repair_status
      FROM tasks t JOIN employees e ON e.id = t.employee_id
      LEFT JOIN backend_runs r ON r.id = (SELECT id FROM backend_runs WHERE task_id = t.id ORDER BY started_at DESC, id DESC LIMIT 1)
      LEFT JOIN repo_changes c ON c.task_id = t.id
      LEFT JOIN system_alarms a ON a.alarm_key = 'task:' || t.id AND a.status = 'open' AND t.status = 'running'
      LEFT JOIN tasks repair ON repair.id = a.task_id
      WHERE t.id = ? AND t.lane = 'ops' AND t.employee_id <> ?`)
      .bind(request.task, SIMONE).first<{ error: string | null; repo_failure: string | null }>();
    if (!task) return { ok: false, code: "TEAM_TASK_NOT_FOUND" } as const;
    const { results: events } = await env.DB.prepare(`SELECT ts, event FROM task_events
      WHERE task_id = ? ORDER BY ts DESC, id DESC LIMIT 10`).bind(request.task).all();
    if (containsCredential(JSON.stringify({ task, events }), env)) return { ok: false, code: "SECRET_OUTPUT" } as const;
    return { ok: true, receipt: request.task, task: {
      ...task, error: task.error?.slice(0, 600) ?? null, repo_failure: task.repo_failure?.slice(0, 600) ?? null,
    }, events } as const;
  }
  if (request.tool === "calendar_busy" || request.tool === "calendar_agenda") {
    const args = typeof request.task === "string" && request.task.length <= 500 ? readJsonObject(request.task) : null;
    const calendar = args?.calendar ?? DEFAULT_MAILBOX;
    const from = args?.from;
    const to = args?.to;
    if (!args || (request.tool === "calendar_agenda" && Object.keys(args).some((key) => !["from", "to", "calendar"].includes(key))) ||
        typeof calendar !== "string" || !mailboxAllowed(calendar) ||
        typeof from !== "string" || !OFFSET_TIMESTAMP.test(from) ||
        typeof to !== "string" || !OFFSET_TIMESTAMP.test(to)) {
      return { ok: false, code: "CALENDAR_WINDOW_REQUIRED" } as const;
    }
    const start = Date.parse(from);
    const end = Date.parse(to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 14 * 86_400_000) {
      return { ok: false, code: "CALENDAR_WINDOW_REQUIRED" } as const;
    }
    if (!await simoneAccountGate(env, calendar.toLowerCase(), "calendar", now)) return { ok: false, code: "GOOGLE_ACCOUNT_OFF" } as const;
    try {
      const read = request.tool === "calendar_agenda" ? calendarAgenda : clashes;
      const result = await read(env, calendar.toLowerCase(), start, end);
      if (!result.ok) return { ok: false, code: "CALENDAR_UNAVAILABLE" } as const;
      if (containsCredential(JSON.stringify(result), env)) return { ok: false, code: "SECRET_OUTPUT" } as const;
      return { ...result, receipt: request.tool } as const;
    } catch {
      return { ok: false, code: "CALENDAR_UNAVAILABLE" } as const;
    }
  }
  if (request.tool === "block_calendar" || request.tool === "edit_calendar_block" || request.tool === "cancel_calendar_block") {
    const message: SimoneMessage = JSON.parse(active.input);
    const args = typeof request.task === "string" && request.task.length <= 2500 ? readJsonObject(request.task) : null;
    const editing = request.tool === "edit_calendar_block";
    const cancelling = request.tool === "cancel_calendar_block";
    const allowedFields = editing ? ["quote", "title", "from", "to", "newTitle", "minutes", "through", "calendar"]
      : cancelling ? ["quote", "title", "from", "calendar"]
      : ["quote", "title", "at", "minutes", "date", "through", "calendar"];
    const calendar = args?.calendar ?? DEFAULT_MAILBOX;
    const quote = args?.quote;
    const title = typeof args?.title === "string" ? args.title.trim() : "";
    if (!args || Object.keys(args).some((key) => !allowedFields.includes(key)) ||
        typeof quote !== "string" || quote.length < 8 || !message.body.includes(quote) ||
        !title || title.length > 120 || !quote.includes(title) ||
        typeof calendar !== "string" || !mailboxAllowed(calendar) ||
        (calendar !== DEFAULT_MAILBOX && !addressesIn(quote).includes(calendar.toLowerCase()))) {
      return { ok: false, code: "CALENDAR_BLOCK_NOT_AUTHORIZED" } as const;
    }
    if (message.source === "boss_inbound_mail") {
      const original = message.mail_id && await env.DB.prepare(`SELECT id FROM boss_inbound_mail
        WHERE id = ? AND task_id = ? AND authorised = 1 AND outcome = 'SIMONE_QUEUED'`)
        .bind(message.mail_id, request.id).first();
      if (!original) return { ok: false, code: "CALENDAR_BLOCK_NOT_AUTHORIZED" } as const;
    } else if (message.source !== "boss_page" && message.source !== "tell_simone") {
      return { ok: false, code: "CALENDAR_BLOCK_NOT_AUTHORIZED" } as const;
    }
    const mailbox = calendar.toLowerCase();
    if (!await simoneAccountGate(env, mailbox, "calendar", now)) return { ok: false, code: "GOOGLE_ACCOUNT_OFF" } as const;
    if (cancelling) {
      const { from } = args;
      const allDay = dateOnly(from);
      const start = typeof from === "string" ? Date.parse(from) : NaN;
      const valid = allDay ? from >= dayOf(active.created_at, OWNER_TZ)
        : typeof from === "string" && OFFSET_TIMESTAMP.test(from) && start > active.created_at;
      if (!valid) return { ok: false, code: "CALENDAR_BLOCK_TIME_REQUIRED" } as const;
      const key = `tev_calendar_cancel_${await sha256Hex(JSON.stringify([request.id, mailbox, title, allDay, start]))}`;
      try {
        const saved = await env.DB.prepare("SELECT detail FROM task_events WHERE id = ?").bind(key).first<string>("detail");
        const previous = saved ? JSON.parse(saved) as CalendarBlockVersion : null;
        const result = await cancelCalendarBlock(env, { mailbox, title, allDay, from: start }, previous, async (target) => {
          // Record the original provider version before deletion. A retry may have a new lease but keeps this target.
          const [, pinned] = await env.DB.batch<{ detail: string }>([
            env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail)
              SELECT ?, tasks.id, ?, 'calendar_cancel_target', ? FROM tasks WHERE ${activeRun} ON CONFLICT(id) DO NOTHING`)
              .bind(key, now, JSON.stringify(target), ...lease),
            env.DB.prepare(`SELECT task_events.detail FROM tasks JOIN task_events ON task_events.task_id = tasks.id
              WHERE task_events.id = ? AND ${activeRun}`).bind(key, ...lease),
          ]);
          return pinned?.results[0] ? JSON.parse(pinned.results[0].detail) as CalendarBlockVersion : null;
        });
        if (!result.ok) return result;
        return { ok: true, receipt: result.eventId, title, calendar: mailbox, state: "cancelled",
          ...(allDay ? { date: from } : { start }) } as const;
      } catch {
        return { ok: false, code: "CALENDAR_UNAVAILABLE" } as const;
      }
    }
    if (editing) {
      const { from, to = from, newTitle = title, minutes, through } = args;
      if (typeof newTitle !== "string" || !newTitle.trim() || newTitle !== newTitle.trim() ||
          newTitle.length > 120 || !quote.includes(newTitle)) {
        return { ok: false, code: "CALENDAR_BLOCK_NOT_AUTHORIZED" } as const;
      }
      if (typeof from !== "string" || typeof to !== "string") return { ok: false, code: "CALENDAR_BLOCK_TIME_REQUIRED" } as const;
      const allDay = dateOnly(from);
      const oldStart = Date.parse(from);
      const newStart = Date.parse(to);
      let duration: number | undefined;
      if (allDay) {
        const today = dayOf(active.created_at, OWNER_TZ);
        if (!dateOnly(to) || from < today || to < today || minutes !== undefined ||
            (through !== undefined && (!dateOnly(through) || through < to))) {
          return { ok: false, code: "CALENDAR_BLOCK_TIME_REQUIRED" } as const;
        }
        if (typeof through === "string") duration = Date.parse(through) - newStart + 86_400_000;
      } else if (!OFFSET_TIMESTAMP.test(from) || !OFFSET_TIMESTAMP.test(to) || through !== undefined ||
          !(oldStart > active.created_at && newStart > active.created_at) ||
          (minutes !== undefined && (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440))) {
        return { ok: false, code: "CALENDAR_BLOCK_TIME_REQUIRED" } as const;
      } else if (typeof minutes === "number") {
        duration = minutes * 60_000;
      }
      if (oldStart === newStart && title === newTitle && duration === undefined) {
        return { ok: false, code: "CALENDAR_BLOCK_TIME_REQUIRED" } as const;
      }
      // Keep the key for timed edits so a retry after an update can recover its existing provider receipt.
      const key = allDay ? [request.id, mailbox, title, from, to, newTitle, through]
        : [request.id, mailbox, title, oldStart, newStart, newTitle, minutes];
      const requestKey = await sha256Hex(JSON.stringify(key));
      try {
        const result = await editCalendarBlock(env, { mailbox, title, allDay, from: oldStart, to: newStart, newTitle, duration, requestKey });
        if (!result.ok) return { ok: false, code: result.code } as const;
        const time = allDay ? { date: to, through: dayOf(result.end, "UTC", -1) } : { start: newStart, end: result.end };
        return { ok: true, receipt: result.eventId, title: result.title, ...time, calendar: mailbox } as const;
      } catch {
        return { ok: false, code: "CALENDAR_UNAVAILABLE" } as const;
      }
    }
    const { at, minutes } = args;
    let period: CalendarBlockPeriod;
    if ("date" in args || "through" in args) {
      const { date, through = date } = args;
      if (!dateOnly(date) || !dateOnly(through) || date < dayOf(active.created_at, OWNER_TZ) ||
          through < date || at !== undefined || minutes !== undefined) {
        return { ok: false, code: "CALENDAR_BLOCK_TIME_REQUIRED" } as const;
      }
      const end = dayOf(Date.parse(through), "UTC", 1);
      if (!dateOnly(end)) return { ok: false, code: "CALENDAR_BLOCK_TIME_REQUIRED" } as const;
      period = { allDay: true, start: date, end };
    } else {
      if (typeof at !== "string" || !OFFSET_TIMESTAMP.test(at) ||
          typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
        return { ok: false, code: "CALENDAR_BLOCK_TIME_REQUIRED" } as const;
      }
      const start = Date.parse(at);
      if (!Number.isFinite(start) || start <= active.created_at) return { ok: false, code: "CALENDAR_BLOCK_TIME_REQUIRED" } as const;
      period = { allDay: false, start, end: start + minutes * 60_000 };
    }
    const eventId = (await sha256Hex(JSON.stringify(["simone-calendar-block", request.id, mailbox, title, period.start, period.end]))).slice(0, 32);
    try {
      const result = await putOnCalendar(env, { mailbox, eventId, title, ...period, where: null, note: "" });
      if (result.ok) {
        const time = period.allDay
          ? { date: period.start, through: dayOf(Date.parse(period.end), "UTC", -1) }
          : { start: period.start, end: period.end };
        return { ok: true, receipt: result.eventId, title, ...time, calendar: mailbox } as const;
      }
    } catch { /* A write or readback failure has no completion receipt. */ }
    return { ok: false, code: "CALENDAR_UNAVAILABLE" } as const;
  }
  if (request.tool === "change_duty") {
    const message: SimoneMessage = JSON.parse(active.input);
    const args = typeof request.task === "string" && request.task.length <= 12_000 ? readJsonObject(request.task) : null;
    const quote = typeof args?.quote === "string" ? args.quote.trim() : "";
    const id = typeof args?.id === "string" ? args.id : "";
    if (message.source === "simone_daily" || !id || id.length > 160 || quote.length < 8 ||
        quote.length > 8000 || !message.body.includes(quote)) {
      return { ok: false, code: "DUTY_INSTRUCTION_REQUIRED" } as const;
    }
    const duty = await env.DB.prepare(`SELECT * FROM standing_duties WHERE id = ? AND removed_at IS NULL`)
      .bind(id).first<OwnedDuty>();
    if (!duty) return { ok: false, code: "DUTY_NOT_FOUND" } as const;

    const key = (await sha256Hex(JSON.stringify(["simone-duty", request.id, duty.id, quote]))).slice(0, 32);
    if (repoInstructions(duty, now)) {
      const saved = await appendDutyInstruction(env, duty, quote, `dv_${key}`, active.created_at, now);
      if (!saved) return { ok: false, code: "DUTY_EDIT_NOT_SAVED" } as const;
      return { ok: true, receipt: duty.id, state: "edited", name: duty.name, version: saved.version } as const;
    }

    const taskId = `tsk_${key}`;
    const filed = () => env.DB.prepare(`SELECT r.id, r.github_repo, t.status FROM repo_changes r JOIN tasks t ON t.id = r.task_id
      WHERE r.task_id = ? AND t.employee_id = 'emp_repo' AND t.envelope_id IS NOT NULL`)
      .bind(taskId).first<{ id: string; github_repo: string | null; status: string }>();
    let change = await filed();
    let dispatched = false;
    if (!change) {
      try {
        const admitted = await routeFixedDutyChange(env, duty, quote, {
          source: message.source === "boss_inbound_mail" ? message.source : "boss_page",
          mailId: message.mail_id, sender: message.from, taskId,
        });
        dispatched = admitted.queued;
      } catch (error) {
        change = await filed();
        if (!change && error instanceof AppError && error.status === 400) {
          return { ok: false, code: "DUTY_CHANGE_REFUSED", note: error.message } as const;
        }
        if (!change) throw error;
      }
      change ??= await filed();
    }
    if (!change) return { ok: false, code: "DUTY_CHANGE_NOT_FILED" } as const;
    if (change.status === "queued" && !dispatched) await env.TASKS.send({ taskId, lane: "ops" });
    return { ok: true, receipt: change.id, state: "handed_to_danielle", repo: change.github_repo } as const;
  }
  if (request.tool === "read_brain") {
    const slug = typeof request.task === "string" ? request.task.trim() : "";
    if (!slug || slug.length > 80) return { ok: false, code: "BRAIN_REQUIRED" } as const;
    try {
      const brain = await oneBrain(env, slug);
      return { ok: true, receipt: brain.slug, brain } as const;
    } catch {
      return { ok: false, code: "BRAIN_UNAVAILABLE" } as const;
    }
  }
  if (request.tool === "route_partner_campaign") {
    const message: SimoneMessage = JSON.parse(active.input);
    const words = typeof request.task === "string" ? request.task.trim() : "";
    const viaConsole = message.console === true;
    if (message.source !== "boss_inbound_mail" || !message.mail_id || !words || words.length > 60_000 ||
        !message.body.includes(words)) {
      return { ok: false, code: "CAMPAIGN_INSTRUCTION_REQUIRED" } as const;
    }
    const result = await campaignFromMail(env, {
      text: words, subject: viaConsole ? message.subject : "", mailId: message.mail_id, messageId: message.message_id ?? null, now, viaConsole,
    });
    if (!result) return { ok: false, code: "CAMPAIGN_INSTRUCTION_REQUIRED" } as const;
    if (result.outcome === "CAMPAIGN_REFUSED") return { ok: false, code: "CAMPAIGN_REFUSED", note: result.reply } as const;
    return { ok: true, receipt: result.campaignId ?? message.mail_id, outcome: result.outcome, note: result.reply } as const;
  }
  if (request.tool === "edit_brain" || request.tool === "record_constraint" ||
      request.tool === "dismiss_match" || request.tool === "apply_morning_reply" ||
      request.tool === "direct_meeting_prep" || request.tool === "steer_thread" || request.tool === "time2read_access_code") {
    const message: SimoneMessage = JSON.parse(active.input);
    const args = typeof request.task === "string" && request.task.length <= 12_000 ? readJsonObject(request.task) : null;
    const quote = typeof args?.quote === "string" ? args.quote.trim() : "";
    if (message.source === "simone_daily" || !quote || !message.body.includes(quote)) {
      return { ok: false, code: "OWNER_INSTRUCTION_REQUIRED" } as const;
    }
    if (request.tool === "edit_brain") {
      const edit = await brainEditsFromMail(env, quote, message.mail_id ?? request.id, active.created_at);
      if (!edit) return { ok: false, code: "BRAIN_EDIT_REQUIRED" } as const;
      return { ok: true, receipt: request.id, note: edit.note } as const;
    }
    if (request.tool === "record_constraint") {
      if (quote.length < 6 || quote.length > 400) return { ok: false, code: "CONSTRAINT_LENGTH" } as const;
      const added = await recordConstraints(env, [quote], message.source, message.mail_id ?? null);
      return { ok: true, receipt: request.id, added } as const;
    }
    if (request.tool === "time2read_access_code") {
      const spec = accessCodeIn(quote);
      if (!spec || spec.op !== args?.action || spec.error ||
          (message.source === "boss_inbound_mail" && !message.mail_id)) {
        return { ok: false, code: "ACCESS_CODE_DETAILS_REQUIRED" } as const;
      }
      const command = await fileCommand(env, "access_code", request.id, message.mail_id ?? null, spec, now);
      const filed = await getCommand(env, command.id);
      const actual = filed && readJsonObject(filed.spec);
      if (actual?.op !== spec.op || actual.code !== spec.code || actual.trial_days !== spec.trial_days || actual.label !== spec.label) {
        return { ok: false, code: "ACCESS_CODE_ALREADY_FILED" } as const;
      }
      return { ok: true, receipt: command.id, state: filed?.state, code: spec.code } as const;
    }
    if (request.tool === "steer_thread") {
      const decision = args?.action;
      if ((decision !== "hold" && decision !== "resume" && decision !== "amend") ||
          message.source !== "boss_inbound_mail" || !message.mail_id || !message.from || !message.reply_chain?.length) {
        return { ok: false, code: "THREAD_INSTRUCTION_REQUIRED" } as const;
      }
      const result = await steerRound(env, {
        chain: message.reply_chain, owner: message.from, decision, own: quote, mailId: message.mail_id, now,
      });
      if (!result || result.outcome === "JOIN") return { ok: false, code: "THREAD_WORK_NOT_FOUND" } as const;
      return { ok: true, receipt: result.taskId, note: result.note, outcome: result.outcome } as const;
    }
    if (request.tool === "direct_meeting_prep") {
      const action = args?.action;
      const id = typeof args?.id === "string" ? args.id : "";
      if ((action !== "purpose" && action !== "personal") || !id || id.length > 160 || quote.length > 2000) {
        return { ok: false, code: "PREP_DIRECTION_REQUIRED" } as const;
      }
      const prep = await getCommand(env, id);
      const note = prep && await answerMeetingPrep(env, prep, action, quote, now, true);
      if (!note) return { ok: false, code: "PREP_NOT_WAITING" } as const;
      return { ok: true, receipt: id, note } as const;
    }
    if (request.tool === "apply_morning_reply") {
      const command = commandOf(quote);
      if ((command?.kind !== "public" && command?.kind !== "gate") || command.kind !== args?.kind || !message.mail_id) {
        return { ok: false, code: "MORNING_INSTRUCTION_REQUIRED" } as const;
      }
      const result = await morningReplyFromMail(env, {
        text: quote, refs: [], mailId: message.mail_id, now: active.created_at,
        read: { reply: null, answers: [], commands: [{ kind: command.kind, text: quote, n: null }] },
      });
      if (!result?.acted) return { ok: false, code: "MORNING_MESSAGE_REQUIRED" } as const;
      return { ok: true, receipt: request.id, note: result.note } as const;
    }
    const code = typeof args?.code === "string" ? args.code.toLowerCase() : "";
    if (!DISMISS_CODE_RE.test(code) || !quote.toLowerCase().includes(code)) {
      return { ok: false, code: "MATCH_CODE_REQUIRED" } as const;
    }
    const match = await tapByCode(env, code);
    if (!match) return { ok: false, code: "MATCH_NOT_FOUND" } as const;
    const result = await dismissMatch(env, match, message.mail_id ? "reply" : "owner_session", now);
    return { ok: true, receipt: code, ...result } as const;
  }
  if (request.tool === "read_personal_mail" || request.tool === "read_personal_drive") {
    const message: SimoneMessage = JSON.parse(active.input);
    const quote = typeof request.task === "string" ? request.task : "";
    const trustedScreen = message.source === "boss_page" || message.source === "tell_simone";
    const verifiedMail = message.source === "boss_inbound_mail" && message.mail_id &&
      await env.DB.prepare(`SELECT id FROM boss_inbound_mail
        WHERE id = ? AND task_id = ? AND authorised = 1 AND outcome = 'SIMONE_QUEUED'`)
        .bind(message.mail_id, request.id).first();
    if ((!trustedScreen && !verifiedMail) || quote.trim().length < 8 || quote.length > 2000 ||
        message.body.length > 12_000 || !message.body.includes(quote)) {
      return { ok: false, code: "PERSONAL_READ_INSTRUCTION_REQUIRED" } as const;
    }
    if (!await simoneAccountGate(env, env.BOSS_SIMONE_PERSONAL_GOOGLE_ACCOUNT?.toLowerCase() ?? null, request.tool === "read_personal_mail" ? "mail" : "drive", now)) {
      return { ok: false, code: "GOOGLE_ACCOUNT_OFF" } as const;
    }
    // Only the Mac holds the personal connector. Authorization itself is never a work receipt.
    return { ok: true, query: message.body } as const;
  }
  if (request.tool === "search_workspace_mail" || request.tool === "read_workspace_mail") {
    const value = typeof request.task === "string" ? request.task.trim() : "";
    const search = request.tool === "search_workspace_mail";
    if (!value || (search ? value.length > 300 : !/^[a-z0-9]{1,64}$/i.test(value))) {
      return { ok: false, code: "MAIL_QUERY_REQUIRED" } as const;
    }
    if (!await simoneAccountGate(env, OUTREACH_MAILBOX, "mail", now)) return { ok: false, code: "GOOGLE_ACCOUNT_OFF" } as const;
    const gmail = GmailSession.from(env);
    if (!gmail) return { ok: false, code: "WORKSPACE_MAIL_NOT_CONNECTED" } as const;
    try {
      if (search) return { ok: true, receipt: "workspace_mail_search", rows: await gmail.list(value, 15) } as const;
      const message = await gmail.read(value);
      return { ok: true, receipt: "workspace_mail_read", message: {
        id: message.id, threadId: message.threadId, date: message.internalDate,
        from: message.headers.from, to: message.headers.to, subject: message.headers.subject,
        body: message.body.slice(0, 20_000),
      } } as const;
    } catch {
      return { ok: false, code: "WORKSPACE_MAIL_UNAVAILABLE" } as const;
    }
  }
  if (request.tool === "search_workspace_drive" || request.tool === "read_workspace_drive") {
    const args = typeof request.task === "string" && request.task.length <= 3000 ? readJsonObject(request.task) : null;
    const search = request.tool === "search_workspace_drive";
    const title = typeof args?.title === "string" ? args.title.trim() : "";
    const pageToken = args?.pageToken;
    const id = typeof args?.id === "string" ? args.id : "";
    if (search ? (!title || title.length > 150 || /[\x00-\x1f]/.test(title) ||
        (pageToken !== undefined && (typeof pageToken !== "string" || !pageToken || pageToken.length > 2048))) :
        !/^[a-zA-Z0-9_-]{10,150}$/.test(id)) {
      return { ok: false, code: "DRIVE_QUERY_REQUIRED" } as const;
    }
    if (!await simoneAccountGate(env, DEFAULT_MAILBOX, "drive", now)) return { ok: false, code: "GOOGLE_ACCOUNT_OFF" } as const;
    if (!env.GSC_SERVICE_ACCOUNT_JSON) return { ok: false, code: "WORKSPACE_DRIVE_NOT_CONNECTED" } as const;
    try {
      if (search) {
        const page = await searchWorkspaceDrive(env, title, typeof pageToken === "string" ? pageToken : undefined);
        if (!page.rows.length && (page.incompleteSearch || page.nextPageToken)) return { ok: true, ...page } as const;
        return { ok: true, receipt: "workspace_drive_search", ...page } as const;
      }
      const files = await readWorkspaceDriveFile(env, id);
      if (!files.read.length) return { ok: false, code: "WORKSPACE_DRIVE_UNREAD", unopened: files.unopened } as const;
      return { ok: true, receipt: "workspace_drive_read", files } as const;
    } catch {
      return { ok: false, code: "WORKSPACE_DRIVE_UNAVAILABLE" } as const;
    }
  }
  if (request.tool === "deal_parties") {
    const args = typeof request.task === "string" && request.task.length <= 500 ? readJsonObject(request.task) : null;
    const company = typeof args?.company === "string" ? args.company.trim() : "";
    const side = args?.side;
    if (!company || company.length > 160 || (side !== "buy" && side !== "sell")) {
      return { ok: false, code: "DEAL_QUERY_REQUIRED" } as const;
    }
    try {
      const match = await partiesAnswer(env, { company, side }, now);
      if (!match) return { ok: false, code: "DEAL_COMPANY_NOT_ON_GRID" } as const;
      return { ok: true, receipt: "deals_grid", ...match } as const;
    } catch {
      return { ok: false, code: "DEAL_GRID_UNAVAILABLE" } as const;
    }
  }
  if (request.tool === "read_mail_material") {
    const message: SimoneMessage = JSON.parse(active.input);
    if (message.source !== "boss_inbound_mail" || !message.mail_id || !message.has_mail_material) {
      return { ok: false, code: "MAIL_MATERIAL_NOT_AVAILABLE" } as const;
    }
    const arrival = await env.DB.prepare(`SELECT object_key FROM boss_inbound_mail
      WHERE id = ? AND task_id = ? AND authorised = 1 AND outcome = 'SIMONE_QUEUED'`)
      .bind(message.mail_id, request.id).first<{ object_key: string | null }>();
    if (!arrival?.object_key) return { ok: false, code: "MAIL_ARCHIVE_UNAVAILABLE" } as const;
    try {
      const archive = await env.VAULT.get(arrival.object_key);
      if (!archive || archive.size > MAX_BODY_BYTES) return { ok: false, code: "MAIL_ARCHIVE_UNAVAILABLE" } as const;
      const driveAllowed = Boolean(await simoneAccountGate(env, DEFAULT_MAILBOX, "drive", now));
      const material = await readEverything(env, await parseMail(await archive.text()), message.body, { driveAllowed });
      return { ok: true, material, ...(material.read.length || material.heard.length ? { receipt: message.mail_id } : {}) } as const;
    } catch {
      return { ok: false, code: "MAIL_ARCHIVE_UNAVAILABLE" } as const;
    }
  }
  if (request.tool === "update_book") {
    const args = typeof request.task === "string" && request.task.length <= 60_000 ? readJsonObject(request.task) : null;
    const message: SimoneMessage = JSON.parse(active.input);
    const text = typeof args?.text === "string" ? args.text.trim() : "";
    const verb = args?.verb;
    if (message.source !== "boss_inbound_mail" || !message.mail_id || !text || !message.body.includes(text) ||
        (verb !== "book" && verb !== "add" && verb !== "remove")) {
      return { ok: false, code: "BOOK_INSTRUCTION_REQUIRED" } as const;
    }
    const original = await env.DB.prepare(`SELECT id FROM boss_inbound_mail
      WHERE id = ? AND task_id = ? AND authorised = 1 AND outcome = 'SIMONE_QUEUED'`)
      .bind(message.mail_id, request.id).first();
    if (!original) return { ok: false, code: "BOOK_INSTRUCTION_REQUIRED" } as const;
    const existing = await env.DB.prepare(`SELECT id, version FROM capital_book WHERE mail_id = ? ORDER BY version LIMIT 1`)
      .bind(message.mail_id).first<{ id: string; version: number }>();
    if (existing) return { ok: true, receipt: existing.id, version: existing.version, changed: false, failed: false,
      note: `This message was filed as book version ${existing.version}.` } as const;
    const input = { text, mailId: message.mail_id, now };
    const result = verb === "book" ? await storeLiveBook(env, { ...input, explicit: true })
      : verb === "add" ? await amendLiveBook(env, input) : await removeFromLiveBook(env, input);
    if (result.failed) {
      await env.DB.prepare(`UPDATE boss_inbound_mail SET why = ? WHERE id = ? AND task_id = ? AND authorised = 1`)
        .bind(headline(result.note).slice(0, 1000), message.mail_id, request.id).run();
    }
    return { ok: true, receipt: result.bookId ?? "book_checked", ...result } as const;
  }
  if (request.tool === "stop_commitment") {
    const args = typeof request.task === "string" && request.task.length <= 1000 ? readJsonObject(request.task) : null;
    const message: SimoneMessage = JSON.parse(active.input);
    const quote = typeof args?.quote === "string" ? args.quote.trim() : "";
    if (message.source === "simone_daily" || !quote || quote.length > 500 || !message.body.includes(quote) ||
        typeof args?.id !== "string" || args.id.length > 160) {
      return { ok: false, code: "COMMITMENT_INSTRUCTION_REQUIRED" } as const;
    }
    if (message.source === "boss_inbound_mail") {
      const original = message.mail_id && await env.DB.prepare(`SELECT id FROM boss_inbound_mail
        WHERE id = ? AND task_id = ? AND authorised = 1 AND outcome = 'SIMONE_QUEUED'`)
        .bind(message.mail_id, request.id).first();
      if (!original) return { ok: false, code: "COMMITMENT_INSTRUCTION_REQUIRED" } as const;
    }
    const owned = await env.DB.prepare(`SELECT name, state, killed_reason FROM owned_deliverables
      WHERE id = ? AND employee_id = ?`).bind(args.id, SIMONE)
      .first<{ name: string; state: string; killed_reason: string | null }>();
    if (owned?.state === "killed" && owned.killed_reason === quote) {
      return { ok: true, receipt: args.id, name: owned.name, state: "killed" } as const;
    }
    if (owned?.state !== "open" && owned?.state !== "blocked") return { ok: false, code: "COMMITMENT_NOT_OPEN" } as const;
    const stopped = await stopDeliverable(env, {
      id: args.id, reason: quote, via: message.source === "boss_inbound_mail" ? "mail" : "screen",
      mailId: message.mail_id, now, ifState: owned.state,
    });
    if (!stopped) return { ok: false, code: "COMMITMENT_NOT_OPEN" } as const;
    return { ok: true, receipt: args.id, name: owned.name, state: "killed" } as const;
  }
  if (request.tool === "booking_channels" || request.tool === "queue_errand" || request.tool === "create_invite") {
    const message: SimoneMessage = JSON.parse(active.input);
    const original = message.source === "boss_inbound_mail" && message.mail_id
      ? await env.DB.prepare(`SELECT from_addr FROM boss_inbound_mail WHERE id = ? AND authorised = 1 AND dmarc_pass = 1
          AND task_id = ? AND outcome = 'SIMONE_QUEUED'`)
        .bind(message.mail_id, request.id).first<{ from_addr: string }>()
      : null;
    if (request.tool === "booking_channels") {
      if (!original) return { ok: false, code: "ERRAND_NOT_AUTHORIZED" } as const;
      const rows = await verifiedBookingChannels(env, original.from_addr, now);
      return { ok: true, rows } as const;
    }
    if (request.tool === "queue_errand") {
      const args = typeof request.task === "string" && request.task.length <= 3000 ? readJsonObject(request.task) : null;
      const quote = args?.quote;
      if (!original || typeof quote !== "string" || !quote.trim() || quote.length > 2000 || !message.body.includes(quote)) {
        return { ok: false, code: "ERRAND_NOT_AUTHORIZED" } as const;
      }
      const previous = args?.previous_booking;
      let recipient: string | null = null;
      let subject = args?.subject;
      let phrase = args?.request;
      if (previous !== undefined) {
        if (typeof previous !== "string" || !/^cmd_[a-z0-9_-]{1,155}$/.test(previous) ||
            Object.keys(args ?? {}).some((key) => !["quote", "previous_booking", "at", "party"].includes(key)) ||
            !quoteStands(message.body, quote, ["NEGATES", "REPORTS"])) {
          return { ok: false, code: "ERRAND_NOT_AUTHORIZED" } as const;
        }
        const at = typeof args?.at === "string" && OFFSET_TIMESTAMP.test(args.at) ? Date.parse(args.at) : NaN;
        const party = args?.party;
        if (!Number.isFinite(at) || at <= now || at >= now + 365 * 86_400_000 ||
            typeof party !== "number" || !Number.isSafeInteger(party) || party < 1 || party > 99) {
          return { ok: false, code: "ERRAND_DETAILS_NOT_ALLOWED" } as const;
        }
        const [channel] = await verifiedBookingChannels(env, original.from_addr, now, previous);
        if (!channel) return { ok: false, code: "ERRAND_CHANNEL_UNAVAILABLE" } as const;
        recipient = channel.recipient;
        subject = "Reservation request";
        phrase = `a reservation for ${party} ${party === 1 ? "person" : "people"} on ${bookingWhen(at)} Eastern time`;
      } else if (Object.keys(args ?? {}).some((key) => !["quote", "subject", "request"].includes(key))) {
        return { ok: false, code: "ERRAND_NOT_AUTHORIZED" } as const;
      }
      const to = freeErrandRecipient(original.from_addr, quote, recipient);
      if (!to) return { ok: false, code: "ERRAND_NOT_AUTHORIZED" } as const;
      if (typeof subject !== "string" || subject.length > 100 || typeof phrase !== "string" ||
          /[\r\n]/.test(subject + phrase) || errandProblems({ subject, request: phrase }).length ||
          !errandDateIn(phrase, active.created_at) || ERRAND_MONEY_RE.test(subject) ||
          containsCredential(`${subject}\n${phrase}`, env)) {
        return { ok: false, code: "ERRAND_DETAILS_NOT_ALLOWED" } as const;
      }
      const command = await fileCommand(env, "errand", request.id, message.mail_id!,
        { to, ask: quote, owner_email: original.from_addr, subject: subject.trim(), request: phrase.trim(), free_only: true,
          previous_booking: previous }, now, request.lease);
      const stored = await getCommand(env, command.id);
      if (!stored) return { ok: false, code: "STALE_SIMONE_RUN" } as const;
      return { ok: true, receipt: command.id, state: stored.state, venue: JSON.parse(stored.spec).to } as const;
    }
    const namedByOwner = original || message.source === "boss_page" || message.source === "tell_simone";
    if (!namedByOwner || ERRAND_MONEY_RE.test(message.body)) return { ok: false, code: "INVITE_NOT_AUTHORIZED" } as const;
    const spec = inviteSpec(request.task, message.body);
    if (!spec || spec.start <= active.created_at) return { ok: false, code: "INVITE_DETAILS_MISSING" } as const;
    if (spec.calendar !== "personal" && !await simoneAccountGate(env, spec.calendar.toLowerCase(), "calendar", now)) {
      return { ok: false, code: "GOOGLE_ACCOUNT_OFF" } as const;
    }
    const command = await fileCommand(env, "invite", request.id, message.mail_id ?? null, spec, now);
    const stored = (await getCommand(env, command.id))!;
    if (stored.state === "cancelled") return { ok: false, code: "INVITE_CANCELLED" } as const;
    if (stored.state === "created") {
      const saved = JSON.parse(stored.spec);
      const result = JSON.parse(stored.result);
      return { ok: true, receipt: stored.id, state: stored.state, line: confirmLine({
        guestName: saved.guest_name, guestEmail: result.guest, start: saved.start,
        minutes: saved.minutes, tz: saved.tz, meet: result.meet, calendar: result.mailbox,
      }) } as const;
    }
    const claimed = await env.DB.prepare(`UPDATE boss_commands SET state = 'creating', updated_at = ?
      WHERE id = ? AND state NOT IN ('cancelled', 'created', 'expired')
        AND (state <> 'creating' OR updated_at <= ?) RETURNING id`)
      .bind(now, command.id, now - 5 * 60_000).first();
    if (!claimed) return { ok: false, code: stored.state === "expired" ? "INVITE_TIME_PASSED" : "INVITE_RUNNING" } as const;
    let line: string;
    try {
      line = await runInvite(env, stored, now);
    } catch {
      await env.DB.prepare(`UPDATE boss_commands SET state = 'failed' WHERE id = ? AND state = 'creating' AND updated_at = ?`)
        .bind(stored.id, now).run();
      return { ok: false, code: "CALENDAR_UNAVAILABLE" } as const;
    }
    const state = (await getCommand(env, command.id))?.state;
    if (state === "created" || state === "add_link") return { ok: true, receipt: command.id, state, line } as const;
    const code = state === "expired" ? "INVITE_TIME_PASSED" : state === "clash" ? "CALENDAR_CLASH" : "CALENDAR_UNAVAILABLE";
    return { ok: false, code, line } as const;
  }
  if (request.tool !== "retry_team_task") return { ok: false, code: "TOOL_NOT_ALLOWED" } as const;
  if (typeof request.task !== "string" || !request.task || request.task.length > 160) return { ok: false, code: "TASK_REQUIRED" } as const;
  const failed = await env.DB.prepare(`SELECT attempts, error, finished_at FROM tasks WHERE id = ? AND status = 'failed'`)
    .bind(request.task).first<{ attempts: number; error: string | null; finished_at: number | null }>();
  if (!failed) return { ok: false, code: "TASK_NOT_RETRYABLE" } as const;
  // A person’s hold, a still-open runner or a repo change needs its own workflow.
  const changed = await env.DB.prepare(`UPDATE tasks SET status = 'queued', error = NULL, finished_at = NULL
    WHERE id = ? AND status = 'failed' AND lane = 'ops' AND employee_id <> ? AND risk = 'low' AND audience = 'internal'
      AND execution_assignment = 'AI_EXECUTE_WITH_NOTICE' AND intake_kind IN ('research','one_off') AND envelope_id IS NOT NULL
      AND attempts < 3 AND attempts = ? AND error IS ? AND finished_at IS ?
      AND (input IS NULL OR CASE WHEN json_valid(input)
        THEN NOT COALESCE(json_extract(input, '$.held_by_her'), 0) AND NOT COALESCE(json_extract(input, '$.taken_over'), 0)
        ELSE 0 END)
      AND NOT EXISTS (SELECT 1 FROM repo_changes WHERE task_id = tasks.id)
      AND NOT EXISTS (SELECT 1 FROM backend_runs WHERE task_id = tasks.id AND finished_at IS NULL)
    RETURNING id, lane`).bind(request.task, SIMONE, failed.attempts, failed.error, failed.finished_at).first<{ id: string; lane: string }>();
  if (!changed) return { ok: false, code: "TASK_NOT_RETRYABLE" } as const;
  try {
    await env.TASKS.send({ taskId: changed.id, lane: changed.lane });
  } catch {
    await env.DB.prepare(`UPDATE tasks SET status = 'failed', error = ?, finished_at = ?
      WHERE id = ? AND status = 'queued' AND attempts = ? AND error IS NULL AND finished_at IS NULL`)
      .bind(failed.error, failed.finished_at, changed.id, failed.attempts).run();
    return { ok: false, code: "QUEUE_UNAVAILABLE" } as const;
  }
  await env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'requeued',?)`)
    .bind(newId("tev"), changed.id, now, JSON.stringify({ by: "Simone", run: request.id })).run();
  return { ok: true, receipt: changed.id } as const;
}
