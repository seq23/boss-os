import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, api, apiJson, row } from "./helpers";
import { brierBps } from "../src/server/investor/calibration";

/**
 * Phase 14 — Investor OS and Wealth Command Center.
 *
 * The acceptance sentence is two claims: one decision recorded with a
 * prediction, resolved, and reflected in a calibration score; and Wealth
 * reading real trading capital without breaching lane isolation. Both are
 * walked end to end below, and the governance around them — the precommit
 * challenge, Deal Energy Protection, the lane boundary — is tested by trying
 * to break it.
 */

const DAY = 86_400_000;
const BPS = 10_000;
const USD = 1_000_000;

let seq = 0;
const nextName = (label: string) => `${label} ${(seq++).toString().padStart(3, "0")}`;

async function newDecision(over: Record<string, unknown> = {}) {
  const { status, body } = await apiJson("/api/investor/decisions", {
    method: "POST",
    body: {
      title: nextName("Decision"),
      context: "A real allocation question with money attached.",
      options: [
        { option: "Invest", why: "The thesis holds" },
        { option: "Pass", why_not: "Valuation is stretched" },
      ],
      kind: "invest",
      stakes: "high",
      ...over,
    },
  });
  expect(status).toBe(201);
  return body.data as any;
}

async function redTeam(decisionId: string, over: Record<string, unknown> = {}) {
  const { status, body } = await apiJson(`/api/investor/decisions/${decisionId}/red-team`, {
    method: "POST",
    body: {
      ways_this_loses: ["The round never closes", "The founder leaves", "The market re-rates"],
      disconfirming_evidence: ["Two comparable deals repriced down 40% this quarter"],
      walk_away_line: "No lead by the end of the quarter",
      verdict: "proceed",
      ...over,
    },
  });
  expect(status).toBe(201);
  return body.data as any;
}

async function newPrediction(decisionId: string | null, over: Record<string, unknown> = {}) {
  const { status, body } = await apiJson("/api/investor/predictions", {
    method: "POST",
    body: {
      decision_id: decisionId,
      statement: nextName("It will happen"),
      probability_bps: 7000,
      resolution_criteria: "A signed document exists, or it does not.",
      resolves_at: Date.now() + 30 * DAY,
      ...over,
    },
  });
  expect(status).toBe(201);
  return body.data as any;
}

async function newDeal(over: Record<string, unknown> = {}) {
  const { status, body } = await apiJson("/api/investor/deals", {
    method: "POST",
    body: { name: nextName("Deal"), kind: "venture", check_size_micros: 500_000 * USD, ...over },
  });
  expect(status).toBe(201);
  return body.data as any;
}

describe("Phase 14 — the Decision Journal", () => {
  it("refuses a decision with one option", async () => {
    const { status, body } = await apiJson("/api/investor/decisions", {
      method: "POST",
      body: { title: "Just do it", context: "Because", options: [{ option: "Do it" }] },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/two options/);
  });

  it("will not commit a decision the red team has never seen", async () => {
    const decision = await newDecision();
    const { status, body } = await apiJson(`/api/investor/decisions/${decision.id}/commit`, {
      method: "POST",
      body: { chosen_option: "Invest", rationale: "The thesis holds." },
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/not been challenged/);
    expect(body.hint).toMatch(/red team/i);
  });

  it("takes the challenge only before commitment, and wants it specific", async () => {
    const decision = await newDecision();

    const thin = await apiJson(`/api/investor/decisions/${decision.id}/red-team`, {
      method: "POST",
      body: {
        ways_this_loses: ["It might not work"],
        disconfirming_evidence: ["Nothing"],
        walk_away_line: "If it feels wrong",
        verdict: "proceed",
      },
    });
    expect(thin.status).toBe(400);
    expect(thin.body.error).toMatch(/at least 3/);

    await redTeam(decision.id);
    await newPrediction(decision.id);
    await api(`/api/investor/decisions/${decision.id}/commit`, {
      method: "POST", body: { chosen_option: "Invest", rationale: "The thesis holds." },
    });

    const late = await apiJson(`/api/investor/decisions/${decision.id}/red-team`, {
      method: "POST",
      body: {
        ways_this_loses: ["a", "b", "c"],
        disconfirming_evidence: ["d"],
        walk_away_line: "e",
        verdict: "kill",
      },
    });
    expect(late.status).toBe(409);
    expect(late.body.hint).toMatch(/post-mortem/);
  });

  it("records the template that generated the challenge", async () => {
    const decision = await newDecision();
    const review = await redTeam(decision.id);
    expect(review.template_id).toBe("tpl_deal_red_team");
    expect(review.prompt).toContain(decision.title);
    expect(review.prompt).not.toMatch(/\{\{/);
  });

  it("needs the changes when the verdict is proceed with changes", async () => {
    const decision = await newDecision();
    const { status } = await apiJson(`/api/investor/decisions/${decision.id}/red-team`, {
      method: "POST",
      body: {
        ways_this_loses: ["a", "b", "c"],
        disconfirming_evidence: ["d"],
        walk_away_line: "e",
        verdict: "proceed_with_changes",
      },
    });
    expect(status).toBe(400);
  });

  it("lets a kill verdict be overridden only in writing, on the record", async () => {
    const decision = await newDecision();
    await redTeam(decision.id, { verdict: "kill" });
    await newPrediction(decision.id);

    const refused = await apiJson(`/api/investor/decisions/${decision.id}/commit`, {
      method: "POST", body: { chosen_option: "Invest", rationale: "I still believe it." },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/kill/);

    const committed = await apiJson(`/api/investor/decisions/${decision.id}/commit`, {
      method: "POST",
      body: {
        chosen_option: "Invest", rationale: "I still believe it.",
        override_reason: "The kill rests on a comparable I think is mispriced.",
      },
    });
    expect(committed.status).toBe(200);
    const override = JSON.parse(committed.body.data.red_team_override);
    expect(override.verdict).toBe("kill");
    expect(override.reason).toMatch(/mispriced/);
  });

  it("will not commit a high-stakes decision with nothing predicted", async () => {
    const decision = await newDecision({ stakes: "high" });
    await redTeam(decision.id);
    const { status, body } = await apiJson(`/api/investor/decisions/${decision.id}/commit`, {
      method: "POST", body: { chosen_option: "Invest", rationale: "Because." },
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/prediction/);
  });

  it("lets a low-stakes decision commit without one", async () => {
    const decision = await newDecision({ stakes: "low" });
    await redTeam(decision.id);
    const { status } = await apiJson(`/api/investor/decisions/${decision.id}/commit`, {
      method: "POST", body: { chosen_option: "Pass", rationale: "Not worth the time." },
    });
    expect(status).toBe(200);
  });

  it("refuses an option that was never written down", async () => {
    const decision = await newDecision({ stakes: "low" });
    await redTeam(decision.id);
    const { status, body } = await apiJson(`/api/investor/decisions/${decision.id}/commit`, {
      method: "POST", body: { chosen_option: "Something else entirely", rationale: "..." },
    });
    expect(status).toBe(400);
    expect(body.hint).toMatch(/Invest, Pass/);
  });

  it("says the forecasts are still open when the outcome is recorded", async () => {
    const decision = await newDecision();
    await redTeam(decision.id);
    await newPrediction(decision.id);
    await api(`/api/investor/decisions/${decision.id}/commit`, {
      method: "POST", body: { chosen_option: "Invest", rationale: "The thesis holds." },
    });

    const { body } = await apiJson(`/api/investor/decisions/${decision.id}/resolve`, {
      method: "POST", body: { summary: "We invested and it is too early to tell.", lesson: "Write shorter horizons." },
    });
    expect(body.data.predictions_still_open).toBe(1);
    expect(JSON.parse(body.data.decision.outcome).lesson).toMatch(/shorter horizons/);
  });
});

describe("Phase 14 — the Prediction Vault and calibration", () => {
  it("scores a forecast the way a Brier score does", () => {
    expect(brierBps(9000, "true")).toBe(100);
    expect(brierBps(9000, "false")).toBe(8100);
    expect(brierBps(5000, "true")).toBe(2500);
    expect(brierBps(5000, "false")).toBe(2500);
  });

  it("refuses certainty and refuses a forecast about the past", async () => {
    const certain = await apiJson("/api/investor/predictions", {
      method: "POST",
      body: { statement: "Certain", probability_bps: BPS, resolution_criteria: "x", resolves_at: Date.now() + DAY },
    });
    expect(certain.status).toBe(400);
    expect(certain.body.error).toMatch(/certainty/i);

    const past = await apiJson("/api/investor/predictions", {
      method: "POST",
      body: { statement: "Yesterday", probability_bps: 5000, resolution_criteria: "x", resolves_at: Date.now() - DAY },
    });
    expect(past.status).toBe(400);
    expect(past.body.hint).toMatch(/memory/);
  });

  it("insists resolution criteria are written before the fact", async () => {
    const { status } = await apiJson("/api/investor/predictions", {
      method: "POST",
      body: { statement: "It works out", probability_bps: 6000, resolves_at: Date.now() + DAY },
    });
    expect(status).toBe(400);
  });

  it("moves a real calibration score when a prediction resolves", async () => {
    const first = await newPrediction(null, { probability_bps: 9000 });
    const { status, body } = await apiJson(`/api/investor/predictions/${first.id}/resolve`, {
      method: "POST", body: { outcome: "true", note: "It closed." },
    });
    expect(status).toBe(200);
    expect(body.data.prediction.brier_bps).toBe(100);
    expect(body.data.calibration.predictions_scored).toBe(1);
    expect(body.data.calibration.brier_score_bps).toBe(100);
    expect(body.data.calibration.hit_rate_bps).toBe(BPS);
    expect(body.data.calibration.buckets[0]).toMatchObject({ from_bps: 9000, to_bps: 10_000, n: 1 });

    // A second, wrong forecast moves the same number the other way.
    const second = await newPrediction(null, { probability_bps: 8000 });
    const after = await apiJson(`/api/investor/predictions/${second.id}/resolve`, {
      method: "POST", body: { outcome: "false" },
    });
    expect(after.body.data.calibration.predictions_scored).toBe(2);
    expect(after.body.data.calibration.brier_score_bps).toBe(Math.round((100 + 6400) / 2));
    expect(after.body.data.calibration.hit_rate_bps).toBe(5000);
    // Forecast 85% on average, right half the time: overconfident by 35 points.
    expect(after.body.data.calibration.overconfidence_bps).toBe(8500 - 5000);

    const stored = await all(`SELECT * FROM calibrations ORDER BY ts DESC`);
    expect(stored.length).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(stored[0].detail).contributions.length).toBe(2);
  });

  it("counts an ambiguous resolution instead of scoring it", async () => {
    const scored = await newPrediction(null, { probability_bps: 6000 });
    await api(`/api/investor/predictions/${scored.id}/resolve`, { method: "POST", body: { outcome: "true" } });
    const unclear = await newPrediction(null, { probability_bps: 4000 });
    const { body } = await apiJson(`/api/investor/predictions/${unclear.id}/resolve`, {
      method: "POST", body: { outcome: "ambiguous", note: "The criteria did not settle it." },
    });

    expect(body.data.prediction.brier_bps).toBeNull();
    expect(body.data.calibration.ambiguous_excluded).toBe(1);
    expect(body.data.calibration.predictions_scored).toBe(1);
  });

  it("refuses to resolve the same forecast twice", async () => {
    const prediction = await newPrediction(null);
    await api(`/api/investor/predictions/${prediction.id}/resolve`, { method: "POST", body: { outcome: "true" } });
    const { status } = await apiJson(`/api/investor/predictions/${prediction.id}/resolve`, {
      method: "POST", body: { outcome: "false" },
    });
    expect(status).toBe(409);
  });

  /**
   * The failure mode of a prediction vault is silence: a forecast passes its
   * date and simply stops being mentioned. The API refuses to create one in the
   * past, so the row is aged directly here — the way time would age it.
   */
  it("names the forecasts that are past their date and still unscored", async () => {
    const soon = await newPrediction(null, { resolves_at: Date.now() + 2 * DAY });
    const overdue = await newPrediction(null, { resolves_at: Date.now() + 3 * DAY });
    await env.DB
      .prepare(`UPDATE predictions SET resolves_at = ? WHERE id = ?`)
      .bind(Date.now() - 5 * DAY, overdue.id)
      .run();

    const { body } = await apiJson("/api/investor/calibration");
    const due = body.data.due_for_resolution.map((p: any) => p.id);
    expect(due).toContain(overdue.id);
    expect(due).not.toContain(soon.id);
    expect(body.data.open_predictions).toBeGreaterThanOrEqual(2);
    expect(body.data.latest).toBeNull();
    expect(body.data.note).toMatch(/Nothing has been scored yet/);
  });
});

describe("Phase 14 — Deal Energy Protection", () => {
  it("reads the pipeline first and lets exactly one deal hold focus", async () => {
    const a = await newDeal();
    const b = await newDeal();

    const focused = await apiJson(`/api/investor/deals/${a.id}/focus`, { method: "POST", body: {} });
    expect(focused.status).toBe(200);
    expect(focused.body.data.energy).toBe("focus");

    const refused = await apiJson(`/api/investor/deals/${b.id}/focus`, { method: "POST", body: {} });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain(a.name);
    expect(refused.body.hint).toMatch(/one deal at a time/);

    const list = await apiJson("/api/investor/deals");
    expect(Object.keys(list.body.data)[0]).toBe("pipeline");
    expect(list.body.data.focus.id).toBe(a.id);
    expect(list.body.data.energy.protected).toBe(true);
    // Two deals in the pipeline behind a focused one is single-deal dependence.
    expect(list.body.data.energy.warnings.some((w: any) => /single-deal dependence/.test(w.text))).toBe(true);

    await api(`/api/investor/deals/${a.id}/release`, { method: "POST", body: {} });
    const second = await apiJson(`/api/investor/deals/${b.id}/focus`, { method: "POST", body: {} });
    expect(second.status).toBe(200);
  });

  /**
   * The check-then-write above can be lost by whoever runs second. The partial
   * unique index is the real arbiter, and the loser must read as a refusal
   * rather than as a 500.
   */
  it("refuses the loser of two simultaneous focus requests", async () => {
    const a = await newDeal();
    const b = await newDeal();
    const [first, second] = await Promise.all([
      apiJson(`/api/investor/deals/${a.id}/focus`, { method: "POST", body: {} }),
      apiJson(`/api/investor/deals/${b.id}/focus`, { method: "POST", body: {} }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const refusal = first.status === 409 ? first : second;
    expect(refusal.body.error).toMatch(/already has focus/);
    expect(await all(`SELECT id FROM deals WHERE energy = 'focus'`)).toHaveLength(1);
  });

  it("takes focus back when the deal is over", async () => {
    const deal = await newDeal();
    await api(`/api/investor/deals/${deal.id}/focus`, { method: "POST", body: {} });
    await api(`/api/investor/deals/${deal.id}`, { method: "PATCH", body: { stage: "passed" } });

    const after = await row(`SELECT energy, focus_since, decided_at FROM deals WHERE id = ?`, deal.id);
    expect(after!.energy).toBe("pipeline");
    expect(after!.focus_since).toBeNull();
    expect(after!.decided_at).toBeGreaterThan(0);

    const { status, body } = await apiJson(`/api/investor/deals/${deal.id}/focus`, { method: "POST", body: {} });
    expect(status).toBe(409);
    expect(body.hint).toMatch(/finished deal/);
  });

  it("will not let focus be set as though it were an ordinary field", async () => {
    const deal = await newDeal();
    const { status, body } = await apiJson(`/api/investor/deals/${deal.id}`, {
      method: "PATCH", body: { energy: "focus" },
    });
    expect(status).toBe(400);
    expect(body.hint).toMatch(/one-focused-deal rule/);
  });

  it("puts an overdue next step on the pipeline as a warning", async () => {
    const deal = await newDeal({ next_step: "Send the term sheet", next_step_due_at: Date.now() - 3 * DAY });
    const { body } = await apiJson("/api/investor/deals");
    expect(body.data.energy.warnings.some((w: any) => w.deal_id === deal.id && /term sheet/.test(w.text))).toBe(true);
  });

  it("weights an opportunity pipeline by probability rather than by hope", async () => {
    await apiJson("/api/investor/opportunities", {
      method: "POST",
      body: { title: nextName("Big but unlikely"), expected_value_micros: 1_000_000 * USD, probability_bps: 500 },
    });
    await apiJson("/api/investor/opportunities", {
      method: "POST",
      body: { title: nextName("Small but likely"), expected_value_micros: 100_000 * USD, probability_bps: 9000 },
    });
    const { body } = await apiJson("/api/investor/opportunities");
    expect(body.data.weighted_value_micros).toBe(50_000 * USD + 90_000 * USD);
  });
});

describe("Phase 14 — the Wealth Command Center and the lane boundary", () => {
  it("reads real trading capital without touching it", async () => {
    const before = await all(`SELECT id, capital_micros, cash_micros FROM trading_accounts ORDER BY id`);
    const positionsBefore = await row(`SELECT COUNT(*) AS n FROM trading_positions`);

    const { status, body } = await apiJson("/api/wealth/trading-bridge");
    expect(status).toBe(200);
    expect(body.data.read_only).toBe(true);
    expect(body.data.source).toBe("trading_lane");
    // The paper book is seeded with real capital; the bridge reports it.
    expect(body.data.capital_micros).toBe(before.reduce((s: number, a: any) => s + a.capital_micros, 0));
    expect(body.data.capital_micros).toBeGreaterThan(0);
    expect(body.data.authority.live_enabled).toBe(false);
    expect(body.data.note).toMatch(/read-only|cannot allocate/i);

    const after = await all(`SELECT id, capital_micros, cash_micros FROM trading_accounts ORDER BY id`);
    expect(after).toEqual(before);
    expect(await row(`SELECT COUNT(*) AS n FROM trading_positions`)).toEqual(positionsBefore);
  });

  it("keeps trading capital out of the book it can allocate", async () => {
    const { body: entity } = await apiJson("/api/wealth/entities", {
      method: "POST", body: { name: nextName("Holdings LLC"), kind: "llc" },
    });
    await apiJson("/api/wealth/vehicles", {
      method: "POST",
      body: { entity_id: entity.data.id, name: "Cash", kind: "cash", value_micros: 250_000 * USD, liquidity: "liquid" },
    });

    const { body } = await apiJson("/api/wealth");
    expect(body.data.totals.ops_micros).toBeGreaterThanOrEqual(250_000 * USD);
    expect(body.data.totals.trading_micros).toBeGreaterThan(0);
    expect(body.data.totals.combined_micros).toBe(body.data.totals.ops_micros + body.data.totals.trading_micros);
    // The one that matters: what Wealth may deploy excludes the trading lane.
    expect(body.data.totals.allocatable_micros).toBe(body.data.totals.ops_micros);
    expect(body.data.boundary.allocatable).toBe("ops");
    expect(body.data.trading.read_only).toBe(true);
  });

  it("refuses to hold trading capital as a vehicle or move it as an allocation", async () => {
    const { body: entity } = await apiJson("/api/wealth/entities", {
      method: "POST", body: { name: nextName("Bridge Test LLC"), kind: "llc" },
    });

    const asVehicle = await apiJson("/api/wealth/vehicles", {
      method: "POST", body: { entity_id: entity.data.id, name: "Trading book", kind: "trading", value_micros: 10 * USD },
    });
    expect(asVehicle.status).toBe(409);
    expect(asVehicle.body.error).toMatch(/cannot be held or allocated/);

    const laneTagged = await apiJson("/api/wealth/entities", {
      method: "POST", body: { name: nextName("Trading Entity"), kind: "llc", lane: "trading" },
    });
    expect(laneTagged.status).toBe(409);

    const { body: track } = await apiJson("/api/wealth/tracks", {
      method: "POST", body: { name: nextName("Growth"), target_allocation_bps: 2000 },
    });
    const fromTrading = await apiJson("/api/wealth/allocations", {
      method: "POST",
      body: { track_id: track.data.id, amount_micros: 1_000 * USD, trading_account_id: "acct_paper" },
    });
    expect(fromTrading.status).toBe(409);
    expect(fromTrading.body.hint).toMatch(/isolated/);
  });

  it("keeps allocation targets inside one book", async () => {
    await apiJson("/api/wealth/tracks", { method: "POST", body: { name: nextName("Core"), target_allocation_bps: 7000 } });
    const { status, body } = await apiJson("/api/wealth/tracks", {
      method: "POST", body: { name: nextName("Moonshots"), target_allocation_bps: 4000 },
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/of the book/);
  });

  it("will not move capital on a decision that is still being argued", async () => {
    const decision = await newDecision({ stakes: "low" });
    const { body: track } = await apiJson("/api/wealth/tracks", {
      method: "POST", body: { name: nextName("Private credit"), target_allocation_bps: 1000 },
    });
    const { status, body } = await apiJson("/api/wealth/allocations", {
      method: "POST",
      body: { track_id: track.data.id, amount_micros: 10_000 * USD, decision_id: decision.id },
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/not been committed/);
  });

  it("reports drift from target and flags a stale mark", async () => {
    const { body: entity } = await apiJson("/api/wealth/entities", {
      method: "POST", body: { name: nextName("Drift LLC"), kind: "llc" },
    });
    const { body: vehicle } = await apiJson("/api/wealth/vehicles", {
      method: "POST",
      body: {
        entity_id: entity.data.id, name: "Old private position", kind: "spv",
        value_micros: 500_000 * USD, valued_at: Date.now() - 400 * DAY,
      },
    });
    const { body: track } = await apiJson("/api/wealth/tracks", {
      method: "POST", body: { name: nextName("Venture"), target_allocation_bps: 3000 },
    });
    await apiJson("/api/wealth/allocations", {
      method: "POST",
      body: { track_id: track.data.id, vehicle_id: vehicle.data.id, amount_micros: 500_000 * USD, kind: "deployed" },
    });

    const { body } = await apiJson("/api/wealth");
    const scored = body.data.tracks.find((t: any) => t.id === track.data.id);
    expect(scored.allocated_micros).toBe(500_000 * USD);
    expect(scored.share_bps).toBe(BPS);
    expect(scored.drift_bps).toBe(BPS - 3000);
    expect(body.data.ops.stale_marks.some((s: any) => s.id === vehicle.data.id)).toBe(true);
  });

  it("nets capital that came back out of the track it came from", async () => {
    const { body: track } = await apiJson("/api/wealth/tracks", {
      method: "POST", body: { name: nextName("Secondaries"), target_allocation_bps: 1000 },
    });
    await apiJson("/api/wealth/allocations", {
      method: "POST", body: { track_id: track.data.id, amount_micros: 100_000 * USD, kind: "deployed" },
    });
    await apiJson("/api/wealth/allocations", {
      method: "POST", body: { track_id: track.data.id, amount_micros: 30_000 * USD, kind: "returned" },
    });

    const { body } = await apiJson("/api/wealth");
    const scored = body.data.tracks.find((t: any) => t.id === track.data.id);
    expect(scored.allocated_micros).toBe(70_000 * USD);
  });

  it("says why there are no tracks rather than inventing canon's names", async () => {
    const { body } = await apiJson("/api/wealth/tracks");
    expect(body.data.note).toMatch(/not reproduced in any authority document/);
    expect(body.data.tracks).toEqual([]);
  });
});

/**
 * The acceptance sentence, walked end to end: a decision recorded with a
 * prediction, challenged, committed, resolved, and reflected in a calibration
 * score — and Wealth reading real trading capital without breaching the lane.
 */
describe("Phase 14 — acceptance", () => {
  it("decision → prediction → resolution → calibration, and capital that follows the decision", async () => {
    const { body: thesis } = await apiJson("/api/investor/theses", {
      method: "POST",
      body: {
        title: nextName("Infrastructure over applications"),
        statement: "Margin accrues to the layer that owns distribution.",
        invalidated_by: "Two consecutive quarters of application-layer margin expansion.",
        conviction: 70,
      },
    });
    const deal = await newDeal({ thesis_id: thesis.data.id, name: nextName("Northwind Series A") });
    await api(`/api/investor/deals/${deal.id}`, { method: "PATCH", body: { stage: "diligence" } });

    const decision = await newDecision({
      title: nextName("Lead the Northwind round"),
      deal_id: deal.id,
      thesis_id: thesis.data.id,
      stakes: "high",
      reversible: false,
    });

    // Challenged before commitment, and the challenge is on the record.
    const review = await redTeam(decision.id, { verdict: "proceed_with_changes", changes_required: ["Halve the first cheque"] });
    expect(review.verdict).toBe("proceed_with_changes");

    // The falsifiable prediction that makes the decision scoreable later.
    const prediction = await newPrediction(decision.id, {
      statement: "Northwind closes a priced round above this valuation within 90 days",
      probability_bps: 7500,
      resolution_criteria: "A signed term sheet at a higher pre-money, or none.",
      resolves_at: Date.now() + 90 * DAY,
    });

    const committed = await apiJson(`/api/investor/decisions/${decision.id}/commit`, {
      method: "POST",
      body: { chosen_option: "Invest", rationale: "The thesis holds and the red team's cut is affordable.", review_at: Date.now() + 120 * DAY },
    });
    expect(committed.status).toBe(200);
    expect(committed.body.data.status).toBe("committed");
    expect(committed.body.data.committed_at).toBeGreaterThan(0);

    // The prediction resolves, and the calibration score moves because of it.
    const resolved = await apiJson(`/api/investor/predictions/${prediction.id}/resolve`, {
      method: "POST", body: { outcome: "true", note: "Closed at a 30% step-up." },
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.prediction.brier_bps).toBe(brierBps(7500, "true"));
    expect(resolved.body.data.calibration.predictions_scored).toBe(1);
    expect(resolved.body.data.calibration.brier_score_bps).toBe(brierBps(7500, "true"));
    expect(resolved.body.data.calibration.buckets[0].n).toBe(1);

    const storedCalibration = await row(`SELECT * FROM calibrations ORDER BY ts DESC LIMIT 1`);
    expect(storedCalibration!.predictions_scored).toBe(1);

    const full = await apiJson(`/api/investor/decisions/${decision.id}`);
    expect(full.body.data.red_team[0].ways_this_loses.length).toBe(3);
    expect(full.body.data.predictions[0].outcome).toBe("true");

    // Capital follows the committed decision, inside the ops lane only.
    const { body: entity } = await apiJson("/api/wealth/entities", { method: "POST", body: { name: nextName("Fund I GP"), kind: "llc" } });
    const { body: vehicle } = await apiJson("/api/wealth/vehicles", {
      method: "POST",
      body: { entity_id: entity.data.id, name: "Northwind SPV", kind: "spv", value_micros: 500_000 * USD },
    });
    const { body: track } = await apiJson("/api/wealth/tracks", {
      method: "POST", body: { name: nextName("Venture"), target_allocation_bps: 4000 },
    });
    const allocation = await apiJson("/api/wealth/allocations", {
      method: "POST",
      body: {
        track_id: track.data.id, vehicle_id: vehicle.data.id, decision_id: decision.id,
        amount_micros: 500_000 * USD, kind: "deployed", note: "Half the original cheque, per the red team.",
      },
    });
    expect(allocation.status).toBe(201);

    const { body: book } = await apiJson("/api/wealth");
    expect(book.data.ops.total_micros).toBe(500_000 * USD);
    expect(book.data.tracks.find((t: any) => t.id === track.data.id).allocated_micros).toBe(500_000 * USD);
    expect(book.data.trading.read_only).toBe(true);
    expect(book.data.trading.capital_micros).toBeGreaterThan(0);
    expect(book.data.totals.allocatable_micros).toBe(book.data.ops.total_micros);

    // The lane held: nothing in Wealth references a trading row.
    const allocations = await all(`SELECT * FROM capital_allocations`);
    expect(allocations.every((a: any) => a.vehicle_id === null || a.vehicle_id.startsWith("veh_"))).toBe(true);
    expect(JSON.stringify(allocations)).not.toContain("acct_paper");
  });
});
