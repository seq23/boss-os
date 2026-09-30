/**
 * HOW LONG A MODEL CALL MAY TAKE, AND HOW LONG A WHOLE WALK DOWN THE LADDER MAY TAKE.
 *
 * ─── What was here before: nothing ─────────────────────────────────────────
 *
 * Not a short deadline — NO deadline. Grepped 18 September 2026 across
 * `src/worker/boss/router/`: no `AbortSignal`, no `AbortController`, no `setTimeout`, no `signal`
 * on any of the four `fetch()` calls in `anthropic.ts`, `openai.ts`, `openrouter.ts` and
 * `fireworks.ts`, and no race around `env.AI.run` in `workersAi.ts`. A provider that accepted the
 * connection and then stopped answering held the run open with nothing to end it.
 *
 * AND THE LADDER MADE THAT ARITHMETIC MUCH WORSE ON 17 SEPTEMBER. Migration 0256 registered
 * fifteen model rows, and `maxFallbackHops` went 1 → 3, which was right — a thirteen-rung ladder
 * under one paid hop is decoration. But the walk is now up to ten free attempts plus four paid
 * ones, each of which may also be retried, and NONE of them was bounded. The worst case was not a
 * long wait; it had no upper bound at all, and what she experiences as "nothing is happening" is
 * precisely the complaint that started the day.
 *
 * ─── The numbers, and what measured them ───────────────────────────────────
 *
 * A DEADLINE SET TO MATCH A SENTENCE IS THE DEFECT, NOT THE FIX. In the sibling repository the same
 * gap was closed by reading a comment that said "~3 min" and writing 180s, and the owner caught it
 * immediately: a deadline equal to the expected duration fails about half the calls by
 * construction. Measurement of that repo's completed runs then showed a 251.0s maximum — four runs
 * that day exceeded the 180s that had been about to ship as the fix.
 *
 * SO THIS REPOSITORY'S NUMBERS COME FROM THIS REPOSITORY'S MEASUREMENTS. `model_benchmarks` holds
 * seven real generations against `mdl_cf_llama33_70b`, recorded 12 September 2026, every one a
 * completed call with its own evidence file:
 *
 *     1076  1292  1714  1916  2382  9312  19767   (ms)
 *     n=7   min 1.1s   median 1.9s   max 19.8s
 *
 * The 19,767ms outlier is `bmk_70b_rc_repo`, whose own note calls it "ten times its median on the
 * other six probes". That is the honest shape of this path: a fast median and a long tail.
 *
 * PER ATTEMPT, 300 SECONDS. Fifteen times the measured maximum here, and above the 251s maximum
 * measured on the sibling's frontier reasoning work — which is the nearer population for rungs
 * 100–130, since not one of the four free reasoning lanes registered in 0256 has been benchmarked
 * on this path yet. It is deliberately NOT tuned close to any observed duration: the point of this
 * constant is to end a call that has stopped answering, not to grade a slow one.
 *
 * WHAT IS UNMEASURED IS SAID SO. No Boss OS latency exists for any reasoning model, because
 * `usage_ledger` has no duration column and the four free reasoning lanes have served zero
 * production requests. When that data exists, this number should be re-derived from it and this
 * comment should change with it.
 */

/** Longest a single provider call may take before it is abandoned. See the derivation above. */
export const ATTEMPT_DEADLINE_MS = 300_000;

/**
 * Longest a whole walk down the ladder may take, across every rung and every retry.
 *
 * THIS IS THE BOUND THAT ACTUALLY PROTECTS HER, and it can be reasoned about without knowing any
 * single model's latency. The per-attempt deadline bounds one call; only this bounds fourteen.
 *
 * TEN MINUTES, AND THE REASON IS THE CRON. The tick is hourly (ADR-017) and drains the task queue.
 * A run allowed to occupy an appreciable fraction of that hour lets the next tick's work stack up
 * behind it, which turns one stuck provider into a backlog. Ten minutes is thirty times the
 * measured maximum call on this path, leaves the hourly tick overwhelmingly free, and puts a
 * number on the thing that previously had none.
 *
 * IT STOPS THE WALK BEFORE A DOOMED CALL, NOT DURING ONE. An attempt is only started if it could
 * finish inside what is left; otherwise the walk ends and says so. Beginning a call that the budget
 * guarantees will be cut off spends money and her time for an answer that cannot arrive.
 */
export const CHAIN_BUDGET_MS = 600_000;

/** What remains of the chain budget, given when the walk started. */
export function chainRemainingMs(startedAt: number, now: number): number {
  return Math.max(0, CHAIN_BUDGET_MS - (now - startedAt));
}

/**
 * How long the next attempt may have, or null when there is not enough left to be worth starting.
 *
 * NULL IS A DECISION, NOT AN ERROR. The caller records a named stop — the run ran out of time
 * walking the ladder — which is a different and far more useful sentence than the silence that
 * preceded it.
 */
export function nextAttemptDeadlineMs(startedAt: number, now: number, ceilingMs = ATTEMPT_DEADLINE_MS): number | null {
  const remaining = chainRemainingMs(startedAt, now);
  if (remaining <= 0) return null;
  return Math.min(ceilingMs, remaining);
}

/**
 * A SEARCH-ENABLED CALL MAY TAKE THE WHOLE CHAIN. A research answer opens twenty to forty pages and
 * writes a long report; five minutes is the ceiling for a plain generation and is not measured
 * against this. UNMEASURED — there has been no production run of it — so it is bounded by the chain
 * budget, which still ends the walk, rather than by a number chosen to look reasonable.
 */
export const RESEARCH_ATTEMPT_DEADLINE_MS = CHAIN_BUDGET_MS;
