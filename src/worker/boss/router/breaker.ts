import { getSetting, setSetting } from "../lib/settings";

/**
 * BOUNDED RETRIES AND A CIRCUIT BREAKER, per addendum §3.1: "Provider outage,
 * withdrawal, cost-limit breach, or policy change triggers bounded retries and a
 * circuit breaker."
 *
 * WHY THE STATE IS IN `settings` AND NOT IN A MODULE VARIABLE. A Worker isolate
 * is discarded and recreated constantly, so an in-memory breaker forgets that a
 * provider is down between two requests a second apart — which is the same as
 * having no breaker at all under exactly the load that needs one. This adds no
 * table (this stage may not add a migration) and no second authority: it is one
 * settings row, readable, and it decides only whether to SKIP a backend, never
 * whether work is permitted.
 *
 * WHAT TRIPS IT
 *   - consecutive provider failures reaching THRESHOLD (outage or withdrawal);
 *   - a cost-limit breach, immediately — one call over the ceiling should not be
 *     retried into a dozen;
 *   - a policy change, immediately — a backend switched to `disabled` stops
 *     being tried at once rather than after three more failures.
 *
 * HALF-OPEN, NOT AUTO-HEALING. After the cooldown one trial call is allowed; if
 * it fails the breaker re-opens immediately, because the failure count is kept.
 * Nothing here declares a provider healthy on a timer alone.
 */

export const BREAKER_KEY = "router_breaker";
export const BREAKER_THRESHOLD = 3;
export const BREAKER_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Attempts per backend inside ONE routing run, retryable errors only.
 *
 * The retry is immediate rather than backed off: a Worker request has a wall
 * clock and a sleep spends it doing nothing. The cooldown, not a delay loop, is
 * where waiting belongs.
 */
export const MAX_ATTEMPTS_PER_BACKEND = 2;

interface BreakerRecord {
  failures: number;
  openedAt: number | null;
  reason: string | null;
  lastFailureAt: number | null;
}

type BreakerMap = Record<string, BreakerRecord>;

async function load(db: D1Database): Promise<BreakerMap> {
  const raw = await getSetting(db, BREAKER_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as BreakerMap) : {};
  } catch {
    // An unreadable breaker record is treated as "no record", never as "open" —
    // a corrupted string must not silently take every backend out of service.
    return {};
  }
}

async function save(db: D1Database, map: BreakerMap): Promise<void> {
  await setSetting(db, BREAKER_KEY, JSON.stringify(map));
}

export interface BreakerState {
  open: boolean;
  halfOpen: boolean;
  failures: number;
  reason: string | null;
  opensAgainAt: number | null;
}

export function stateOf(record: BreakerRecord | undefined, now: number): BreakerState {
  if (!record || record.openedAt === null) {
    return { open: false, halfOpen: false, failures: record?.failures ?? 0, reason: record?.reason ?? null, opensAgainAt: null };
  }
  const until = record.openedAt + BREAKER_COOLDOWN_MS;
  if (now >= until) {
    return { open: false, halfOpen: true, failures: record.failures, reason: record.reason, opensAgainAt: until };
  }
  return { open: true, halfOpen: false, failures: record.failures, reason: record.reason, opensAgainAt: until };
}

export async function breakerStates(db: D1Database, now = Date.now()): Promise<Record<string, BreakerState>> {
  const map = await load(db);
  const out: Record<string, BreakerState> = {};
  for (const [id, rec] of Object.entries(map)) out[id] = stateOf(rec, now);
  return out;
}

export async function breakerState(db: D1Database, backendId: string, now = Date.now()): Promise<BreakerState> {
  const map = await load(db);
  return stateOf(map[backendId], now);
}

/** One more failure. Opens the breaker at the threshold, or re-opens a half-open one. */
export async function recordFailure(
  db: D1Database,
  backendId: string,
  reason: string,
  now = Date.now(),
): Promise<BreakerState> {
  const map = await load(db);
  const prev = map[backendId] ?? { failures: 0, openedAt: null, reason: null, lastFailureAt: null };
  const failures = prev.failures + 1;
  const openedAt = failures >= BREAKER_THRESHOLD ? now : null;
  map[backendId] = { failures, openedAt, reason: reason.slice(0, 300), lastFailureAt: now };
  await save(db, map);
  return stateOf(map[backendId], now);
}

/** A cost-limit breach or a policy change. Opens at once, no threshold. */
export async function trip(
  db: D1Database,
  backendId: string,
  reason: string,
  now = Date.now(),
): Promise<BreakerState> {
  const map = await load(db);
  const prev = map[backendId] ?? { failures: 0, openedAt: null, reason: null, lastFailureAt: null };
  map[backendId] = {
    failures: Math.max(prev.failures, BREAKER_THRESHOLD),
    openedAt: now,
    reason: reason.slice(0, 300),
    lastFailureAt: now,
  };
  await save(db, map);
  return stateOf(map[backendId], now);
}

/** A call succeeded. The record is cleared rather than decremented. */
export async function recordSuccess(db: D1Database, backendId: string): Promise<void> {
  const map = await load(db);
  if (!map[backendId]) return;
  delete map[backendId];
  await save(db, map);
}

/** Owner action: close a breaker deliberately, without waiting for the cooldown. */
export async function resetBreaker(db: D1Database, backendId: string): Promise<void> {
  await recordSuccess(db, backendId);
}
