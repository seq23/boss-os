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
import { backfillWarmReferences, listWarmReferences, markWarmReferences, recordWarmReferences } from "../lp/references";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest } from "../lib/http";
import { nextDueAt } from "../duties/cadence";
// boss fix L
import {
  upsertLpRows, listLpRows, importProspects, prospectPlan, prospectsToVerify, recordVerdicts, recordProspectEvents, suppressAddresses, proposeTemplate,
  approvedTemplate, pendingTemplate, ledgerRows, readExclusions, prospectActivity, backfillTouches,
} from "../lp/desk";
import { LP_STATUS_LABEL, canSpend, monthOf, monthSpent, nameRulesIn, MONIQUE_MONTHLY } from "../../../shared/boss/lp/plan.mjs";

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

/* ═══ Boss fix L (23 Oct 2026): the LP tracker, prospects, 8Raise ledger, catch-up suppression ═══
 *
 * Read by the Deals page (LpTab, ProspectsTab) and written by the Mac lanes (lp-daily.mjs,
 * lp-prospects.mjs, lp-prospect-discovery.mjs, lp-eightraise.mjs, lp-catchups.mjs). Names stay in
 * D1; nothing here is ever logged with a name.
 */

lp.get("/replies", async (c) => {
  const rows = await listLpRows(c.env.DB);
  return ok(c, {
    rows: rows.map((r) => ({
      id: r.id, name: r.name, firm: r.firm, address: r.address, bucket: r.bucket, quote: r.quote,
      status: r.status, status_label: (LP_STATUS_LABEL as Record<string, string>)[r.status] ?? r.status,
      first_seen: r.first_seen, drafted_at: r.drafted_at, sent_at: r.sent_at, thread_id: r.thread_id,
      draft_message_id: r.draft_message_id, send_error: r.send_error,
      said: r.said, draft_body: r.draft_body, last_reply_text: r.last_reply_text, last_reply_at: r.last_reply_at,
      reply_from: r.reply_from, subject: r.subject,
    })),
  });
});

/** The Mac's morning read. Returns the rows with their tap tokens, for the morning email buttons. */
lp.post("/replies", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!Array.isArray(b?.rows)) throw badRequest("rows[] is required");
  const n = await upsertLpRows(c.env.DB, b.rows);
  if (b.rows.length > 0 && n === 0) throw badRequest("No row was valid", "Each row needs an address, a bucket of call or warm, a status and the YYYY-MM-DD it arrived.");
  return ok(c, { upserted: n, rows: await listLpRows(c.env.DB) });
});

lp.get("/prospects", async (c) => {
  // Tap tokens only for the Mac lane that builds the morning email (?tokens=1); the screen never needs them.
  const tokens = c.req.query("tokens") === "1" ? ", draft_tap_token" : "";
  const rows = (await c.env.DB.prepare(`SELECT id, name, firm, email, kind, source, source_ref, status, side, touches, first_sent_at, last_touch_at, thread_id, last_message_id, subject, reply_note, (SELECT t.sent_from FROM prospect_touches t WHERE t.prospect_id = prospects.id AND t.sent_from IS NOT NULL ORDER BY t.sent_at DESC LIMIT 1) AS sent_from, draft_tap_token IS NOT NULL AS has_draft, created_at, updated_at${tokens} FROM prospects ORDER BY created_at DESC LIMIT 1000`).all<any>()).results ?? [];
  return ok(c, { rows, approved: await approvedTemplate(c.env.DB), pending: await pendingTemplate(c.env.DB) });
});

/** Every send with its words, the replies, who is next and when, the totals (?since=ms, default all). */
lp.get("/prospects/activity", async (c) => {
  const since = Number(c.req.query("since") ?? 0);
  return ok(c, await prospectActivity(c.env.DB, Number.isFinite(since) && since > 0 ? since : 0));
});

/** Her Sent mail, read on her Mac: every prospect email that went, with its words. */
lp.post("/prospects/touches", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!Array.isArray(b?.touches)) throw badRequest("touches[] is required");
  return ok(c, { recorded: await backfillTouches(c.env.DB, b.touches.slice(0, 2000)) });
});

lp.post("/prospects/import", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!Array.isArray(b?.rows)) throw badRequest("rows[] is required");
  return ok(c, await importProspects(c.env.DB, b.rows));
});

/** Warm references (Simone's meeting prep): the list, her Mac's link checks, the 1 Sep backfill. */
lp.get("/references", async (c) => ok(c, { rows: await listWarmReferences(c.env.DB) }));
lp.post("/references", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!Array.isArray(b?.rows)) throw badRequest("rows[] is required");
  return ok(c, { recorded: await recordWarmReferences(c.env.DB, b.rows.slice(0, 2000)) });
});
lp.post("/references/checks", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!Array.isArray(b?.checks)) throw badRequest("checks[] is required");
  return ok(c, { marked: await markWarmReferences(c.env.DB, b.checks.slice(0, 2000)) });
});
lp.post("/references/backfill", async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  const since = Number(b?.since ?? Date.parse("2026-09-01T00:00:00Z"));
  return ok(c, await backfillWarmReferences(c.env.DB, Number.isFinite(since) ? since : 0));
});

lp.get("/prospects/plan", async (c) => ok(c, await prospectPlan(c.env.DB)));

/** Her NeverBounce, before every touch (24 Oct 2026): the due addresses with no fresh verdict, then the verdicts. */
lp.get("/prospects/to-verify", async (c) => {
  const cap = Math.max(0, Math.min(200, Number(c.req.query("cap") ?? 25) || 0));
  return ok(c, { emails: await prospectsToVerify(c.env.DB, cap) });
});
lp.post("/prospects/verdicts", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!Array.isArray(b?.verdicts)) throw badRequest("verdicts[] is required");
  return ok(c, { recorded: await recordVerdicts(c.env.DB, b.verdicts.slice(0, 2000)) });
});

/** The Mac's morning bounce read (lp-bounces.mjs) and NeverBounce "invalid" verdicts (lp-prospects.mjs). */
lp.post("/prospects/suppress", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!Array.isArray(b?.emails)) throw badRequest("emails[] is required");
  if (!["bounced", "invalid"].includes(b?.reason)) throw badRequest("reason must be bounced or invalid");
  const added = await suppressAddresses(c.env.DB, b.emails.slice(0, 2000), b.reason);
  return ok(c, { added, received: b.emails.length });
});

lp.post("/prospects/events", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!Array.isArray(b?.events)) throw badRequest("events[] is required");
  return ok(c, { recorded: await recordProspectEvents(c.env.DB, b.events) });
});

/** Propose the prospect email + featured names. A tone-rule failure is refused with its reasons. */
lp.post("/prospects/template", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const names = Array.isArray(b?.names) ? b.names.map((n: any) => ({ name: String(n.name ?? n), why: n.why ? String(n.why) : undefined })) : [];
  const r = await proposeTemplate(c.env.DB, b?.template ?? null, names);
  if (!r.ok) throw badRequest(`The prospect email was not proposed: ${r.problems.join("; ")}`);
  return ok(c, r);
});

/** Her featured-name rules, each name as she wrote it (migration 0301). */
export const NAME_RULES_SQL = `SELECT COALESCE(display, name) AS name, rule FROM prospect_name_rules`;

/** Her plain-words edits to the featured names ("add X", "drop Y", "never feature Z"). */
lp.post("/prospects/names", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const rules = nameRulesIn(String(b?.text ?? ""));
  const now = Date.now();
  for (const r of rules) {
    // Keyed lower case (one rule per company); `display` keeps her casing for the email ("OpenAI").
    await c.env.DB.prepare(`INSERT INTO prospect_name_rules (name, rule, said, created_at, display) VALUES (?,?,?,?,?)
      ON CONFLICT(name) DO UPDATE SET rule = CASE WHEN prospect_name_rules.rule = 'never' THEN 'never' ELSE excluded.rule END, said = excluded.said, created_at = excluded.created_at, display = excluded.display`)
      .bind(r.name.toLowerCase(), r.rule, String(b?.text ?? "").slice(0, 300), now, r.name).run();
  }
  const all = (await c.env.DB.prepare(NAME_RULES_SQL).all<any>()).results ?? [];
  return ok(c, { applied: rules, rules: all });
});

lp.get("/prospects/names", async (c) => ok(c, { rules: (await c.env.DB.prepare(NAME_RULES_SQL).all<any>()).results ?? [] }));

/** Her two lists (D's tables), read-only. `established: false` means fail closed. */
lp.get("/exclusions", async (c) => ok(c, await readExclusions(c.env.DB)));

lp.get("/eightraise", async (c) => {
  const month = c.req.query("month") ?? monthOf();
  const rows = await ledgerRows(c.env.DB, month);
  return ok(c, { month, rows, used: monthSpent(rows, month), allowance: MONIQUE_MONTHLY });
});

/**
 * Log a credit. A spend is checked against the month's budget, the floor and the one-search-per-
 * company rule BEFORE the Mac makes the call (dry: true), and logged after it (dry: false).
 */
lp.post("/eightraise", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const month = monthOf();
  const purpose = String(b?.purpose ?? "");
  const credits = Number(b?.credits ?? 0);
  if (purpose === "balance_read") {
    await c.env.DB.prepare(`INSERT INTO eightraise_ledger (id, month, purpose, tool, company, credits, balance_after, at, note) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(newId("e8r"), month, "balance_read", String(b?.tool ?? "get_usage"), null, 0, b?.balance ?? null, Date.now(), null).run();
    return ok(c, { logged: true });
  }
  const ledger = await ledgerRows(c.env.DB, month);
  const check = canSpend({ purpose, credits, contacts: Number(b?.contacts ?? 0), company: b?.company ?? null, ledger, balance: b?.balance ?? null, month });
  if (!check.ok) return ok(c, { allowed: false, why: check.why });
  if (b?.dry) return ok(c, { allowed: true });
  await c.env.DB.prepare(`INSERT INTO eightraise_ledger (id, month, purpose, tool, company, credits, balance_after, at, note) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(newId("e8r"), month, purpose, String(b?.tool ?? "").slice(0, 60), b?.company ? String(b.company).slice(0, 120) : null, credits,
      b?.balance_after ?? null, Date.now(), b?.note ? String(b.note).slice(0, 200) : null).run();
  return ok(c, { allowed: true, logged: true });
});

lp.get("/catchups/history", async (c) => ok(c, { rows: (await c.env.DB.prepare(`SELECT person_key, reason_type, suggested_at FROM catchup_suggestions ORDER BY suggested_at DESC LIMIT 2000`).all<any>()).results ?? [] }));

lp.post("/catchups/record", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const rows = Array.isArray(b?.rows) ? b.rows : [];
  const now = Date.now();
  const stmts = rows.filter((r: any) => String(r.person_key ?? "").includes("@")).map((r: any) =>
    c.env.DB.prepare(`INSERT INTO catchup_suggestions (id, person_key, reason_type, suggested_at) VALUES (?,?,?,?)`)
      .bind(newId("cus"), String(r.person_key).toLowerCase(), String(r.reason_type ?? "other").slice(0, 40), now));
  if (stmts.length) await c.env.DB.batch(stmts);
  return ok(c, { recorded: stmts.length });
});
