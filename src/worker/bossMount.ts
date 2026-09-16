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
import bossApp, { runScheduled as runBossNightly, runDuties as runBossDuties, runReaper as runBossReaper } from "./boss/index";
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
    /*
     * Workers AI, passed through rather than dropped.
     *
     * The chassis Env carries it and Boss's Env now declares it, but this translation layer is
     * where the two meet — and it was silently omitting the binding, so Boss OS saw `AI` as absent
     * no matter what wrangler.toml said. A binding that exists on one side of a seam and not the
     * other fails as "not configured", which is indistinguishable from a real misconfiguration and
     * sends you looking in the wrong file.
     */
    AI: env.AI,
    /*
     * THE LIVE LINE IS v21. Owner's decision, 6 Sep 2026: the build in ~/GitHub/boss-os is v21;
     * the v20 build in REPO_OPERATOR_ARCHIVE/deprecated-repos/ is deprecated. The two were
     * indistinguishable from inside the product, because this fallback reported the literal
     * string "v20" and `BOSS_OS_VERSION` was never set in wrangler.toml - so production, health
     * checks and every snapshot payload all identified as the deprecated build.
     *
     * The canon in docs/boss/ keeps its v20 filenames: those are the AUTHORITY this implements,
     * not the thing being versioned, and the v20.1 plan §1 forbids renumbering them.
     */
    BOSS_OS_VERSION: env.BOSS_OS_VERSION ?? "21.0.0",
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
  /*
   * ─── A HUNT IS NOT A DRAFTING JOB, AND THE MODEL MUST NOT EAT IT ──────────
   *
   * A task carrying `input.hunt` is work for `scripts/ops/buyer-hunt.mjs --from-boss`, which runs on
   * her Mac because the hunt is SEC full-text search plus eight XML filings per name plus a local
   * ledger — none of which exists in a Worker.
   *
   * Without this exclusion the drain got there first. On 12 September her "find a seller of $1B+ of
   * OpenAI shares" landed on Monique with the hunt parsed correctly onto it —
   * {"asset":"OpenAI","size_usd":1000000000,"side":"sell"} — and the model drained it seconds later
   * and wrote "I will initiate a search for potential sellers", moving the task to
   * `awaiting_approval`. The local runner polls for `queued`, so by the time it looked, the work had
   * been answered by a paragraph promising to do it. That is this repository's most-named defect
   * wearing its politest face: it ran, it reported success, and nothing was hunted.
   *
   * The hunt stays queued until the thing that can actually perform it claims it.
   *
   * ─── AND A GRID FIX IS NOT A DRAFTING JOB EITHER ──────────────────────────
   *
   * A task carrying `input.grid_fix` is a red workflow, a stuck pull request or a lane that stopped
   * shipping in one of her own repositories, found by `scripts/ops/grid-watch.mjs`. Fixing one means
   * working INSIDE that repository, and her standing rule is ONE AGENT PER REPO — learned when three
   * agents in one repo turned forty minutes of work into four hours of rebasing. A drain that
   * claimed a dozen of these at once would break that rule a dozen times in a single tick, and what
   * it would produce is the same paragraph promising the work that the hunt exclusion above exists
   * to prevent.
   *
   * So a grid fix is named, owned by Danielle and visible on the board, and who opens the branch is
   * a decision a person makes, one repository at a time.
   */
  const due = await db
    .prepare(
      `SELECT q.id, q.task_id, q.lane, q.attempt FROM boss_task_queue q
       JOIN tasks t ON t.id = q.task_id
       WHERE q.state = 'pending' AND q.visible_at <= ?
         AND COALESCE(json_extract(t.input, '$.hunt'), '') = ''
         AND COALESCE(json_extract(t.input, '$.grid_fix'), '') = ''
       ORDER BY q.enqueued_at LIMIT ?`,
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

export { runBossNightly, runBossDuties, runBossReaper };
