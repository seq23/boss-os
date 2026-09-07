import { Hono } from "hono";
import type { Env, TaskMessage, Vars } from "./env";
import { requireSession, readSession, signIn, signOut, setSessionCookie } from "./auth";
import { errorBody, ok } from "./lib/http";
import { logEvent } from "./lib/log";
import { approvals, runExpirySweep } from "./routes/approvals";
import { employees } from "./routes/employees";
import { tasks } from "./routes/tasks";
import { intake } from "./routes/intake";
import { models } from "./routes/models";
import { memory, runPromotionSweep } from "./routes/memory";
import { vault, takeSnapshot, pruneSnapshots } from "./routes/vault";
import {
  DAY_MS,
  maintenanceDue,
  maintenanceWindowOpensAt,
  snapshotDue,
} from "./cron/cadence";
import { trading } from "./routes/trading";
import { system } from "./routes/system";
import { today, assembleDayFlow, dayId, ensureDay } from "./routes/today";
import { relationships } from "./routes/relationships";
import { knowledge } from "./routes/knowledge";
import { spirit } from "./routes/spirit";
import { prompt } from "./routes/prompt";
import { capability, runCapabilityCadence } from "./routes/capability";
import { governance } from "./routes/governance";
import { runtimes } from "./routes/runtimes";
import { bridge } from "./routes/bridge";
import { quant } from "./routes/quant";
import { continuity } from "./routes/continuity";
import { sync } from "./routes/sync";
import { policy } from "./routes/policy";
import { backends, spendLeverRoutes } from "./routes/backends";
import { runSentinel } from "./governance/sentinel";
import { investor } from "./routes/investor";
import { wealth } from "./routes/wealth";
import { surfaceOverdueFollowUps } from "./relationships/follow_ups";
import { ensureAlmanac } from "./spirit/day";
import { handleTask, handleDeadLetter } from "./queue/consumer";
import { rollBudgetWindows } from "./router/budget";
import { materialiseDueDuties } from "./duties/materialise";
import { newId } from "./lib/id";

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.onError(async (err, c) => {
  const { status, body } = errorBody(err);
  if (status >= 500) {
    await logEvent(c.env.DB, {
      level: "error", scope: "http", event: "unhandled_error",
      detail: { path: c.req.path, method: c.req.method, message: body.error },
    }).catch(() => {});
  }
  return c.json(body, status as 500);
});

// ─── Auth (ungated) ──────────────────────────────────────────────────────────
app.post("/api/auth/unlock", async (c) => {
  const body = await c.req.json<{ passcode?: string }>().catch(() => null);
  // Guessing is counted per caller. Behind Cloudflare this header is set by the
  // edge and cannot be spoofed by the client; without it every caller shares
  // one bucket, which is stricter rather than looser.
  const caller = c.req.header("cf-connecting-ip") ?? "unknown";
  const token = await signIn(c.env, body?.passcode ?? "", caller);
  setSessionCookie(c, token);
  return ok(c, { unlocked: true });
});

app.post("/api/auth/lock", async (c) => {
  await signOut(c, c.env);
  return ok(c, { unlocked: false });
});

app.get("/api/auth/state", async (c) => {
  const cookie = c.req.header("cookie") ?? "";
  const match = /boss_session=([^;]+)/.exec(cookie);
  // Goes through the same reader as the gate, so a session invalidated by a
  // secret rotation reports locked here too rather than showing a green light
  // in front of a door that no longer opens.
  return ok(c, { unlocked: Boolean(await readSession(c.env, match?.[1])) });
});

/** Liveness only. Deliberately ungated so an uptime check needs no passcode. */
app.get("/api/health", async (c) => {
  try {
    await c.env.DB.prepare(`SELECT 1`).first();
    return ok(c, { status: "ok", version: c.env.BOSS_OS_VERSION, now: Date.now() });
  } catch {
    return c.json({ ok: false, error: "The database is not reachable" }, 503);
  }
});

// ─── Everything below needs a session ────────────────────────────────────────
// Explicit skip list, so this stays correct no matter how routes get reordered.
app.use("/api/*", async (c, next) => {
  if (c.req.path.startsWith("/api/auth/") || c.req.path === "/api/health") return next();
  return requireSession(c, next);
});

app.route("/api/today", today);
app.route("/api/approvals", approvals);
app.route("/api/employees", employees);
app.route("/api/tasks", tasks);
app.route("/api/intake", intake);
app.route("/api/models", models);
app.route("/api/memory", memory);
app.route("/api/relationships", relationships);
app.route("/api/knowledge", knowledge);
app.route("/api/spirit", spirit);
app.route("/api/prompt", prompt);
app.route("/api/capability", capability);
app.route("/api/governance", governance);
app.route("/api/runtimes", runtimes);
app.route("/api/bridge", bridge);
app.route("/api/quant", quant);
app.route("/api/continuity", continuity);
app.route("/api/investor", investor);
app.route("/api/wealth", wealth);
app.route("/api/vault", vault);
app.route("/api/trading", trading);
app.route("/api/system", system);
app.route("/api/sync", sync);
app.route("/api/policy", policy);
app.route("/api/backends", backends);
/*
 * The spend lever, at the exact path the client is already written against.
 *
 * MOUNTED BELOW /api/system, AND THAT IS SAFE FOR A REASON WORTH STATING. This line used to claim
 * it was mounted above; it is not, and a comment that misdescribes route order is a trap — the next
 * reader reorders something on the strength of it.
 *
 * It works because `routes/system.ts` declares no top-level `:param`: every route there is a
 * literal (`/status`, `/health`, `/cost`, `/audit`…) or a param nested under one
 * (`/settings/:key`, `/dead-letters/:id/requeue`). So the system app simply does not match
 * `/spend-lever` and matching falls through to here. Verified against a running worker, not
 * reasoned about: GET /api/boss/system/spend-lever returns 200 with the lever state.
 *
 * ADD A TOP-LEVEL `/:something` TO routes/system.ts AND THIS BREAKS SILENTLY — the lever would
 * start 404ing through a route that looks unrelated. If that day comes, move this mount above
 * `/api/system` rather than debugging the lever.
 */
app.route("/api/system/spend-lever", spendLeverRoutes);

app.all("/api/*", (c) => c.json({ ok: false, error: "No such endpoint" }, 404));

// The SPA and its assets are served by the ASSETS binding for everything else.
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

/**
 * Nightly maintenance.
 *
 * Each step is independent and recorded: one failing step must not silently
 * cancel the rest, and "the cron ran" is not the same claim as "the cron
 * worked". `cron_runs` holds the per-step result so Diagnostics can show it.
 *
 * CALLED ON EVERY QUARTER-HOURLY TICK, AND GUARDED HERE RATHER THAN AT THE CALL SITE. The
 * Worker's `scheduled()` handler serves the chassis job runner too, which wants that tick; only
 * this function knows what "nightly" is supposed to mean for Boss OS. Putting the guard in the
 * handler would leave the exported function still able to run 96 times a day for the next caller
 * who reaches for it. See `cron/cadence.ts` for the measurements that prompted this.
 *
 * Returns what it decided, so the caller can log a skip as a skip instead of as silence.
 */
export async function runScheduled(env: Env, now = Date.now()): Promise<CronOutcome> {
  const lastRun = await env.DB
    .prepare(`SELECT started_at FROM cron_runs ORDER BY started_at DESC LIMIT 1`)
    .first<{ started_at: number }>();

  if (!maintenanceDue(now, lastRun?.started_at ?? null)) {
    return { ran: false, reason: "not_due", next_window_at: maintenanceWindowOpensAt(now + DAY_MS) };
  }

  const runId = newId("crn");
  const startedAt = now;
  await env.DB
    .prepare(`INSERT INTO cron_runs (id, started_at, status) VALUES (?,?,'running')`)
    .bind(runId, startedAt)
    .run();

  const steps: { name: string; status: string; ms: number; detail?: unknown; error?: string }[] = [];

  const step = async (name: string, fn: () => Promise<unknown>) => {
    const t0 = Date.now();
    try {
      const detail = await fn();
      steps.push({ name, status: "ok", ms: Date.now() - t0, detail });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      steps.push({ name, status: "failed", ms: Date.now() - t0, error: message });
      await logEvent(env.DB, {
        level: "error", scope: "cron", event: `${name}_failed`, detail: { message },
      }).catch(() => {});
    }
  };

  await step("roll_budgets", async () => ({ rolled: await rollBudgetWindows(env.DB) }));
  // The day exists whether or not anyone opened Today, so a day with no gates
  // is still a recorded day rather than a gap in the ledger.
  await step("roll_day", async () => {
    const day = await ensureDay(env.DB, dayId(Date.now()));
    const blocks = await assembleDayFlow(env, day);
    return { day: day.id, blocks: blocks.length, empty: blocks.filter((b) => b.is_empty).length };
  });
  // Canon §40. `roll_day` already surfaces what is due for the day it builds;
  // this step is recorded separately so "the follow-ups were swept" and "the
  // day was rebuilt" stay distinguishable in `cron_runs`.
  await step("surface_follow_ups", async () => {
    const now = Date.now();
    const day = await ensureDay(env.DB, dayId(now));
    return surfaceOverdueFollowUps(env.DB, day.id, now, now);
  });
  // The almanac is computed, so keeping twenty-four months ahead of the date is
  // arithmetic rather than a fetch. It runs nightly so the horizon never
  // quietly shortens to nothing.
  await step("roll_almanac", async () => ensureAlmanac(env.DB, Date.now()));
  // Canon puts the monthly capability scan and the quarterly review on Phase
  // 10's standing duties. That table is not in the surviving artifact, so the
  // cadence rides the nightly cron, which knows the date; the step is a no-op
  // on every day that is not the first of a month.
  await step("capability_cadence", () => runCapabilityCadence(env, Date.now()));
  // Canon §4. The sentinel reads the real tables and raises what is true.
  await step("compliance_sentinel", () => runSentinel(env));
  await step("expiry_sweep", () => runExpirySweep(env));
  await step("promotion_sweep", () => runPromotionSweep(env));
  /*
   * WEEKLY, NOT DAILY, and skipped again when nothing of substance moved.
   *
   * The owner's instruction on 6 Sep 2026: "i think the cron job should be only 1x per week right
   * now. i dont do enough on this system to snapshot more than that." The interval honours that.
   * `skipIfUnchanged` honours the reason behind it - on a quiet week even the weekly copy is a
   * duplicate of the one before it, and a vault full of identical files makes the one restore
   * that matters harder to find, not easier.
   *
   * A skip is a recorded step with its reason, never an absent one. "No snapshot this week
   * because nothing changed" and "no snapshot this week" are different claims, and only the
   * first one is trustworthy.
   */
  await step("snapshot", async () => {
    const last = await env.DB
      .prepare(`SELECT ts FROM vault_snapshots WHERE status = 'complete' ORDER BY ts DESC LIMIT 1`)
      .first<{ ts: number }>();
    if (!snapshotDue(now, last?.ts ?? null)) {
      return { skipped: true, reason: "not_due", last_at: last?.ts ?? null };
    }
    return takeSnapshot(env, "weekly", { skipIfUnchanged: true });
  });
  // Retention runs after the snapshot, so a fresh copy is already in the vault before anything
  // old is considered for deletion. Never the other way round.
  await step("prune_snapshots", () => pruneSnapshots(env));

  const failed = steps.filter((s) => s.status === "failed").length;
  await env.DB
    .prepare(`UPDATE cron_runs SET finished_at = ?, status = ?, steps = ? WHERE id = ?`)
    .bind(
      Date.now(),
      failed === 0 ? "complete" : failed === steps.length ? "failed" : "partial",
      JSON.stringify(steps),
      runId,
    )
    .run();

  await logEvent(env.DB, {
    level: failed ? "warn" : "info", scope: "cron", event: "nightly_complete",
    durationMs: Date.now() - startedAt, detail: { steps, failed },
  });

  return { ran: true, run_id: runId, steps: steps.length, failed };
}

/**
 * Standing duties, on EVERY tick rather than inside the daily run.
 *
 * THE BUG THIS SHAPE AVOIDS, WHICH I WROTE AND CAUGHT BEFORE IT SHIPPED. Putting duty
 * materialisation inside `runScheduled` looks natural — it is maintenance, and maintenance runs
 * daily. But the daily run fires at 03:00 UTC, which is 21:00 or 22:00 the previous evening in
 * America/Chicago. Camille's report is due at 06:30 Chicago, so the 03:00 run would find it not yet
 * due, and the NEXT day's 03:00 run would find it due and fourteen hours stale. The report would
 * arrive a day late, every day, and the cause would look like the duty rather than the cadence it
 * was hung off.
 *
 * A duty may be due at any hour, so the thing that checks must run at every hour. It is cheap by
 * construction: two number comparisons per duty, and at most one row written.
 *
 * ITS OWN waitUntil AT THE CALL SITE, so a failure here cannot swallow the task drain or the daily
 * maintenance, and neither of them can swallow this.
 */
export async function runDuties(env: Env, now = Date.now()) {
  return materialiseDueDuties(env, now);
}

/** What the tick decided. A skip carries its reason so silence is never the only evidence. */
export type CronOutcome =
  | { ran: false; reason: "not_due"; next_window_at: number }
  | { ran: true; run_id: string; steps: number; failed: number };

export default {
  fetch: app.fetch,

  async queue(batch: MessageBatch<TaskMessage>, env: Env): Promise<void> {
    // The dead-letter queue and the work queue share this handler; only the
    // queue name tells them apart.
    if (batch.queue.endsWith("-dlq")) {
      for (const message of batch.messages) {
        try {
          await handleDeadLetter(env, message.body);
          message.ack();
        } catch (err) {
          console.error(JSON.stringify({ scope: "queue", event: "dlq_write_failed", error: String(err) }));
          message.ack(); // never bounce a message inside the dead-letter queue
        }
      }
      return;
    }

    for (const message of batch.messages) {
      try {
        await handleTask(env, message.body);
        message.ack();
      } catch {
        // handleTask has already recorded the failure and its evidence packet.
        message.retry();
      }
    }
  },

  /*
   * THE EVENT KNOWS WHEN IT WAS SUPPOSED TO FIRE, AND THAT IS THE CLOCK THAT MATTERS.
   *
   * This read `Date.now()` and ignored `scheduledTime`. Two consequences, one real and one that
   * only ever bit the suite: a tick delivered late — which Cloudflare explicitly permits — was
   * judged against the wall clock rather than against the window it belonged to; and the maintenance
   * window could not be reached by a test at all, so five tests asserting the nightly run failed
   * for the three hours between 00:00 and 03:00 UTC every day. That is 7pm to 10pm in the owner's
   * own timezone, which is exactly when someone is most likely to be looking.
   */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env, event.scheduledTime ?? Date.now()));
  },
};
