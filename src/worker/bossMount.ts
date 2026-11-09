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
import bossApp, { runScheduled as runBossNightly, runDuties as runBossDuties, runReaper as runBossReaper, runOutreach as runBossOutreach, runOpenLoops as runBossOpenLoops, runEightraise as runBossEightraise, runKendra as runBossKendra } from "./boss/index";
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
    // `delaySeconds` is honoured as the real Queue does: a dated deferred task (R14) waits for its date.
    send: (body: TaskMessage, opts?: { delaySeconds?: number }) => enqueue(body, Math.max(0, Number(opts?.delaySeconds ?? 0)) * 1000),
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
    BROWSER: env.BROWSER,
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
    BOSS_EXTRA_OWNER_SENDERS: env.BOSS_EXTRA_OWNER_SENDERS,
    FIREWORKS_API_KEY: env.FIREWORKS_API_KEY,
    // The Gmail draft's key. Omitting it here is how `AI` sat declared-and-unreachable for a week.
    GSC_SERVICE_ACCOUNT_JSON: env.GSC_SERVICE_ACCOUNT_JSON,
    // R3: the secret door's key. Omitted here, the door would be declared and fail closed forever.
    BOSS_OS_SECRET_HANDOFF_KEY: env.BOSS_OS_SECRET_HANDOFF_KEY,
    /*
     * THE TWO FRONTIER KEYS (26 Oct 2026). Set on the Worker since 17 Sep and never passed through
     * here, so Boss OS's Anthropic and OpenAI backends were "enabled" with no key they could reach,
     * and the first probe of them said so. Every key a backend's wiring names must cross this seam;
     * tests/bossEnvCarriesBackendKeys.test.ts reads the wiring and fails if one does not.
     */
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    // OpenRouter too, the same seam's same gap (bk_openrouter enabled 17 Sep with its own cap).
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    BRAVE_SEARCH_API_KEY: env.BRAVE_SEARCH_API_KEY,
  };
}

/** True when this request belongs to a ported Boss OS route. */
export function isBossRoute(pathname: string): boolean {
  return pathname === "/api/boss" || pathname.startsWith("/api/boss/");
}

/**
 * HER ONE-TAP LINKS ARE PAGES, NOT /api PATHS (combined boss fix, 23 Oct 2026). The plain-email gate
 * holds any email linking to an /api path (rule 13), so the morning email's Send as is / Skip /
 * Approve buttons point at `/tap/<token>?do=…` and are served here by Boss OS's tap route
 * (`/api/auth/tap`, src/worker/boss/routes/lpTap.ts). Same handler, same token rules: a GET only
 * renders the confirm page, the page's own POST (relative `?do=…`) acts.
 */
export const TAP_PAGE_RE = /^\/tap\/([A-Za-z0-9_-]{20,40})$/;
export function tapPageToBossPath(pathname: string): string | null {
  const m = TAP_PAGE_RE.exec(pathname);
  return m ? `/api/boss/auth/tap/${m[1]}` : null;
}

/**
 * HER RESEARCH PAGES ARE PAGES, NOT /api PATHS (repair, 1 Nov 2026 — held mail
 * 9755e2553df7b488.json, f1ea62c2edaacc01.json: every research delivery's own line,
 * `Page: https://boss.sequoiataylor.com/api/boss/research/pages/<id>`, tripped rule 13 and held the
 * whole email). Same shape as `tapPageToBossPath`: a plain address, mapped to the existing
 * session-gated handler — never a new door. Ids are `rpg_…`.
 */
export const RESEARCH_PAGE_PATH_RE = /^\/research\/([A-Za-z0-9_-]{3,64})$/;
export function researchPageToBossPath(pathname: string): string | null {
  const m = RESEARCH_PAGE_PATH_RE.exec(pathname);
  return m ? `/api/boss/research/pages/${m[1]}` : null;
}

/**
 * A PARTNER ONE-PAGER IS A PAGE, NOT AN /api PATH (owner, 8 Nov 2026). The link in Monique's second
 * partner email and in her notes to the owner is `/p/<token>`, mapped to the ungated one-pager route
 * (routes/outreach.ts `partnerPage`), the same way as `/tap` and `/research`.
 */
export const PARTNER_PAGE_RE = /^\/p\/([A-Za-z0-9_-]{16,40})$/;
export function partnerPageToBossPath(pathname: string): string | null {
  const m = PARTNER_PAGE_RE.exec(pathname);
  return m ? `/api/boss/outreach/p/${m[1]}` : null;
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

/** A claimed row with no task progress for this long belongs to an invocation that died. */
export const ORPHAN_AFTER_MS = 20 * 60_000;

/**
 * A ROW CLAIMED BY A DRAIN THAT DIED IS PUT BACK (6 Nov 2026). The drain marks a row 'running' and
 * only its own invocation ever moves it on, so an invocation cut short (a request's 30-second tail,
 * a tick past its limit) left the task 'running' for ever: Camille's deep research for Valerie sat
 * from 07:00 with no run anywhere and nothing looking. A 'running' row whose task has written no
 * event for ORPHAN_AFTER_MS is re-queued (its attempt counted); past MAX_ATTEMPTS it goes to the
 * dead-letter path, which tells her. A task parked on a seat is not this: its row is already 'done'.
 */
export async function reapOrphanedRuns(bossEnv: BossEnv, db: D1Database, now: number): Promise<number> {
  const stale = await db
    .prepare(
      `SELECT q.id, q.task_id, q.lane, q.attempt FROM boss_task_queue q
        WHERE q.state = 'running' AND q.visible_at < ?1
          AND COALESCE((SELECT MAX(e.ts) FROM task_events e WHERE e.task_id = q.task_id), 0) < ?1`,
    )
    .bind(now - ORPHAN_AFTER_MS)
    .all<{ id: string; task_id: string; lane: string; attempt: number }>();
  let n = 0;
  for (const row of stale.results ?? []) {
    const attempt = row.attempt + 1;
    const why = `requeued: the run that claimed it stopped with no word for ${Math.round(ORPHAN_AFTER_MS / 60_000)} minutes`;
    if (attempt >= MAX_ATTEMPTS) {
      await handleDeadLetter(bossEnv, { taskId: row.task_id, lane: row.lane, attempt }, why).catch(() => {});
      await db.prepare(`UPDATE boss_task_queue SET state = 'dead', attempt = ?, finished_at = ?, last_error = ? WHERE id = ? AND state = 'running'`)
        .bind(attempt, now, why, row.id).run();
    } else {
      await db.batch([
        db.prepare(`UPDATE boss_task_queue SET state = 'pending', attempt = ?, visible_at = ?, last_error = ? WHERE id = ? AND state = 'running'`).bind(attempt, now, why, row.id),
        db.prepare(`UPDATE tasks SET status = 'queued' WHERE id = ? AND status = 'running'`).bind(row.task_id),
        db.prepare(`INSERT INTO task_events (id, task_id, ts, event, detail) VALUES (?,?,?,'requeued',?)`)
          .bind(`tev_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`, row.task_id, now, JSON.stringify({ why, attempt })),
      ]);
    }
    n++;
  }
  return n;
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
  opts: { fromRequest?: boolean } = {},
): Promise<{ ran: number; failed: number; dead: number; reaped?: number }> {
  const bossEnv = toBossEnv(env);
  const db = env.WP_OS_DB;
  const reaped = await reapOrphanedRuns(bossEnv, db, now.getTime());
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
   * So a grid fix is named, owned by Danielle and visible on the board, and it is CLAIMED BY THE CI
   * SWEEP — one agent per repo, through the inbox grid-watch writes (`TASK_EXECUTORS.grid_fix`).
   * A token this drain refuses with no entry in TASK_EXECUTORS fails `validate:work-reaches-executor`.
   */
  const due = await db
    .prepare(
      `SELECT q.id, q.task_id, q.lane, q.attempt FROM boss_task_queue q
       JOIN tasks t ON t.id = q.task_id
       WHERE q.state = 'pending' AND q.visible_at <= ?
         AND COALESCE(json_extract(t.input, '$.hunt'), '') = ''
         AND COALESCE(json_extract(t.input, '$.grid_fix'), '') = ''
         AND (? = 0 OR COALESCE(q.last_error, '') NOT LIKE 'tick-only%')
       ORDER BY q.enqueued_at LIMIT ?`,
    )
    .bind(now.getTime(), opts.fromRequest ? 1 : 0, limit)
    .all<{ id: string; task_id: string; lane: string; attempt: number }>();

  let ran = 0;
  let failed = 0;
  let dead = 0;

  for (const row of due.results ?? []) {
    const msg: TaskMessage = { taskId: row.task_id, lane: row.lane, attempt: row.attempt, ...(opts.fromRequest ? { fromRequest: true } : {}) };
    /*
     * CLAIMED ATOMICALLY. Two drains can now overlap — the request that queued a rewrite and the
     * progress poll that kicks the queue two seconds later — and before this a plain UPDATE let both
     * run the same task. The conditional write means exactly one of them proceeds; the other sees
     * zero rows changed and moves on.
     */
    const claimed = await db
      .prepare(`UPDATE boss_task_queue SET state = 'running' WHERE id = ? AND state = 'pending'`)
      .bind(row.id)
      .run();
    if (!claimed.meta || claimed.meta.changes === 0) continue;
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
  return { ran, failed, dead, ...(reaped ? { reaped } : {}) };
}

export { runBossNightly, runBossDuties, runBossReaper, runBossOutreach, runBossOpenLoops, runBossEightraise, runBossKendra };
