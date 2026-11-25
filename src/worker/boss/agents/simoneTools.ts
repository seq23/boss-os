import type { Env } from "../env";
import { newId } from "../lib/id";
import { SIMONE, SIMONE_AVAILABLE, type SimoneMessage } from "./simone";
import { addressesIn, confirmLine, errandIn, ERRAND_MONEY_RE, DEFAULT_MAILBOX, OWNER_TZ } from "../../../shared/boss/commands/parse.mjs";
import { audit } from "../lib/audit";
import { getCommand, runInvite } from "../commands/run";
import { mailboxAllowed } from "../commands/google";
import { parseMail } from "../../../shared/mail/parseMail.mjs";
import { readEverything } from "../intake/readFiles";
import { headline, MAX_BODY_BYTES } from "../intake/inboundMail";
import { partiesAnswer } from "../capital/grid";
import { amendLiveBook, removeFromLiveBook, storeLiveBook } from "../capital/book";
import { readJsonObject } from "../router/types";
import { stopDeliverable } from "../today/deliverables";
import { GmailSession } from "../outreach/gmail";

const READS = {
  morning: `SELECT day, updated_at, sent_at FROM morning_digests ORDER BY day DESC LIMIT 3`,
  invitations: `SELECT id, title, starts_at, ends_at, status FROM owner_invitations ORDER BY starts_at DESC LIMIT 30`,
  errands: `SELECT id, state, updated_at FROM boss_commands WHERE kind = 'errand' ORDER BY updated_at DESC LIMIT 30`,
  meeting_prep: `SELECT id, state, updated_at FROM boss_commands WHERE kind = 'meeting_prep' ORDER BY updated_at DESC LIMIT 30`,
  kdp: `SELECT title_ref, label, state, updated_at FROM kdp_titles ORDER BY updated_at DESC LIMIT 30`,
  mail_tail: `SELECT id, received_at, authorised, subject, outcome, reply_state FROM boss_inbound_mail ORDER BY received_at DESC LIMIT 30`,
  commitments: `SELECT id, name, state, current_status FROM owned_deliverables
    WHERE employee_id = 'emp_chief' AND state IN ('open','blocked') ORDER BY updated_at DESC LIMIT 50`,
  team: `SELECT t.id, t.title, t.status, t.started_at, t.finished_at, e.name AS employee FROM tasks t
    JOIN employees e ON e.id = t.employee_id WHERE t.lane = 'ops' AND t.employee_id <> 'emp_chief'
      AND t.status IN ('failed','running','queued') ORDER BY t.created_at DESC LIMIT 30`,
} as const;

async function fileCommand(env: Env, kind: "errand" | "invite", task: string, mail: string | null, spec: Record<string, unknown>, now: number) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${kind}:${task}`));
  const key = Array.from(new Uint8Array(hash).slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const id = `cmd_${key}`;
  const [write] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO boss_commands (id, mail_id, kind, state, spec, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
      .bind(id, mail, kind, kind === "errand" ? "queued" : "new",
        JSON.stringify(kind === "invite" ? { ...spec, provider_event_id: key } : spec), now, now),
    ...(mail ? [env.DB.prepare(`UPDATE boss_inbound_mail SET command_id = ? WHERE id = ? AND task_id = ? AND authorised = 1`)
      .bind(id, mail, task)] : []),
  ]);
  return { id, created: Boolean(write?.meta.changes) };
}

function inviteSpec(value: unknown, ownerText: string) {
  try {
    if (typeof value !== "string" || value.length > 2000) return null;
    const { guest, name, at, minutes, zone, calendar = DEFAULT_MAILBOX } = JSON.parse(value);
    if (typeof guest !== "string" || !addressesIn(ownerText).includes(guest.toLowerCase())) return null;
    if (typeof at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(at)) return null;
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
  const active = await env.DB.prepare(`SELECT id, input, created_at FROM tasks WHERE id = ? AND employee_id = ? AND status = 'running'
    AND attempts = ? AND CASE WHEN json_valid(input) THEN json_extract(input, '$.agent') END = 'simone'
    AND ${SIMONE_AVAILABLE}`)
    .bind(request.id, SIMONE, request.lease).first<{ id: string; input: string; created_at: number }>();
  if (!active) return { ok: false, code: "STALE_SIMONE_RUN" } as const;
  if (Object.hasOwn(READS, request.tool)) {
    const { results } = await env.DB.prepare(READS[request.tool as keyof typeof READS]).all();
    return { ok: true, rows: results } as const;
  }
  if (request.tool === "search_workspace_mail" || request.tool === "read_workspace_mail") {
    const value = typeof request.task === "string" ? request.task.trim() : "";
    const search = request.tool === "search_workspace_mail";
    if (!value || (search ? value.length > 300 : !/^[a-z0-9]{1,64}$/i.test(value))) {
      return { ok: false, code: "MAIL_QUERY_REQUIRED" } as const;
    }
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
      const material = await readEverything(env, await parseMail(await archive.text()), message.body);
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
  if (request.tool === "queue_errand" || request.tool === "create_invite") {
    const message: SimoneMessage = JSON.parse(active.input);
    const original = message.source === "boss_inbound_mail" && message.mail_id
      ? await env.DB.prepare(`SELECT from_addr FROM boss_inbound_mail WHERE id = ? AND authorised = 1 AND task_id = ?`)
        .bind(message.mail_id, request.id).first<{ from_addr: string }>()
      : null;
    if (request.tool === "queue_errand") {
      const spec = original && errandIn({ sender: original.from_addr, text: message.body });
      if (!spec) return { ok: false, code: "ERRAND_NOT_AUTHORIZED" } as const;
      const command = await fileCommand(env, "errand", request.id, message.mail_id!,
        { ...spec, owner_email: original.from_addr }, now);
      if (command.created) await audit(env.DB, {
        actor: "owner", lane: "ops", entityType: "boss_command", entityId: command.id, action: "errand_approved_by_her_email",
        detail: { mail_id: message.mail_id, simone_run: request.id },
      });
      return { ok: true, receipt: command.id } as const;
    }
    const namedByOwner = original || message.source === "boss_page" || message.source === "tell_simone";
    if (!namedByOwner || ERRAND_MONEY_RE.test(message.body)) return { ok: false, code: "INVITE_NOT_AUTHORIZED" } as const;
    const spec = inviteSpec(request.task, message.body);
    if (!spec || spec.start <= active.created_at) return { ok: false, code: "INVITE_DETAILS_MISSING" } as const;
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
  if (typeof request.task !== "string" || request.task.length > 160) return { ok: false, code: "TASK_REQUIRED" } as const;
  // Keep approvals, repo lanes and external effects out of the repair tool. There is no generic API proxy.
  const changed = await env.DB.prepare(`UPDATE tasks SET status = 'queued', error = NULL, finished_at = NULL
    WHERE id = ? AND status = 'failed' AND lane = 'ops' AND employee_id <> ? AND risk = 'low' AND audience = 'internal'
      AND execution_assignment = 'AI_EXECUTE_WITH_NOTICE' AND intake_kind IN ('research','one_off') AND envelope_id IS NOT NULL
      AND attempts < 3
      AND NOT EXISTS (SELECT 1 FROM repo_changes WHERE task_id = tasks.id)
    RETURNING id, lane`).bind(request.task, SIMONE).first<{ id: string; lane: string }>();
  if (!changed) return { ok: false, code: "TASK_NOT_RETRYABLE" } as const;
  try {
    await env.TASKS.send({ taskId: changed.id, lane: changed.lane });
  } catch {
    await env.DB.prepare(`UPDATE tasks SET status = 'failed', error = 'QUEUE_UNAVAILABLE', finished_at = ?
      WHERE id = ? AND status = 'queued'`).bind(now, changed.id).run();
    return { ok: false, code: "QUEUE_UNAVAILABLE" } as const;
  }
  await env.DB.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'requeued',?)`)
    .bind(newId("tev"), changed.id, now, JSON.stringify({ by: "Simone", run: request.id })).run();
  return { ok: true, receipt: changed.id } as const;
}
