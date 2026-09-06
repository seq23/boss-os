/**
 * Canon §40 — relationship scoring.
 *
 * Five dimensions. Three of them are judgements only the Boss can make —
 * strategic importance, trust, opportunity value — and the system stores them
 * rather than guessing them. Two are derived: recency, from the last contact
 * against the agreed cadence, and relationship health, from all four plus what
 * is actually outstanding.
 *
 * The derivation is written down. `score_detail` keeps the inputs, the weights,
 * every penalty and the arithmetic, so a health score that looks wrong can be
 * argued with instead of merely distrusted.
 */

const DAY_MS = 86_400_000;

export const SCORE_DIMENSIONS = [
  "strategic_importance",
  "trust_level",
  "recency_score",
  "opportunity_value",
  "relationship_health",
] as const;

/** Weights sum to 1. Trust and recency lead: a warm tie you never speak to decays. */
export const HEALTH_WEIGHTS = {
  trust_level: 0.35,
  recency_score: 0.3,
  strategic_importance: 0.2,
  opportunity_value: 0.15,
} as const;

export const PENALTIES = {
  /** Per follow-up the Boss owes and is late on, capped. */
  overdue_follow_up: 8,
  overdue_follow_up_cap: 24,
  /** Per commitment that was dropped rather than kept, capped. */
  dropped_commitment: 5,
  dropped_commitment_cap: 15,
  /** Never contacted at all: a relationship on paper is not a relationship. */
  never_contacted: 10,
} as const;

export interface RelationshipRow {
  id: string;
  person_id: string;
  lane: string;
  kind: string;
  strategic_importance: number;
  trust_level: number;
  recency_score: number;
  opportunity_value: number;
  relationship_health: number;
  cadence_days: number;
  last_contact_at: number | null;
  next_touch_due_at: number | null;
  scored_at: number | null;
  score_detail: string | null;
  notes: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

export function clampScore(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Recency, canon §40's third dimension.
 *
 * Full marks inside the cadence you agreed to. Straight-line decay after it,
 * reaching zero at three times the cadence. Never contacted is 0 — not a
 * default, a fact.
 */
export function recencyScore(lastContactAt: number | null, cadenceDays: number, now: number): number {
  if (lastContactAt === null) return 0;
  const cadence = Math.max(1, cadenceDays) * DAY_MS;
  const elapsed = Math.max(0, now - lastContactAt);
  if (elapsed <= cadence) return 100;
  if (elapsed >= cadence * 3) return 0;
  return clampScore(100 * (1 - (elapsed - cadence) / (cadence * 2)));
}

export interface HealthInput {
  strategic_importance: number;
  trust_level: number;
  recency_score: number;
  opportunity_value: number;
  overdue_follow_ups: number;
  dropped_commitments: number;
  ever_contacted: boolean;
}

export interface HealthResult {
  health: number;
  detail: {
    inputs: HealthInput;
    weights: typeof HEALTH_WEIGHTS;
    weighted: number;
    penalties: { reason: string; points: number }[];
    penalty_total: number;
  };
}

/** Canon §40's fifth dimension. Everything that goes into it is named. */
export function healthScore(input: HealthInput): HealthResult {
  const weighted =
    input.trust_level * HEALTH_WEIGHTS.trust_level +
    input.recency_score * HEALTH_WEIGHTS.recency_score +
    input.strategic_importance * HEALTH_WEIGHTS.strategic_importance +
    input.opportunity_value * HEALTH_WEIGHTS.opportunity_value;

  const penalties: { reason: string; points: number }[] = [];

  if (input.overdue_follow_ups > 0) {
    const points = Math.min(
      input.overdue_follow_ups * PENALTIES.overdue_follow_up,
      PENALTIES.overdue_follow_up_cap,
    );
    penalties.push({
      reason: `${input.overdue_follow_ups} follow-up${input.overdue_follow_ups === 1 ? "" : "s"} you owe and are late on`,
      points,
    });
  }
  if (input.dropped_commitments > 0) {
    const points = Math.min(
      input.dropped_commitments * PENALTIES.dropped_commitment,
      PENALTIES.dropped_commitment_cap,
    );
    penalties.push({
      reason: `${input.dropped_commitments} commitment${input.dropped_commitments === 1 ? "" : "s"} dropped rather than kept`,
      points,
    });
  }
  if (!input.ever_contacted) {
    penalties.push({ reason: "No contact has ever been recorded", points: PENALTIES.never_contacted });
  }

  const penaltyTotal = penalties.reduce((sum, p) => sum + p.points, 0);

  return {
    health: clampScore(weighted - penaltyTotal),
    detail: { inputs: input, weights: HEALTH_WEIGHTS, weighted: Math.round(weighted), penalties, penalty_total: penaltyTotal },
  };
}

/**
 * Re-derives recency and health for one relationship and writes them down with
 * the trace. Called whenever anything that feeds a score changes: a judgement
 * the Boss revises, a meeting captured, a follow-up kept or dropped.
 */
export async function rescoreRelationship(
  db: D1Database,
  relationshipId: string,
  now = Date.now(),
): Promise<RelationshipRow | null> {
  const rel = await db
    .prepare(`SELECT * FROM relationships WHERE id = ?`)
    .bind(relationshipId)
    .first<RelationshipRow>();
  if (!rel) return null;

  const [overdue, dropped] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM follow_ups
          WHERE relationship_id = ? AND owner = 'boss' AND status = 'open' AND due_at < ?`,
      )
      .bind(rel.id, now)
      .first<{ n: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM follow_ups WHERE relationship_id = ? AND owner = 'boss' AND status = 'dropped'`)
      .bind(rel.id)
      .first<{ n: number }>(),
  ]);

  const recency = recencyScore(rel.last_contact_at, rel.cadence_days, now);
  const { health, detail } = healthScore({
    strategic_importance: rel.strategic_importance,
    trust_level: rel.trust_level,
    recency_score: recency,
    opportunity_value: rel.opportunity_value,
    overdue_follow_ups: overdue?.n ?? 0,
    dropped_commitments: dropped?.n ?? 0,
    ever_contacted: rel.last_contact_at !== null,
  });

  const nextTouch =
    rel.last_contact_at === null ? null : rel.last_contact_at + Math.max(1, rel.cadence_days) * DAY_MS;

  await db
    .prepare(
      `UPDATE relationships
          SET recency_score = ?, relationship_health = ?, next_touch_due_at = ?,
              scored_at = ?, score_detail = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(recency, health, nextTouch, now, JSON.stringify({ ...detail, scored_at: now }), now, rel.id)
    .run();

  return {
    ...rel,
    recency_score: recency,
    relationship_health: health,
    next_touch_due_at: nextTouch,
    scored_at: now,
    score_detail: JSON.stringify({ ...detail, scored_at: now }),
    updated_at: now,
  };
}
