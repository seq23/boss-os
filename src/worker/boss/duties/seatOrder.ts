/**
 * WHICH SUBSCRIPTION SEAT GOES FIRST (owner, 24 Oct 2026: "Use OpenAI first for everything (saves
 * Claude usage)"). ONE PLACE: the queue consumer resolves every task's seat ladder through
 * `orderSeats`, and the Mac's /claim walks the ladder the consumer stamped, so nothing else orders
 * seats. Off: each duty's own order. On: OpenAI's seat (`bk_codex`) is tried before Claude's
 * (`bk_claude_code`) on every ladder that has Claude's seat in it. A seat that cannot do the work
 * refuses and the walk moves on, as it always has. The briefing is Claude first either way (hard work, 13 Nov 2026;
 * `briefingLadder.ts`). Paid cloud rungs are unaffected: they stay unreachable for the briefing.
 */
export const OPENAI_FIRST_KEY = "seat_order_openai_first";
export const OPENAI_SEAT = "bk_codex";
export const CLAUDE_SEAT = "bk_claude_code";

export function orderSeats(ladder: string[], openaiFirst: boolean): string[] {
  if (!openaiFirst || !ladder.includes(CLAUDE_SEAT)) return ladder;
  const rest = ladder.filter((x) => x !== OPENAI_SEAT);
  const at = rest.indexOf(CLAUDE_SEAT);
  return [...rest.slice(0, at), OPENAI_SEAT, ...rest.slice(at)];
}

export const isOn = (v: string | null | undefined) => v === "on" || v === "true";

/**
 * AN LP OR DEAL-TERMS DRAFT RUNS ON THE CLAUDE SEAT ONLY (owner, Today v4, 31 Oct 2026): never Codex /
 * ChatGPT, never a free or training route, never a cloud rung. A task marks itself with
 * `input.confidential_draft = true` (or `input.draft_kind` "lp_reply" / "deal_terms"); its ladder is cut
 * to Claude's seat, the "OpenAI first" switch cannot reorder it, and the cloud fallback is off. A ladder
 * without Claude's seat becomes EMPTY: the task fails closed, it is never moved to another seat.
 */
export const CONFIDENTIAL_DRAFT_KINDS = ["lp_reply", "lp_scheduling", "deal_terms"] as const;
/**
 * OWNER RULING, 4 Nov 2026: an LP reply or scheduling draft is confidential only for an LP who has
 * COMMITTED (`lp_committed: true` on the task, from `committed_at`); a prospect's reply is
 * public-model-approved. Deal terms are always confidential, and so is anything marked so outright.
 */
export function isConfidentialDraft(input: { confidential_draft?: unknown; draft_kind?: unknown; lp_committed?: unknown } | null | undefined): boolean {
  const kind = String(input?.draft_kind ?? "");
  if (input?.confidential_draft === true || kind === "deal_terms") return true;
  return (kind === "lp_reply" || kind === "lp_scheduling") && input?.lp_committed === true;
}
export function confidentialLadder(ladder: string[]): string[] {
  return ladder.filter((x) => x === CLAUDE_SEAT);
}

/*
 * ─── THE SEATS OF A LADDER, IN THE JOB CLASS'S ORDER (owner, 13 Nov 2026) ───────────────────────
 *
 * `routes` is the job's row of aiRoles.mjs ROUTE_TABLE (tiers, never a model). The two seat tiers
 * take the place Claude's seat holds on the duty's own ladder, in the table's order; a tier the table
 * leaves out is left out. A ladder without Claude's seat is left as it is, as `orderSeats` always did:
 * a duty that names one seat for what that seat can do is not widened here.
 */
export const SEAT_OF_TIER: Readonly<Record<string, string>> = { claude: CLAUDE_SEAT, codex: OPENAI_SEAT };

export function seatsForRoutes(routes: readonly string[]): string[] {
  return routes.map((r) => SEAT_OF_TIER[r]).filter((x): x is string => typeof x === "string");
}

export function orderSeatsByRoutes(ladder: string[], routes: readonly string[]): string[] {
  if (!ladder.includes(CLAUDE_SEAT)) return ladder;
  const rest = ladder.filter((x) => x !== OPENAI_SEAT);
  const at = rest.indexOf(CLAUDE_SEAT);
  return [...rest.slice(0, at), ...seatsForRoutes(routes), ...rest.slice(at + 1)];
}

/** How long two failures in a row keep a seat off a job class before it is tried again. */
export const DEMOTION_MS = 7 * 24 * 3600_000;

/**
 * DID THIS SEAT FAIL ITS LAST TWO JOBS OF THIS CLASS? Read from the run log the router already keeps,
 * nothing new stored: `backend_runs` (a run the seat finished: succeeded or failed) and the
 * `ladder_release` events (a run the seat gave an unusable answer on, handed to the next seat).
 * Each run carries the class the queue stamped on it (`requested.job_class`).
 *
 * OUT OF USAGE IS NOT A FAILURE: a spent-plan release carries `exhausted_until` and is not counted,
 * and a refused or cancelled run never ran. Only the newest two count, and only inside DEMOTION_MS,
 * so one good run, or a week, puts the seat back.
 */
export async function seatFailedTwice(db: D1Database, seat: string, jobClass: string, now = Date.now()): Promise<boolean> {
  const rows = await db
    .prepare(
      `SELECT ok FROM (
         SELECT COALESCE(finished_at, started_at) AS ts, CASE status WHEN 'succeeded' THEN 1 ELSE 0 END AS ok
           FROM backend_runs
          WHERE backend_id = ?1 AND status IN ('succeeded','failed')
            AND json_extract(requested, '$.job_class') = ?2 AND COALESCE(finished_at, started_at) > ?3
         UNION ALL
         SELECT e.ts AS ts, 0 AS ok
           FROM task_events e JOIN backend_runs r ON r.id = json_extract(e.detail, '$.run_id')
          WHERE e.event = 'ladder_release' AND e.ts > ?3
            AND json_extract(e.detail, '$.from') = ?1 AND json_extract(e.detail, '$.exhausted_until') IS NULL
            AND json_extract(r.requested, '$.job_class') = ?2
       ) ORDER BY ts DESC LIMIT 2`,
    )
    .bind(seat, jobClass, now - DEMOTION_MS)
    .all<{ ok: number }>();
  const last = rows.results ?? [];
  return last.length === 2 && last.every((r) => Number(r.ok) === 0);
}
