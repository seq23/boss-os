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

/*
 * ─── AND A RUN NOBODY EVER CLAIMED, 18 SEPTEMBER 2026 ──────────────────────
 *
 * The rule above governs runs that WERE claimed. `claimed_at IS NOT NULL` in the query below meant
 * a run parked and never picked up at all was outside this reaper's reach entirely — status
 * `running`, `finished_at` null, for ever, with nothing able to end it and nothing saying so.
 *
 * That is not hypothetical. `brn_m2t69hnweb7bw9c0` — the Executive Intelligence Report — was parked
 * at 12:01:38 UTC and never claimed, because the claimer on her Mac was exiting 1 before it claimed
 * anything (see `scripts/sync-agent/agent.mjs`). She opened Boss OS at 7am, got no brief, and had
 * nothing anywhere to tell her why. The claimer is fixed; the silence it left behind is this.
 *
 * A DEADLINE THAT CANNOT CRY WOLF. The claimer fires five times a day and the longest gap between
 * fires is overnight, so a run parked in the evening legitimately waits until the morning. Twenty-
 * four hours is longer than any legitimate wait and is already the threshold Today uses for "its
 * last task is still running — nothing picked it up", so the alert she may see and the run's own
 * record now change state together instead of one lingering behind the other for ever.
 *
 * IT SAYS SOMETHING DIFFERENT, BECAUSE IT MEANS SOMETHING DIFFERENT. "A device claimed this and
 * went quiet" sends her to look at a machine that ran. "No device ever claimed this" sends her to
 * the claimer, which is where the fault actually is — the distinction the old single sentence could
 * not draw, because it could not see these runs at all.
 */

/** Never reap a run younger than this, whatever it asked for. */
export const REAP_FLOOR_MS = 60 * 60 * 1000;

/**
 * How long a parked run may wait for ANY device to claim it.
 *
 * Longer than the longest legitimate wait — the overnight gap between the claimer's last evening
 * fire and its first morning one — so a quiet night is never reported as a fault.
 */
export const UNCLAIMED_ALLOWED_MS = 24 * 60 * 60 * 1000;

export interface SilentRun {
  id: string;
  task_id: string | null;
  backend_id: string;
  claimed_by: string | null;
  claimed_at: number | null;
  started_at: number;
  requested: string | null;
  lane: string | null;
}

/** How long a run may stay silent after its claim before it is a failure. */
export function silenceAllowedMs(requested: string | null | undefined): number {
  let asked = 0;
  try { asked = Number(JSON.parse(requested ?? "{}")?.max_seconds ?? 0); } catch { asked = 0; }
  return Math.max(REAP_FLOOR_MS, (Number.isFinite(asked) ? asked : 0) * 2 * 1000);
}

/**
 * Pure judgement over a row, so the rule is testable without a clock or a database.
 *
 * A NEVER-CLAIMED RUN IS NOT SILENT, IT IS UNCLAIMED — two different faults with two different
 * places to look, so this refuses to answer for the other one rather than treating a null claim as
 * the epoch and reaping a run parked five minutes ago.
 */
export function isSilent(run: Pick<SilentRun, "claimed_at" | "requested">, now: number): boolean {
  if (run.claimed_at === null || run.claimed_at === undefined) return false;
  return now - run.claimed_at > silenceAllowedMs(run.requested);
}

/**
 * Pure judgement for a run NOBODY claimed, so this rule too is testable without a clock or a
 * database — and so the threshold is one value a test can point at rather than a literal in a query.
 */
export function isUnclaimed(run: Pick<SilentRun, "claimed_at" | "started_at">, now: number): boolean {
  return run.claimed_at === null && now - run.started_at > UNCLAIMED_ALLOWED_MS;
}

export async function reapSilentRuns(env: Env, now = Date.now()): Promise<{ examined: number; reaped: string[] }> {
  const rows = await env.DB
    .prepare(
      `SELECT r.id, r.task_id, r.backend_id, r.claimed_by, r.claimed_at, r.started_at, r.requested, t.lane
         FROM backend_runs r
    LEFT JOIN tasks t ON t.id = r.task_id
        WHERE r.status = 'running' AND r.finished_at IS NULL
          AND ( (r.claimed_at IS NOT NULL AND r.claimed_at < ?)
             OR (r.claimed_at IS NULL     AND r.started_at < ?) )`,
    )
    .bind(now - REAP_FLOOR_MS, now - UNCLAIMED_ALLOWED_MS)
    .all<SilentRun>();

  const reaped: string[] = [];
  for (const run of rows.results ?? []) {
    const neverClaimed = run.claimed_at === null;
    if (neverClaimed ? !isUnclaimed(run, now) : !isSilent(run, now)) continue;
    const since = neverClaimed ? run.started_at : run.claimed_at!;
    const hours = Math.round((now - since) / 3_600_000);
    /*
     * TWO FAULTS, TWO SENTENCES. The old one sent her to look at a machine that ran; a run nobody
     * claimed means the claimer never got to it, which is a different place to look.
     */
    const error = neverClaimed
      ? `No device claimed this run in the ${hours} hour${hours === 1 ? "" : "s"} since it was parked. ` +
        "The claimer on her Mac (com.seq.boss-agent) is not picking work up; the work did not happen."
      : `${run.claimed_by ?? "a device"} claimed this run ${hours} hour${hours === 1 ? "" : "s"} ago and never reported. ` +
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
      action: neverClaimed ? "backend_run_never_claimed" : "backend_run_reaped",
      detail: { backend_id: run.backend_id, task_id: run.task_id, claimed_by: run.claimed_by, silent_hours: hours },
    }).catch(() => {});
    await logEvent(env.DB, {
      level: "error", scope: "backends", event: neverClaimed ? "run_never_claimed" : "run_silent", lane: run.lane ?? "ops", entityId: run.task_id ?? run.id,
      detail: { run_id: run.id, backend_id: run.backend_id, claimed_by: run.claimed_by, silent_hours: hours, never_claimed: neverClaimed },
    }).catch(() => {});
  }
  return { examined: rows.results?.length ?? 0, reaped };
}
