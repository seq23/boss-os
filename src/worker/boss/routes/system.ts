import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { reconcileSpend } from "../spend/reconcile";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { getSetting, setSetting } from "../lib/settings";
import { rollBudgetWindows } from "../router/budget";
import { COST_MODES, COST_MODE_POLICY, isCostMode } from "../../../shared/boss/governance";
import { pendingApprovals } from "../approvals/pending";
import { spendLeverState, SPEND_LEVER_POSITIONS } from "../router/spend";
import {
  GRADIENT_CAUTIOUS_MICROS, GRADIENT_CHEAPER_MICROS, GRADIENT_HARD_STOP_MICROS,
  GRADIENT_NOTIFY_MICROS, gradientState, notifySentence,
} from "../router/gradient";
import { sufficiency } from "../router/experience";
import {
  planState, setPlan, PLAN_TIERS, COST_BASIS_NOTE, spendSentence,
  type SpendKind, type CostBasis,
} from "../router/plan";
import { listBackends } from "../backends/registry";

export const system = new Hono<{ Bindings: Env; Variables: Vars }>();

/*
 * `pending_approvals` IS DELIBERATELY NOT IN THIS MAP.
 *
 * It was, and it was its own `SELECT COUNT(*)` — one of four separate answers to "what is waiting
 * on her", which is how the tab badge came to say 9 over an empty Inbox. It now comes from
 * `approvals/pending.ts`, the same call that produces the list, so the number and the list are two
 * readings of one query. `validate:one-source` fails the build if it comes back here.
 */
const COUNTED = {
  open_tasks: `SELECT COUNT(*) AS n FROM tasks WHERE status IN ('queued','running','awaiting_approval')`,
  failed_tasks: `SELECT COUNT(*) AS n FROM tasks WHERE status = 'failed'`,
  employees: `SELECT COUNT(*) AS n FROM employees WHERE lifecycle IN ('active','provisional')`,
  capture_memories: `SELECT COUNT(*) AS n FROM memory_items WHERE tier = 'capture' AND status = 'active'`,
  canon_memories: `SELECT COUNT(*) AS n FROM memory_items WHERE tier = 'canon' AND status = 'active'`,
  vault_snapshots: `SELECT COUNT(*) AS n FROM vault_snapshots WHERE status = 'complete'`,
  open_orders: `SELECT COUNT(*) AS n FROM trading_orders WHERE status IN ('draft','awaiting_approval','sent')`,
  open_incidents: `SELECT COUNT(*) AS n FROM trading_incidents WHERE resolved_at IS NULL`,
  open_dead_letters: `SELECT COUNT(*) AS n FROM dead_letters WHERE status = 'open'`,
  agent_proposals_pending: `SELECT COUNT(*) AS n FROM agent_proposals WHERE status = 'proposed'`,
};

system.get("/status", async (c) => {
  await rollBudgetWindows(c.env.DB);

  const counts: Record<string, number> = {};
  for (const [key, sql] of Object.entries(COUNTED)) {
    const row = await c.env.DB.prepare(sql).first<{ n: number }>();
    counts[key] = row?.n ?? 0;
  }
  // The badge's number, from the query that produces the badge's list.
  const waiting = await pendingApprovals(c.env.DB);
  counts.pending_approvals = waiting.total;

  /*
   * ─── WHAT ACTUALLY HAPPENED TODAY, IN UNITS THAT MOVE ─────────────────────
   *
   * Her question, over and over: did my employees actually do anything, and did it work? The most
   * prominent strip on the Inbox was answering a different one — "$0.00 of $2.00" — and answering it
   * with a figure that is STRUCTURALLY ALWAYS ZERO, because nearly every run executes through Claude
   * Code on her own subscription and records `cost_micros: 0` by design.
   *
   * On the morning this was written, two runs died at exit 124 and the screen said nothing, while a
   * progress bar that cannot fill sat at the top of the page implying oversight. Worse: that ceiling
   * was used as the reason to cut the daily briefing's leash to 300s, which is what killed it.
   *
   * So the strip now reports runs and their outcomes. `failed` is the number she needs; it is the one
   * that would have shown her this morning's two dead runs the moment she opened the Inbox.
   *
   * TOKENS RATHER THAN DOLLARS FOR THE RESOURCE LINE. Tokens are measured and real. A dollar figure
   * covering only the metered backends would read as "nothing ran" on a day when six things ran.
   */
  const dayStart = new Date().setHours(0, 0, 0, 0);
  const [runRows, tokenRow, deliveredRow] = await Promise.all([
    c.env.DB
      .prepare(`SELECT status, COUNT(*) AS n FROM backend_runs WHERE started_at >= ? GROUP BY status`)
      .bind(dayStart).all<{ status: string; n: number }>(),
    c.env.DB
      .prepare(
        `SELECT COALESCE(SUM(in_tokens),0) AS in_tokens, COALESCE(SUM(out_tokens),0) AS out_tokens,
                COALESCE(SUM(cost_micros),0) AS metered_micros, COUNT(*) AS calls
           FROM usage_ledger WHERE ts >= ?`,
      )
      .bind(dayStart).first<{ in_tokens: number; out_tokens: number; metered_micros: number; calls: number }>(),
    /*
     * THINGS THAT EXIST, NOT ATTEMPTS. A run that started is not a report she can read; a row in
     * executive_reports is. Counting attempts is how "6 runs" became a number that felt like progress
     * on a day when two of them delivered nothing.
     */
    c.env.DB
      .prepare(`SELECT COUNT(*) AS n FROM executive_reports WHERE generated_at >= ? AND status <> 'failed'`)
      .bind(dayStart).first<{ n: number }>(),
  ]);
  const byRunStatus = Object.fromEntries((runRows.results ?? []).map((r) => [r.status, r.n]));
  const work_today = {
    since: dayStart,
    runs: Object.values(byRunStatus).reduce((a, b) => a + Number(b || 0), 0),
    succeeded: Number(byRunStatus.succeeded ?? 0),
    failed: Number(byRunStatus.failed ?? 0),
    running: Number(byRunStatus.running ?? 0),
    refused: Number(byRunStatus.refused ?? 0),
    delivered: deliveredRow?.n ?? 0,
    in_tokens: tokenRow?.in_tokens ?? 0,
    out_tokens: tokenRow?.out_tokens ?? 0,
    /*
     * NAMED SO THE SCREEN CANNOT PRESENT IT AS TOTAL SPEND. It covers the metered backends and
     * nothing else, and the Inbox says which — so a zero reads as "nothing metered ran" rather than
     * as "nothing ran", which is the misreading that cost the briefing its timeout.
     */
    metered_micros: tokenRow?.metered_micros ?? 0,
    metered_calls: tokenRow?.calls ?? 0,
  };

  const [lanes, budgets, lastCron, lastSnapshot] = await Promise.all([
    c.env.DB.prepare(`SELECT id, name, isolated FROM lanes ORDER BY id`).all(),
    c.env.DB.prepare(`SELECT * FROM budgets ORDER BY lane, period`).all(),
    c.env.DB.prepare(`SELECT * FROM cron_runs ORDER BY started_at DESC LIMIT 1`).first(),
    c.env.DB.prepare(`SELECT id, ts, status, bytes FROM vault_snapshots ORDER BY ts DESC LIMIT 1`).first(),
  ]);

  const costMode = (await getSetting(c.env.DB, "cost_mode")) ?? "NORMAL";

  return ok(c, {
    version: c.env.BOSS_OS_VERSION,
    phase: "Phases 0–5",
    now: Date.now(),
    lanes: lanes.results ?? [],
    counts,
    work_today,
    budgets: budgets.results ?? [],
    cost_mode: costMode,
    cost_mode_policy: COST_MODE_POLICY[isCostMode(costMode) ? costMode : "NORMAL"],
    last_cron: lastCron,
    last_snapshot: lastSnapshot,
  });
});

/**
 * Deep health check.
 *
 * Touches every binding rather than asserting they exist. Reports what is
 * missing instead of failing on the first problem, so one run tells you
 * everything that needs fixing.
 */
system.get("/health", async (c) => {
  const checks: { name: string; ok: boolean; detail: string }[] = [];

  const check = async (name: string, fn: () => Promise<string>) => {
    try {
      checks.push({ name, ok: true, detail: await fn() });
    } catch (err) {
      checks.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  };

  await check("d1", async () => {
    const row = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM lanes`).first<{ n: number }>();
    if (!row || row.n === 0) throw new Error("The lanes table is empty. Run the seed migrations.");
    return `${row.n} lanes`;
  });

  await check("d1_migrations", async () => {
    const row = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM trading_authority`).first<{ n: number }>();
    if (!row?.n) throw new Error("Migration 0004 has not been applied — the trading authority row is missing.");
    return "0001–0004 applied";
  });

  await check("r2_vault", async () => {
    const probe = `health/${newId("hc")}.txt`;
    await c.env.VAULT.put(probe, "ok");
    const got = await c.env.VAULT.get(probe);
    const text = await got?.text();
    await c.env.VAULT.delete(probe);
    if (text !== "ok") throw new Error("Wrote to R2 but could not read the same object back");
    return "read/write ok";
  });

  await check("kv_sessions", async () => {
    const key = `health:${newId("hc")}`;
    await c.env.SESSIONS.put(key, "ok", { expirationTtl: 60 });
    const got = await c.env.SESSIONS.get(key);
    await c.env.SESSIONS.delete(key);
    if (got !== "ok") throw new Error("Wrote to KV but could not read the same key back");
    return "read/write ok";
  });

  await check("queue_binding", async () => {
    if (!c.env.TASKS || typeof c.env.TASKS.send !== "function") {
      throw new Error("The TASKS queue binding is missing. Check wrangler.jsonc.");
    }
    return "bound";
  });

  await check("secrets", async () => {
    const missing: string[] = [];
    if (!c.env.BOSS_PASSCODE) missing.push("BOSS_PASSCODE");
    if (!c.env.SESSION_SECRET) missing.push("SESSION_SECRET");
    if (missing.length) throw new Error(`Missing required secrets: ${missing.join(", ")}`);

    const providers = await c.env.DB
      .prepare(`SELECT id, name, api_key_var FROM providers WHERE enabled = 1`)
      .all<{ id: string; name: string; api_key_var: string }>();
    const unset = (providers.results ?? [])
      .filter((p) => !(c.env as unknown as Record<string, string | undefined>)[p.api_key_var])
      .map((p) => `${p.name} (${p.api_key_var})`);
    if (unset.length) throw new Error(`Enabled providers with no key set: ${unset.join(", ")}`);
    return "required secrets present";
  });

  await check("cron", async () => {
    const last = await c.env.DB
      .prepare(`SELECT started_at, status FROM cron_runs ORDER BY started_at DESC LIMIT 1`)
      .first<{ started_at: number; status: string }>();
    if (!last) throw new Error("The nightly cron has never run here");
    const ageHours = (Date.now() - last.started_at) / 3_600_000;
    if (ageHours > 48) throw new Error(`The last cron run was ${Math.round(ageHours)} hours ago`);
    return `last run ${Math.round(ageHours)}h ago, ${last.status}`;
  });

  const failed = checks.filter((c2) => !c2.ok);
  return ok(c, {
    ok: failed.length === 0,
    version: c.env.BOSS_OS_VERSION,
    checked_at: Date.now(),
    failing: failed.map((f) => f.name),
    checks,
  });
});

// ─── Diagnostics ─────────────────────────────────────────────────────────────

system.get("/diagnostics", async (c) => {
  const level = c.req.query("level");
  const params: unknown[] = [];
  let sql = `SELECT * FROM system_events`;
  if (level) { sql += ` WHERE level = ?`; params.push(level); }
  sql += ` ORDER BY ts DESC LIMIT 200`;
  const [events, crons] = await Promise.all([
    c.env.DB.prepare(sql).bind(...params).all(),
    c.env.DB.prepare(`SELECT * FROM cron_runs ORDER BY started_at DESC LIMIT 10`).all(),
  ]);
  return ok(c, { events: events.results ?? [], cron_runs: crons.results ?? [] });
});

system.get("/dead-letters", async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT * FROM dead_letters WHERE status = 'open' ORDER BY ts DESC LIMIT 100`).all();
  return ok(c, rows.results ?? []);
});

/** Puts a dead-lettered task back on the queue after the cause was fixed. */
system.post("/dead-letters/:id/requeue", async (c) => {
  const id = c.req.param("id");
  const dl = await c.env.DB
    .prepare(`SELECT * FROM dead_letters WHERE id = ? AND status = 'open'`).bind(id)
    .first<{ id: string; task_id: string | null; lane: string | null }>();
  if (!dl) throw notFound("No open dead letter with that id");
  if (!dl.task_id) throw conflict("That dead letter has no task to requeue");

  const task = await c.env.DB
    .prepare(`SELECT id, lane FROM tasks WHERE id = ?`).bind(dl.task_id)
    .first<{ id: string; lane: string }>();
  if (!task) throw conflict("The task behind that dead letter no longer exists");

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE tasks SET status = 'queued', error = NULL, finished_at = NULL WHERE id = ?`).bind(task.id),
    c.env.DB.prepare(`UPDATE dead_letters SET status = 'requeued', resolved_at = ? WHERE id = ?`).bind(Date.now(), id),
  ]);
  await c.env.TASKS.send({ taskId: task.id, lane: task.lane });
  await audit(c.env.DB, { actor: "boss", lane: task.lane, entityType: "task", entityId: task.id, action: "requeued_from_dlq" });
  return ok(c, { requeued: true, task_id: task.id });
});

system.post("/dead-letters/:id/dismiss", async (c) => {
  const id = c.req.param("id");
  const res = await c.env.DB
    .prepare(`UPDATE dead_letters SET status = 'dismissed', resolved_at = ? WHERE id = ? AND status = 'open'`)
    .bind(Date.now(), id)
    .run();
  if (!res.meta.changes) throw notFound("No open dead letter with that id");
  return ok(c, { dismissed: true });
});

// ─── Cost ────────────────────────────────────────────────────────────────────

/** Which lanes, employees, models, and task kinds actually cost money. */
system.get("/cost", async (c) => {
  const days = Math.min(90, Math.max(1, Number(c.req.query("days") ?? 30)));
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  const [byLane, byEmployee, byModel, byKind, daily, blocked] = await Promise.all([
    c.env.DB.prepare(
      `SELECT lane, COALESCE(SUM(cost_micros),0) AS cost, COUNT(*) AS calls
         FROM usage_ledger WHERE ts >= ? GROUP BY lane ORDER BY cost DESC`,
    ).bind(since).all(),
    c.env.DB.prepare(
      `SELECT u.employee_id, e.name, COALESCE(SUM(u.cost_micros),0) AS cost, COUNT(*) AS calls
         FROM usage_ledger u LEFT JOIN employees e ON e.id = u.employee_id
        WHERE u.ts >= ? AND u.employee_id IS NOT NULL
        GROUP BY u.employee_id ORDER BY cost DESC LIMIT 20`,
    ).bind(since).all(),
    c.env.DB.prepare(
      `SELECT u.model_id, m.display_name, COALESCE(SUM(u.cost_micros),0) AS cost,
              COALESCE(SUM(u.in_tokens),0) AS in_tokens, COALESCE(SUM(u.out_tokens),0) AS out_tokens
         FROM usage_ledger u LEFT JOIN models m ON m.id = u.model_id
        WHERE u.ts >= ? GROUP BY u.model_id ORDER BY cost DESC LIMIT 20`,
    ).bind(since).all(),
    c.env.DB.prepare(
      `SELECT t.intake_kind, COALESCE(SUM(u.cost_micros),0) AS cost, COUNT(DISTINCT t.id) AS tasks
         FROM usage_ledger u JOIN tasks t ON t.id = u.task_id
        WHERE u.ts >= ? AND t.intake_kind IS NOT NULL
        GROUP BY t.intake_kind ORDER BY cost DESC`,
    ).bind(since).all(),
    c.env.DB.prepare(
      `SELECT CAST(ts / 86400000 AS INTEGER) * 86400000 AS day,
              COALESCE(SUM(cost_micros),0) AS cost
         FROM usage_ledger WHERE ts >= ? GROUP BY day ORDER BY day`,
    ).bind(since).all(),
    c.env.DB.prepare(
      `SELECT outcome, COUNT(*) AS n FROM routing_decisions
        WHERE ts >= ? AND outcome != 'routed' GROUP BY outcome ORDER BY n DESC`,
    ).bind(since).all(),
  ]);

  return ok(c, {
    window_days: days,
    by_lane: byLane.results ?? [],
    by_employee: byEmployee.results ?? [],
    by_model: byModel.results ?? [],
    by_intake_kind: byKind.results ?? [],
    daily: daily.results ?? [],
    non_routed_decisions: blocked.results ?? [],
  });
});

system.get("/audit", async (c) => {
  const entity = c.req.query("entity_id");
  const params: unknown[] = [];
  let sql = `SELECT * FROM audit_log`;
  if (entity) { sql += ` WHERE entity_id = ?`; params.push(entity); }
  sql += ` ORDER BY ts DESC LIMIT 100`;
  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return ok(c, rows.results ?? []);
});

system.get("/usage", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT u.*, m.display_name AS model_name FROM usage_ledger u
         LEFT JOIN models m ON m.id = u.model_id
        ORDER BY u.ts DESC LIMIT 100`,
    )
    .all();
  return ok(c, rows.results ?? []);
});


system.get("/settings", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM settings ORDER BY key`).all();
  return ok(c, rows.results ?? []);
});

system.put("/settings/:key", async (c) => {
  const key = c.req.param("key");
  const { value } = await c.req.json<{ value: string }>();

  // Live trading is not a settings toggle. It lives behind the authority
  // envelope, which refuses until every gate is met.
  if (key === "trading_live_enabled" && String(value) === "true") {
    throw conflict(
      "Live trading cannot be switched on from settings",
      "Record the micro-live gates under Trading. This build has no live broker adapter regardless.",
    );
  }
  if (key === "cost_mode" && !COST_MODES.includes(String(value) as never)) {
    throw badRequest("That is not a cost mode", `Use one of: ${COST_MODES.join(", ")}.`);
  }

  await setSetting(c.env.DB, key, String(value));
  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "setting", entityId: key,
    action: "updated", detail: { value: String(value) },
  });
  if (key === "cost_mode") {
    await logEvent(c.env.DB, { level: "warn", scope: "settings", event: "cost_mode_changed", detail: { value } });
  }
  return ok(c, { key, value });
});

system.get("/cost-modes", (c) =>
  ok(c, COST_MODES.map((m) => COST_MODE_POLICY[m])),
);

/**
 * ONE SCREEN THAT ANSWERS "WHAT CAN THIS THING SPEND".
 *
 * ─── Her words ─────────────────────────────────────────────────────────────
 *
 *   "i see nothing in systems about controlling costs and setting monthly budgets that all got
 *    sent to the backends tab? ... arent we on medium level of costs? what happened to the lever?
 *    ... give me a budget ceiling for each thing there"
 *
 * THE LEVER WAS NEVER MISSING, IT WAS INVISIBLE. She is on MODERATE at $25/month with `cost_mode`
 * NORMAL — the "medium" she remembers. Both live in Settings, neither appeared on Systems, and
 * cost control had scattered into a tab about something else entirely.
 *
 * THE LEVER AND THE COST MODE STAY TWO THINGS. `router/spend.ts` is explicit: "how good a model"
 * and "how much money" are different decisions, the lever never moves the mode and the mode never
 * moves the lever. They are two controls here for that reason and must never be merged.
 *
 * NO FOURTH BUDGET CONCEPT IS INTRODUCED. Everything below already existed — the lever, the cost
 * mode, the lane budgets, the per-backend ceilings — and this endpoint puts them in one answer with
 * each figure carrying what KIND of figure it is. That is the whole complaint: not that the numbers
 * were wrong, but that no screen put them together or said what they meant.
 */
system.get("/costs", async (c) => {
  const [lever, plan, backends, laneMonth, laneDay] = await Promise.all([
    spendLeverState(c.env.DB),
    planState(c.env.DB),
    listBackends(c.env.DB),
    c.env.DB.prepare(`SELECT limit_micros, spent_micros, window_started_at FROM budgets WHERE lane='ops' AND period='month'`)
      .first<{ limit_micros: number; spent_micros: number; window_started_at: number }>(),
    c.env.DB.prepare(`SELECT limit_micros, spent_micros FROM budgets WHERE lane='ops' AND period='day'`)
      .first<{ limit_micros: number; spent_micros: number }>(),
  ]);

  const mode = (await getSetting(c.env.DB, "cost_mode")) ?? "NORMAL";

  /*
   * ─── WHERE SHE SITS ON THE GRADIENT, AND WHAT IT IS COSTING HER ───────────
   *
   * Her requirement was not "a number somewhere". It was that she sees, without asking: the lever
   * position, where she is on the gradient AND WHY, what it currently costs her in capability, and
   * — approaching a threshold — that it is coming BEFORE it bites. A control that only announces
   * itself at the moment it stops work is a control she meets as an obstacle.
   *
   * THE LADDER IS RETURNED WITH IT rather than left implicit in a band name, so the screen can draw
   * the rungs and mark where she is rather than printing a word she has to remember the meaning of.
   */
  const gradient = await gradientState(c.env.DB, lever.position);
  const evidence = await sufficiency(c.env.DB);

  const nextRung = [
    { at: GRADIENT_CHEAPER_MICROS, paced: true, label: "cheaper choices" },
    { at: GRADIENT_CAUTIOUS_MICROS, paced: true, label: "free-first, paid for protected work only" },
    { at: GRADIENT_NOTIFY_MICROS, paced: false, label: "you are notified, with the bypass decision" },
    { at: GRADIENT_HARD_STOP_MICROS, paced: false, label: "hard stop, bypass available" },
  ].find((r) => (r.paced ? gradient.pacedMicros : gradient.spentMicros) < r.at) ?? null;

  return ok(c, {
    gradient: {
      applies: gradient.applies,
      band: gradient.band,
      month_spent_micros: gradient.spentMicros,
      month_elapsed_pct: Math.round(gradient.elapsed * 100),
      elapsed_floored: gradient.elapsedFloored,
      paced_month_end_micros: gradient.pacedMicros,
      austerity: gradient.austerity,
      paid_ceiling_factor: gradient.paidCeilingFactor,
      notify: gradient.notify,
      hard_stop: gradient.hardStop,
      where_and_why: gradient.sentence,
      costs_you: gradient.capabilityCost,
      /*
       * APPROACHING A RUNG IS VISIBLE BEFORE IT BITES. `next_rung` is what has not happened yet and
       * how far away it is, in the same units as the figure beside it.
       */
      next_rung: nextRung
        ? {
            at_micros: nextRung.at,
            measured_against: nextRung.paced ? "paced_month_end" : "raw_month_to_date",
            away_micros: Math.max(0, nextRung.at - (nextRung.paced ? gradient.pacedMicros : gradient.spentMicros)),
            what_changes: nextRung.label,
          }
        : null,
      notice: gradient.notify ? notifySentence(gradient) : null,
      ladder_micros: {
        cheaper: GRADIENT_CHEAPER_MICROS,
        cautious: GRADIENT_CAUTIOUS_MICROS,
        notify: GRADIENT_NOTIFY_MICROS,
        hard_stop: GRADIENT_HARD_STOP_MICROS,
      },
      governs:
        "How careful to be with money, measured against how much of the month has gone. It runs only inside " +
        "MODERATE, it never moves the lever, and it never touches protected work — that keeps a capable model " +
        "or stops and says so.",
    },
    model_evidence: {
      ...evidence,
      governs:
        "Which models have actually done which jobs, by (task kind, model). An unproven model is UNKNOWN, not " +
        "good, and unknown never wins work that matters.",
    },
    lever: {
      position: lever.position,
      positions: SPEND_LEVER_POSITIONS,
      allowance_micros: lever.allowanceMicros,
      moderate_micros: lever.moderateMicros,
      label: lever.label,
      governs: "How much money the router may spend. It supplies the allowance a backend's own ceiling defers to; the lane budget stays the outer authority and the smallest of the three always wins.",
    },
    cost_mode: {
      value: mode,
      modes: COST_MODES,
      governs: "Which model tiers are good enough for the work. A quality decision, not a money one — it never moves the lever and the lever never moves it.",
    },
    plan: {
      ...plan,
      governs:
        "What your Claude plan is worth in a month, and how much of it you keep for your own work. " +
        "The employees may draw the rest, so upgrading the plan moves their ceiling by itself.",
      /*
       * SAID IN WORDS BECAUSE THE NUMBER LIES ON ITS OWN. This is a subscription; nothing here is
       * billed to a card, and the figure beside it has been read as an invoice for a week.
       */
      basis_note: COST_BASIS_NOTE.plan_equivalent,
    },
    lane: {
      month_limit_micros: laneMonth?.limit_micros ?? 0,
      month_spent_micros: laneMonth?.spent_micros ?? 0,
      /*
       * THE DAY IS A PACE INSIDE THE MONTH, NOT A SECOND AUTHORITY. 0222 found a $2/day cap under a
       * $50/month ceiling — $60 against $50 — so the derived figure is reported beside the stored
       * one and any drift between them is visible rather than latent.
       */
      day_limit_micros: laneDay?.limit_micros ?? 0,
      day_spent_micros: laneDay?.spent_micros ?? 0,
      day_derived_micros: plan.dailyMicros,
      day_agrees: (laneDay?.limit_micros ?? 0) === plan.dailyMicros,
    },
    backends: backends.map((b) => ({
      id: b.id,
      display_name: b.display_name,
      status: b.status,
      spend_kind: b.spend_kind,
      cost_basis: b.cost_basis,
      ceiling_source: b.ceiling_source,
      ceiling_micros: b.monthly_ceiling_micros,
      spent_micros: b.spent_micros,
      /* The word, not the number — three $0.00 rows meant free, unauthorised and off. */
      sentence: spendSentence(b.spend_kind as SpendKind, b.monthly_ceiling_micros, b.cost_basis as CostBasis),
      basis_note: COST_BASIS_NOTE[b.cost_basis as CostBasis] ?? "",
    })),
  });
});

/** Moving the plan tier or the reserve. The ceiling follows; nothing is materialised. */
system.post("/costs/plan", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (b?.tier === undefined && b?.reserve_pct === undefined && b?.capacity_micros === undefined) {
    throw badRequest("Nothing to change", "Send { tier }, { reserve_pct } or { capacity_micros }.");
  }
  try {
    const state = await planState(c.env.DB);
    const next = await setPlan(c.env.DB, {
      tier: b?.tier,
      reservePct: b?.reserve_pct === undefined ? undefined : Number(b.reserve_pct),
      capacityMicros: b?.capacity_micros === undefined ? undefined : Number(b.capacity_micros),
    });
    return ok(c, {
      plan: next,
      tiers: PLAN_TIERS,
      moved: {
        from_ceiling_micros: state.employeeCeilingMicros,
        to_ceiling_micros: next.employeeCeilingMicros,
      },
    });
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : "That plan change was refused");
  }
});

/** Runs the maintenance cron by hand, for a restore drill or after a fix. */
system.post("/maintenance", async (c) => {
  const rolled = await rollBudgetWindows(c.env.DB);
  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "system", action: "maintenance_run" });
  return ok(c, { budget_rows_rolled: rolled });
});

/**
 * One spend figure, from every ledger that holds one.
 *
 * Three ledgers record money here and nothing added them together, so "what did I spend" was
 * answered by whichever one the reader opened. This reports the total with its parts still visible
 * and each part's basis attached, so a figure that looks wrong is traceable to the ledger that
 * produced it rather than being an unexplained number.
 *
 * The window defaults to the ops month budget's window, because that is the window the hard stop
 * she actually feels is measured against.
 */
system.get("/spend-reconciliation", async (c) => {
  const since = Number(c.req.query("since"));
  const window = await c.env.DB
    .prepare(`SELECT window_started_at FROM budgets WHERE lane = 'ops' AND period = 'month' LIMIT 1`)
    .first<{ window_started_at: number }>();

  const startedAt = Number.isFinite(since) && since > 0
    ? since
    : window?.window_started_at ?? Date.now() - 30 * 86_400_000;

  return ok(c, await reconcileSpend(c.env, startedAt));
});
