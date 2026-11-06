/**
 * KENDRA'S ALARMS over HTTP (alarms/kendra.ts holds the store; rules in src/shared/boss/alarms/rules.mjs).
 *
 *   GET  /          open alarms, and those closed in the last 7 days
 *   POST /raise     { key, kind, text, subject_id?, hers? } — her Mac's owner-mail watch raises here
 *   POST /clear     { key, reason } — the same watch clears a series whose newest send went
 *
 * Behind the normal session gate: the Mac's jobs unlock with the passcode through the vault.
 * The Worker's own checks call the store directly on the hourly tick.
 */
import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest } from "../lib/http";
import { raiseAlarm, clearAlarm, isAlarmKey, type AlarmKind } from "../alarms/kendra";

export const alarms = new Hono<{ Bindings: Env; Variables: Vars }>();

const KINDS: AlarmKind[] = ["output_floor", "stale_task", "owner_mail"];

alarms.get("/", async (c) => {
  const since = Date.now() - 7 * 86_400_000;
  const { results } = await c.env.DB.prepare(
    `SELECT id, alarm_key, kind, owner, subject_id, text, hers, status, first_at, last_at, seen, task_id, closed_at, closed_reason
       FROM system_alarms WHERE status = 'open' OR closed_at >= ? ORDER BY status DESC, last_at DESC`,
  ).bind(since).all();
  return ok(c, { alarms: results ?? [] });
});

alarms.post("/raise", async (c) => {
  const b = (await c.req.json().catch(() => null)) as Record<string, any> | null;
  if (!isAlarmKey(b?.key)) throw badRequest("Send { key, kind, text }", "key is output:…, task:… or mail:…");
  if (!KINDS.includes(b!.kind)) throw badRequest(`"${b!.kind}" is not an alarm kind`, KINDS.join(", "));
  const text = typeof b!.text === "string" ? b!.text.trim() : "";
  if (!text) throw badRequest("An alarm says what happened", "text is the sentence Kendra reads.");
  const r = await raiseAlarm(c.env, { key: b!.key, kind: b!.kind, text, subject_id: b!.subject_id ?? null, hers: b!.hers === true });
  return ok(c, r, r.action === "kept" ? 200 : 201);
});

alarms.post("/clear", async (c) => {
  const b = (await c.req.json().catch(() => null)) as Record<string, any> | null;
  if (!isAlarmKey(b?.key)) throw badRequest("Send { key, reason }");
  const reason = typeof b!.reason === "string" && b!.reason.trim() ? b!.reason.trim() : "condition cleared";
  return ok(c, { cleared: await clearAlarm(c.env, b!.key, reason) });
});
