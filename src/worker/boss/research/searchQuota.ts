import { freeDailyCap } from "../backends/guard";

/**
 * A FREE SEARCH SERVICE'S DAILY ALLOWANCE, CLAIMED BEFORE THE CALL (owner, 5 Nov 2026: Brave Search
 * "capped at 20 searches a day"). The cap is read from `FREE_ROUTES` (backends/guard.ts), never from
 * a row or a request. One atomic upsert takes a slot only while `used` is under the cap, so two
 * researches at once cannot both take the twentieth. The day is Central, her day.
 */
export function centralDay(now: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

export async function claimFreeSearch(
  db: D1Database,
  service: string,
  now: number = Date.now(),
): Promise<{ ok: true; used: number; cap: number } | { ok: false; used: number; cap: number }> {
  const cap = freeDailyCap(service);
  const day = centralDay(now);
  if (cap <= 0) return { ok: false, used: 0, cap: 0 };
  const res = await db
    .prepare(
      `INSERT INTO free_search_quota_days (service, day, used, updated_at) VALUES (?1, ?2, 1, ?3)
       ON CONFLICT (service, day) DO UPDATE SET used = used + 1, updated_at = ?3 WHERE used < ?4`,
    )
    .bind(service, day, now, cap)
    .run();
  const row = await db
    .prepare(`SELECT used FROM free_search_quota_days WHERE service = ?1 AND day = ?2`)
    .bind(service, day)
    .first<{ used: number }>();
  const used = row?.used ?? 0;
  return (res.meta?.changes ?? 0) > 0 ? { ok: true, used, cap } : { ok: false, used, cap };
}
