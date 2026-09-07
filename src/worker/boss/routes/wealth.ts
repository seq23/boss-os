/**
 * Phase 14 — Wealth Command Center.
 *
 * Canon §42. Entities hold vehicles, vehicles carry a value with the date it
 * was marked, tracks say what the book is *for*, and allocations move capital
 * between them with the decision that authorised it attached.
 *
 * The lane boundary is load-bearing here. Wealth reads trading capital through
 * the Trading Allocation Bridge, read-only, and refuses to represent it as
 * something Wealth can hold or deploy. Every refusal uses the same words.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { LANE_BREACH_REFUSAL, readTradingCapital } from "../investor/bridge";
import { assertProtectedAction } from "../governance/gate";
import { buildLedger, isMonth, monthKey, lineDefinitions, LINE_KEYS } from "../today/returns";

export const wealth = new Hono<{ Bindings: Env; Variables: Vars }>();

const BPS = 10_000;

const ENTITY_KINDS = new Set(["person", "llc", "corp", "trust", "fund", "foundation", "other"]);
const VEHICLE_KINDS = new Set([
  "brokerage", "cash", "spv", "fund", "operating_company", "real_estate", "private_credit", "crypto", "other",
]);
const LIQUIDITY = new Set(["liquid", "semi_liquid", "illiquid"]);
const ALLOCATION_KINDS = new Set(["committed", "deployed", "reserved", "returned", "written_off"]);

/** Allocation kinds that add to a track, against the two that take away. */
const NEGATIVE_KINDS = new Set(["returned", "written_off"]);

/**
 * Fields that would only be sent by something trying to put trading capital
 * inside Wealth. Named explicitly, so the refusal is specific rather than a
 * generic validation error.
 */
const LANE_TELLS = ["trading_account_id", "trading_position_id", "from_trading", "trading_capital_micros"];

function refuseLaneBreach(body: any): void {
  for (const key of LANE_TELLS) {
    if (body?.[key] !== undefined) throw conflict(LANE_BREACH_REFUSAL.message, LANE_BREACH_REFUSAL.hint);
  }
  if (body?.lane !== undefined && String(body.lane) === "trading") {
    throw conflict(LANE_BREACH_REFUSAL.message, LANE_BREACH_REFUSAL.hint);
  }
}

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

function micros(value: unknown, what: string): number {
  if (value === undefined || value === null) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw badRequest(`${what} is an integer number of USD micros`);
  return n;
}

// ─── Entities ─────────────────────────────────────────────────────────────────

/**
 * The buyer candidates the sourcing sweep found, and the list she reviews.
 *
 * IT IS ALSO WHAT MAKES THE DAILY HUNT AFFORDABLE. `sky-snapshot.mjs` reads this before each run and
 * writes the names into the run's workspace as KNOWN.json, so the sweep looks for what is NEW rather
 * than re-finding the same institutions — which was both why a daily run cost $2 and why the list
 * repeated itself.
 *
 * `status` filters: new (awaiting her), reviewed, contacted, rejected, promoted.
 */
wealth.get("/sourcing", async (c) => {
  const status = c.req.query("status");
  const rows = status
    ? await c.env.DB.prepare(
        `SELECT * FROM sourcing_candidates WHERE status = ? ORDER BY COALESCE(ticket_floor_usd,0) DESC, created_at DESC LIMIT 200`,
      ).bind(status).all()
    : await c.env.DB.prepare(
        `SELECT * FROM sourcing_candidates ORDER BY COALESCE(ticket_floor_usd,0) DESC, created_at DESC LIMIT 200`,
      ).all();

  const candidates = rows.results ?? [];
  const fresh = candidates.filter((x: any) => x.status === "new").length;
  return ok(c, { candidates, total: candidates.length, awaiting_review: fresh });
});

/** Her verdict on one candidate. Nothing else in the system may move a row out of `new`. */
wealth.post("/sourcing/:id/status", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const status = b?.status ? String(b.status) : "";
  const allowed = ["new", "reviewed", "contacted", "rejected", "promoted"];
  if (!allowed.includes(status)) throw badRequest(`"${status}" is not a candidate status`, `One of: ${allowed.join(", ")}.`);

  const res = await c.env.DB
    .prepare(`UPDATE sourcing_candidates SET status = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`)
    .bind(status, b?.notes ? String(b.notes) : null, Date.now(), c.req.param("id"))
    .run();
  if (!res.meta.changes) throw notFound("No candidate with that id");
  return ok(c, { id: c.req.param("id"), status });
});

// ─── The return-on-effort ledger ──────────────────────────────────────────────

/**
 * Effort against outcome, per income line, for one month.
 *
 * WHY IT IS AN ENDPOINT AND NOT A TODAY BLOCK. Canon §15 fixes Today at thirteen elements and the
 * build plan adds no fourteenth; that rule has already survived the Wednesday packet, which went
 * inside Meetings rather than beside it. This is also the wrong kind of number for a morning
 * screen: it changes monthly, it is read to decide where a season goes rather than what to do at
 * 7am, and a daily glance at a monthly ratio is a habit rather than a decision. It sits on Capital,
 * beside the pipeline it is about — the same reasoning that put model spend in Settings.
 *
 * `lifetime` carries the rows whose source cannot bucket by month. They are returned separately and
 * never summed with the month: "542 emails, 4 replies" is a lifetime fact, and adding it to
 * September's would double-count every send.
 */
wealth.get("/returns", async (c) => {
  const requested = c.req.query("period") ?? monthKey(Date.now());
  if (!isMonth(requested)) throw badRequest(`"${requested}" is not a month`, "Use YYYY-MM.");

  const ledger = await buildLedger(c.env.DB, requested);

  const lifetime = await c.env.DB
    .prepare(
      `SELECT line, source, effort_label, effort_count, outcome_label, outcome_count,
              unmeasured_why, window_days, note, measured_at
         FROM line_returns WHERE period = 'all' ORDER BY line ASC`,
    )
    .all();

  /* Which months have contributed data at all, so the client offers real choices rather than a
   * date picker that mostly returns empty months. */
  const months = await c.env.DB
    .prepare(`SELECT DISTINCT period FROM line_returns WHERE period <> 'all' ORDER BY period DESC LIMIT 24`)
    .all<{ period: string }>();

  return ok(c, {
    ...ledger,
    lifetime: lifetime.results ?? [],
    months_with_contributions: (months.results ?? []).map((m) => m.period),
    lines_defined: lineDefinitions(),
  });
});

/**
 * The contributed half arrives here, from `scripts/ops/line-returns.mjs` running on her Mac.
 *
 * IT IS AN UPSERT, NOT AN APPEND. These are measurements OF a period rather than events IN one, so
 * running the job twice on the same day must not double the month. The unique index on
 * (line, period, source) is what makes that true in the database rather than in the caller.
 *
 * A LINE KEY THAT IS NOT IN `projects.ts` IS REFUSED. An income line that appears because something
 * POSTed it is exactly the fourth-active-project-with-no-decision-behind-it that projects.ts exists
 * to prevent, and a ledger that grows lines by itself is a ledger she stops trusting.
 */
wealth.post("/returns", async (c) => {
  const body = await c.req.json<any>().catch(() => null);
  const rows = Array.isArray(body?.measurements) ? body.measurements : null;
  if (!rows) throw badRequest("measurements[] is required");
  if (rows.length === 0) throw badRequest("Nothing to record", "An empty contribution is a failed read, not a measurement.");
  if (rows.length > 200) throw badRequest("Too many measurements in one contribution");

  const now = Date.now();
  const written: string[] = [];

  for (const row of rows) {
    const line = requiredText(row?.line, "line");
    if (!LINE_KEYS.has(line)) {
      throw badRequest(
        `"${line}" is not an income line`,
        `The lines are declared in projects.ts: ${[...LINE_KEYS].join(", ")}.`,
      );
    }
    const period = requiredText(row?.period, "period");
    if (period !== "all" && !isMonth(period)) throw badRequest(`"${period}" is not a period`, "YYYY-MM, or 'all'.");

    const effortCount = Number(row?.effort_count);
    if (!Number.isInteger(effortCount) || effortCount < 0) throw badRequest("effort_count is a whole number of acts");

    /*
     * NULL AND ZERO ARE DIFFERENT AND THE WIRE FORMAT HAS TO KEEP THEM DIFFERENT. `undefined` and
     * `null` both mean unmeasured; anything else must parse as a whole number. A silent Number(null)
     * would turn every unmeasured line into a zero, which is the one failure this feature cannot
     * have — so it is checked here rather than coerced.
     */
    const rawOutcome = row?.outcome_count;
    let outcomeCount: number | null = null;
    if (rawOutcome !== null && rawOutcome !== undefined) {
      outcomeCount = Number(rawOutcome);
      if (!Number.isInteger(outcomeCount) || outcomeCount < 0) throw badRequest("outcome_count is a whole number, or null for unmeasured");
    }

    const unmeasuredWhy = optionalText(row?.unmeasured_why);
    if (outcomeCount === null && !unmeasuredWhy) {
      throw badRequest(
        "An unmeasured outcome needs a reason",
        "outcome_count: null says the system cannot see the result. Without unmeasured_why that blank is indistinguishable from a dead line.",
      );
    }

    await c.env.DB
      .prepare(
        `INSERT INTO line_returns
           (id, line, period, source, effort_label, effort_count, outcome_label, outcome_count,
            unmeasured_why, window_days, note, measured_at, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(line, period, source) DO UPDATE SET
           effort_label = excluded.effort_label,
           effort_count = excluded.effort_count,
           outcome_label = excluded.outcome_label,
           outcome_count = excluded.outcome_count,
           unmeasured_why = excluded.unmeasured_why,
           window_days = excluded.window_days,
           note = excluded.note,
           measured_at = excluded.measured_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        newId("lr"), line, period, requiredText(row?.source, "source"),
        requiredText(row?.effort_label, "effort_label"), effortCount,
        requiredText(row?.outcome_label, "outcome_label"), outcomeCount,
        unmeasuredWhy,
        row?.window_days === undefined || row?.window_days === null ? null : Number(row.window_days),
        optionalText(row?.note), now, now, now,
      )
      .run();
    written.push(`${line}/${period}/${row.source}`);
  }

  await audit(c.env.DB, {
    actor: "line-returns-contributor", lane: "ops", entityType: "line_returns",
    action: "contribute", detail: { measurements: written.length },
  });

  return ok(c, { recorded: written.length, slots: written });
});

// ─── LP × buyer cross-matches ─────────────────────────────────────────────────

/**
 * Firms that appear on both the LP tracker and the buyer candidate list.
 *
 * CONFIRMED AND NEAR ARE RETURNED IN SEPARATE ARRAYS, not one list with a flag, because a flag in a
 * list gets skimmed past. A near-miss she treats as a match costs her the first thirty seconds of a
 * call with a stranger she believes she knows, and there is no recovering that.
 */
wealth.get("/crossmatches", async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT * FROM counterparty_crossmatches ORDER BY confidence ASC, created_at DESC LIMIT 200`)
    .all<any>();
  const all = rows.results ?? [];
  return ok(c, {
    confirmed: all.filter((r) => r.confidence === "confirmed"),
    near: all.filter((r) => r.confidence === "near"),
    total: all.length,
    awaiting_review: all.filter((r) => r.status === "new").length,
  });
});

/** LP individuals must never reach the cloud. An '@' in a firm field is the tell that one has. */
const LOOKS_LIKE_A_PERSON = (row: any) =>
  ["lp_firm", "candidate_name", "matched_core", "why", "lp_status_note"].some((k) => String(row?.[k] ?? "").includes("@"));

/**
 * The matcher runs on her Mac — the LP sheet is unreadable from here — and posts its verdicts.
 *
 * THE '@' GUARD IS NOT THEORETICAL. The relationship sync carries the same one and it caught a real
 * leak on its first run, when a collision suffix was built from the first characters of a real
 * address. An email address in a firm column means the contributor has sent a person, and the
 * correct response is to refuse the whole batch rather than store the good rows and hope.
 */
wealth.post("/crossmatches", async (c) => {
  const body = await c.req.json<any>().catch(() => null);
  const rows = Array.isArray(body?.matches) ? body.matches : null;
  if (!rows) throw badRequest("matches[] is required");
  if (rows.length > 200) throw badRequest("Too many matches in one batch");

  for (const row of rows) {
    if (LOOKS_LIKE_A_PERSON(row)) {
      throw conflict(
        "That batch contains an email address in a firm field",
        "Cross-match rows carry firms and aggregate counts only. LP individuals stay in the local file.",
      );
    }
  }

  const now = Date.now();
  const runId = optionalText(body?.run_id);
  let written = 0;

  for (const row of rows) {
    const confidence = String(row?.confidence ?? "");
    if (confidence !== "confirmed" && confidence !== "near") {
      throw badRequest(`"${confidence}" is not a confidence`, "confirmed or near. There is no third tier and there must not be one.");
    }
    const lpList = String(row?.lp_list ?? "");
    if (lpList !== "sequence" && lpList !== "suppressed") {
      throw badRequest(`"${lpList}" is not an LP list`, "sequence (being emailed) or suppressed (do not contact).");
    }

    await c.env.DB
      .prepare(
        `INSERT INTO counterparty_crossmatches
           (id, candidate_id, candidate_name, lp_firm, matched_core, confidence, method, lp_list,
            lp_contacts, lp_type, lp_drip_stage, lp_signal_tier, lp_first_sent, lp_last_sent,
            lp_status_note, why, status, run_id, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?,?,?)
         ON CONFLICT(candidate_id, lp_firm) DO UPDATE SET
           candidate_name = excluded.candidate_name,
           matched_core = excluded.matched_core,
           confidence = excluded.confidence,
           method = excluded.method,
           lp_list = excluded.lp_list,
           lp_contacts = excluded.lp_contacts,
           lp_type = excluded.lp_type,
           lp_drip_stage = excluded.lp_drip_stage,
           lp_signal_tier = excluded.lp_signal_tier,
           lp_first_sent = excluded.lp_first_sent,
           lp_last_sent = excluded.lp_last_sent,
           lp_status_note = excluded.lp_status_note,
           why = excluded.why,
           run_id = excluded.run_id,
           updated_at = excluded.updated_at`,
      )
      .bind(
        newId("xm"),
        requiredText(row?.candidate_id, "candidate_id"),
        requiredText(row?.candidate_name, "candidate_name"),
        requiredText(row?.lp_firm, "lp_firm"),
        requiredText(row?.matched_core, "matched_core"),
        confidence,
        requiredText(row?.method, "method"),
        lpList,
        Number(row?.lp_contacts ?? 0) || 0,
        optionalText(row?.lp_type), optionalText(row?.lp_drip_stage), optionalText(row?.lp_signal_tier),
        optionalText(row?.lp_first_sent), optionalText(row?.lp_last_sent), optionalText(row?.lp_status_note),
        requiredText(row?.why, "why"),
        runId, now, now,
      )
      .run();
    written++;
  }

  await audit(c.env.DB, {
    actor: "crossmatch-contributor", lane: "ops", entityType: "counterparty_crossmatches",
    action: "contribute", detail: { matches: written, run_id: runId },
  });

  return ok(c, { recorded: written });
});

/** Her verdict on one overlap. Nothing else in the system moves a row out of 'new'. */
wealth.post("/crossmatches/:id/status", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const status = b?.status ? String(b.status) : "";
  const allowed = ["new", "reviewed", "acted", "rejected"];
  if (!allowed.includes(status)) throw badRequest(`"${status}" is not a cross-match status`, `One of: ${allowed.join(", ")}.`);

  const res = await c.env.DB
    .prepare(`UPDATE counterparty_crossmatches SET status = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`)
    .bind(status, b?.notes ? String(b.notes) : null, Date.now(), c.req.param("id"))
    .run();
  if (!res.meta.changes) throw notFound("No cross-match with that id");
  return ok(c, { id: c.req.param("id"), status });
});

wealth.get("/entities", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT e.*,
              (SELECT COUNT(*) FROM portfolio_vehicles v WHERE v.entity_id = e.id AND v.status = 'active') AS vehicles,
              (SELECT COALESCE(SUM(v.value_micros),0) FROM portfolio_vehicles v WHERE v.entity_id = e.id AND v.status = 'active') AS value_micros
         FROM entities e
        WHERE e.status <> 'dissolved'
        ORDER BY e.name ASC LIMIT 200`,
    )
    .all();
  return ok(c, rows.results ?? []);
});

wealth.post("/entities", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  refuseLaneBreach(b);
  const name = requiredText(b?.name, "An entity name");
  const kind = optionalText(b?.kind) ?? "other";
  if (!ENTITY_KINDS.has(kind)) throw badRequest(`"${kind}" is not a kind of entity`, `One of: ${[...ENTITY_KINDS].join(", ")}.`);

  const clash = await c.env.DB.prepare(`SELECT id FROM entities WHERE name = ?`).bind(name).first<{ id: string }>();
  if (clash) throw conflict(`${name} is already on file`, `It is ${clash.id}.`);

  const id = newId("ent");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO entities (id, lane, name, kind, jurisdiction, role, notes, status, created_at, updated_at)
       VALUES (?,'ops',?,?,?,?,?,'active',?,?)`,
    )
    .bind(id, name, kind, optionalText(b?.jurisdiction), optionalText(b?.role), optionalText(b?.notes), now, now)
    .run();

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "entity", entityId: id, action: "created", detail: { name, kind } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM entities WHERE id = ?`).bind(id).first(), 201);
});

// ─── Portfolio vehicles ───────────────────────────────────────────────────────

wealth.get("/vehicles", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT v.*, e.name AS entity_name FROM portfolio_vehicles v
         JOIN entities e ON e.id = v.entity_id
        WHERE v.status <> 'written_off'
        ORDER BY v.value_micros DESC LIMIT 200`,
    )
    .all();
  return ok(c, rows.results ?? []);
});

wealth.post("/vehicles", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  refuseLaneBreach(b);

  const kind = requiredText(b?.kind, "A vehicle kind");
  if (kind === "trading" || kind === "trading_account") {
    throw conflict(LANE_BREACH_REFUSAL.message, LANE_BREACH_REFUSAL.hint);
  }
  if (!VEHICLE_KINDS.has(kind)) throw badRequest(`"${kind}" is not a kind of vehicle`, `One of: ${[...VEHICLE_KINDS].join(", ")}.`);

  const name = requiredText(b?.name, "A vehicle name");
  const entityId = requiredText(b?.entity_id, "An entity id");
  const entity = await c.env.DB.prepare(`SELECT id FROM entities WHERE id = ?`).bind(entityId).first();
  if (!entity) throw badRequest("No entity with that id", "Create it first at POST /api/wealth/entities.");

  const liquidity = optionalText(b?.liquidity) ?? "illiquid";
  if (!LIQUIDITY.has(liquidity)) throw badRequest(`"${liquidity}" is not a liquidity class`, `One of: ${[...LIQUIDITY].join(", ")}.`);

  const value = micros(b?.value_micros, "value_micros");
  // A mark with no date is a rumour. If a value is given, so is its date.
  const valuedAt = b?.valued_at === undefined || b?.valued_at === null ? (value ? Date.now() : null) : Number(b.valued_at);
  if (valuedAt !== null && !Number.isFinite(valuedAt)) throw badRequest("valued_at is an epoch millisecond timestamp");

  const id = newId("veh");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO portfolio_vehicles
         (id, entity_id, name, kind, custodian, value_micros, valued_at, liquidity, notes, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,'active',?,?)`,
    )
    .bind(id, entityId, name, kind, optionalText(b?.custodian), value, valuedAt, liquidity, optionalText(b?.notes), now, now)
    .run();

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "portfolio_vehicle", entityId: id, action: "created", detail: { name, kind } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM portfolio_vehicles WHERE id = ?`).bind(id).first(), 201);
});

wealth.patch("/vehicles/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => null);
  if (!b) throw badRequest("Send the fields to change");
  refuseLaneBreach(b);

  const vehicle = await c.env.DB.prepare(`SELECT id FROM portfolio_vehicles WHERE id = ?`).bind(id).first();
  if (!vehicle) throw notFound("No vehicle with that id");

  const updates: Record<string, string | number | null> = {};
  if (b.value_micros !== undefined) {
    updates.value_micros = micros(b.value_micros, "value_micros");
    updates.valued_at = b.valued_at === undefined ? Date.now() : Number(b.valued_at);
  }
  if (b.name !== undefined) updates.name = requiredText(b.name, "A vehicle name");
  if (b.custodian !== undefined) updates.custodian = optionalText(b.custodian);
  if (b.notes !== undefined) updates.notes = optionalText(b.notes);
  if (b.status !== undefined) {
    const status = String(b.status);
    if (!["active", "exited", "written_off"].includes(status)) throw badRequest(`"${status}" is not a vehicle status`);
    updates.status = status;
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) throw badRequest("Nothing in that body changes anything");
  await c.env.DB
    .prepare(`UPDATE portfolio_vehicles SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map((k) => updates[k]), Date.now(), id)
    .run();
  return ok(c, await c.env.DB.prepare(`SELECT * FROM portfolio_vehicles WHERE id = ?`).bind(id).first());
});

// ─── Wealth tracks ────────────────────────────────────────────────────────────

wealth.get("/tracks", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM wealth_tracks ORDER BY target_allocation_bps DESC, name ASC`).all();
  const tracks = rows.results ?? [];
  return ok(c, {
    tracks,
    // Canon §42 fixes the track names; no authority document in this build
    // contains them, so they are not invented here.
    note: tracks.length
      ? null
      : "No tracks are defined. Canon §42's track names are not reproduced in any authority document available to this build, so none were seeded.",
  });
});

wealth.post("/tracks", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  refuseLaneBreach(b);
  const name = requiredText(b?.name, "A track name");
  const target = b?.target_allocation_bps === undefined ? 0 : Number(b.target_allocation_bps);
  if (!Number.isFinite(target) || target < 0 || target > BPS) throw badRequest(`target_allocation_bps is between 0 and ${BPS}`);

  const clash = await c.env.DB.prepare(`SELECT id FROM wealth_tracks WHERE name = ?`).bind(name).first<{ id: string }>();
  if (clash) throw conflict(`${name} already exists`, `It is ${clash.id}.`);

  // The book cannot be more than the book.
  const existing = await c.env.DB
    .prepare(`SELECT COALESCE(SUM(target_allocation_bps),0) AS total FROM wealth_tracks WHERE status = 'active'`)
    .first<{ total: number }>();
  if ((existing?.total ?? 0) + Math.round(target) > BPS) {
    throw conflict(
      `Targets would total ${(((existing?.total ?? 0) + target) / 100).toFixed(1)}% of the book`,
      "Allocation targets are a division of one book. Lower another track first.",
    );
  }

  const id = newId("trk");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO wealth_tracks (id, name, thesis, target_allocation_bps, horizon, status, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,'active',?,?,?)`,
    )
    .bind(id, name, optionalText(b?.thesis), Math.round(target), optionalText(b?.horizon), optionalText(b?.notes), now, now)
    .run();

  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "wealth_track", entityId: id, action: "created", detail: { name, target_allocation_bps: Math.round(target) } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM wealth_tracks WHERE id = ?`).bind(id).first(), 201);
});

// ─── Capital allocations ──────────────────────────────────────────────────────

wealth.get("/allocations", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT a.*, t.name AS track_name, v.name AS vehicle_name, d.title AS decision_title
         FROM capital_allocations a
         JOIN wealth_tracks t ON t.id = a.track_id
    LEFT JOIN portfolio_vehicles v ON v.id = a.vehicle_id
    LEFT JOIN decisions d ON d.id = a.decision_id
        ORDER BY a.as_of DESC LIMIT 200`,
    )
    .all();
  return ok(c, rows.results ?? []);
});

wealth.post("/allocations", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  refuseLaneBreach(b);

  // Canon §18: deploying capital is irreversible in practice.
  await assertProtectedAction(c.env, "capital_allocation");

  const trackId = requiredText(b?.track_id, "A track id");
  const track = await c.env.DB.prepare(`SELECT id, status FROM wealth_tracks WHERE id = ?`).bind(trackId).first<{ id: string; status: string }>();
  if (!track) throw badRequest("No track with that id");
  if (track.status === "closed") throw conflict("That track is closed");

  const kind = optionalText(b?.kind) ?? "deployed";
  if (!ALLOCATION_KINDS.has(kind)) throw badRequest(`"${kind}" is not a kind of allocation`, `One of: ${[...ALLOCATION_KINDS].join(", ")}.`);

  const amount = micros(b?.amount_micros, "amount_micros");
  if (amount <= 0) throw badRequest("An allocation moves a positive amount", "Use kind 'returned' or 'written_off' for capital coming back or lost.");

  const vehicleId = optionalText(b?.vehicle_id);
  if (vehicleId) {
    const vehicle = await c.env.DB.prepare(`SELECT id, entity_id FROM portfolio_vehicles WHERE id = ?`).bind(vehicleId).first<{ id: string; entity_id: string }>();
    if (!vehicle) throw badRequest("No vehicle with that id");
  }

  const decisionId = optionalText(b?.decision_id);
  if (decisionId) {
    const decision = await c.env.DB.prepare(`SELECT id, status FROM decisions WHERE id = ?`).bind(decisionId).first<{ id: string; status: string }>();
    if (!decision) throw badRequest("No decision with that id");
    if (decision.status === "draft") {
      throw conflict(
        "That decision has not been committed",
        "Capital moves after the decision is committed, not while it is still being argued.",
      );
    }
  }

  const asOf = b?.as_of === undefined || b?.as_of === null ? Date.now() : Number(b.as_of);
  if (!Number.isFinite(asOf)) throw badRequest("as_of is an epoch millisecond timestamp");

  const id = newId("cap");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO capital_allocations (id, track_id, vehicle_id, entity_id, decision_id, kind, amount_micros, as_of, note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(id, trackId, vehicleId, optionalText(b?.entity_id), decisionId, kind, amount, asOf, optionalText(b?.note), now)
    .run();

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "capital_allocation", entityId: id, action: kind,
    detail: { track_id: trackId, amount_micros: amount, decision_id: decisionId },
  });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM capital_allocations WHERE id = ?`).bind(id).first(), 201);
});

// ─── The command centre itself ────────────────────────────────────────────────

/**
 * One read of the whole book: what is held, what it is for, how far each track
 * has drifted from its target, and — separately, and read-only — what the
 * trading lane is holding.
 */
wealth.get("/", async (c) => {
  const now = Date.now();
  const [vehicles, tracks, allocations, trading] = await Promise.all([
    c.env.DB
      .prepare(
        `SELECT v.id, v.name, v.kind, v.liquidity, v.value_micros, v.valued_at, e.name AS entity_name
           FROM portfolio_vehicles v JOIN entities e ON e.id = v.entity_id
          WHERE v.status = 'active'`,
      )
      .all<any>(),
    c.env.DB.prepare(`SELECT * FROM wealth_tracks WHERE status <> 'closed' ORDER BY target_allocation_bps DESC`).all<any>(),
    c.env.DB
      .prepare(`SELECT track_id, kind, COALESCE(SUM(amount_micros),0) AS total FROM capital_allocations GROUP BY track_id, kind`)
      .all<{ track_id: string; kind: string; total: number }>(),
    readTradingCapital(c.env.DB, now),
  ]);

  const held = vehicles.results ?? [];
  const opsMicros = held.reduce((sum, v) => sum + v.value_micros, 0);
  const liquidMicros = held.filter((v) => v.liquidity === "liquid").reduce((sum, v) => sum + v.value_micros, 0);

  const byKind: Record<string, number> = {};
  for (const v of held) byKind[v.kind] = (byKind[v.kind] ?? 0) + v.value_micros;

  const netByTrack: Record<string, number> = {};
  for (const a of allocations.results ?? []) {
    const signed = NEGATIVE_KINDS.has(a.kind) ? -a.total : a.total;
    netByTrack[a.track_id] = (netByTrack[a.track_id] ?? 0) + signed;
  }
  const allocatedTotal = Object.values(netByTrack).reduce((a, b) => a + b, 0);

  const trackRows = (tracks.results ?? []).map((t) => {
    const allocated = netByTrack[t.id] ?? 0;
    const shareBps = allocatedTotal > 0 ? Math.round((allocated / allocatedTotal) * BPS) : 0;
    return {
      ...t,
      allocated_micros: allocated,
      share_bps: shareBps,
      drift_bps: shareBps - t.target_allocation_bps,
    };
  });

  // A stale mark is worse than a missing one, because it looks like knowledge.
  const stale = held.filter((v) => v.valued_at === null || now - v.valued_at > 180 * 86_400_000);

  return ok(c, {
    ops: {
      total_micros: opsMicros,
      liquid_micros: liquidMicros,
      by_kind: byKind,
      vehicles: held.length,
      stale_marks: stale.map((v) => ({ id: v.id, name: v.name, valued_at: v.valued_at })),
    },
    tracks: trackRows,
    allocated_micros: allocatedTotal,
    unallocated_micros: opsMicros - allocatedTotal,
    // Read across the lane boundary, and kept in its own object so no total
    // silently blends governed trading capital into allocatable wealth.
    trading: trading,
    totals: {
      ops_micros: opsMicros,
      trading_micros: trading.capital_micros,
      combined_micros: opsMicros + trading.capital_micros,
      allocatable_micros: opsMicros,
    },
    boundary: {
      allocatable: "ops",
      note: LANE_BREACH_REFUSAL.hint,
    },
  });
});

/** The bridge on its own, for anything that wants the trading read without the book. */
wealth.get("/trading-bridge", async (c) => ok(c, await readTradingCapital(c.env.DB)));
