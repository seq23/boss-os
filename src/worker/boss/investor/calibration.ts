/**
 * Prediction scoring — canon §41's Prediction Vault, the half that makes it
 * load-bearing rather than decorative.
 *
 * A forecast is scored by its Brier contribution, `(p − outcome)²`, kept in
 * basis points so nothing depends on float equality: 10000 is as wrong as it
 * gets, 0 is perfect, and a coin-flip 50% scores 2500 whatever happens. A
 * calibration run is the mean of those contributions plus the bucket table that
 * shows *where* the forecasting is off — a single number tells you that you are
 * miscalibrated, the buckets tell you whether it is overconfidence at the top
 * end or hedging in the middle.
 */

import { newId } from "../lib/id";

export const BPS = 10_000;
const BUCKET_WIDTH_BPS = 1_000;

export interface ResolvedPrediction {
  id: string;
  probability_bps: number;
  outcome: string | null;
  resolved_at: number | null;
}

/** `(p − outcome)²` in basis points. Lower is better. */
export function brierBps(probabilityBps: number, outcome: "true" | "false"): number {
  const p = Math.max(0, Math.min(BPS, Math.round(probabilityBps))) / BPS;
  const actual = outcome === "true" ? 1 : 0;
  return Math.round((p - actual) ** 2 * BPS);
}

export interface CalibrationBucket {
  from_bps: number;
  to_bps: number;
  n: number;
  mean_probability_bps: number;
  hit_rate_bps: number;
  gap_bps: number;
}

export interface CalibrationResult {
  id: string;
  ts: number;
  window_start: number;
  window_end: number;
  predictions_scored: number;
  ambiguous_excluded: number;
  brier_score_bps: number | null;
  mean_probability_bps: number | null;
  hit_rate_bps: number | null;
  overconfidence_bps: number | null;
  buckets: CalibrationBucket[];
}

function bucketIndex(probabilityBps: number): number {
  return Math.min(9, Math.floor(probabilityBps / BUCKET_WIDTH_BPS));
}

const mean = (values: number[]) =>
  values.length === 0 ? 0 : Math.round(values.reduce((a, b) => a + b, 0) / values.length);

/**
 * Scores every prediction resolved inside the window and stores the run.
 *
 * Ambiguous resolutions are counted and excluded rather than scored: a
 * prediction whose criteria did not settle it says something about how the
 * prediction was written, not about how well it forecast.
 */
export async function runCalibration(
  db: D1Database,
  window: { start?: number; end?: number } = {},
  now = Date.now(),
): Promise<CalibrationResult> {
  const start = window.start ?? 0;
  const end = window.end ?? now;

  const resolved = await db
    .prepare(
      `SELECT id, probability_bps, outcome, resolved_at
         FROM predictions
        WHERE status = 'resolved' AND resolved_at >= ? AND resolved_at <= ?
        ORDER BY resolved_at ASC`,
    )
    .bind(start, end)
    .all<ResolvedPrediction>();

  const rows = resolved.results ?? [];
  const scored = rows.filter((r) => r.outcome === "true" || r.outcome === "false");
  const ambiguous = rows.length - scored.length;

  const contributions = scored.map((r) => ({
    id: r.id,
    probability_bps: r.probability_bps,
    outcome: r.outcome as "true" | "false",
    brier_bps: brierBps(r.probability_bps, r.outcome as "true" | "false"),
  }));

  const buckets: CalibrationBucket[] = [];
  for (let i = 0; i < 10; i++) {
    const inBucket = contributions.filter((c) => bucketIndex(c.probability_bps) === i);
    if (inBucket.length === 0) continue;
    const meanProbability = mean(inBucket.map((c) => c.probability_bps));
    const hitRate = mean(inBucket.map((c) => (c.outcome === "true" ? BPS : 0)));
    buckets.push({
      from_bps: i * BUCKET_WIDTH_BPS,
      to_bps: (i + 1) * BUCKET_WIDTH_BPS,
      n: inBucket.length,
      mean_probability_bps: meanProbability,
      hit_rate_bps: hitRate,
      gap_bps: meanProbability - hitRate,
    });
  }

  const meanProbability = contributions.length ? mean(contributions.map((c) => c.probability_bps)) : null;
  const hitRate = contributions.length ? mean(contributions.map((c) => (c.outcome === "true" ? BPS : 0))) : null;

  const result: CalibrationResult = {
    id: newId("cal"),
    ts: now,
    window_start: start,
    window_end: end,
    predictions_scored: contributions.length,
    ambiguous_excluded: ambiguous,
    brier_score_bps: contributions.length ? mean(contributions.map((c) => c.brier_bps)) : null,
    mean_probability_bps: meanProbability,
    hit_rate_bps: hitRate,
    overconfidence_bps: meanProbability !== null && hitRate !== null ? meanProbability - hitRate : null,
    buckets,
  };

  await db
    .prepare(
      `INSERT INTO calibrations
         (id, ts, window_start, window_end, predictions_scored, ambiguous_excluded,
          brier_score_bps, mean_probability_bps, hit_rate_bps, overconfidence_bps, buckets, detail, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      result.id, result.ts, result.window_start, result.window_end,
      result.predictions_scored, result.ambiguous_excluded,
      result.brier_score_bps, result.mean_probability_bps, result.hit_rate_bps,
      result.overconfidence_bps, JSON.stringify(result.buckets),
      JSON.stringify({ contributions: contributions.slice(0, 200) }), now,
    )
    .run();

  return result;
}
