/**
 * THE MONTHLY MEASURED LINE: PER ROUTE, HOW MANY RUNS COMPLETED, FAILED AND WERE REDONE (owner,
 * 13 Nov 2026). Counted from the run logs the router already keeps, nothing new stored:
 *
 *   · the seats (Claude's, Codex's)  `backend_runs`: succeeded / failed, and "redone" = a run the
 *     seat gave up and the next seat took (`ladder_release` events naming it as `from`);
 *   · the free and cloud routes      `usage_ledger` joined to the model's provider: ok / error, and
 *     "redone" = answers that failed the job's own check (`model_job_outcome` rejected by the router).
 *
 * A route is a provider or a seat, never a model. A source that cannot be read says so in its cell
 * (`not read: <reason>`); it is never a zero.
 */
export interface RouteCount { route: string; completed: number; failed: number; redone: number }
export interface RouteCounts { since: number; until: number; routes: RouteCount[]; notRead: string[] }

export async function routeCounts(db: D1Database, since: number, until: number): Promise<RouteCounts> {
  const by = new Map<string, RouteCount>();
  const at = (route: string) => by.get(route) ?? by.set(route, { route, completed: 0, failed: 0, redone: 0 }).get(route)!;
  const notRead: string[] = [];
  const read = async <T>(what: string, sql: string, each: (r: T) => void) => {
    try {
      const rows = await db.prepare(sql).bind(since, until).all<T>();
      for (const r of rows.results ?? []) each(r);
    } catch (e) {
      notRead.push(`${what} not read: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
    }
  };
  await read<{ route: string; status: string; n: number }>("seat runs",
    `SELECT backend_id AS route, status, COUNT(*) AS n FROM backend_runs
      WHERE started_at >= ? AND started_at < ? AND status IN ('succeeded','failed') GROUP BY 1, 2`,
    (r) => { at(r.route)[r.status === "succeeded" ? "completed" : "failed"] += Number(r.n); });
  await read<{ route: string; n: number }>("seat hand-downs",
    `SELECT json_extract(detail, '$.from') AS route, COUNT(*) AS n FROM task_events
      WHERE event = 'ladder_release' AND ts >= ? AND ts < ? AND json_extract(detail, '$.from') IS NOT NULL GROUP BY 1`,
    (r) => { at(r.route).redone += Number(r.n); });
  await read<{ route: string; status: string; n: number }>("model calls",
    `SELECT COALESCE(m.provider_id, 'unknown') AS route, u.status AS status, COUNT(*) AS n
       FROM usage_ledger u LEFT JOIN models m ON m.id = u.model_id
      WHERE u.ts >= ? AND u.ts < ? GROUP BY 1, 2`,
    (r) => { at(r.route)[r.status === "ok" ? "completed" : "failed"] += Number(r.n); });
  await read<{ route: string; n: number }>("answers that failed their check",
    `SELECT m.provider_id AS route, COUNT(*) AS n FROM model_job_outcome o JOIN models m ON m.id = o.model_id
      WHERE o.ts >= ? AND o.ts < ? AND o.source = 'router' AND o.outcome = 'rejected' GROUP BY 1`,
    (r) => { at(r.route).redone += Number(r.n); });
  return { since, until, routes: [...by.values()].sort((a, b) => b.completed + b.failed - (a.completed + a.failed) || a.route.localeCompare(b.route)), notRead };
}

/** One line for the Systems list. Zero runs anywhere is said by name, never left looking like a quiet month. */
export function routeCountsLine(c: RouteCounts): string {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const cells = c.routes.map((r) => `${r.route} ${r.completed} completed, ${r.failed} failed, ${r.redone} redone`);
  const body = cells.length ? cells.join("; ") : c.notRead.length ? "no route could be counted" : "NAMED STOP [NO_RUNS_COUNTED] the run logs hold no run in this window";
  return `Routes ${day(c.since)} to ${day(c.until)}: ${body}${c.notRead.length ? ` (${c.notRead.join("; ")})` : ""}.`;
}
