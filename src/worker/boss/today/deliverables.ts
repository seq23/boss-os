import type { Env } from "../env";

/**
 * OWNED WORK, AND WHY IT CANNOT BE QUIETLY DROPPED.
 *
 * Her rule: "she owns this deliverable so she needs to make sure its done and if there is any block
 * she needs to tell me immediately and keep reminding me until its done. she canot drop it. that
 * goes for all employees when i give them something to own."
 *
 * ─── The distinction this file rests on ─────────────────────────────────────
 *
 * A DUTY IS DEFINED BY FIRING. A DELIVERABLE IS DEFINED BY BEING TRUE.
 *
 * `duty_practice_week` fired every Sunday for eleven weeks, cost real money, and delivered into a
 * handler that did not exist. Every signal said it worked, because a duty's success criterion is
 * that it ran. That is the failure this mechanism outlaws, and it is why the terminal check here
 * asks the RECORDS rather than asking the duty, the employee, or the job.
 *
 * ─── Which is what makes a broken executor loud instead of restful ──────────
 *
 * Nothing a run says can close a deliverable. A watcher that stops reporting stops advancing
 * `last_activity_at`, and that silence IS the stall condition — so the failure mode where a
 * commitment dies along with the job that was keeping it alive cannot happen here. The commitment
 * outlives its executor by construction.
 *
 * ─── Computed on read, on the screen she already opens ──────────────────────
 *
 * Every alert below is produced while rendering Today. Not by a cron that could itself fail
 * silently, and not on a page she has to remember to visit. An escalation you have to go and find
 * is not an escalation.
 */

export interface DeliverableRow {
  id: string;
  name: string;
  employee_id: string;
  employee_name: string | null;
  lane: string;
  terminal_condition: string;
  terminal_check: string;
  state: string;
  duty_id: string | null;
  escalation_path: string;
  blocker: string | null;
  blocked_since: number | null;
  last_activity_at: number | null;
  stall_after_days: number;
}

export interface DeliverableAlert {
  severity: "medium" | "high" | "critical";
  text: string;
  source_type: string;
  source_id: string | null;
}

/**
 * THE LADDER. Days blocked → how loudly she is told.
 *
 * "Keep reminding me until its done" is the instruction, and a reminder that reads identically on
 * day one and day twenty is one she learns to skim past — which is the same silence it was meant to
 * replace, wearing a badge. So the words change as well as the severity, and the top rung says the
 * thing that is actually true at a fortnight: the current route is not working and something else
 * has to happen.
 *
 * Pure arithmetic, exported, so the interesting rungs are testable without standing anything up.
 */
export function escalationFor(daysBlocked: number): { severity: "medium" | "high" | "critical"; tone: string } {
  if (daysBlocked >= 14) {
    return {
      severity: "critical",
      tone: "This has been blocked for over two weeks. The route being used is not working — it needs a different one, and only you can open it.",
    };
  }
  if (daysBlocked >= 7) {
    return { severity: "critical", tone: "A week blocked. Whatever is being tried is not moving it." };
  }
  if (daysBlocked >= 3) {
    return { severity: "high", tone: "Still blocked after several days." };
  }
  return { severity: "medium", tone: "Raised now, and it stays here until it clears." };
}

/**
 * The terminal conditions the Worker knows how to evaluate.
 *
 * A DELIVERABLE IS CLOSED BY THE WORLD, NOT BY A CLAIM. Each check counts real rows. Adding one is
 * a deliberate act: `validate:owned-deliverables` fails the build if a migration names a check that
 * is not in this object, because a deliverable whose terminal check is a typo can never be
 * satisfied and would nag her for ever with no way out but killing it.
 */
export const TERMINAL_CHECKS: Record<
  string,
  (env: Env) => Promise<{ met: boolean; progress: string }>
> = {
  /**
   * Every authored title is Live.
   *
   * `in_review` DOES NOT COUNT AS DONE. A title Amazon is still looking at is not published, and
   * three of hers sat in review for days before going Live. Counting them would close the
   * deliverable on the strength of a submission.
   */
  kdp_all_live: async (env: Env) => {
    const row = await env.DB
      .prepare(
        `SELECT
           SUM(CASE WHEN state IN ('blocked','in_review') THEN 1 ELSE 0 END) AS outstanding,
           SUM(CASE WHEN state = 'live' THEN 1 ELSE 0 END) AS live,
           COUNT(*) AS total
         FROM kdp_titles WHERE state != 'withdrawn'`,
      )
      .first<{ outstanding: number; live: number; total: number }>();

    const outstanding = row?.outstanding ?? 0;
    const live = row?.live ?? 0;
    const total = row?.total ?? 0;

    /*
     * AN EMPTY TABLE IS NOT COMPLETION. Zero outstanding out of zero titles would otherwise read as
     * "everything is published" — the empty-loop pass, at the level of an outcome. If the register
     * of titles is empty, the deliverable is not met and says why.
     */
    if (total === 0) {
      return { met: false, progress: "No titles are recorded at all, which is a broken register rather than a finished shelf." };
    }
    return { met: outstanding === 0, progress: `${live} of ${total} Live, ${outstanding} still outstanding.` };
  },
};

/**
 * Every open deliverable, evaluated, with anything that needs saying.
 *
 * Returns the alerts rather than pushing them, so `today.ts` decides where they sit and this file
 * stays testable. Closing a deliverable whose condition is now met is a WRITE and happens here on
 * purpose: the moment the world becomes true is the moment it should stop nagging her, and making
 * that depend on a separate job would be one more thing that can fail silently.
 */
export async function deliverableAlerts(env: Env, now = Date.now()): Promise<DeliverableAlert[]> {
  const rows = await env.DB
    .prepare(
      `SELECT d.id, d.name, d.employee_id, e.name AS employee_name, d.lane, d.terminal_condition,
              d.terminal_check, d.state, d.duty_id, d.escalation_path, d.blocker, d.blocked_since,
              d.last_activity_at, d.stall_after_days
         FROM owned_deliverables d
         LEFT JOIN employees e ON e.id = d.employee_id
        WHERE d.state IN ('open','blocked')
        ORDER BY COALESCE(d.blocked_since, d.created_at)`,
    )
    .all<DeliverableRow>();

  const open = rows.results ?? [];
  const alerts: DeliverableAlert[] = [];

  /*
   * RULE 0, ON A SURFACE RATHER THAN IN A BUILD.
   *
   * A loop over an empty set that returns "nothing to report" is the defect class her rules name by
   * name, and here it would be the worst possible instance of it: a register of commitments that is
   * empty renders as "nothing is stuck", which is indistinguishable from "everything is fine". The
   * system was seeded with one deliverable in 0202, so zero means rows were lost or the table was
   * never migrated — either way she is told, rather than shown a reassuring blank.
   */
  if (open.length === 0) {
    const anyAtAll = await env.DB.prepare(`SELECT COUNT(*) AS n FROM owned_deliverables`).first<{ n: number }>();
    if ((anyAtAll?.n ?? 0) === 0) {
      alerts.push({
        severity: "high",
        text: "The register of owned work is empty. That is a broken register, not a clear plate — nothing can be tracked as owned until something is in it.",
        source_type: "tasks",
        source_id: null,
      });
    }
    return alerts;
  }

  for (const d of open) {
    const who = d.employee_name ?? d.employee_id;

    // ── Has the world made it true? ──
    const check = TERMINAL_CHECKS[d.terminal_check];
    if (check) {
      let outcome: { met: boolean; progress: string } | null = null;
      try {
        outcome = await check(env);
      } catch {
        // A check that throws must not close the deliverable and must not hide it. It stays open
        // and the ordinary escalation below still runs, which is the safe direction.
        outcome = null;
      }
      if (outcome?.met) {
        await env.DB
          .prepare(`UPDATE owned_deliverables SET state = 'done', done_at = ?, updated_at = ? WHERE id = ?`)
          .bind(now, now, d.id)
          .run();
        alerts.push({
          severity: "medium",
          text: `${who} finished "${d.name}". ${outcome.progress}`,
          source_type: "tasks",
          source_id: d.id,
        });
        continue;
      }
    } else {
      /*
       * A DELIVERABLE WITH NO KNOWN CHECK CAN NEVER COMPLETE, so it is reported as the fault it is
       * rather than nagging her for ever about something with no way out. The build validator makes
       * this unreachable; it is here because a validator only guards the migrations it can see.
       */
      alerts.push({
        severity: "high",
        text: `"${d.name}" names a completion check (${d.terminal_check}) this system does not have, so nothing can ever mark it done. ${who} owns it.`,
        source_type: "tasks",
        source_id: d.id,
      });
    }

    // ── Blocked: tell her at once, and keep telling her, louder. ──
    if (d.state === "blocked") {
      const days = Math.floor((now - (d.blocked_since ?? now)) / 86_400_000);
      const { severity, tone } = escalationFor(days);
      alerts.push({
        severity,
        text:
          `${who} is blocked on "${d.name}" — ${days} day${days === 1 ? "" : "s"}. ` +
          `${d.blocker ?? "No blocker was recorded, which is itself the problem."} ${tone}`,
        source_type: "tasks",
        source_id: d.id,
      });
    }

    /*
     * ── Silence, which is its own alarm. ──
     *
     * THIS IS THE RULE THAT MAKES DROPPING IT IMPOSSIBLE. An owner who stops working something, a
     * launchd job that stops firing, a duty skipped for budget — all three look identical from
     * inside the system, and all three produce the same thing: nothing happening. So nothing
     * happening is what is measured, and it is measured against the deliverable rather than against
     * the executor, which means a broken executor makes this louder rather than quieter.
     */
    const since = d.last_activity_at ?? null;
    const stallDays = since === null ? null : Math.floor((now - since) / 86_400_000);
    if (stallDays !== null && stallDays >= d.stall_after_days) {
      alerts.push({
        severity: stallDays >= d.stall_after_days * 2 ? "critical" : "high",
        text:
          `Nothing has happened on "${d.name}" for ${stallDays} days and ${who} owns it. ` +
          (d.duty_id
            ? `${d.duty_id} is meant to be moving it, so either it has stopped running or it is running and achieving nothing.`
            : "Nothing automated is moving it, so it moves when you move it."),
        source_type: "tasks",
        source_id: d.id,
      });
    }
    if (since === null) {
      alerts.push({
        severity: "high",
        text: `"${d.name}" has never had any activity recorded, and ${who} owns it. Nothing has started.`,
        source_type: "tasks",
        source_id: d.id,
      });
    }
  }

  return alerts;
}

/**
 * Something happened on a deliverable.
 *
 * Called by whatever moves the work — the KDP watcher's report is the first caller. It advances
 * `last_activity_at`, which is the only thing standing between a commitment and the stall alarm,
 * and it may set or clear the block. IT CANNOT MARK ANYTHING DONE: only `TERMINAL_CHECKS` does
 * that, and that asymmetry is the whole design.
 */
export async function recordDeliverableActivity(
  env: Env,
  args: { id: string; blocked?: boolean; blocker?: string | null; now?: number },
): Promise<void> {
  const now = args.now ?? Date.now();
  const row = await env.DB
    .prepare(`SELECT id, state, blocked_since FROM owned_deliverables WHERE id = ?`)
    .bind(args.id)
    .first<{ id: string; state: string; blocked_since: number | null }>();
  if (!row) return;
  // A deliverable she killed stays killed. A run reporting activity on it must not resurrect a
  // decision she made.
  if (row.state === "killed" || row.state === "done") {
    await env.DB.prepare(`UPDATE owned_deliverables SET last_activity_at = ?, updated_at = ? WHERE id = ?`)
      .bind(now, now, args.id).run();
    return;
  }

  const blocked = args.blocked === true;
  await env.DB
    .prepare(
      `UPDATE owned_deliverables
          SET last_activity_at = ?,
              state = ?,
              blocker = COALESCE(?, blocker),
              -- THE CLOCK IS NOT RESTARTED BY A CHECK-IN. A block that is still a block on day
              -- twelve is twelve days old, however many times someone looked at it. Resetting here
              -- would make the ladder measure attention rather than duration, which is precisely
              -- the number that must not be resettable.
              blocked_since = CASE WHEN ? = 1 THEN COALESCE(blocked_since, ?) ELSE NULL END,
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(now, blocked ? "blocked" : "open", args.blocker ?? null, blocked ? 1 : 0, now, now, args.id)
    .run();
}
