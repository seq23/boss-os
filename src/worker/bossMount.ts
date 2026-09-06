/**
 * Boss OS, mounted inside the chassis this repo was cloned from.
 *
 * WHY A MOUNT AND NOT A MERGE. Boss OS is ~18k lines of Hono routes written against its own
 * `Env` — `DB`, `VAULT`, `SESSIONS`, `TASKS`. The chassis binds `WP_OS_DB`, `WP_OS_DOCUMENTS`,
 * `WP_OS_KV` and has no queue at all. Rewriting 64 files to rename four bindings would have
 * touched every one of them to change nothing observable, so the translation lives here instead,
 * in one file, and the ported subsystems stay byte-comparable to the artifact they came from.
 *
 * WHY `/api/boss`. Three prefixes collide outright — approvals, governance, knowledge — and the
 * concepts behind employees, intake, memory, models, relationships and tasks exist on both sides
 * with different schemas. Mounting under one prefix means neither router can shadow the other
 * while the two are being reconciled, and every Boss route keeps the path its own tests use.
 */
import type { Env } from "./env";
import bossApp, { runScheduled as runBossNightly } from "./boss/index";
import type { Env as BossEnv, TaskMessage } from "./boss/env";
import { handleTask, handleDeadLetter } from "./boss/queue/consumer";

/** How many times a task may fail before it is handed to the dead-letter path. */
const MAX_ATTEMPTS = 3;
/** Backoff before a failed task becomes visible again. */
const BACKOFF_MS = [0, 30_000, 5 * 60_000];

/**
 * A `Queue`-shaped object backed by D1.
 *
 * Boss OS's routes call `env.TASKS.send(...)` and must keep working unchanged. Only the two
 * methods it actually uses are real; anything else throws rather than silently succeeding,
 * because a queue that accepts work it will never run is the worst of the available failures.
 */
function d1Queue(db: D1Database): Queue<TaskMessage> {
  const enqueue = async (body: TaskMessage, delayMs = 0) => {
    const now = Date.now();
    await db
      .prepare(
        `INSERT INTO boss_task_queue (id, task_id, lane, attempt, state, visible_at, enqueued_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .bind(crypto.randomUUID(), body.taskId, body.lane, body.attempt ?? 0, now + delayMs, now)
      .run();
  };
  return {
    send: (body: TaskMessage) => enqueue(body),
    sendBatch: async (batch: Iterable<{ body: TaskMessage }>) => {
      for (const m of batch) await enqueue(m.body);
    },
  } as unknown as Queue<TaskMessage>;
}

/**
 * Translate the chassis environment into the one Boss OS was written against.
 *
 * `VAULT` is the sharp edge: R2 is optional here and required there, and the continuity vault is
 * the subsystem whose entire point is that a snapshot exists. So an absent bucket is refused at
 * the boundary with a named reason rather than allowed to surface as a null dereference three
 * layers down inside a restore.
 */
export function toBossEnv(env: Env): BossEnv {
  if (!env.WP_OS_DOCUMENTS) {
    throw new Error("boss_vault_unbound: R2 is not bound, so the continuity vault cannot run");
  }
  if (!env.WP_OS_KV) {
    throw new Error("boss_sessions_unbound: KV is not bound, so Boss OS cannot hold a session");
  }
  return {
    DB: env.WP_OS_DB,
    VAULT: env.WP_OS_DOCUMENTS,
    SESSIONS: env.WP_OS_KV,
    TASKS: d1Queue(env.WP_OS_DB),
    ASSETS: env.ASSETS,
    BOSS_OS_VERSION: env.BOSS_OS_VERSION ?? "v20",
    DEFAULT_PROVIDER: env.BOSS_DEFAULT_PROVIDER ?? "local",
    BOSS_PASSCODE: env.BOSS_PASSCODE ?? "",
    SESSION_SECRET: env.BOSS_SESSION_SECRET ?? "",
    FIREWORKS_API_KEY: env.FIREWORKS_API_KEY,
  };
}

/** True when this request belongs to a ported Boss OS route. */
export function isBossRoute(pathname: string): boolean {
  return pathname === "/api/boss" || pathname.startsWith("/api/boss/");
}

/**
 * Hand the request to Boss OS with the mount prefix removed, so its routes and its tests see the
 * same paths they always did.
 */
export async function handleBossRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api\/boss/, "/api") || "/api";
  const inner = new Request(url.toString(), request);
  return bossApp.fetch(inner, toBossEnv(env));
}

/**
 * Drain the task table. Called from the chassis's single cron entry point.
 *
 * Returns what it did rather than nothing, so a tick that ran and found no work is
 * distinguishable in the log from a tick that never ran — the difference the chassis's own
 * scheduling notes are written around.
 */
export async function drainBossTasks(
  env: Env,
  now: Date,
  limit = 25,
): Promise<{ ran: number; failed: number; dead: number }> {
  const bossEnv = toBossEnv(env);
  const db = env.WP_OS_DB;
  const due = await db
    .prepare(
      `SELECT id, task_id, lane, attempt FROM boss_task_queue
       WHERE state = 'pending' AND visible_at <= ?
       ORDER BY enqueued_at LIMIT ?`,
    )
    .bind(now.getTime(), limit)
    .all<{ id: string; task_id: string; lane: string; attempt: number }>();

  let ran = 0;
  let failed = 0;
  let dead = 0;

  for (const row of due.results ?? []) {
    const msg: TaskMessage = { taskId: row.task_id, lane: row.lane, attempt: row.attempt };
    await db.prepare(`UPDATE boss_task_queue SET state = 'running' WHERE id = ?`).bind(row.id).run();
    try {
      await handleTask(bossEnv, msg);
      await db
        .prepare(`UPDATE boss_task_queue SET state = 'done', finished_at = ? WHERE id = ?`)
        .bind(Date.now(), row.id)
        .run();
      ran++;
    } catch (err) {
      const attempt = row.attempt + 1;
      if (attempt >= MAX_ATTEMPTS) {
        // handleTask has already recorded the failure and its evidence packet; the dead-letter
        // path is what stops it being retried for ever in silence.
        await handleDeadLetter(bossEnv, msg, String(err)).catch(() => {});
        await db
          .prepare(
            `UPDATE boss_task_queue SET state = 'dead', attempt = ?, finished_at = ?, last_error = ? WHERE id = ?`,
          )
          .bind(attempt, Date.now(), String(err), row.id)
          .run();
        dead++;
      } else {
        await db
          .prepare(
            `UPDATE boss_task_queue SET state = 'pending', attempt = ?, visible_at = ?, last_error = ? WHERE id = ?`,
          )
          .bind(attempt, Date.now() + (BACKOFF_MS[attempt] ?? 60_000), String(err), row.id)
          .run();
        failed++;
      }
    }
  }
  return { ran, failed, dead };
}

export { runBossNightly };
