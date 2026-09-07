/**
 * Phase 16 — Spirit OS, astrology, contribution, ancestors.
 *
 * Canon §43's components, §42.1–42.3's computed sky, §44's contribution
 * practice, and §5.2's reality priority. Decision §1.5 is the law that decides
 * the hard cases: nothing here may function as a cause, a permission or a
 * substitute for doing the thing.
 *
 * Concretely, that means a manifestation closes on what was done and what
 * happened. Signs — dreams, synchronicities, feelings — are recorded, because
 * they matter to the person, and never counted. And anything needing a real
 * ephemeris is reported as deferred rather than estimated into existence.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import {
  ADVISORY_NOTE, CANON_WINDOW_TYPES, DEFERRED_ASTRONOMY, MANUAL_ALMANAC, NO_EPHEMERIS,
  AWAITING_OWNER, OWNER_INPUTS,
  moonPhase, moonPosition,
} from "../spirit/astro";
import { METHOD_PLANETS, STATION_UNCERTAINTY_HOURS } from "../spirit/planets";
import { monthRange, OWNER_TIMEZONE, OWNER_TIMEZONE_LABEL } from "../../../shared/boss/timezone";
import {
  gratitudeFor, MANIFESTATION_SEQUENCE, HARD_DAY_FLOOR, SEQUENCE_MINUTES,
} from "../spirit/practice";
import { buildBodyContract } from "../today/body";
import { TIME_ACCURACY, natalChart, transits, type BirthData, type TimeAccuracy } from "../spirit/natal";
import { almanacCoverage, importAlmanac } from "../spirit/almanac_import";
import {
  ANCESTOR_MINUTES_TARGET, CONTRIBUTION_IDEAL, CONTRIBUTION_MINIMUM,
  dayId, ensureAlmanac, ensureAlmanacAround, monthId, spiritSignal,
} from "../spirit/day";

export const spirit = new Hono<{ Bindings: Env; Variables: Vars }>();

const DAY_MS = 86_400_000;

/**
 * Canon §1.5. A manifestation is closed by action and result. These are the
 * numbers that decision uses, and they are constants rather than opinions
 * spread through the handler.
 */
export const MIN_ACTIONS_TO_CLOSE = 3;
export const MIN_VERIFIABLE_RESULTS_TO_CLOSE = 1;

const EVIDENCE_KINDS = new Set(["action", "result", "sign"]);
/** The two that count. `sign` is deliberately absent. */
export const COUNTING_EVIDENCE = ["action", "result"] as const;

const RITUAL_CADENCES = new Set(["daily", "weekly", "monthly", "lunar", "seasonal"]);
const RITUAL_ANCHORS = new Set(["new_moon", "full_moon", "month_start", "none"]);
const CONTRIBUTION_KINDS = new Set(["money", "time", "help", "teaching", "introduction", "other"]);
const ANCESTOR_KINDS = new Set(["remembrance", "story", "gratitude", "ritual", "research"]);

function requiredText(value: unknown, what: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw badRequest(`${what} is required`);
  return text;
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function positiveInt(value: unknown, what: string): number {
  if (value === undefined || value === null) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) throw badRequest(`${what} is a whole number, zero or more`);
  return n;
}

// ─── The day and the month ────────────────────────────────────────────────────

/** Everything the daily Spirit screen shows, computed and read from real rows. */
spirit.get("/day", async (c) => {
  const requested = c.req.query("date");
  const id = requested ? String(requested) : dayId(Date.now());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(id)) throw badRequest("A day is YYYY-MM-DD in UTC");

  const signal = await spiritSignal(c.env.DB, id);

  /*
   * THE PRACTICE, WHICH IS WHAT THIS SCREEN IS FOR.
   *
   * Everything below existed before this endpoint returned it. The Body contract was computed at the
   * Morning Gate and written to `morning_agenda`, where nothing read it — built, stored, invisible.
   * The gratitude sentence and the manifestation sequence were in her contract and in no code at
   * all. The screen showed the sky and none of the practice, which is the wrong way round: §5.2 puts
   * reality first, and the practice IS the reality here.
   */
  const day = await c.env.DB
    .prepare(`SELECT day_mode FROM days WHERE id = ?`).bind(id)
    .first<{ day_mode: string | null }>();
  const mode = day?.day_mode ?? null;
  const reduced = mode === "recovery" || mode === "mvd";

  const [gratitude, body] = await Promise.all([
    gratitudeFor(c.env, id),
    buildBodyContract(c.env, id, mode),
  ]);

  /*
   * TRANSITS, FILTERED TO THE ONES THAT ACTUALLY TOUCH HER.
   *
   * The natal endpoint returns all ten bodies with their degrees, which is a table to read rather
   * than a thing to know. What matters at 6am is the short list making an aspect to her own chart —
   * usually two or three — and on most days the honest answer is "nothing is close", which this
   * says rather than padding the list to look busy.
   *
   * §5.2 AND §1.5 BOUND THE WORDING. The sky is context, never a cause and never a permission, so
   * these are reported as what is overhead and never as a reason to do or not do anything. No
   * interpretation is generated: an aspect is named, and what it means is hers.
   */
  const birthRow = await c.env.DB
    .prepare(`SELECT value FROM settings WHERE key = 'natal_birth_data'`)
    .first<{ value: string }>();

  let sky: unknown = {
    available: false,
    reason: "No birth data yet, so there is no natal chart for anything to transit.",
  };
  if (birthRow) {
    const birth = JSON.parse(birthRow.value) as BirthData;
    const chart = natalChart(birth);
    const active = transits(chart, Date.now())
      .filter((t) => t.aspect !== null)
      .sort((a, b) => a.from_natal - b.from_natal);
    sky = {
      available: true,
      active,
      // Said plainly, because an empty list is a real answer and a blank space is not.
      quiet: active.length === 0,
      note: ADVISORY_NOTE,
    };
  }

  return ok(c, {
    ...signal,
    sky,
    practice: {
      day_mode: mode,
      gratitude,
      /*
       * §8.4's floor is a DIFFERENT sequence, not a truncated one — her document lists it
       * separately, and its last item is a real-world action precisely because §8.2 forbids
       * manifestation standing in for one. Swapping in a shortened version of the twenty-minute
       * sequence would have dropped that.
       */
      manifestation: {
        steps: reduced ? HARD_DAY_FLOOR : MANIFESTATION_SEQUENCE,
        minutes: reduced ? 9 : SEQUENCE_MINUTES,
        floor: reduced,
        note: reduced
          ? "The hard-day floor. §8.2: this never replaces the real-world action, which is why one is on the list."
          : "Morning only. Twenty minutes.",
      },
      body,
    },
  });
});

/**
 * The month: the almanac for it, the contribution practice, the ancestor hour,
 * and what is open. Rendered from computed and stored data only — this endpoint
 * makes no network call and neither does anything it reads.
 */
spirit.get("/month", async (c) => {
  const month = c.req.query("month") ?? monthId(Date.now());
  if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest(`A month is YYYY-MM in ${OWNER_TIMEZONE_LABEL} time`);

  /*
   * THE MONTH IS HERS, AND IT IS THE ACTUAL MONTH.
   *
   * Two things were wrong in one line. The window ran on UTC, so an event at 8pm Central on the
   * last day of a month appeared in the next one — the almanac showing her a September evening
   * under October. And the end was the start plus a fixed 31 days, so every shorter month swept up
   * the beginning of the next: September carried the 1st of October, February carried three days
   * of March.
   */
  const { start, end } = monthRange(month);
  // Any month, not only the ones inside the rolling horizon.
  await ensureAlmanac(c.env.DB, Date.now());
  await ensureAlmanacAround(c.env.DB, start + 15 * DAY_MS);

  const [events, contributions, ancestors, rituals, manifestations, dreams, birthRow] = await Promise.all([
    c.env.DB
      .prepare(`SELECT * FROM astro_calendar WHERE starts_at >= ? AND starts_at < ? ORDER BY starts_at ASC`)
      .bind(start, end)
      .all<any>(),
    c.env.DB.prepare(`SELECT * FROM contributions WHERE month = ? ORDER BY ts DESC`).bind(month).all<any>(),
    c.env.DB.prepare(`SELECT * FROM ancestor_entries WHERE month = ? ORDER BY ts DESC`).bind(month).all<any>(),
    c.env.DB
      .prepare(
        `SELECT r.*, (SELECT COUNT(*) FROM ritual_runs x WHERE x.ritual_id = r.id AND x.ts >= ? AND x.ts < ?) AS runs_this_month
           FROM rituals r WHERE r.status = 'active' ORDER BY r.cadence, r.name`,
      )
      .bind(start, end)
      .all<any>(),
    c.env.DB.prepare(`SELECT * FROM manifestations WHERE status = 'open' ORDER BY created_at DESC`).all<any>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM dream_entries WHERE ts >= ? AND ts < ?`).bind(start, end).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT value FROM settings WHERE key = 'natal_birth_data'`).first<{ value: string }>(),
  ]);

  const contributionRows = contributions.results ?? [];
  const ancestorMinutes = (ancestors.results ?? []).reduce((sum: number, a: any) => sum + a.minutes, 0);
  const hasBirthData = Boolean(birthRow);

  return ok(c, {
    month,
    advisory: true,
    note: ADVISORY_NOTE,
    almanac: (events.results ?? []).map((e) => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null })),
    contribution: {
      entries: contributionRows,
      count: contributionRows.length,
      minimum: CONTRIBUTION_MINIMUM,
      ideal: CONTRIBUTION_IDEAL,
      met: contributionRows.length >= CONTRIBUTION_MINIMUM,
      given_micros: contributionRows.reduce((sum: number, r: any) => sum + r.amount_micros, 0),
      minutes: contributionRows.reduce((sum: number, r: any) => sum + r.minutes, 0),
      tone:
        contributionRows.length === 0
          ? "Nothing this month yet. One counts, and there is no daily version of this."
          : `${contributionRows.length} this month. The floor is one; four is the good month.`,
    },
    ancestors: {
      entries: ancestors.results ?? [],
      minutes: ancestorMinutes,
      target_minutes: ANCESTOR_MINUTES_TARGET,
      met: ancestorMinutes >= ANCESTOR_MINUTES_TARGET,
      tone: "An hour a month, whenever it suits. Nothing here is late and nothing is scored.",
    },
    rituals: rituals.results ?? [],
    manifestations: manifestations.results ?? [],
    dreams: dreams?.n ?? 0,
    // Canon §42.2's monthly forward view is only as complete as its pasted half,
    // so the month says how complete that is rather than implying it is whole.
    window_types: CANON_WINDOW_TYPES,
    coverage: await almanacCoverage(c.env.DB, Date.now()),
    // Said in the payload rather than assumed by the screen: every instant on this page is rendered
    // on this clock, and a reader comparing it to another chart needs to know which one.
    timezone: OWNER_TIMEZONE,
    timezone_label: OWNER_TIMEZONE_LABEL,
    deferred: DEFERRED_ASTRONOMY,
    /*
     * THE QUESTION DISAPPEARS ONCE IT IS ANSWERED.
     *
     * This was a constant, so the page went on asking for birth data she had already given —
     * "Waiting on you: natal chart" sitting under a chart that existed. An ask that outlives its
     * answer is worse than no ask: it teaches her the screen does not know what it holds.
     */
    owner_inputs: hasBirthData ? [] : OWNER_INPUTS,
  });
});

// ─── Astronomy ────────────────────────────────────────────────────────────────

spirit.get("/astro/almanac", async (c) => {
  const from = Number(c.req.query("from") ?? Date.now());
  const months = Number(c.req.query("months") ?? 24);
  if (!Number.isFinite(from) || !Number.isFinite(months)) throw badRequest("from is an epoch millisecond timestamp and months is a number");

  const built = await ensureAlmanac(c.env.DB, Date.now());
  const rows = await c.env.DB
    .prepare(`SELECT * FROM astro_calendar WHERE starts_at >= ? AND starts_at <= ? ORDER BY starts_at ASC LIMIT 500`)
    .bind(from, from + months * 30.44 * DAY_MS)
    .all<any>();

  return ok(c, {
    events: (rows.results ?? []).map((e) => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null })),
    built: built.built,
    advisory: true,
    note: ADVISORY_NOTE,
    window_types: CANON_WINDOW_TYPES,
    coverage: await almanacCoverage(c.env.DB, Date.now()),
    manual: MANUAL_ALMANAC,
    deferred: DEFERRED_ASTRONOMY,
  });
});

spirit.post("/astro/almanac/rebuild", async (c) => {
  const result = await ensureAlmanac(c.env.DB, Date.now());
  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "astro_calendar", action: "rebuilt", detail: result });
  return ok(c, result);
});

/**
 * The pasted half of the almanac — canon §42.3.
 *
 * The computed half rebuilds itself; this half arrives from a public almanac
 * once every couple of years. Every row records which almanac it came from, and
 * a refresh replaces the range rather than layering a second copy over it.
 */
spirit.post("/astro/almanac/import", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await importAlmanac(c.env.DB, body as Record<string, unknown>, Date.now());
  await audit(c.env.DB, {
    actor: "boss",
    lane: "ops",
    entityType: "astro_calendar",
    action: "imported",
    detail: { imported: result.imported, replaced: result.replaced, source_name: result.source_name },
  });
  return ok(c, result);
});

/** What the forward view holds and what it is still waiting for. */
spirit.get("/astro/almanac/coverage", async (c) => ok(c, await almanacCoverage(c.env.DB, Date.now())));

/** The sky at an instant, computed on the spot. Useful for checking the method. */
spirit.get("/astro/at", async (c) => {
  const ts = Number(c.req.query("ts") ?? Date.now());
  if (!Number.isFinite(ts)) throw badRequest("ts is an epoch millisecond timestamp");
  const phase = moonPhase(ts);
  const position = moonPosition(ts);
  return ok(c, {
    ts,
    phase: phase.phase,
    illumination: phase.illumination,
    age_days: phase.age_days,
    waxing: phase.waxing,
    moon: position,
    advisory: true,
    note: ADVISORY_NOTE,
    method: "Meeus truncated series, computed here. Longitude good to about a third of a degree; near a cusp the next sign is named rather than guessed between.",
  });
});

/**
 * The natal layer. It is not estimated, not approximated from the lunar series,
 * and not filled with plausible dates: it is reported as deferred, with the
 * reason.
 *
 * WHAT CHANGED. This endpoint used to report "DEFERRED — NO EPHEMERIS SOURCE" over three items, and
 * two of them were wrong about themselves: planetary ingresses are computed now, and so are the
 * retrogrades and shadow windows that were filed separately as awaiting a paste. What is left is not
 * an ephemeris gap at all — the same arithmetic produces a natal chart the moment it has a birth
 * date, a birth time and a birth place. That is a question for one person, not a missing dependency,
 * and the response now asks it.
 */
spirit.get("/astro/natal", async (c) => {
  const stored = await c.env.DB
    .prepare(`SELECT value FROM settings WHERE key = 'natal_birth_data'`)
    .first<{ value: string }>();
  const birth = stored ? (JSON.parse(stored.value) as BirthData) : null;

  /*
   * ONCE THE BIRTH DATA EXISTS THE CHART IS JUST COMPUTED. There is no second dependency behind it,
   * which is exactly what "no ephemeris source" obscured for the life of this build.
   */
  if (birth) {
    return ok(c, {
      available: true,
      birth: { ...birth, born_at_iso: new Date(birth.born_at).toISOString() },
      chart: natalChart(birth),
      // The transits the endpoint promised would follow. `at` lets a specific moment be asked for
      // rather than only "now", which is what makes a past or future day inspectable.
      transits: transits(natalChart(birth), Number(c.req.query("at")) || Date.now()),
      advisory: true,
      note: ADVISORY_NOTE,
    });
  }

  return ok(c, {
    available: false,
    status: AWAITING_OWNER,
    // Empty, and that IS the finding: nothing here is blocked on a source any more.
    deferred: DEFERRED_ASTRONOMY,
    owner_inputs: OWNER_INPUTS,
    reason:
      "The planets are computed here, not fetched — the same arithmetic that produces the retrogrades " +
      "and ingresses on this screen produces a natal chart. What it does not have is your birth date, " +
      "your birth time and your birth place, and no computation can supply those.",
    what_would_change_it:
      "Three facts from you. The date and place are easy; the time matters most, because the ascendant " +
      "and houses move a degree every four minutes.",
    holds_birth_data: false,
    now_computed: {
      note:
        "Retrograde periods, pre- and post-retrograde shadow windows, and planetary sign ingresses are " +
        "computed and in the almanac. Nothing on this screen is waiting for a paste.",
      method: METHOD_PLANETS,
      station_uncertainty_hours: STATION_UNCERTAINTY_HOURS,
      coverage: await almanacCoverage(c.env.DB, Date.now()),
    },
  });
});

/**
 * Take the birth data, once.
 *
 * WHAT IT REFUSES AND WHY. An unparseable instant, an unknown accuracy word, or coordinates outside
 * the globe are all rejected rather than coerced — a chart built on a silently corrected input is
 * wrong in a way nobody can see. Coordinates are optional and their absence is reported by the
 * chart itself, because a chart with no houses is a real chart and a chart with guessed houses is
 * not.
 */
spirit.post("/astro/natal", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!b) throw badRequest("Send { born_at, birth_place, time_accuracy }");

  const bornAt = typeof b.born_at === "number" ? b.born_at : Date.parse(String(b.born_at ?? ""));
  if (!Number.isFinite(bornAt)) {
    throw badRequest(
      "born_at must be a birth instant",
      "An ISO timestamp WITH its offset, e.g. 1990-04-17T06:12:00-05:00, or epoch milliseconds. " +
        "The offset matters: an hour of drift moves the ascendant fifteen degrees.",
    );
  }
  const place = String(b.birth_place ?? "").trim();
  if (!place) throw badRequest("birth_place is needed", "The city is enough. It is recorded, not looked up.");

  const accuracy = String(b.time_accuracy ?? "");
  if (!(TIME_ACCURACY as readonly string[]).includes(accuracy)) {
    throw badRequest(
      `time_accuracy is ${TIME_ACCURACY.join(", ")}`,
      "Say which honestly. 'exact' is the only one that produces an ascendant, and claiming it for a " +
        "remembered time produces a confident wrong answer instead of an honest missing one.",
    );
  }

  const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));
  const latitude = num(b.latitude);
  const longitude = num(b.longitude);
  if (latitude !== null && (!Number.isFinite(latitude) || Math.abs(latitude) > 90)) {
    throw badRequest("latitude is degrees north, between -90 and 90");
  }
  if (longitude !== null && (!Number.isFinite(longitude) || Math.abs(longitude) > 180)) {
    throw badRequest("longitude is degrees EAST, between -180 and 180", "West is negative.");
  }

  const birth: BirthData = {
    born_at: Math.round(bornAt), birth_place: place,
    time_accuracy: accuracy as TimeAccuracy, latitude, longitude,
  };

  await c.env.DB
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('natal_birth_data', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(JSON.stringify(birth), Date.now())
    .run();

  // Audited without the data. That she set it, and when, is governance; the birth instant itself is
  // hers and does not need repeating into a log that other things read.
  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "settings", entityId: "natal_birth_data",
    action: "set", detail: { time_accuracy: accuracy, has_coordinates: latitude !== null && longitude !== null },
  });

  return ok(c, { available: true, birth, chart: natalChart(birth), note: ADVISORY_NOTE }, 201);
});

// ─── Manifestations, and the anti-delusion rule ───────────────────────────────

spirit.get("/manifestations", async (c) => {
  const status = c.req.query("status");
  const rows = await c.env.DB
    .prepare(
      `SELECT m.*,
              (SELECT COUNT(*) FROM manifestation_evidence e WHERE e.manifestation_id = m.id AND e.kind = 'action') AS actions,
              (SELECT COUNT(*) FROM manifestation_evidence e WHERE e.manifestation_id = m.id AND e.kind = 'result' AND e.verifiable = 1) AS verifiable_results,
              (SELECT COUNT(*) FROM manifestation_evidence e WHERE e.manifestation_id = m.id AND e.kind = 'sign') AS signs
         FROM manifestations m
        ${status ? "WHERE m.status = ?" : ""}
        ORDER BY m.created_at DESC LIMIT 200`,
    )
    .bind(...(status ? [status] : []))
    .all<any>();

  return ok(c, {
    manifestations: rows.results ?? [],
    rule: {
      actions_required: MIN_ACTIONS_TO_CLOSE,
      verifiable_results_required: MIN_VERIFIABLE_RESULTS_TO_CLOSE,
      signs_count_toward_completion: false,
      note: "Canon §1.5: what closes this is what you did and what happened. Signs are kept because they matter to you, and they never count.",
    },
  });
});

spirit.post("/manifestations", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const title = requiredText(b?.title, "A title");
  const statement = requiredText(b?.statement, "The statement");
  // §1.5: the first concrete action is required at creation. A manifestation
  // with no next action is a wish, and the system will not hold wishes.
  const firstAction = requiredText(
    b?.first_action,
    "The first concrete action",
  );

  const targetAt = b?.target_at === undefined || b?.target_at === null ? null : Number(b.target_at);
  if (targetAt !== null && !Number.isFinite(targetAt)) throw badRequest("target_at is an epoch millisecond timestamp");

  const id = newId("mnf");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO manifestations (id, title, statement, domain, first_action, target_at, status, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,'open',?,?,?)`,
    )
    .bind(id, title, statement, optionalText(b?.domain), firstAction, targetAt, optionalText(b?.notes), now, now)
    .run();

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "manifestation", entityId: id, action: "opened", detail: { title } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM manifestations WHERE id = ?`).bind(id).first(), 201);
});

spirit.get("/manifestations/:id", async (c) => {
  const id = c.req.param("id");
  const manifestation = await c.env.DB.prepare(`SELECT * FROM manifestations WHERE id = ?`).bind(id).first<any>();
  if (!manifestation) throw notFound("No manifestation with that id");

  const evidence = await c.env.DB
    .prepare(`SELECT * FROM manifestation_evidence WHERE manifestation_id = ? ORDER BY ts DESC`)
    .bind(id)
    .all<any>();
  const rows = evidence.results ?? [];

  const actions = rows.filter((e) => e.kind === "action").length;
  const verifiableResults = rows.filter((e) => e.kind === "result" && e.verifiable).length;

  return ok(c, {
    manifestation,
    evidence: rows,
    progress: {
      actions,
      actions_required: MIN_ACTIONS_TO_CLOSE,
      verifiable_results: verifiableResults,
      verifiable_results_required: MIN_VERIFIABLE_RESULTS_TO_CLOSE,
      signs: rows.filter((e) => e.kind === "sign").length,
      signs_counted: 0,
      can_close: actions >= MIN_ACTIONS_TO_CLOSE && verifiableResults >= MIN_VERIFIABLE_RESULTS_TO_CLOSE,
    },
  });
});

spirit.post("/manifestations/:id/evidence", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => null);
  const kind = requiredText(b?.kind, "A kind of evidence");
  if (!EVIDENCE_KINDS.has(kind)) throw badRequest(`"${kind}" is not a kind of evidence`, `One of: ${[...EVIDENCE_KINDS].join(", ")}.`);
  const description = requiredText(b?.description, "A description");

  const manifestation = await c.env.DB
    .prepare(`SELECT id, status FROM manifestations WHERE id = ?`).bind(id)
    .first<{ id: string; status: string }>();
  if (!manifestation) throw notFound("No manifestation with that id");
  if (manifestation.status !== "open") throw conflict(`That manifestation is ${manifestation.status}`);

  // A result that nobody could check is a feeling with a stronger word attached.
  const verifiable = kind === "result" ? (b?.verifiable === false ? 0 : 1) : b?.verifiable ? 1 : 0;
  if (kind === "result" && verifiable === 1 && !optionalText(b?.reference)) {
    throw badRequest(
      "A verifiable result needs a reference",
      "Where can it be checked? A bank line, a signed document, a message, a date and a witness.",
    );
  }

  const evidenceId = newId("mev");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO manifestation_evidence (id, manifestation_id, ts, kind, description, verifiable, reference, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .bind(evidenceId, id, b?.ts === undefined ? now : Number(b.ts), kind, description, verifiable, optionalText(b?.reference), now)
    .run();

  return ok(
    c,
    {
      evidence: await c.env.DB.prepare(`SELECT * FROM manifestation_evidence WHERE id = ?`).bind(evidenceId).first(),
      counts_toward_completion: kind !== "sign",
      note:
        kind === "sign"
          ? "Recorded, and it does not count. Canon §1.5: signs are kept because they matter to you, not because they close anything."
          : null,
    },
    201,
  );
});

/**
 * Closing one. This is the anti-delusion gate: three things done and one
 * checkable thing that happened. The refusal names exactly what is missing, and
 * says plainly that signs will not make up the difference.
 */
spirit.post("/manifestations/:id/manifested", async (c) => {
  const id = c.req.param("id");
  const manifestation = await c.env.DB.prepare(`SELECT * FROM manifestations WHERE id = ?`).bind(id).first<any>();
  if (!manifestation) throw notFound("No manifestation with that id");
  if (manifestation.status !== "open") throw conflict(`That manifestation is already ${manifestation.status}`);

  const counts = await c.env.DB
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'action' THEN 1 ELSE 0 END),0) AS actions,
         COALESCE(SUM(CASE WHEN kind = 'result' AND verifiable = 1 THEN 1 ELSE 0 END),0) AS results,
         COALESCE(SUM(CASE WHEN kind = 'sign' THEN 1 ELSE 0 END),0) AS signs
       FROM manifestation_evidence WHERE manifestation_id = ?`,
    )
    .bind(id)
    .first<{ actions: number; results: number; signs: number }>();

  const actions = counts?.actions ?? 0;
  const results = counts?.results ?? 0;

  if (actions < MIN_ACTIONS_TO_CLOSE || results < MIN_VERIFIABLE_RESULTS_TO_CLOSE) {
    const missing: string[] = [];
    if (actions < MIN_ACTIONS_TO_CLOSE) missing.push(`${MIN_ACTIONS_TO_CLOSE - actions} more action${MIN_ACTIONS_TO_CLOSE - actions === 1 ? "" : "s"} you took`);
    if (results < MIN_VERIFIABLE_RESULTS_TO_CLOSE) missing.push(`${MIN_VERIFIABLE_RESULTS_TO_CLOSE - results} verifiable result${MIN_VERIFIABLE_RESULTS_TO_CLOSE - results === 1 ? "" : "s"}`);
    throw conflict(
      `That is not manifested yet — it needs ${missing.join(" and ")}`,
      counts?.signs
        ? `${counts.signs} sign${counts.signs === 1 ? "" : "s"} are recorded against it and none of them count. Canon §1.5: what closes this is what you did and what happened.`
        : "Canon §1.5: what closes this is what you did and what happened.",
    );
  }

  const now = Date.now();
  await c.env.DB
    .prepare(`UPDATE manifestations SET status = 'manifested', manifested_at = ?, updated_at = ? WHERE id = ? AND status = 'open'`)
    .bind(now, now, id)
    .run();

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "manifestation", entityId: id, action: "manifested",
    detail: { actions, verifiable_results: results, signs_counted: 0 },
  });
  return ok(c, {
    manifestation: await c.env.DB.prepare(`SELECT * FROM manifestations WHERE id = ?`).bind(id).first(),
    closed_on: { actions, verifiable_results: results, signs_counted: 0 },
  });
});

spirit.post("/manifestations/:id/release", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => ({}));
  const reason = requiredText(b?.reason, "A reason");
  const status = b?.abandoned ? "abandoned" : "released";

  const now = Date.now();
  const res = await c.env.DB
    .prepare(`UPDATE manifestations SET status = ?, closed_reason = ?, updated_at = ? WHERE id = ? AND status = 'open'`)
    .bind(status, reason, now, id)
    .run();
  if (!res.meta.changes) throw conflict("That manifestation is not open");

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "manifestation", entityId: id, action: status, detail: { reason } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM manifestations WHERE id = ?`).bind(id).first());
});

// ─── Rituals ──────────────────────────────────────────────────────────────────

spirit.get("/rituals", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM ritual_runs x WHERE x.ritual_id = r.id) AS runs
         FROM rituals r WHERE r.status <> 'retired' ORDER BY r.cadence, r.name`,
    )
    .all<any>();
  return ok(c, (rows.results ?? []).map((r) => ({ ...r, steps: JSON.parse(r.steps ?? "[]") })));
});

spirit.post("/rituals", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const name = requiredText(b?.name, "A name");
  const cadence = optionalText(b?.cadence) ?? "weekly";
  if (!RITUAL_CADENCES.has(cadence)) throw badRequest(`"${cadence}" is not a cadence`, `One of: ${[...RITUAL_CADENCES].join(", ")}.`);
  const anchor = optionalText(b?.anchor) ?? "none";
  if (!RITUAL_ANCHORS.has(anchor)) throw badRequest(`"${anchor}" is not an anchor`, `One of: ${[...RITUAL_ANCHORS].join(", ")}.`);
  if (cadence === "lunar" && anchor !== "new_moon" && anchor !== "full_moon") {
    throw badRequest("A lunar ritual is anchored to the new or full moon", "Otherwise it has no window to be due in.");
  }

  const steps = Array.isArray(b?.steps) ? b.steps.map((s: any) => String(s).trim()).filter(Boolean) : [];
  if (steps.length === 0) throw badRequest("A ritual needs at least one step", "A practice with no steps is an intention.");

  const id = newId("rit");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO rituals (id, name, intent, cadence, anchor, steps, minutes, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,'active',?,?)`,
    )
    .bind(id, name, optionalText(b?.intent), cadence, anchor, JSON.stringify(steps), positiveInt(b?.minutes, "minutes") || null, now, now)
    .run();

  return ok(c, await c.env.DB.prepare(`SELECT * FROM rituals WHERE id = ?`).bind(id).first(), 201);
});

spirit.post("/rituals/:id/done", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => ({}));

  const ritual = await c.env.DB.prepare(`SELECT id, status FROM rituals WHERE id = ?`).bind(id).first<{ id: string; status: string }>();
  if (!ritual) throw notFound("No ritual with that id");
  if (ritual.status !== "active") throw conflict(`That ritual is ${ritual.status}`);

  const now = Date.now();
  const runId = newId("rrn");
  await c.env.DB.batch([
    c.env.DB
      .prepare(`INSERT INTO ritual_runs (id, ritual_id, ts, minutes, note, created_at) VALUES (?,?,?,?,?,?)`)
      .bind(runId, id, now, positiveInt(b?.minutes, "minutes") || null, optionalText(b?.note), now),
    c.env.DB.prepare(`UPDATE rituals SET last_done_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, id),
  ]);

  return ok(c, { run: await c.env.DB.prepare(`SELECT * FROM ritual_runs WHERE id = ?`).bind(runId).first() }, 201);
});

// ─── Dreams ───────────────────────────────────────────────────────────────────

spirit.get("/dreams", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM dream_entries ORDER BY ts DESC LIMIT 100`).all<any>();
  return ok(c, (rows.results ?? []).map((d) => ({ ...d, symbols: d.symbols ? JSON.parse(d.symbols) : [] })));
});

spirit.post("/dreams", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const body = requiredText(b?.body, "The dream");
  const symbols = Array.isArray(b?.symbols) ? b.symbols.map((s: any) => String(s).trim()).filter(Boolean) : [];

  const id = newId("drm");
  const now = Date.now();
  await c.env.DB
    .prepare(`INSERT INTO dream_entries (id, ts, title, body, symbols, mood, memory_id, created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(id, b?.ts === undefined ? now : Number(b.ts), optionalText(b?.title), body, JSON.stringify(symbols), optionalText(b?.mood), optionalText(b?.memory_id), now)
    .run();

  return ok(c, await c.env.DB.prepare(`SELECT * FROM dream_entries WHERE id = ?`).bind(id).first(), 201);
});

// ─── Contribution — canon §44 ─────────────────────────────────────────────────

spirit.get("/contributions", async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT month, COUNT(*) AS n, COALESCE(SUM(amount_micros),0) AS given, COALESCE(SUM(minutes),0) AS minutes
                FROM contributions GROUP BY month ORDER BY month DESC LIMIT 24`)
    .all<{ month: string; n: number; given: number; minutes: number }>();
  const recent = await c.env.DB.prepare(`SELECT * FROM contributions ORDER BY ts DESC LIMIT 50`).all<any>();

  return ok(c, {
    by_month: rows.results ?? [],
    recent: recent.results ?? [],
    minimum: CONTRIBUTION_MINIMUM,
    ideal: CONTRIBUTION_IDEAL,
    // The tone is specified by canon §44, not chosen here.
    note: "One a month is the whole requirement. Four is the good month. There is no daily practice, no streak, and nothing owed for a month that had one.",
  });
});

spirit.post("/contributions", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const kind = requiredText(b?.kind, "A kind of contribution");
  if (!CONTRIBUTION_KINDS.has(kind)) throw badRequest(`"${kind}" is not a kind of contribution`, `One of: ${[...CONTRIBUTION_KINDS].join(", ")}.`);

  const ts = b?.ts === undefined ? Date.now() : Number(b.ts);
  if (!Number.isFinite(ts)) throw badRequest("ts is an epoch millisecond timestamp");

  const id = newId("con");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO contributions (id, ts, month, kind, recipient, amount_micros, minutes, note, anonymous, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, ts, monthId(ts), kind, optionalText(b?.recipient),
      positiveInt(b?.amount_micros, "amount_micros"), positiveInt(b?.minutes, "minutes"),
      optionalText(b?.note), b?.anonymous ? 1 : 0, now,
    )
    .run();

  const count = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM contributions WHERE month = ?`).bind(monthId(ts))
    .first<{ n: number }>();

  return ok(
    c,
    {
      contribution: await c.env.DB.prepare(`SELECT * FROM contributions WHERE id = ?`).bind(id).first(),
      month_count: count?.n ?? 1,
      tone:
        (count?.n ?? 1) >= CONTRIBUTION_IDEAL
          ? "That is the good month."
          : "That is the month's requirement met. Anything further is yours to choose.",
    },
    201,
  );
});

// ─── Ancestors — gentle, monthly, unscored ────────────────────────────────────

spirit.get("/ancestors", async (c) => {
  const month = c.req.query("month") ?? monthId(Date.now());
  const [entries, minutes] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM ancestor_entries ORDER BY ts DESC LIMIT 100`).all<any>(),
    c.env.DB.prepare(`SELECT COALESCE(SUM(minutes),0) AS minutes FROM ancestor_entries WHERE month = ?`).bind(month).first<{ minutes: number }>(),
  ]);

  return ok(c, {
    entries: entries.results ?? [],
    month,
    minutes: minutes?.minutes ?? 0,
    target_minutes: ANCESTOR_MINUTES_TARGET,
    note: "One hour a month, whenever it suits. This is a remembrance, not an obligation, and nothing here counts down.",
  });
});

spirit.post("/ancestors", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const who = requiredText(b?.who, "Who is being remembered");
  const kind = optionalText(b?.kind) ?? "remembrance";
  if (!ANCESTOR_KINDS.has(kind)) throw badRequest(`"${kind}" is not a kind of entry`, `One of: ${[...ANCESTOR_KINDS].join(", ")}.`);

  const ts = b?.ts === undefined ? Date.now() : Number(b.ts);
  if (!Number.isFinite(ts)) throw badRequest("ts is an epoch millisecond timestamp");

  const id = newId("anc");
  const now = Date.now();
  await c.env.DB
    .prepare(`INSERT INTO ancestor_entries (id, ts, month, who, relation, kind, minutes, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(id, ts, monthId(ts), who, optionalText(b?.relation), kind, positiveInt(b?.minutes, "minutes"), optionalText(b?.note), now)
    .run();

  return ok(c, await c.env.DB.prepare(`SELECT * FROM ancestor_entries WHERE id = ?`).bind(id).first(), 201);
});
