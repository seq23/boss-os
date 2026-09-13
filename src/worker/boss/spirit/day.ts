/**
 * The daily Spirit signal — canon §43, §42.1–42.3, §44, and above all §5.2.
 *
 * §5.2 is the rule that shapes this file: reality has priority. The signal is
 * assembled from computed sky, real practice records and real contribution
 * history, and it is handed back with the operational state of the system
 * attached — so a day where something is actually broken says so first, and the
 * sky is what it always was, context.
 *
 * The tone of the contribution and ancestor sections is part of the
 * specification, not decoration. Canon §44 asks for one contribution a month
 * and calls four a good month; it explicitly does not ask for a daily practice,
 * and it does not permit guilt. Nothing here is a streak, a score, or a red
 * number.
 */

import { newId } from "../lib/id";
import { monthIdInZone } from "../../../shared/boss/timezone";
import {
  ADVISORY_NOTE, CANON_WINDOW_TYPES, buildAlmanac, currentLunation, moonPhase, moonPosition,
  type AlmanacEvent, type CurrentLunation,
} from "./astro";

const DAY_MS = 86_400_000;

/** Canon §42.2's five, for telling one of them apart from a ritual anchor. */
const CANON_WINDOW_KEYS = new Set<string>(CANON_WINDOW_TYPES.map((w) => w.key));

/** A stored detail that will not parse is a null detail, never a thrown day. */
function safeParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Canon §44. The floor is one; four is the good month. Neither is a debt. */
export const CONTRIBUTION_MINIMUM = 1;
export const CONTRIBUTION_IDEAL = 4;

/** Canon §43's ancestor practice: an hour a month, gently. */
export const ANCESTOR_MINUTES_TARGET = 60;

/** How far ahead the almanac is kept. Canon asks for twenty-four months. */
export const ALMANAC_MONTHS = 24;

export const dayId = (ts: number): string => new Date(Math.floor(ts / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
/*
 * THE MONTH IS THE OWNER'S MONTH, NOT UTC'S.
 *
 * This read the UTC month, so anything logged after 7pm Central on the last day of a month was
 * filed under the NEXT one — and the contribution floor is "one a month", counted from this
 * column. A record could satisfy a month she had already closed and leave the current one empty.
 */
export const monthId = (ts: number): string => monthIdInZone(ts);

/**
 * Computes and stores an arbitrary stretch of almanac.
 *
 * Idempotent by construction: the arithmetic is deterministic, so recomputing a
 * range produces byte-identical timestamps and the unique index absorbs them.
 */
export async function ensureAlmanacRange(
  db: D1Database,
  fromTs: number,
  months: number,
  now = Date.now(),
): Promise<{ built: number; total: number }> {
  const events: AlmanacEvent[] = buildAlmanac(fromTs, months);
  const createdAt = now;
  const statements = events.map((e) =>
    db
      .prepare(
        `INSERT INTO astro_calendar (id, kind, label, starts_at, ends_at, detail, source, method, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(kind, starts_at) DO NOTHING`,
      )
      .bind(newId("ast"), e.kind, e.label, e.starts_at, e.ends_at, JSON.stringify(e.detail), e.source, e.method, createdAt),
  );

  // Batched in chunks: twenty-four months is a few hundred statements.
  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50));
  }

  const after = await db.prepare(`SELECT COUNT(*) AS n FROM astro_calendar`).first<{ n: number }>();
  return { built: events.length, total: after?.n ?? 0 };
}

/**
 * Keeps the rolling twenty-four-month horizon canon asks for. Computed, not
 * fetched: the same arithmetic on any machine produces the same rows, which is
 * the property that lets the Emergency Offline Library mean anything.
 */
export async function ensureAlmanac(db: D1Database, now = Date.now(), months = ALMANAC_MONTHS): Promise<{ built: number; total: number }> {
  const horizon = now + months * 30.44 * DAY_MS;
  const covered = await db
    .prepare(`SELECT MAX(starts_at) AS latest, COUNT(*) AS n FROM astro_calendar WHERE source = 'computed'`)
    .first<{ latest: number | null; n: number }>();

  /*
   * "FAR ENOUGH AHEAD" IS NOT THE SAME QUESTION AS "EVERYTHING IT SHOULD HOLD".
   *
   * This check used to ask only how far the rows reached. When the planetary layer was added, every
   * production database already had twenty-four months of lunar rows — so the horizon test passed,
   * the rebuild returned `built: 0`, and not one retrograde was ever written. A stage that runs and
   * does nothing, which is exactly the failure this repository names.
   *
   * So the horizon AND the set of kinds both have to hold. A kind that is expected and absent means
   * this build knows how to compute something the table has never been given.
   */
  const kinds = await db
    .prepare(`SELECT DISTINCT kind FROM astro_calendar WHERE source = 'computed'`)
    .all<{ kind: string }>();
  const present = new Set((kinds.results ?? []).map((k) => k.kind));
  const missingKind = EXPECTED_COMPUTED_KINDS.find((k) => !present.has(k));

  if (covered?.latest && covered.latest >= horizon - 45 * DAY_MS && !missingKind) {
    return { built: 0, total: covered.n };
  }
  return ensureAlmanacRange(db, now - DAY_MS, months, now);
}

/**
 * Every kind `buildAlmanac` produces, named so their absence is detectable.
 *
 * ADDING A KIND WITHOUT ADDING IT HERE is the way this breaks again: the rows would be computed for
 * a fresh database and never backfilled into an existing one, and nothing would say so.
 */
export const EXPECTED_COMPUTED_KINDS = [
  "new_moon", "full_moon", "window", "retrograde", "shadow", "ingress",
] as const;

/**
 * Covers a specific moment, whenever it is.
 *
 * A month view of last March has to work, and the sky then is as computable as
 * the sky next week. Rather than keeping decades of rows, the range around a
 * requested date is computed on demand and kept.
 */
export async function ensureAlmanacAround(db: D1Database, ts: number, now = Date.now()): Promise<{ built: number; total: number }> {
  const near = await db
    .prepare(`SELECT COUNT(*) AS n FROM astro_calendar WHERE kind IN ('new_moon','full_moon') AND starts_at >= ? AND starts_at <= ?`)
    .bind(ts - 40 * DAY_MS, ts + 40 * DAY_MS)
    .first<{ n: number }>();
  if ((near?.n ?? 0) >= 2) {
    const total = await db.prepare(`SELECT COUNT(*) AS n FROM astro_calendar`).first<{ n: number }>();
    return { built: 0, total: total?.n ?? 0 };
  }
  return ensureAlmanacRange(db, ts - 40 * DAY_MS, 3, now);
}

export interface AstroDayRow {
  id: string;
  date_ts: number;
  phase: string;
  illumination_bps: number;
  age_days: number;
  waxing: number;
  moon_sign: string;
  moon_degrees: number;
  cusp: number;
  next_sign: string | null;
  windows: string | null;
  method: string;
  computed_at: number;
}

/**
 * Computes and stores one day's sky. Noon UTC is used as the moment, so a day's
 * row describes the middle of the day rather than its first instant.
 */
export async function ensureAstroDay(db: D1Database, id: string, now = Date.now()): Promise<AstroDayRow> {
  const existing = await db.prepare(`SELECT * FROM astro_days WHERE id = ?`).bind(id).first<AstroDayRow>();
  if (existing) return existing;

  const dateTs = Date.parse(`${id}T00:00:00.000Z`);
  if (Number.isNaN(dateTs)) throw new Error(`Not a day: ${id}`);
  const noon = dateTs + DAY_MS / 2;

  const phase = moonPhase(noon);
  const position = moonPosition(noon);

  const windows = await db
    .prepare(
      `SELECT label, starts_at, ends_at, detail FROM astro_calendar
        WHERE kind = 'window' AND starts_at <= ? AND (ends_at IS NULL OR ends_at >= ?)
        ORDER BY starts_at ASC`,
    )
    .bind(dateTs + DAY_MS - 1, dateTs)
    .all<{ label: string; starts_at: number; ends_at: number | null; detail: string }>();

  const row: AstroDayRow = {
    id,
    date_ts: dateTs,
    phase: phase.phase,
    illumination_bps: Math.round(phase.illumination * 10_000),
    age_days: Number(phase.age_days.toFixed(3)),
    waxing: phase.waxing ? 1 : 0,
    moon_sign: position.sign,
    moon_degrees: Number(position.degrees_in_sign.toFixed(3)),
    cusp: position.cusp ? 1 : 0,
    next_sign: position.next_sign,
    windows: JSON.stringify(windows.results ?? []),
    method: "Computed from the Meeus truncated lunar series. No network call.",
    computed_at: now,
  };

  await db
    .prepare(
      `INSERT INTO astro_days
         (id, date_ts, phase, illumination_bps, age_days, waxing, moon_sign, moon_degrees, cusp, next_sign, windows, method, computed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(
      row.id, row.date_ts, row.phase, row.illumination_bps, row.age_days, row.waxing,
      row.moon_sign, row.moon_degrees, row.cusp, row.next_sign, row.windows, row.method, row.computed_at,
    )
    .run();

  const stored = await db.prepare(`SELECT * FROM astro_days WHERE id = ?`).bind(id).first<AstroDayRow>();
  return stored ?? row;
}

export interface RealityPriority {
  warning: boolean;
  text: string;
  counts: Record<string, number>;
  rule: string;
}

/**
 * Canon §5.2. The operational state of the system, read plainly, and stated
 * before anything about the sky. When something is actually wrong, the spirit
 * screen says so — a system that offers a lunar window while three tasks are
 * dead in the queue has its priorities inverted.
 */
export async function realityPriority(db: D1Database, now = Date.now()): Promise<RealityPriority> {
  const [deadLetters, failedTasks, incidents, expiring, overdueFollowUps, killSwitch] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n FROM dead_letters WHERE status = 'open'`).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE status = 'failed'`).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM trading_incidents WHERE resolved_at IS NULL AND severity IN ('high','critical')`).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?`).bind(now + DAY_MS).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM follow_ups WHERE status = 'open' AND due_at < ?`).bind(now).first<{ n: number }>(),
    db.prepare(`SELECT kill_switch FROM trading_authority LIMIT 1`).first<{ kill_switch: number }>(),
  ]);

  const counts = {
    dead_letters: deadLetters?.n ?? 0,
    failed_tasks: failedTasks?.n ?? 0,
    open_high_incidents: incidents?.n ?? 0,
    approvals_expiring: expiring?.n ?? 0,
    overdue_follow_ups: overdueFollowUps?.n ?? 0,
    kill_switch: killSwitch?.kill_switch ? 1 : 0,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return {
    warning: total > 0,
    text:
      total === 0
        ? "Nothing operational is waiting. The sky is context either way."
        : `Reality first: ${total} thing${total === 1 ? "" : "s"} need attention before anything here — ` +
          Object.entries(counts)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`)
            .join(", ") + ".",
    counts,
    rule: "Canon §5.2: reality has priority. Nothing on this screen is a reason to act or not act.",
  };
}

export interface SpiritSignal {
  advisory: true;
  note: string;
  /** The nearest new moon, full moon or eclipse inside 48 hours. Null means there is not one. */
  major_event: {
    kind: string;
    label: string;
    at: number;
    hours_away: number;
    detail: unknown;
  } | null;
  /**
   * THE CYCLE SHE IS CURRENTLY INSIDE, which `major_event` is not and was never meant to be.
   *
   * Her instruction of 13 Sep 2026: "evn tho its sept 13 i should still be able to see the new moon
   * in virgo section for 2 weeks until the next major lunation". `major_event` answers "is something
   * about to happen" and correctly goes null once it has; this answers "what opened the cycle I am
   * in", which has no null — there is always one, and the boundary is the next major lunation rather
   * than a fixed fortnight.
   *
   * NEVER NULL, DELIBERATELY. It is computed from the same Meeus series as the almanac rather than
   * read from `astro_calendar`, because a lapse in that table's coverage would empty this section —
   * and an empty "what cycle am I in" is indistinguishable from the bug it exists to fix.
   */
  current_lunation: CurrentLunation;
  astro: {
    day: string;
    phase: string;
    illumination_bps: number;
    moon_sign: string;
    degrees_in_sign: number;
    cusp: boolean;
    next_sign: string | null;
    waxing: boolean;
    windows: unknown[];
    /** Which of canon §42.2's five windows holds today, or null before one is built. */
    canon_window: string | null;
    method: string;
  };
  rituals_due: { id: string; name: string; cadence: string; last_done_at: number | null; why: string }[];
  contribution: {
    month: string;
    count: number;
    minimum: number;
    ideal: number;
    met: boolean;
    tone: string;
    /**
     * WHAT SHE ACTUALLY RECORDED, not only how many.
     *
     * The day view carried a COUNT(*) and nothing else, so the Spirit panel could show "4 this
     * month" and could not show what any of the four were. That is how four accidental rows
     * survived on screen looking exactly like four months' worth of practice. A count is a number;
     * this is the record.
     */
    entries: { id: string; ts: number; kind: string; note: string | null; recipient: string | null }[];
  };
  ancestors: {
    month: string; minutes: number; target_minutes: number; met: boolean; tone: string;
    /** Outstanding, in the sense of not yet done. Never in the sense of late — §44 forbids that. */
    standing: boolean;
    remaining_minutes: number;
    /** How it clears, stated on the reminder itself. Null once it has. */
    dismissal: string | null;
  };
  manifestations: { open: number; without_evidence_this_month: number };
  reality_priority: RealityPriority;
}

/** Whether a ritual is due today, and the reason in words the screen can print. */
function ritualDue(
  ritual: { id: string; name: string; cadence: string; anchor: string | null; last_done_at: number | null },
  now: number,
  dayStart: number,
  inNewMoonWindow: boolean,
  inFullMoonWindow: boolean,
): { due: boolean; why: string } {
  const last = ritual.last_done_at;
  switch (ritual.cadence) {
    case "daily":
      return { due: !last || last < dayStart, why: last ? "Not yet today." : "Never run." };
    case "weekly":
      return { due: !last || now - last >= 7 * DAY_MS, why: last ? "A week since the last one." : "Never run." };
    case "monthly":
      return { due: !last || monthId(last) !== monthId(now), why: last ? "Not yet this month." : "Never run." };
    case "lunar": {
      const window = ritual.anchor === "full_moon" ? inFullMoonWindow : inNewMoonWindow;
      const doneInWindow = last !== null && now - last < 4 * DAY_MS;
      return {
        due: window && !doneInWindow,
        why: window ? `Inside the ${ritual.anchor === "full_moon" ? "full" : "new"} moon window.` : "Outside its window.",
      };
    }
    default:
      return { due: false, why: "Seasonal — not tracked daily." };
  }
}

/**
 * The whole daily signal, assembled from computed sky and real records. This is
 * what both `GET /api/spirit/day` and the Today screen's Spirit Signal block
 * read, so the two can never disagree.
 */
export async function spiritSignal(db: D1Database, id: string, now = Date.now()): Promise<SpiritSignal> {
  await ensureAlmanac(db, now);
  // A day outside the rolling horizon — last spring, next decade — still has a
  // sky, and it is as computable as any other.
  const requested = Date.parse(`${id}T12:00:00.000Z`);
  if (Number.isFinite(requested)) await ensureAlmanacAround(db, requested, now);
  const astro = await ensureAstroDay(db, id, now);
  const dayStart = astro.date_ts;
  const month = monthId(dayStart);

  const [rituals, contributions, ancestors, openManifestations, evidenceThisMonth, reality] = await Promise.all([
    db.prepare(`SELECT id, name, cadence, anchor, last_done_at FROM rituals WHERE status = 'active'`)
      .all<{ id: string; name: string; cadence: string; anchor: string | null; last_done_at: number | null }>(),
    db
      .prepare(`SELECT id, ts, kind, note, recipient FROM contributions WHERE month = ? ORDER BY ts DESC`)
      .bind(month)
      .all<{ id: string; ts: number; kind: string; note: string | null; recipient: string | null }>(),
    db.prepare(`SELECT COALESCE(SUM(minutes),0) AS minutes FROM ancestor_entries WHERE month = ?`).bind(month).first<{ minutes: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM manifestations WHERE status = 'open'`).first<{ n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM manifestations m
          WHERE m.status = 'open'
            AND NOT EXISTS (
              SELECT 1 FROM manifestation_evidence e
               WHERE e.manifestation_id = m.id AND e.kind IN ('action','result') AND e.ts >= ?
            )`,
      )
      .bind(Date.parse(`${month}-01T00:00:00.000Z`))
      .first<{ n: number }>(),
    realityPriority(db, now),
  ]);

  const windows = (JSON.parse(astro.windows ?? "[]") as { label: string; detail?: string }[]).map((w) => ({
    ...w,
    detail: typeof w.detail === "string" ? safeParse(w.detail) : (w.detail ?? null),
  })) as { label: string; detail: { window_type?: string } | null }[];

  const windowType = (key: string) => windows.some((w) => w.detail?.window_type === key);
  const inNewMoon = windowType("new_moon_anchor");
  const inFullMoon = windowType("full_moon_anchor");

  // Canon §42.2's five windows partition the lunation, so exactly one of them
  // holds any given day. The day names it rather than making the screen infer it
  // from a list of labels.
  const canonWindow =
    windows.find((w) => CANON_WINDOW_KEYS.has(String(w.detail?.window_type ?? "")))?.detail?.window_type ?? null;

  const due = (rituals.results ?? [])
    .map((r) => ({ r, verdict: ritualDue(r, now, dayStart, inNewMoon, inFullMoon) }))
    .filter(({ verdict }) => verdict.due)
    .map(({ r, verdict }) => ({ id: r.id, name: r.name, cadence: r.cadence, last_done_at: r.last_done_at, why: verdict.why }));

  const contributionRows = contributions.results ?? [];
  const contributionCount = contributionRows.length;
  const ancestorMinutes = ancestors?.minutes ?? 0;

  /*
   * ─── THE THING SHE ASKED FOR IN CAPITALS ──────────────────────────────────
   *
   *   "if i log in and push the spirit tab on 9/9 and there is a HUGE ASTROLOGICAL EVENT ON 9/10
   *    THE NEW MOON IN VIRGO AT 11:27PM EDT --- IT SHOULD BE FUCKING PROMINENT"
   *
   * She is right, and it was never a data problem: `buildAlmanac` has been computing new moons and
   * full moons to the minute, with the sign, for as long as it has existed. Every one of them was
   * flattened into a `windows` array the screen rendered as "1 window open" underneath three
   * sentences of disclaimer. The event was in the payload and nowhere in the reading.
   *
   * A DEFINED HORIZON RATHER THAN "SOON". Forty-eight hours: long enough that tomorrow night's new
   * moon is on today's screen, short enough that the top of the tab is not permanently occupied.
   * Outside it, `major_event` is null and the screen says so in words — "no major event in the next
   * two days" is a real answer and must not look like a failed fetch.
   *
   * MAJOR IS A CLOSED LIST, not a score. New moons, full moons and eclipses; a routine daily aspect
   * is not an event, and letting one in would put something at display size every single day, which
   * is the same as putting nothing there.
   */
  const MAJOR_KINDS = new Set(["new_moon", "full_moon", "eclipse"]);
  const HORIZON_MS = 48 * 60 * 60 * 1000;
  const upcoming = await db
    .prepare(
      `SELECT kind, label, starts_at, detail FROM astro_calendar
        WHERE starts_at >= ? AND starts_at <= ?
        ORDER BY starts_at LIMIT 20`,
    )
    .bind(now - 6 * 60 * 60 * 1000, now + HORIZON_MS)
    .all<{ kind: string; label: string; starts_at: number; detail: string | null }>()
    .catch(() => ({ results: [] as any[] }));
  const majorRow = (upcoming.results ?? []).find((e) => MAJOR_KINDS.has(e.kind)) ?? null;
  const majorEvent = majorRow
    ? {
        kind: majorRow.kind,
        label: majorRow.label,
        at: majorRow.starts_at,
        hours_away: Math.round((majorRow.starts_at - now) / 3_600_000),
        detail: safeParse(majorRow.detail ?? "null"),
      }
    : null;

  return {
    advisory: true,
    note: ADVISORY_NOTE,
    /*
     * THE EVENT, AT THE TOP OF THE PAYLOAD, so the screen cannot bury it without doing so
     * deliberately. `null` means "nothing major within two days" and is rendered as that sentence.
     */
    major_event: majorEvent,
    /*
     * COMPUTED, NOT QUERIED. One call, no row, no network — see `currentLunation` for why the
     * almanac table is the wrong source for this particular question.
     */
    current_lunation: currentLunation(now),
    astro: {
      day: astro.id,
      phase: astro.phase,
      illumination_bps: astro.illumination_bps,
      moon_sign: astro.moon_sign,
      degrees_in_sign: astro.moon_degrees,
      cusp: Boolean(astro.cusp),
      next_sign: astro.next_sign,
      waxing: Boolean(astro.waxing),
      windows,
      canon_window: canonWindow,
      method: astro.method,
    },
    rituals_due: due,
    contribution: {
      month,
      count: contributionCount,
      minimum: CONTRIBUTION_MINIMUM,
      ideal: CONTRIBUTION_IDEAL,
      met: contributionCount >= CONTRIBUTION_MINIMUM,
      entries: contributionRows,
      // Canon §44 is explicit that this is not a daily practice and not a debt.
      tone:
        contributionCount === 0
          ? "Nothing recorded this month yet. One is the whole requirement, and there is no daily version of this. Nothing is owed."
          : contributionCount >= CONTRIBUTION_IDEAL
            ? `${contributionCount} this month. That is the good month canon describes.`
            : `${contributionCount} this month — the floor is cleared. More is welcome and none of it is expected.`,
    },
    ancestors: {
      month,
      minutes: ancestorMinutes,
      target_minutes: ANCESTOR_MINUTES_TARGET,
      met: ancestorMinutes >= ANCESTOR_MINUTES_TARGET,
      /*
       * A STANDING REMINDER, AND THE ONLY WAY IT CLEARS IS BY BEING DONE.
       *
       * The owner asked for exactly this: it stays until she can say she completed it and name the
       * day and time. There is deliberately no dismiss — a reminder with a dismiss button is a
       * reminder you get rid of instead of doing, and it would have been the easiest thing to build
       * and the least use to her. It goes when the hour is recorded, and not before.
       *
       * Canon §44's tone still holds. `standing` is not "overdue": there is no schedule here and
       * nothing is late. It is a thing outstanding, said plainly, once.
       */
      standing: ancestorMinutes < ANCESTOR_MINUTES_TARGET,
      remaining_minutes: Math.max(0, ANCESTOR_MINUTES_TARGET - ancestorMinutes),
      dismissal:
        ancestorMinutes >= ANCESTOR_MINUTES_TARGET
          ? null
          : "This clears when you record the hour with the day and time you did it. There is no other way to clear it, on purpose.",
      tone:
        ancestorMinutes === 0
          ? "An hour a month, whenever it suits. There is no schedule and nothing is late."
          : ancestorMinutes >= ANCESTOR_MINUTES_TARGET
            ? `${ancestorMinutes} minutes this month. That is the hour.`
            : `${ancestorMinutes} minutes so far. The rest can happen whenever it happens.`,
    },
    manifestations: {
      open: openManifestations?.n ?? 0,
      without_evidence_this_month: evidenceThisMonth?.n ?? 0,
    },
    reality_priority: reality,
  };
}
