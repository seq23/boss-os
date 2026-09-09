/**
 * What came back from LP outreach, counted and categorised.
 *
 * ─── What she asked for ────────────────────────────────────────────────────
 *
 *   "an employee can keep track of all the opt outs and replies and send me an inbox daily summary
 *    to deliver to the twin agent"
 *
 * ─── What crosses, and what stays on her Mac ───────────────────────────────
 *
 * COUNTS, SIX CATEGORIES, AND ONE COMPOSED SENTENCE. Nothing that identifies anybody. The real
 * addresses — which Twin needs, because suppressing someone requires knowing who — are written to a
 * file on her Mac and never posted. That is the same split `contacts-sync.mjs` uses, and it is why
 * the code-names-only rule and the "Twin must be able to act" requirement do not actually conflict:
 * they are about different files.
 *
 * The `@` guard is unchanged and applies here exactly as it does everywhere else. A digest carrying
 * an address is refused whole, not edited — a silently-trimmed summary is one she would read as
 * complete.
 *
 * ─── And it is silent when there is nothing ────────────────────────────────
 *
 * A day with no replies posts no digest and raises no Inbox item. A daily notification that fires
 * regardless is one she stops opening, and then the day it mattered looks like the forty before it.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest } from "../lib/http";
import { nextDueAt } from "../duties/cadence";

export const lp = new Hono<{ Bindings: Env; Variables: Vars }>();

const DUTY_ID = "duty_lp_replies";
const COUNTS = ["opt_outs", "interested", "wants_deck", "questions", "auto_replies", "bounces", "total_read"] as const;

const count = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

/** The digests, newest first. */
lp.get("/", async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT * FROM lp_reply_digests ORDER BY day_id DESC LIMIT 30`)
    .all<any>();
  const duty = await c.env.DB
    .prepare(`SELECT id, name, employee_id, suspended, suspended_reason, last_run_at, next_due_at FROM standing_duties WHERE id = ?`)
    .bind(DUTY_ID).first<any>();
  return ok(c, { digests: rows.results ?? [], duty: duty ?? null });
});

/** The local run filing a day. */
lp.post("/digest", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const dayId = String(b?.day_id ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayId)) {
    throw badRequest("A digest needs the day it covers", "Without it, two runs on one day cannot be told apart from two days.");
  }

  const summary = b?.summary === undefined || b?.summary === null ? null : String(b.summary).trim().slice(0, 600);
  if (summary && summary.includes("@")) {
    throw badRequest(
      "The summary contains an '@' and was refused",
      "A digest reports how many and of what kind. The addresses Twin needs live in the suppression file on your Mac and never cross this line.",
    );
  }

  const values: Record<string, number> = {};
  for (const k of COUNTS) values[k] = count(b?.[k]);

  /*
   * A RUN THAT READ NOTHING FILES NOTHING. Rule 0 at the endpoint: an all-zero digest would put a
   * row on the screen saying a day was checked and empty, which is indistinguishable from a day the
   * job could not read at all. The script reports its failures as failures instead.
   */
  if ((values.total_read ?? 0) === 0) {
    throw badRequest(
      "A digest of zero messages is not filed",
      "Nothing to report means nothing is posted, so an absent digest always means either a quiet day the log records, or a run that failed and said so.",
    );
  }

  const now = Date.now();
  const id = newId("lpd");
  await c.env.DB
    .prepare(
      `INSERT INTO lp_reply_digests
         (id, day_id, opt_outs, interested, wants_deck, questions, auto_replies, bounces,
          total_read, summary, suppress_file, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(day_id) DO UPDATE SET
         opt_outs = excluded.opt_outs, interested = excluded.interested, wants_deck = excluded.wants_deck,
         questions = excluded.questions, auto_replies = excluded.auto_replies, bounces = excluded.bounces,
         total_read = excluded.total_read, summary = excluded.summary, suppress_file = excluded.suppress_file`,
    )
    .bind(
      id, dayId, values.opt_outs, values.interested, values.wants_deck, values.questions,
      values.auto_replies, values.bounces, values.total_read, summary,
      // A PATH, NOT THE ADDRESSES. The file is on her Mac; this says where Twin will find it.
      b?.suppress_file ? String(b.suppress_file).slice(0, 300) : null,
      now,
    )
    .run();

  /*
   * THE DUTY'S CLOCK, ADVANCED BY THE WORK HAPPENING. A `local_job` duty is never materialised by
   * the cron, so this is the only thing that can say it ran — which is the correct place for it.
   */
  const duty = await c.env.DB
    .prepare(`SELECT local_hour, local_minute, timezone, cadence, weekday, weekdays FROM standing_duties WHERE id = ?`)
    .bind(DUTY_ID).first<any>();
  if (duty) {
    let advanced: number | null = null;
    try {
      advanced = nextDueAt(
        {
          local_hour: duty.local_hour, local_minute: duty.local_minute, timezone: duty.timezone,
          cadence: duty.cadence, weekday: duty.weekday,
          weekdays: duty.weekdays ? JSON.parse(duty.weekdays) : null,
        },
        now,
      );
    } catch { advanced = null; }
    await c.env.DB
      .prepare(
        advanced === null
          ? `UPDATE standing_duties SET last_run_at = ? WHERE id = ?`
          : `UPDATE standing_duties SET last_run_at = ?, next_due_at = ? WHERE id = ?`,
      )
      .bind(...(advanced === null ? [now, DUTY_ID] : [now, advanced, DUTY_ID]))
      .run();
  }

  await logEvent(c.env.DB, {
    level: (values.opt_outs ?? 0) > 0 ? "warn" : "info",
    scope: "duties", event: "lp_digest_filed", entityId: DUTY_ID,
    detail: { day_id: dayId, ...values },
  }).catch(() => {});

  await audit(c.env.DB, {
    actor: "system", lane: "ops", entityType: "standing_duty", entityId: DUTY_ID,
    action: "lp_digest_filed", detail: { day_id: dayId, total_read: values.total_read },
  });

  return ok(c, { id, day_id: dayId, ...values }, 201);
});
