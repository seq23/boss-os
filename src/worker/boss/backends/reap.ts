import type { Env } from "../env";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";

/**
 * A RUN THE MACHINE CLAIMED AND NEVER REPORTED IS A FAILURE, AND IT IS SAID SO.
 *
 * ─── What was in production, 15 September 2026 ─────────────────────────────
 *
 * `brn_m2ecxghymfgwg7xf` — Camille's Executive Intelligence Report, hand-fired on the 13th at
 * 22:06 — was claimed by `dev_mac_seq` at 22:10 and never reported. Its task read `running` for
 * two days and eleven hours. Nothing anywhere could end it: the report route refuses a run that is
 * not `running` (correct), the claim route skips a run that is claimed (correct), and no third
 * party existed. The runner most likely died with the laptop's lid, which is the ordinary way a
 * Mac process ends and the one this system is documented to expect.
 *
 * A task that reads `running` for ever is worse than one that reads `failed`: it is a card that
 * looks like progress, it holds its seat's health dot amber with no reason, and if it were the
 * duty's latest task, Today would say "fired, but its last task is still running — nothing picked
 * it up", which sends her to the launchd agent when the agent is fine.
 *
 * ─── The rule ──────────────────────────────────────────────────────────────
 *
 * A run is SILENT when it was claimed longer ago than twice the time it asked for — `max_seconds`
 * in its own request, doubled for a slow machine — and never less than an hour, so a run that asked
 * for ninety seconds is not reaped by a tick that arrived while it was still typing. Reaped means:
 * the run is `failed` with a sentence that names the device and the silence; the task is `failed`
 * the same way the report route fails it; both are audited; and the duty that raised it stays
 * exactly where it was, because the work did not happen and the duty is still due.
 *
 * Runs on every hourly tick, its own `waitUntil`, so it can neither be swallowed by nor swallow the
 * drain, the duties or the nightly.
 */

/** Never reap a run younger than this, whatever it asked for. */
export const REAP_FLOOR_MS = 60 * 60 * 1000;

export interface SilentRun {
  id: string;
  task_id: string | null;
  backend_id: string;
  claimed_by: string | null;
  claimed_at: number;
  requested: string | null;
  lane: string | null;
}

/** How long a run may stay silent after its claim before it is a failure. */
export function silenceAllowedMs(requested: string | null | undefined): number {
  let asked = 0;
  try { asked = Number(JSON.parse(requested ?? "{}")?.max_seconds ?? 0); } catch { asked = 0; }
  return Math.max(REAP_FLOOR_MS, (Number.isFinite(asked) ? asked : 0) * 2 * 1000);
}

/** Pure judgement over a row, so the rule is testable without a clock or a database. */
export function isSilent(run: Pick<SilentRun, "claimed_at" | "requested">, now: number): boolean {
  return now - run.claimed_at > silenceAllowedMs(run.requested);
}

export async function reapSilentRuns(env: Env, now = Date.now()): Promise<{ examined: number; reaped: string[] }> {
  const rows = await env.DB
    .prepare(
      `SELECT r.id, r.task_id, r.backend_id, r.claimed_by, r.claimed_at, r.requested, t.lane
         FROM backend_runs r
    LEFT JOIN tasks t ON t.id = r.task_id
        WHERE r.status = 'running' AND r.finished_at IS NULL AND r.claimed_at IS NOT NULL
          AND r.claimed_at < ?`,
    )
    .bind(now - REAP_FLOOR_MS)
    .all<SilentRun>();

  const reaped: string[] = [];
  for (const run of rows.results ?? []) {
    if (!isSilent(run, now)) continue;
    const hours = Math.round((now - run.claimed_at) / 3_600_000);
    const error =
      `${run.claimed_by ?? "a device"} claimed this run ${hours} hour${hours === 1 ? "" : "s"} ago and never reported. ` +
      "The runner most likely stopped with the machine; the work did not happen.";
    const statements = [
      env.DB.prepare(`UPDATE backend_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ? AND status = 'running' AND finished_at IS NULL`)
        .bind(now, error, run.id),
    ];
    if (run.task_id) {
      statements.push(
        env.DB.prepare(`UPDATE tasks SET status = 'failed', finished_at = COALESCE(finished_at, ?), error = ? WHERE id = ? AND status IN ('queued','running')`)
          .bind(now, error, run.task_id),
      );
    }
    await env.DB.batch(statements);
    reaped.push(run.id);
    await audit(env.DB, {
      actor: "system", lane: run.lane ?? "ops", entityType: "backend_run", entityId: run.id,
      action: "backend_run_reaped",
      detail: { backend_id: run.backend_id, task_id: run.task_id, claimed_by: run.claimed_by, silent_hours: hours },
    }).catch(() => {});
    await logEvent(env.DB, {
      level: "error", scope: "backends", event: "run_silent", lane: run.lane ?? "ops", entityId: run.task_id ?? run.id,
      detail: { run_id: run.id, backend_id: run.backend_id, claimed_by: run.claimed_by, silent_hours: hours },
    }).catch(() => {});
  }
  return { examined: rows.results?.length ?? 0, reaped };
}
