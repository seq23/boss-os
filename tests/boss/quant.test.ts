import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, api, apiJson, row, stubFetch } from "./helpers";
import { killSwitchProof } from "../../src/worker/boss/trading/quant";

/**
 * Phase 22 — the AI Quant Fund, Parts B–G.
 *
 * Canon's acceptance sentence for this phase reads: paper and micro-live gates
 * exist with evidence requirements; no scale-up without approval; the kill
 * switch is proven against a running demo engine; and the trading validation
 * status stays honest.
 *
 * Three of those four are proven here. The fourth is not, and this file will not
 * pretend otherwise.
 *
 * The engine is not in this repository. Every kill-switch test below runs
 * against a stubbed transport, which proves the protocol — that an
 * acknowledgement is required, that a reply without one is refused, that an
 * unreachable engine is refused, that proof expires, and that micro-live and
 * every scale rung stay shut while it is unproven. It does not prove a round
 * trip to a real Hummingbot on a real box, because no such box exists here.
 * That gate is externally unproven and `GET /api/quant/validation` reports it
 * that way rather than rounding up from a passing test.
 */

const DAY = 86_400_000;

let seq = 0;
const nextKey = (label: string) => `${label}_${(seq++).toString().padStart(3, "0")}`;

/** An engine that answers, the way a running one would. */
function engineAcknowledges(reference = "ack-1") {
  return stubFetch(() =>
    new Response(JSON.stringify({ acknowledged: true, stopped: true, reference }), {
      status: 200, headers: { "content-type": "application/json" },
    }),
  );
}

async function configureEngine(controlUrl = "https://engine.invalid/control") {
  const { status } = await apiJson("/api/quant/engines/eng_primary", {
    method: "PATCH",
    body: { control_url: controlUrl, status: "connected", region: "us-east", fingerprint: "SHA256:test" },
  });
  expect(status).toBe(200);
}

async function proveKillSwitch() {
  await configureEngine();
  const restore = engineAcknowledges();
  try {
    const { body } = await apiJson("/api/quant/engines/eng_primary/kill-switch-probe", { method: "POST", body: {} });
    expect(body.data.probe.outcome).toBe("acknowledged");
    return body;
  } finally {
    restore();
  }
}

async function newStrategy(name: string) {
  const { status, body } = await apiJson("/api/trading/strategies", {
    method: "POST",
    body: {
      name, thesis: "Mean reversion on a spread that reliably closes.",
      market: "crypto", timeframe: "intraday", risk_controls: "Post-only limits, 15% max drawdown.",
    },
  });
  expect(status).toBe(201);
  return body.data;
}

describe("Phase 22 — the authority it was built from", () => {
  it("says plainly that the master plan is not in this build's authority set", async () => {
    const { body } = await apiJson("/api/quant/ladder");
    expect(body.data.authority.governing_document).toBe("Boss_OS_AI_Quant_Fund_Master_Plan_v5.md");
    expect(body.data.authority.available_to_this_build).toBe(false);
    expect(body.data.authority.implemented_from.length).toBeGreaterThanOrEqual(2);
    expect(body.data.authority.consequence).toMatch(/does not invent the rest/);
  });

  it("uses no guaranteed-return language anywhere on the quant surface", async () => {
    const surfaces = await Promise.all([
      apiJson("/api/quant/ladder"), apiJson("/api/quant/sequence"), apiJson("/api/quant/rungs"),
      apiJson("/api/quant/nevers"), apiJson("/api/quant/validation"), apiJson("/api/quant/engines"),
    ]);
    const text = surfaces.map((s) => JSON.stringify(s.body)).join(" ");
    for (const phrase of [
      "guaranteed return", "guaranteed profit", "risk-free", "risk free", "cannot lose",
      "sure thing", "assured return", "guaranteed income",
    ]) {
      expect(text.toLowerCase()).not.toContain(phrase);
    }
  });

  it("records the risk constitution with what actually enforces each never", async () => {
    const { body } = await apiJson("/api/quant/nevers");
    expect(body.data.nevers.length).toBeGreaterThanOrEqual(10);
    expect(body.data.enforced_in_code).toBeGreaterThanOrEqual(7);
    expect(body.data.procedural).toBeGreaterThanOrEqual(1);
    expect(body.data.note).toMatch(/most dangerous lie/);

    for (const never of body.data.nevers) {
      expect(["code", "procedural"]).toContain(never.enforcement);
      expect(never.enforced_by).toBeTruthy();
    }
    // The procedural ones are honest about having nothing behind them but the Boss.
    const revenge = body.data.nevers.find((n: any) => n.key === "no_revenge_trading");
    expect(revenge.enforcement).toBe("procedural");
    expect(revenge.enforced_by).toMatch(/Boss holds this one/);
  });
});

describe("Phase 22 — the ladder does not skip", () => {
  it("ships the seven stages with evidence requirements at each one", async () => {
    const { body } = await apiJson("/api/quant/ladder");
    expect(body.data.stages).toHaveLength(7);
    expect(body.data.stages.map((s: any) => s.key)).toEqual([
      "research", "backtest", "paper", "micro_live", "breakeven", "target", "scale",
    ]);
    for (const stage of body.data.stages) {
      expect(stage.pass_criteria.length).toBeGreaterThanOrEqual(1);
      expect(stage.fail_criteria.length).toBeGreaterThanOrEqual(1);
      expect(stage.required_logs.length).toBeGreaterThanOrEqual(1);
      expect(stage.required_review).toBeTruthy();
      expect(stage.advance_requires_approval).toBe(true);
    }

    const paper = body.data.stages.find((s: any) => s.key === "paper");
    expect(paper.required_logs).toContain("Order log");
    const microLive = body.data.stages.find((s: any) => s.key === "micro_live");
    expect(microLive.capital_limit_micros).toBe(300_000_000);
    expect(microLive.pass_criteria.join(" ")).toMatch(/Kill switch proven/);
  });

  it("refuses a scorecard that skips a stage", async () => {
    const strategy = await newStrategy(nextKey("Skipper"));
    const { status, body } = await apiJson("/api/quant/scorecards", {
      method: "POST",
      body: {
        strategy_id: strategy.id, stage_from: "backtest", stage_to: "micro_live",
        criteria: [{ key: "x", requirement: "y", observed: "z", met: true }],
      },
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/not the next stage/);
    expect(body.hint).toMatch(/no skipping/i);
  });

  it("refuses a promotion with no scored evidence", async () => {
    const strategy = await newStrategy(nextKey("Unscored"));
    const { status, body } = await apiJson("/api/quant/scorecards", {
      method: "POST", body: { strategy_id: strategy.id, stage_from: "research", stage_to: "backtest", criteria: [] },
    });
    expect(status).toBe(400);
    expect(body.hint).toMatch(/unscored promotion is a hunch/);
  });

  it("scores a card, refuses to promote a failing one, and advances only on approval", async () => {
    const strategy = await newStrategy(nextKey("Careful"));
    const failing = await apiJson("/api/quant/scorecards", {
      method: "POST",
      body: {
        strategy_id: strategy.id, stage_from: "research", stage_to: "backtest",
        criteria: [
          { key: "hypothesis", requirement: "A written edge statement", observed: "Written", met: true },
          { key: "failure_condition", requirement: "A named failure condition", observed: "Missing", met: false },
        ],
      },
    });
    expect(failing.body.data.verdict).toBe("fail");
    expect(failing.body.data.note).toMatch(/Repair the failed gate/);

    const refused = await apiJson(`/api/quant/scorecards/${failing.body.data.scorecard.id}/promote`, { method: "POST", body: {} });
    expect(refused.status).toBe(409);
    expect(refused.body.hint).toMatch(/not a promotion request/);

    const passing = await apiJson("/api/quant/scorecards", {
      method: "POST",
      body: {
        strategy_id: strategy.id, stage_from: "research", stage_to: "backtest",
        criteria: [
          { key: "hypothesis", requirement: "A written edge statement", observed: "Written and dated", met: true },
          { key: "failure_condition", requirement: "A named failure condition", observed: "Spread fails to close in 3 sessions", met: true },
        ],
      },
    });
    expect(passing.body.data.verdict).toBe("pass");
    expect(passing.body.data.note).toMatch(/does not advance on a score alone/);

    const promoted = await apiJson(`/api/quant/scorecards/${passing.body.data.scorecard.id}/promote`, { method: "POST", body: {} });
    expect(promoted.status).toBe(201);
    // Still in research until the approval is decided.
    expect(await row(`SELECT stage FROM trading_strategies WHERE id = ?`, strategy.id)).toMatchObject({ stage: "research" });

    await api(`/api/approvals/${promoted.body.data.approval_id}/decide`, { method: "POST", body: { decision: "approved" } });
    expect(await row(`SELECT stage FROM trading_strategies WHERE id = ?`, strategy.id)).toMatchObject({ stage: "backtest" });
    expect(await row(`SELECT status FROM promotion_scorecards WHERE id = ?`, passing.body.data.scorecard.id)).toMatchObject({ status: "applied" });
  });

  it("leaves the strategy where it was when the promotion is refused", async () => {
    const strategy = await newStrategy(nextKey("Held"));
    const card = await apiJson("/api/quant/scorecards", {
      method: "POST",
      body: {
        strategy_id: strategy.id, stage_from: "research", stage_to: "backtest",
        criteria: [{ key: "hypothesis", requirement: "Written", observed: "Written", met: true }],
      },
    });
    const promoted = await apiJson(`/api/quant/scorecards/${card.body.data.scorecard.id}/promote`, { method: "POST", body: {} });
    await api(`/api/approvals/${promoted.body.data.approval_id}/decide`, {
      method: "POST", body: { decision: "rejected", note: "The edge is fee noise." },
    });

    expect(await row(`SELECT stage FROM trading_strategies WHERE id = ?`, strategy.id)).toMatchObject({ stage: "research" });
    expect(await row(`SELECT status FROM promotion_scorecards WHERE id = ?`, card.body.data.scorecard.id)).toMatchObject({ status: "rejected" });
  });

  it("keeps the 90-day sequence in order, with the same failure rule everywhere", async () => {
    const { body } = await apiJson("/api/quant/sequence");
    expect(body.data.weeks).toHaveLength(12);
    for (const week of body.data.weeks) {
      expect(week.artifact).toBeTruthy();
      expect(week.gate).toBeTruthy();
      expect(week.failure_rule).toMatch(/Do not skip forward/);
    }

    const skipped = await apiJson("/api/quant/sequence/5/start", { method: "POST", body: {} });
    expect(skipped.status).toBe(409);
    expect(skipped.body.hint).toMatch(/Do not skip forward/);

    await api("/api/quant/sequence/1/start", { method: "POST", body: {} });
    const started = await apiJson("/api/quant/sequence/1/complete", { method: "POST", body: { note: "Keys are on the engine, not here." } });
    expect(started.body.data.status).toBe("complete");
    expect((await apiJson("/api/quant/sequence/2/start", { method: "POST", body: {} })).status).toBe(200);
  });
});

/**
 * The kill-switch protocol, against a stubbed engine. What each of these
 * establishes is that an acknowledgement is *required* and that everything
 * downstream stays shut without one — not that a real engine ever answered.
 */
describe("Phase 22 — the kill-switch protocol requires an acknowledgement", () => {
  it("starts unproven, and says why", async () => {
    const proof = await killSwitchProof(env.DB);
    expect(proof.proven).toBe(false);
    expect(proof.reason).toMatch(/never been probed/);
  });

  it("records an unconfigured engine as unproven rather than as an error", async () => {
    const { status, body } = await apiJson("/api/quant/engines/eng_primary/kill-switch-probe", { method: "POST", body: {} });
    expect(status).toBe(201);
    expect(body.data.probe.outcome).toBe("not_configured");
    expect(body.data.proof.proven).toBe(false);
    expect(body.data.note).toMatch(/micro-live stays closed/);
  });

  it("counts a reply without an acknowledgement as unproven", async () => {
    await configureEngine();
    const restore = stubFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      const { body } = await apiJson("/api/quant/engines/eng_primary/kill-switch-probe", { method: "POST", body: {} });
      expect(body.data.probe.outcome).toBe("no_ack");
      expect(body.data.probe.detail).toMatch(/Unacknowledged is unproven/);
      expect(body.data.proof.proven).toBe(false);
    } finally { restore(); }
  });

  it("counts an unreachable engine as unproven", async () => {
    await configureEngine();
    const restore = stubFetch(() => { throw new Error("connection refused"); });
    try {
      const { body } = await apiJson("/api/quant/engines/eng_primary/kill-switch-probe", { method: "POST", body: {} });
      expect(body.data.probe.outcome).toBe("error");
      expect(body.data.probe.detail).toMatch(/Unreachable is unproven/);
    } finally { restore(); }
  });

  it("records proof when the transport acknowledges, and expires that proof later", async () => {
    const proved = await proveKillSwitch();
    expect(proved.data.proof.proven).toBe(true);
    expect(proved.data.note).toMatch(/That is what proof means here/);

    const probe = await row(`SELECT * FROM kill_switch_probes WHERE outcome = 'acknowledged'`);
    expect(probe!.acknowledged_at).toBeGreaterThan(0);
    expect(probe!.ack_reference).toBe("ack-1");

    // Proof does not last forever.
    await env.DB.prepare(`UPDATE kill_switch_probes SET ts = ? WHERE id = ?`).bind(Date.now() - 60 * DAY, probe!.id).run();
    const stale = await killSwitchProof(env.DB);
    expect(stale.proven).toBe(false);
    expect(stale.reason).toMatch(/Proof expires/);
  });

  it("does not let a completed round trip imply a verified engine", async () => {
    await proveKillSwitch();
    const { body } = await apiJson("/api/quant/validation");
    const item = body.data.items.find((i: any) => i.key === "kill_switch_proven");

    // The gate can read met — the endpoint answered — but the status must still
    // say what that does and does not establish, rather than implying a real
    // Hummingbot on a real server was verified from here.
    expect(item.status).toBe("met");
    expect(item.detail).toMatch(/control endpoint answered and acknowledged/);
    expect(item.detail).toMatch(/not verified here/);
  });

  it("refuses micro-live promotion while the kill switch is unproven", async () => {
    const strategy = await newStrategy(nextKey("Eager"));
    await env.DB.prepare(`UPDATE trading_strategies SET stage = 'paper' WHERE id = ?`).bind(strategy.id).run();

    const { status, body } = await apiJson("/api/quant/scorecards", {
      method: "POST",
      body: {
        strategy_id: strategy.id, stage_from: "paper", stage_to: "micro_live",
        criteria: [{ key: "gates", requirement: "Six gates recorded", observed: "Recorded", met: true }],
      },
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/kill switch has not been proven/);
    expect(body.hint).toMatch(/only sets a local flag/);
  });

  it("allows the micro-live card once the switch is proven", async () => {
    await proveKillSwitch();
    const strategy = await newStrategy(nextKey("Ready"));
    await env.DB.prepare(`UPDATE trading_strategies SET stage = 'paper' WHERE id = ?`).bind(strategy.id).run();

    const { status, body } = await apiJson("/api/quant/scorecards", {
      method: "POST",
      body: {
        strategy_id: strategy.id, stage_from: "paper", stage_to: "micro_live",
        criteria: [
          { key: "gates", requirement: "Six micro-live gates recorded", observed: "All six recorded", met: true },
          { key: "drawdown", requirement: "Drawdown inside the envelope", observed: "8% against a 15% limit", met: true },
        ],
      },
    });
    expect(status).toBe(201);
    expect(body.data.verdict).toBe("pass");
    expect(JSON.parse(body.data.scorecard.evidence).kill_switch.proven).toBe(true);
  });
});

describe("Phase 22 — no scale-up without approval", () => {
  it("refuses a rung while the kill switch is unproven", async () => {
    const { status, body } = await apiJson("/api/quant/rungs/1/open", {
      method: "POST", body: { reason: "The paper run looked good." },
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/kill switch is not proven/);
    expect(body.hint).toMatch(/No capital opens behind an unproven stop/);
  });

  it("refuses a rung that skips the one below it", async () => {
    await proveKillSwitch();
    const { status, body } = await apiJson("/api/quant/rungs/2/open", {
      method: "POST", body: { reason: "Straight to the bigger number." },
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/Rung 1 has not been opened/);
    expect(body.hint).toMatch(/capital least of all/);
  });

  it("requests rather than opens, and opens only on approval", async () => {
    await proveKillSwitch();
    const { status, body } = await apiJson("/api/quant/rungs/1/open", {
      method: "POST", body: { reason: "Stage 3 passed and the switch is proven." },
    });
    expect(status).toBe(201);
    expect(body.data.note).toMatch(/Requested, not opened/);
    expect(await row(`SELECT reached_at FROM scale_rungs WHERE rung_no = 1`)).toMatchObject({ reached_at: null });

    const approval = await row(`SELECT kind, risk, lane FROM approvals WHERE id = ?`, body.data.approval_id);
    expect(approval).toMatchObject({ kind: "trading_scale_up", risk: "high", lane: "trading" });

    await api(`/api/approvals/${body.data.approval_id}/decide`, { method: "POST", body: { decision: "approved" } });
    const rung = await row(`SELECT reached_at, capital_micros FROM scale_rungs WHERE rung_no = 1`);
    expect(rung!.reached_at).toBeGreaterThan(0);
    expect(rung!.capital_micros).toBe(300_000_000);
  });

  it("opens nothing when the approval is refused", async () => {
    await proveKillSwitch();
    const { body } = await apiJson("/api/quant/rungs/1/open", { method: "POST", body: { reason: "Trying it." } });
    await api(`/api/approvals/${body.data.approval_id}/decide`, {
      method: "POST", body: { decision: "rejected", note: "Not yet." },
    });
    expect(await row(`SELECT reached_at FROM scale_rungs WHERE rung_no = 1`)).toMatchObject({ reached_at: null });
  });

  it("is held like any other trade under a high-risk state", async () => {
    await proveKillSwitch();
    await api("/api/governance/state", { method: "POST", body: { state: "activated", risk_class: "high", hours: 4 } });
    const { status, body } = await apiJson("/api/quant/rungs/1/open", { method: "POST", body: { reason: "Now." } });
    expect(status).toBe(409);
    expect(body.error).toMatch(/Not now/);
  });

  /*
   * The validation status asserts "no rung opens without an approval". That
   * claim has to be checked against the rows rather than restated: a status
   * that reports "met" no matter what the table says is not a gate, it is a
   * label. These two cover both answers.
   */
  it("reports the rung-approval gate as met when every open rung is approved", async () => {
    await proveKillSwitch();
    const { body } = await apiJson("/api/quant/rungs/1/open", { method: "POST", body: { reason: "Proven and scored." } });
    await api(`/api/approvals/${body.data.approval_id}/decide`, { method: "POST", body: { decision: "approved" } });

    const { body: validation } = await apiJson("/api/quant/validation");
    const item = validation.data.items.find((i: any) => i.key === "scale_rung_approval");
    expect(item.status).toBe("met");
    expect(item.detail).toMatch(/each behind an approved approval/);
  });

  it("reports the gate as unmet when a rung is open with no approval behind it", async () => {
    // A rung opened directly in the table — the shape a bug, a bad migration or
    // a hand-edit would leave. The status must notice rather than round up.
    await env.DB.prepare(`UPDATE scale_rungs SET reached_at = ?, approval_id = NULL WHERE rung_no = 1`)
      .bind(Date.now()).run();

    const { body } = await apiJson("/api/quant/validation");
    const item = body.data.items.find((i: any) => i.key === "scale_rung_approval");
    expect(item.status).toBe("unmet");
    expect(item.detail).toMatch(/open without an approved approval/);
    expect(body.data.blocking).toContain("scale_rung_approval");
  });

  it("does not count a pending or rejected approval as an approval", async () => {
    await proveKillSwitch();
    const { body } = await apiJson("/api/quant/rungs/1/open", { method: "POST", body: { reason: "Asked for it." } });
    // Opened in the table while its approval is still sitting in the inbox.
    await env.DB.prepare(`UPDATE scale_rungs SET reached_at = ? WHERE rung_no = 1`).bind(Date.now()).run();
    expect(await row(`SELECT status FROM approvals WHERE id = ?`, body.data.approval_id)).toMatchObject({ status: "pending" });

    const { body: validation } = await apiJson("/api/quant/validation");
    expect(validation.data.items.find((i: any) => i.key === "scale_rung_approval").status).toBe("unmet");
  });
});

describe("Phase 22 — Boss OS governs, it does not execute", () => {
  it("refuses to hold an exchange credential", async () => {
    const { status, body } = await apiJson("/api/quant/engines/eng_primary", {
      method: "PATCH", body: { api_key: "abc", control_url: "https://engine.invalid/control" },
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/holds no key that can move money/);
    expect(body.hint).toMatch(/never in D1/);

    const columns = await all(`PRAGMA table_info(trading_engines)`);
    const names = columns.map((c: any) => c.name.toLowerCase());
    for (const forbidden of ["api_key", "secret", "credential", "token", "passphrase"]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("refuses to switch the engine to live", async () => {
    const { status, body } = await apiJson("/api/quant/engines/eng_primary", {
      method: "PATCH", body: { environment: "live" },
    });
    expect(status).toBe(409);
    expect(body.hint).toMatch(/broker adapter that does not exist/);
  });

  it("ships the engine as planned, not provisioned", async () => {
    const { body } = await apiJson("/api/quant/engines");
    expect(body.data.engines).toHaveLength(1);
    expect(body.data.engines[0].status).toBe("planned");
    expect(body.data.engines[0].environment).toBe("demo");
    expect(body.data.engines[0].notes).toMatch(/Provision nothing until this phase/);
  });
});

/**
 * The acceptance sentence, walked end to end — including the part that stays
 * honest about what has not been proven.
 */
describe("Phase 22 — acceptance", () => {
  it("gates carry evidence, no scale-up without approval, the switch protocol holds, and the status stays honest", async () => {
    // Paper and micro-live gates exist, with evidence requirements.
    const ladder = await apiJson("/api/quant/ladder");
    const paper = ladder.body.data.stages.find((s: any) => s.key === "paper");
    const microLive = ladder.body.data.stages.find((s: any) => s.key === "micro_live");
    expect(paper.required_logs.length).toBeGreaterThanOrEqual(3);
    expect(microLive.required_logs).toContain("Kill switch probe");

    // The kill-switch protocol completes against a stubbed transport. This is
    // the record the ladder checks; it is not evidence of a real engine.
    const proof = await proveKillSwitch();
    expect(proof.data.proof.proven).toBe(true);

    // Scale-up needs an approval and nothing opens before it.
    const requested = await apiJson("/api/quant/rungs/1/open", { method: "POST", body: { reason: "Stage 3 passed." } });
    expect(await row(`SELECT reached_at FROM scale_rungs WHERE rung_no = 1`)).toMatchObject({ reached_at: null });
    await api(`/api/approvals/${requested.body.data.approval_id}/decide`, { method: "POST", body: { decision: "approved" } });
    expect((await row(`SELECT reached_at FROM scale_rungs WHERE rung_no = 1`))!.reached_at).toBeGreaterThan(0);

    // And the validation status refuses to round anything up.
    const { body: validation } = await apiJson("/api/quant/validation");
    expect(validation.data.ready_for_live).toBe(false);
    expect(validation.data.blocking).toContain("live_adapter");

    const byKey = Object.fromEntries(validation.data.items.map((i: any) => [i.key, i]));
    expect(byKey.live_adapter.status).toBe("unmet");
    expect(byKey.no_credentials_held.status).toBe("met");
    expect(byKey.micro_live_gates.status).toBe("unmet");
    expect(validation.data.note).toMatch(/does not round up/);
    expect(validation.data.authority.available_to_this_build).toBe(false);
  });
});
