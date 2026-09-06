/**
 * Phase 22 — the AI Quant Fund, Parts B–G.
 *
 * Authority: the v5 master plan governs this phase and is not in the authority
 * set available to this build, so these routes implement the locked decision
 * that derives from it (build plan §1.7 D6) and the ladder, sequence and risk
 * constitution the architecture notes record. Where the master plan's own
 * detail would be needed, the gap is reported rather than filled.
 *
 * Boss OS governs; it does not execute. Every route here refuses something or
 * records something. None of them place an order.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound, conflict } from "../lib/http";
import { assertLadderStep, killSwitchProof, probeKillSwitch, stages, validationStatus } from "../trading/quant";
import { assertProtectedAction } from "../governance/gate";

export const quant = new Hono<{ Bindings: Env; Variables: Vars }>();

/** The master plan document itself, and what its absence means here. */
export const AUTHORITY_NOTE = {
  governing_document: "Boss_OS_AI_Quant_Fund_Master_Plan_v5.md",
  available_to_this_build: false,
  implemented_from: [
    "Build plan §1.7 D6 — the locked trading execution decision",
    "Architecture notes §8 — the ladder, the envelope, the 90-day sequence, the risk constitution",
  ],
  consequence:
    "Where the master plan's own detail would be required — per-strategy parameters, the full day-by-day " +
    "sequence, the complete fourteen nevers — this build records what it has and does not invent the rest.",
};

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

// ─── The ladder and the sequence ──────────────────────────────────────────────

quant.get("/ladder", async (c) => {
  const rows = await stages(c.env.DB);
  return ok(c, {
    stages: rows.map((s) => ({
      ...s,
      pass_criteria: JSON.parse(s.pass_criteria),
      fail_criteria: JSON.parse(s.fail_criteria),
      required_logs: JSON.parse(s.required_logs),
      advance_requires_approval: Boolean(s.advance_requires_approval),
    })),
    rule: "No skipping. Repair the failed gate rather than stepping over it.",
    authority: AUTHORITY_NOTE,
  });
});

quant.get("/sequence", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM trading_sequence ORDER BY week_no`).all();
  return ok(c, {
    weeks: rows.results ?? [],
    failure_rule: "Do not skip forward; repair the failed gate.",
  });
});

quant.post("/sequence/:week/:action", async (c) => {
  const week = Number(c.req.param("week"));
  const action = c.req.param("action");
  if (!["start", "complete", "block"].includes(action)) {
    throw badRequest(`"${action}" is not something you can do to a week`, "One of: start, complete, block.");
  }
  const b = await c.req.json<any>().catch(() => ({}));

  const row = await c.env.DB.prepare(`SELECT * FROM trading_sequence WHERE week_no = ?`).bind(week).first<any>();
  if (!row) throw notFound("No such week in the sequence");

  // The failure rule is the whole point: a later week cannot start while an
  // earlier one is blocked or unfinished.
  if (action === "start") {
    const earlier = await c.env.DB
      .prepare(`SELECT week_no, status FROM trading_sequence WHERE week_no < ? AND status <> 'complete' ORDER BY week_no LIMIT 1`)
      .bind(week)
      .first<{ week_no: number; status: string }>();
    if (earlier) {
      throw conflict(
        `Week ${earlier.week_no} is ${earlier.status.replace(/_/g, " ")}`,
        "Do not skip forward; repair the failed gate.",
      );
    }
  }

  const now = Date.now();
  const status = action === "start" ? "in_progress" : action === "complete" ? "complete" : "blocked";
  await c.env.DB
    .prepare(`UPDATE trading_sequence SET status = ?, completed_at = ?, note = COALESCE(?, note) WHERE week_no = ?`)
    .bind(status, action === "complete" ? now : null, optionalText(b?.note), week)
    .run();

  await audit(c.env.DB, { actor: "boss", lane: "trading", entityType: "trading_sequence", entityId: String(week), action: status });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM trading_sequence WHERE week_no = ?`).bind(week).first());
});

// ─── Desks ────────────────────────────────────────────────────────────────────

quant.get("/desks", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM strategy_desks WHERE status = 'active' ORDER BY name`).all<any>();
  return ok(c, (rows.results ?? []).map((d) => ({ ...d, symbols: JSON.parse(d.symbols) })));
});

quant.post("/desks", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const key = requiredText(b?.key, "A key");
  const symbols = Array.isArray(b?.symbols) ? b.symbols.map(String) : [];
  if (symbols.length === 0) throw badRequest("A desk trades a named set of symbols", "An open-ended allowlist is not an allowlist.");

  const id = newId("dsk");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO strategy_desks (id, key, name, mandate, bot, venue, symbols, owner_role, status, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,'active',?,?,?)`,
    )
    .bind(
      id, key, requiredText(b?.name, "A name"), requiredText(b?.mandate, "A mandate"),
      optionalText(b?.bot) ?? "hummingbot", requiredText(b?.venue, "A venue"),
      JSON.stringify(symbols), optionalText(b?.owner_role) ?? "quant_research",
      optionalText(b?.notes), now, now,
    )
    .run();

  await audit(c.env.DB, { actor: "boss", lane: "trading", entityType: "strategy_desk", entityId: id, action: "opened", detail: { key } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM strategy_desks WHERE id = ?`).bind(id).first(), 201);
});

// ─── Promotion scorecards ─────────────────────────────────────────────────────

quant.get("/scorecards", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT s.*, st.name AS strategy_name FROM promotion_scorecards s
         JOIN trading_strategies st ON st.id = s.strategy_id ORDER BY s.ts DESC LIMIT 100`,
    )
    .all<any>();
  return ok(c, (rows.results ?? []).map((s) => ({ ...s, criteria: JSON.parse(s.criteria), evidence: JSON.parse(s.evidence) })));
});

/**
 * Scoring a strategy for the next stage. Three refusals live here: the ladder
 * step must be the next one, every criterion must carry an observation, and a
 * card that does not pass cannot be sent for approval.
 */
quant.post("/scorecards", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const strategyId = requiredText(b?.strategy_id, "A strategy id");
  const stageFrom = requiredText(b?.stage_from, "The stage it is in");
  const stageTo = requiredText(b?.stage_to, "The stage it would move to");

  const strategy = await c.env.DB
    .prepare(`SELECT id, name, stage FROM trading_strategies WHERE id = ?`).bind(strategyId)
    .first<{ id: string; name: string; stage: string }>();
  if (!strategy) throw badRequest("No strategy with that id");

  const { to } = await assertLadderStep(c.env.DB, stageFrom, stageTo);

  if (!Array.isArray(b?.criteria) || b.criteria.length === 0) {
    throw badRequest("A scorecard needs criteria", "Send [{ key, requirement, observed, met }] — an unscored promotion is a hunch.");
  }
  const criteria = b.criteria.map((raw: any) => {
    const key = requiredText(raw?.key, "A criterion key");
    const requirement = requiredText(raw?.requirement, "What the criterion requires");
    const observed = requiredText(raw?.observed, `What was observed for ${key}`);
    return { key, requirement, observed, met: Boolean(raw?.met) };
  });

  const score = criteria.filter((c2: any) => c2.met).length;
  const verdict = score === criteria.length ? "pass" : "fail";

  // Micro-live has one more condition than its own criteria: the kill switch
  // must already be proven against a running engine.
  let killSwitch = null;
  if (to.key === "micro_live") {
    killSwitch = await killSwitchProof(c.env.DB);
    if (!killSwitch.proven) {
      throw conflict(
        "The kill switch has not been proven against a running engine",
        `${killSwitch.reason} Build plan §1.7: a kill switch that only sets a local flag is not a kill switch.`,
      );
    }
  }

  const id = newId("psc");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO promotion_scorecards
         (id, strategy_id, desk_id, ts, stage_from, stage_to, criteria, score, max_score, verdict, evidence, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'proposed',?)`,
    )
    .bind(
      id, strategyId, optionalText(b?.desk_id), now, stageFrom, stageTo,
      JSON.stringify(criteria), score, criteria.length, verdict,
      JSON.stringify({ ...(b?.evidence ?? {}), kill_switch: killSwitch }), now,
    )
    .run();

  await audit(c.env.DB, {
    actor: "boss", lane: "trading", entityType: "promotion_scorecard", entityId: id, action: "scored",
    detail: { strategy_id: strategyId, stage_from: stageFrom, stage_to: stageTo, verdict },
  });

  return ok(
    c,
    {
      scorecard: await c.env.DB.prepare(`SELECT * FROM promotion_scorecards WHERE id = ?`).bind(id).first(),
      verdict,
      note:
        verdict === "pass"
          ? "Scored and passing. Promotion still needs an approval — the ladder does not advance on a score alone."
          : `Scored and failing on ${criteria.length - score} criterion/criteria. Repair the failed gate.`,
    },
    201,
  );
});

/** Sends a passing scorecard for approval. Failing cards do not get that far. */
quant.post("/scorecards/:id/promote", async (c) => {
  const id = c.req.param("id");
  const card = await c.env.DB.prepare(`SELECT * FROM promotion_scorecards WHERE id = ?`).bind(id).first<any>();
  if (!card) throw notFound("No scorecard with that id");
  if (card.status !== "proposed") throw conflict(`That scorecard is already ${card.status}`);
  if (card.verdict !== "pass") {
    throw conflict(
      "That scorecard did not pass",
      "A failing card is not a promotion request. Repair the gate and score it again.",
    );
  }

  const approvalId = newId("apr");
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk, payload, status, requested_at, expires_at)
         VALUES (?,'trading',?,?,'strategy_promotion','promotion_scorecards',?,'high',?,'pending',?,?)`,
      )
      .bind(
        approvalId, `Advance to ${card.stage_to}`, `Scored ${card.score}/${card.max_score}.`, id,
        JSON.stringify({ scorecard_id: id, strategy_id: card.strategy_id, stage_to: card.stage_to }),
        now, now + 7 * 86_400_000,
      ),
    c.env.DB.prepare(`UPDATE promotion_scorecards SET approval_id = ? WHERE id = ?`).bind(approvalId, id),
  ]);

  return ok(c, { scorecard_id: id, approval_id: approvalId, note: "Sent for approval. The stage does not change until it is approved." }, 201);
});

// ─── The scale ladder ─────────────────────────────────────────────────────────

quant.get("/rungs", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM scale_rungs ORDER BY rung_no`).all<any>();
  return ok(c, {
    rungs: (rows.results ?? []).map((r) => ({ ...r, requirements: JSON.parse(r.requirements), reached: Boolean(r.reached_at) })),
    rule: "No autonomous capital increase. Every rung is an approval, and rungs open in order.",
  });
});

/**
 * Opening a rung. Three refusals: the rung below must be open, the kill switch
 * must be proven, and the Boss must approve — a scale-up that happened because
 * the numbers looked good is the failure this exists to prevent.
 */
quant.post("/rungs/:rung/open", async (c) => {
  const rungNo = Number(c.req.param("rung"));
  const b = await c.req.json<any>().catch(() => ({}));
  const reason = requiredText(b?.reason, "A reason");

  // Canon §18: opening capital is a protected action like any other trade.
  await assertProtectedAction(c.env, "trade", { type: "scale_rung", id: String(rungNo) });

  const rung = await c.env.DB.prepare(`SELECT * FROM scale_rungs WHERE rung_no = ?`).bind(rungNo).first<any>();
  if (!rung) throw notFound("No such rung");
  if (rung.reached_at) throw conflict("That rung is already open");

  const below = await c.env.DB
    .prepare(`SELECT rung_no, reached_at FROM scale_rungs WHERE rung_no < ? ORDER BY rung_no DESC LIMIT 1`)
    .bind(rungNo)
    .first<{ rung_no: number; reached_at: number | null }>();
  if (below && !below.reached_at) {
    throw conflict(
      `Rung ${below.rung_no} has not been opened`,
      "The ladder has no skipping, and capital least of all.",
    );
  }

  const proof = await killSwitchProof(c.env.DB);
  if (!proof.proven) {
    throw conflict(
      "The kill switch is not proven against a running engine",
      `${proof.reason} No capital opens behind an unproven stop.`,
    );
  }

  const approvalId = newId("apr");
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk, payload, status, requested_at, expires_at)
         VALUES (?,'trading',?,?,'trading_scale_up','scale_rungs',?,'high',?,'pending',?,?)`,
      )
      .bind(
        approvalId, `Open ${rung.label}`, reason, String(rungNo),
        JSON.stringify({ rung_no: rungNo, capital_micros: rung.capital_micros, reason }),
        now, now + 7 * 86_400_000,
      ),
    c.env.DB.prepare(`UPDATE scale_rungs SET approval_id = ? WHERE rung_no = ?`).bind(approvalId, rungNo),
  ]);

  await logEvent(c.env.DB, { level: "info", scope: "trading", event: "scale_rung_requested", detail: { rung_no: rungNo } });
  return ok(
    c,
    {
      rung_no: rungNo,
      approval_id: approvalId,
      note: "Requested, not opened. Capital moves when the approval is decided, and not before.",
    },
    201,
  );
});

// ─── Engines and the kill-switch proof ────────────────────────────────────────

quant.get("/engines", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM trading_engines ORDER BY created_at`).all<any>();
  const probes = await c.env.DB.prepare(`SELECT * FROM kill_switch_probes ORDER BY ts DESC LIMIT 20`).all<any>();
  return ok(c, {
    engines: rows.results ?? [],
    recent_probes: probes.results ?? [],
    proof: await killSwitchProof(c.env.DB),
  });
});

quant.patch("/engines/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => null);
  if (!b) throw badRequest("Send the fields to change");

  // The envelope is protected, and so is what the envelope points at.
  await assertProtectedAction(c.env, "trading_authority_change", { type: "trading_engine", id });

  const engine = await c.env.DB.prepare(`SELECT id, environment FROM trading_engines WHERE id = ?`).bind(id).first<{ id: string; environment: string }>();
  if (!engine) throw notFound("No engine with that id");

  if (b.environment === "live") {
    throw conflict(
      "This build does not run a live engine",
      "Live execution needs a broker adapter that does not exist in this repository, and every Part G gate recorded. The environment stays demo.",
    );
  }
  if (b.api_key !== undefined || b.secret !== undefined || b.credential !== undefined) {
    throw conflict(
      "Boss OS holds no key that can move money",
      "Exchange credentials live on the engine, never in the Worker and never in D1. There is no field here to put one in.",
    );
  }

  const updates: Record<string, string | number | null> = {};
  if (b.control_url !== undefined) updates.control_url = optionalText(b.control_url);
  if (b.status !== undefined) {
    const status = String(b.status);
    if (!["planned", "provisioned", "connected", "unreachable"].includes(status)) throw badRequest(`"${status}" is not an engine status`);
    updates.status = status;
  }
  if (b.region !== undefined) updates.region = optionalText(b.region);
  if (b.fingerprint !== undefined) updates.fingerprint = optionalText(b.fingerprint);
  if (b.notes !== undefined) updates.notes = optionalText(b.notes);

  const keys = Object.keys(updates);
  if (keys.length === 0) throw badRequest("Nothing in that body changes anything");
  await c.env.DB
    .prepare(`UPDATE trading_engines SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map((k) => updates[k]), Date.now(), id)
    .run();

  await audit(c.env.DB, { actor: "boss", lane: "trading", entityType: "trading_engine", entityId: id, action: "updated", detail: { changed: keys } });
  return ok(c, await c.env.DB.prepare(`SELECT * FROM trading_engines WHERE id = ?`).bind(id).first());
});

/** The proof itself: send the command, wait for the acknowledgement, record both. */
quant.post("/engines/:id/kill-switch-probe", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => ({}));
  const kind = b?.kind === "reach" ? "reach" : "stop";

  const result = await probeKillSwitch(c.env, id, kind);
  await audit(c.env.DB, {
    actor: "boss", lane: "trading", entityType: "trading_engine", entityId: id, action: "kill_switch_probe",
    detail: { kind, outcome: result.outcome },
  });

  return ok(
    c,
    {
      probe: result,
      proof: await killSwitchProof(c.env.DB),
      note:
        result.outcome === "acknowledged"
          ? "Acknowledged by the engine. That is what proof means here."
          : "Not acknowledged. The kill switch stays unproven, and micro-live stays closed.",
    },
    201,
  );
});

// ─── The risk constitution and the honest status ──────────────────────────────

quant.get("/nevers", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM trading_nevers ORDER BY key`).all<any>();
  const list = rows.results ?? [];
  return ok(c, {
    nevers: list,
    enforced_in_code: list.filter((n: any) => n.enforcement === "code").length,
    procedural: list.filter((n: any) => n.enforcement === "procedural").length,
    note:
      "The enforcement column is the honest half. `procedural` means nothing in this repository stops it — " +
      "only the Boss does. Marking one of those as enforced would be the most dangerous lie in the system.",
  });
});

quant.get("/validation", async (c) =>
  ok(c, { ...(await validationStatus(c.env)), authority: AUTHORITY_NOTE }),
);
