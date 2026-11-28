import { z } from "zod";
import { BOSS_INTAKE_MAILBOX, SIMONE_MAILBOX } from "../../../shared/boss/intake/mail.mjs";
import { BRAND_MAILBOXES } from "../../../shared/boss/commands/parse.mjs";
import { containsCredential } from "../../../shared/boss/service/secretLines.mjs";
import { BOSS_ORIGIN } from "../../../shared/boss/research/page.mjs";
import { dayIdInZone } from "../../../shared/boss/timezone";
import type { Env } from "../env";
import { AppError, badRequest } from "../lib/http";
import { OPERATIONS_ENABLED, operatingStopped } from "../lib/operatingStop";
import { workerEvidence } from "./workerEvidence";
import { startOfDay } from "../../../shared/boss/schedule/clock.mjs";

export const SIMONE_OPERATIONS_SETTING = "simone_operations";
const text = (max: number) => z.string().trim().min(1).max(max);
const reportShape = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rows: z.array(z.object({
    id: text(300), name: text(240), aim: text(1600), evidence: text(350),
    kind: z.enum(["agent", "duty", "launchd", "workflow", "worker_cron", "schedule", "initiative", "sender", "mailbox", "site"]),
    coverage: z.enum(["listed", "unlisted", "not_running", "paused", "unknown"]),
    state: z.enum(["verified", "nothing_due", "missing", "unknown", "no_proof"]),
  }).strict()).min(1).max(2000),
  issues: z.array(text(600)).max(2000),
  proposal: text(500).nullable(),
}).strict();
type Report = z.infer<typeof reportShape>;

async function readReport(db: D1Database) {
  const row = await db.prepare("SELECT value, updated_at FROM settings WHERE key = ?").bind(SIMONE_OPERATIONS_SETTING)
    .first<{ value: string; updated_at: number }>();
  return row ? { ...JSON.parse(row.value) as Report, observedAt: row.updated_at } : null;
}

export async function operatingInputs(db: D1Database, now = Date.now(), includeWorkerEvidence = true) {
  const day = dayIdInZone(now);
  if (await operatingStopped(db)) return { day, stopped: true };
  const saved = await readReport(db);
  if (saved?.day === day) return { day, checked: true };
  // Same employee and duty registries used by the dispatchers. Omit briefs, message bodies, and run logs.
  const [agents, duties] = await db.batch([
    db.prepare(`SELECT id, name, role, status = 'paused' AS paused FROM employees
      WHERE lane = 'ops' AND lifecycle IN ('active', 'provisional') AND status IN ('active','paused')`),
    db.prepare(`SELECT d.id, d.name, d.employee_id AS employeeId, d.suspended AS paused,
      (d.next_due_at IS NOT NULL OR d.executor = 'local_job') AS scheduled
      FROM standing_duties d JOIN employees e ON e.id = d.employee_id
      WHERE d.lane = 'ops' AND d.removed_at IS NULL AND e.lifecycle IN ('active','provisional')`),
  ]);
  return { day, agents: agents?.results, duties: duties?.results,
    workerEvidence: includeWorkerEvidence ? await workerEvidence(db, now) : undefined,
    arrivals: includeWorkerEvidence ? await arrivalInputs(db, now) : undefined, mailboxes: [
    { id: "boss-intake", name: BOSS_INTAKE_MAILBOX, handler: "the Boss OS mail handler" },
    { id: "simone-intake", name: SIMONE_MAILBOX, handler: "the Boss OS mail handler" },
    ...BRAND_MAILBOXES.map(({ brand }) => ({ id: brand, name: brand + " Workspace inbox", handler: "the Workspace intake and account readers" })),
    { id: "pnp-corporate-outreach", name: "Porch & Party office replies", handler: "the Porch & Party outreach forwarding handler" },
  ] };
}

/**
 * WHAT THE ARRIVAL CHECK READS (owner, 28 Nov 2026: "sent" and "forwarded" count only when the receiving
 * end shows it arrived; rules in src/shared/boss/mail/arrival.mjs). Every agent email recorded as
 * sent on the previous Central day (ids and addresses only, never a body), and the last ten kept
 * mornings with the card keys each carried and the send that carried it. The Mac asks the receiving
 * end about each one (scripts/ops/lib/simone-operations.mjs `readArrivals`).
 */
export async function arrivalInputs(db: D1Database, now = Date.now()) {
  const end = startOfDay(now);
  const start = startOfDay(end - 1);
  const [sent, mornings] = await db.batch([
    db.prepare(`SELECT id, message_id, from_addr, layout, sent_at FROM boss_sent_mail
      WHERE delivery_state = 'sent' AND sent_at >= ? AND sent_at < ? ORDER BY sent_at LIMIT 400`).bind(start, end),
    db.prepare(`SELECT day, payload, sent_at, created_at FROM morning_digests ORDER BY day DESC LIMIT 10`),
  ]);
  const keysOf = (payload: string) => {
    try {
      const p = JSON.parse(payload) as { decide?: { key?: string | null }[]; still_yours?: { key?: string | null }[] };
      return [...(p.decide ?? []), ...(p.still_yours ?? [])].map((d) => d?.key).filter((k): k is string => typeof k === "string" && k.startsWith("reply:"));
    } catch { return []; }
  };
  const rows = (mornings?.results ?? []) as { day: string; payload: string; sent_at: number | null; created_at: number }[];
  const carried = [];
  for (const m of rows) {
    // The send that carried this morning: its digest in the sent log on or after the build, that day.
    const mail = m.sent_at == null ? null : await db.prepare(`SELECT id, message_id, from_addr, layout, sent_at FROM boss_sent_mail
      WHERE layout = 'digest' AND delivery_state = 'sent' AND sent_at >= ? AND sent_at < ? ORDER BY sent_at LIMIT 1`)
      .bind(startOfDay(m.sent_at), m.sent_at + 3_600_000).first<{ id: string; message_id: string; from_addr: string; layout: string; sent_at: number }>();
    carried.push({ day: m.day, built_at: m.created_at, sent_at: m.sent_at, keys: keysOf(m.payload), mail: mail ?? null });
  }
  return { start, end, sent: sent?.results ?? [], mornings: carried };
}

export async function operatingReport(db: D1Database, now = Date.now()) {
  const report = await readReport(db);
  return report?.day === dayIdInZone(now) ? report : null;
}

export async function storeOperatingReport(env: Env, input: unknown, now = Date.now()) {
  const parsed = reportShape.safeParse(input);
  if (!parsed.success || parsed.data.day !== dayIdInZone(now)) throw badRequest("The operating report needs today's nonempty inventory.");
  const report = parsed.data;
  const value = JSON.stringify(report);
  if (new TextEncoder().encode(value).length > 850_000 || containsCredential(value, env)) throw badRequest("The operating report was refused.");
  const actionable = report.issues.filter((line) => line.startsWith("NOT WORKING:") || line.startsWith("COULDN'T CHECK:"));
  const notices = actionable.filter((line) => line.startsWith("NOT WORKING:"));
  const summary = [
    ...(notices.length ? notices.slice(0, 3) : actionable.slice(0, 1)),
    ...(actionable.length > 3 ? [`The inventory has ${actionable.length} warnings in all.`] : []),
    ...report.issues.filter((line) => line.endsWith("no proof yet.")).slice(0, 1),
  ];
  const previous = await readReport(env.DB);
  const moves = await env.DB.prepare(`SELECT json_extract(detail, '$.line') AS line FROM task_events
    WHERE event = 'simone_route_changed' AND ts > ? AND ts <= ? ORDER BY ts, id`)
    .bind(previous?.observedAt ?? now - 86_400_000, now).all<{ line: string }>();
  const note = { section: "operations", at: new Date(now).toISOString(), title: "Simone’s operating check",
    lines: [...summary, ...moves.results.map(({ line }) => line), ...(report.proposal ? [report.proposal] : [])],
    // A screen, never an /api link: her email holds the whole morning when it carries one (28 Nov 2026).
    link: { label: "See it on Updates", url: `${BOSS_ORIGIN}/?tab=updates` },
  };
  const key = `simone-operations-${report.day}`;
  const [saved] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO settings (key, value, updated_at)
      SELECT ?, ?, ? WHERE ${OPERATIONS_ENABLED}
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      WHERE json_extract(settings.value, '$.day') < json_extract(excluded.value, '$.day')`).bind(SIMONE_OPERATIONS_SETTING, value, now),
    // changes() comes from the preceding setting write in this transaction. A duplicate or a
    // stop during the read cannot produce a second owner notice or replace the daily note.
    env.DB.prepare(`INSERT INTO morning_sections (section, job, day, body, status, told_at, created_at, updated_at)
      SELECT 'operations', 'simone', ?, ?, 'fresh', NULL, ?, ? WHERE changes() > 0
      ON CONFLICT(section) DO UPDATE SET day = excluded.day, body = excluded.body, status = 'fresh',
      told_at = NULL, updated_at = excluded.updated_at`).bind(report.day, JSON.stringify(note), now, now),
    env.DB.prepare(`INSERT INTO boss_task_notices (id, task_id, lane, from_name, kind, subject, body, created_at, needs_her)
      SELECT ?, ?, 'ops', 'Simone', 'update', ?, ?, ?, 0
      WHERE changes() > 0 AND ? > 0 ON CONFLICT(id) DO NOTHING`)
      .bind(key, key, notices.length ? "NOT WORKING: Simone’s operating check" : "COULDN'T CHECK: Simone’s operating check",
        summary.join("\n").slice(0, 2000), now, actionable.length),
  ]);
  if (!saved?.meta.changes && await operatingStopped(env.DB)) throw new AppError(409, "The owner stopped operations.");
  return { saved: Boolean(saved?.meta.changes), rows: report.rows.length };
}
