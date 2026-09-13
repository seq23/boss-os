/**
 * The manual almanac — canon §42.3, build plan §1.5 D4.
 *
 * Retrograde periods and shadow windows are not computed. They cannot be
 * derived from the lunar series, they need planetary positions this build has no
 * ephemeris for, and no vendor is acceptable for the reasons the build plan
 * settles at length. So the build plan makes the manual calendar the *primary*
 * implementation: a table entered once from a public almanac and refreshable the
 * same way.
 *
 * This module is that path. It does three things and refuses to do a fourth:
 *
 * 1. It takes pasted rows, validates them hard, and stores them with
 *    `source = 'imported'` and the almanac they came from recorded on every row,
 *    so a computed row and an entered row are never confused for one another.
 * 2. It re-imports without duplicating, because a calendar that has to be
 *    hand-deduplicated is a calendar that stops being refreshed.
 * 3. It reports honestly how much of the twenty-four-month horizon is actually
 *    covered, and says the horizon is empty when it is empty.
 *
 * It never invents a date. There is no default retrograde table in this file and
 * no seed migration that ships one: a plausible-looking calendar of dates nobody
 * checked would be indistinguishable from a real one, which is the exact failure
 * canon §1.5 exists to prevent.
 */

import { AWAITING_ALMANAC, MANUAL_ALMANAC, MANUAL_ALMANAC_KINDS, type ManualAlmanacKind } from "./astro";
import { batchReads } from "../lib/batchReads";
import { newId } from "../lib/id";
import { badRequest } from "../lib/http";

const DAY_MS = 86_400_000;

/** The longest a single retrograde or shadow period may plausibly run. */
export const MAX_PERIOD_DAYS = 200;

/** Canon asks for a twenty-four-month forward view. */
export const HORIZON_MONTHS = 24;

const SHADOW_PHASES = new Set(["pre", "post"]);

export interface ImportedEvent {
  kind: ManualAlmanacKind;
  label: string;
  starts_at: number;
  ends_at: number;
  /** For a shadow: which retrograde it belongs to, and which side of it. */
  retrograde_label?: string;
  phase?: "pre" | "post";
  body?: string | null;
}

export interface ImportResult {
  imported: number;
  replaced: number;
  source_name: string;
  coverage: AlmanacCoverage;
}

function integerTimestamp(value: unknown, what: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw badRequest(`${what} is an epoch millisecond timestamp`, "Whole milliseconds since 1970, UTC.");
  }
  return n;
}

/**
 * Validates one pasted row.
 *
 * Every refusal here is a mistake a person actually makes while copying a
 * calendar: a period that ends before it starts, a shadow with no retrograde
 * attached to it, a year typed where a timestamp belongs. Each one is caught at
 * the door rather than stored and puzzled over later.
 */
export function validateEvent(raw: unknown, index: number): ImportedEvent {
  const where = `event ${index + 1}`;
  if (!raw || typeof raw !== "object") throw badRequest(`${where} is not an object`);
  const input = raw as Record<string, unknown>;

  const kind = String(input.kind ?? "").trim() as ManualAlmanacKind;
  if (!(MANUAL_ALMANAC_KINDS as readonly string[]).includes(kind)) {
    throw badRequest(
      `${where}: kind is ${MANUAL_ALMANAC_KINDS.join(" or ")}`,
      "New and full moons are computed here and are not imported; importing them would put two sources behind one row.",
    );
  }

  const label = String(input.label ?? "").trim();
  if (!label) throw badRequest(`${where}: label is required`, "Name the planet and the period, as the almanac prints it.");

  const startsAt = integerTimestamp(input.starts_at, `${where}: starts_at`);
  const endsAt = integerTimestamp(input.ends_at, `${where}: ends_at`);
  if (endsAt <= startsAt) {
    throw badRequest(`${where}: ends_at is after starts_at`, "A retrograde and a shadow are both periods, never instants.");
  }
  if (endsAt - startsAt > MAX_PERIOD_DAYS * DAY_MS) {
    throw badRequest(
      `${where}: that period runs longer than ${MAX_PERIOD_DAYS} days`,
      "Check the year on both ends — a mistyped year is what this usually is.",
    );
  }

  const event: ImportedEvent = {
    kind,
    label,
    starts_at: startsAt,
    ends_at: endsAt,
    body: input.body === undefined || input.body === null ? null : String(input.body).trim() || null,
  };

  if (kind === "shadow") {
    const retrogradeLabel = String(input.retrograde_label ?? "").trim();
    if (!retrogradeLabel) {
      throw badRequest(
        `${where}: a shadow window names the retrograde it belongs to`,
        "A shadow period with no retrograde attached to it is not a shadow period.",
      );
    }
    const phase = String(input.phase ?? "").trim();
    if (!SHADOW_PHASES.has(phase)) throw badRequest(`${where}: phase is 'pre' or 'post'`);
    event.retrograde_label = retrogradeLabel;
    event.phase = phase as "pre" | "post";
  }

  return event;
}

/**
 * Stores a pasted calendar.
 *
 * `replace` is the refresh path: it clears the imported rows this paste covers
 * before writing, so re-pasting a corrected calendar leaves the corrected one
 * behind rather than both. Without it, the unique index makes the import
 * idempotent — the same paste twice stores the same rows once, updated in place.
 *
 * Computed rows are never touched by either path. The delete is scoped to
 * `source = 'imported'` and to the imported kinds, so a refresh cannot take the
 * lunar almanac with it.
 */
export async function importAlmanac(
  db: D1Database,
  input: { source_name?: unknown; replace?: unknown; events?: unknown },
  now = Date.now(),
): Promise<ImportResult> {
  const sourceName = String(input.source_name ?? "").trim();
  if (!sourceName) {
    throw badRequest(
      "source_name is required",
      "Name the almanac this came from. A table nobody can trace back to a source is a table nobody can check.",
    );
  }

  const rawEvents = input.events;
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
    throw badRequest("events is a non-empty array", "Paste the retrograde and shadow periods from the almanac.");
  }

  const events = rawEvents.map(validateEvent);

  // Two rows for the same kind at the same instant are a copy/paste artefact,
  // and the unique index would silently keep one. Say so instead.
  const seen = new Set<string>();
  for (const event of events) {
    const key = `${event.kind}:${event.starts_at}`;
    if (seen.has(key)) throw badRequest(`Two ${event.kind} rows start at the same instant: ${event.label}`);
    seen.add(key);
  }

  const method = `Manual almanac entry (canon §42.3), from: ${sourceName}`;
  let replaced = 0;

  if (input.replace === true) {
    const from = Math.min(...events.map((e) => e.starts_at));
    const to = Math.max(...events.map((e) => e.ends_at));
    const existing = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM astro_calendar
          WHERE source = 'imported' AND kind IN ('retrograde','shadow') AND starts_at >= ? AND starts_at <= ?`,
      )
      .bind(from, to)
      .first<{ n: number }>();
    replaced = existing?.n ?? 0;
    await db
      .prepare(
        `DELETE FROM astro_calendar
          WHERE source = 'imported' AND kind IN ('retrograde','shadow') AND starts_at >= ? AND starts_at <= ?`,
      )
      .bind(from, to)
      .run();
  }

  const statements = events.map((event) =>
    db
      .prepare(
        `INSERT INTO astro_calendar (id, kind, label, starts_at, ends_at, detail, source, method, created_at)
         VALUES (?,?,?,?,?,?,'imported',?,?)
         ON CONFLICT(kind, starts_at) DO UPDATE SET
           label = excluded.label,
           ends_at = excluded.ends_at,
           detail = excluded.detail,
           source = excluded.source,
           method = excluded.method`,
      )
      .bind(
        newId("ast"),
        event.kind,
        event.label,
        event.starts_at,
        event.ends_at,
        JSON.stringify({
          entered_from: sourceName,
          retrograde_label: event.retrograde_label ?? null,
          phase: event.phase ?? null,
          body: event.body ?? null,
          note: "Entered by hand from a published almanac. Not computed here, and not fetched.",
        }),
        method,
        now,
      ),
  );

  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50));
  }

  return { imported: events.length, replaced, source_name: sourceName, coverage: await almanacCoverage(db, now) };
}

export interface ManualKindCoverage {
  key: string;
  kind: ManualAlmanacKind;
  label: string;
  status: string;
  how: string;
  /** Everything that exists for this kind, from either source. */
  rows: number;
  /** Produced by `planets.ts`. */
  computed_rows: number;
  /** Typed in by a person, which is a different claim and stays separately countable. */
  imported_rows: number;
  earliest: number | null;
  latest: number | null;
  /** Months of the forward horizon this kind actually reaches. */
  months_covered: number;
  covers_horizon: boolean;
  entered_from: string[];
}

export interface AlmanacCoverage {
  horizon_months: number;
  horizon_ends_at: number;
  complete: boolean;
  manual: ManualKindCoverage[];
  note: string;
}

/**
 * What the almanac actually holds, per imported kind.
 *
 * `covers_horizon` is the only claim that matters and it is deliberately strict:
 * a handful of rows for next month does not cover twenty-four months, and a
 * screen that says it does would be lying about the one thing canon §42.2 asks
 * this table for.
 */
export async function almanacCoverage(db: D1Database, now = Date.now(), months = HORIZON_MONTHS): Promise<AlmanacCoverage> {
  const horizonEndsAt = now + months * 30.44 * DAY_MS;
  const manual: ManualKindCoverage[] = [];

  // Three reads per manual kind, all in one batch rather than serial awaits — each statement is
  // CPU on this runtime, and this ran on every Spirit month view. See lib/batchReads.ts.
  const reads = batchReads(db);
  const recorded = MANUAL_ALMANAC.map((entry) => ({
    entry,
    stats: reads.first<{ n: number; earliest: number | null; latest: number | null }>(true, () => db
      .prepare(
        `SELECT COUNT(*) AS n, MIN(starts_at) AS earliest, MAX(COALESCE(ends_at, starts_at)) AS latest
           FROM astro_calendar WHERE kind = ? AND source = 'imported'`,
      )
      .bind(entry.kind)),
    sources: reads.all<{ method: string }>(true, () => db
      .prepare(`SELECT DISTINCT method FROM astro_calendar WHERE kind = ? AND source = 'imported'`)
      .bind(entry.kind)),
    /*
     * COMPUTED ROWS COUNT AS COVERAGE NOW, and before the planetary layer existed there were none to
     * count — this query asked only for `source = 'imported'`, so the answer was always zero and the
     * screen always said AWAITING. Both sources are counted for coverage; the imported tally is kept
     * separate so a person can still see what they entered themselves.
     */
    computed: reads.first<{ n: number; latest: number | null }>(true, () => db
      .prepare(
        `SELECT COUNT(*) AS n, MAX(COALESCE(ends_at, starts_at)) AS latest
           FROM astro_calendar WHERE kind = ? AND source = 'computed'`,
      )
      .bind(entry.kind)),
  }));
  await reads.flush();

  for (const r of recorded) {
    const entry = r.entry;
    const [stats, sources, computed] = await Promise.all([r.stats, r.sources, r.computed]);

    const imported = stats?.n ?? 0;
    const rows = imported + (computed?.n ?? 0);
    const latest = rows > 0
      ? Math.max(stats?.latest ?? 0, computed?.latest ?? 0) || null
      : null;
    const monthsCovered = latest && latest > now ? Math.floor((latest - now) / (30.44 * DAY_MS)) : 0;

    manual.push({
      key: entry.key,
      kind: entry.kind,
      label: entry.label,
      status: (computed?.n ?? 0) > 0
        ? `${computed!.n} computed${imported ? `, ${imported} entered by hand` : ""}`
        : imported > 0 ? `${imported} entered` : AWAITING_ALMANAC,
      how: entry.how,
      rows,
      // KEPT APART, because "how much exists" and "how much a person typed" are different questions
      // and one screen asks each. Totalling them was what made the import test read 15 instead of 1.
      computed_rows: computed?.n ?? 0,
      imported_rows: imported,
      earliest: imported > 0 ? stats?.earliest ?? null : null,
      latest,
      months_covered: monthsCovered,
      covers_horizon: rows > 0 && !!latest && latest >= horizonEndsAt,
      entered_from: (sources.results ?? []).map((s) => s.method),
    });
  }

  const complete = manual.every((m) => m.covers_horizon);
  return {
    horizon_months: months,
    horizon_ends_at: Math.round(horizonEndsAt),
    complete,
    manual,
    note: complete
      ? "New and full moons and the §42.2 windows are computed; retrogrades and shadow periods are entered and cover the horizon."
      : "New and full moons and the §42.2 windows are computed. Retrogrades and shadow periods are entered by hand and this horizon is not fully covered — the forward view is incomplete until it is, and nothing here fills the gap with invented dates.",
  };
}
