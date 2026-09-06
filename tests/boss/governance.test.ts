import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, api, apiJson, insertApproval, row } from "./helpers";
import { WATCH_LIST } from "../src/server/governance/gate";

/**
 * Phase 19 — the Operating Governance Layer.
 *
 * Acceptance: a protected action is refused under a high-risk emotional state,
 * recorded and explained; and the Compliance Sentinel flags at least the watch
 * list. Everything here is enforcement, so the tests try to do the things the
 * layer is supposed to stop.
 */

const DAY = 86_400_000;
const USD = 1_000_000;

let seq = 0;
const nextName = (label: string) => `${label} ${(seq++).toString().padStart(3, "0")}`;

async function recordState(state: string, riskClass: string, note?: string) {
  const { status, body } = await apiJson("/api/governance/state", {
    method: "POST",
    body: { state, risk_class: riskClass, note, hours: 8 },
  });
  expect(status).toBe(201);
  return body.data;
}

describe("Phase 19 — canon §18, the state gates the protected actions", () => {
  it("records a state, holds only the protected actions, and says so kindly", async () => {
    const recorded = await recordState("grieving", "high", "Bad news this morning.");
    expect(recorded.held).toMatch(/Protected actions are held/);
    expect(recorded.held).toMatch(/Everything else runs as normal/);

    const current = await apiJson("/api/governance/state");
    expect(current.body.data.current.risk_class).toBe("high");
    expect(current.body.data.current.state).toBe("grieving");

    const check = await apiJson("/api/governance/check/trade");
    expect(check.body.data.allowed).toBe(false);
    expect(check.body.data.reason).toMatch(/Not now/);
    expect(check.body.data.reason).toMatch(/still be here/);
    // Kind, not moralising.
    expect(check.body.data.reason).not.toMatch(/should not|irresponsible|mistake|failure/i);

    // An action with no protected right is unaffected.
    const unprotected = await apiJson("/api/governance/check/task_output");
    expect(unprotected.body.data.allowed).toBe(true);
  });

  it("refuses an order while the state stands, and records the refusal", async () => {
    await recordState("activated", "high");

    const { status, body } = await apiJson("/api/trading/orders", {
      method: "POST",
      body: { account_id: "acct_paper", symbol: "BTC", side: "buy", qty: 1, ref_price: 50_000 },
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/Not now/);
    expect(body.hint).toMatch(/§18/);

    const flags = await all(`SELECT * FROM compliance_flags WHERE watch_key = 'protected_action_blocked'`);
    expect(flags.length).toBe(1);
    expect(JSON.parse(flags[0].detail).action_class).toBe("trade");
    expect(flags[0].severity).toBe("medium");

    const events = await all(`SELECT * FROM system_events WHERE event = 'protected_action_blocked'`);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].level).toBe("warn");

    // Nothing was drafted.
    expect(await all(`SELECT id FROM trading_orders`)).toHaveLength(0);
  });

  it("holds committing a decision and allocating capital, and lets ordinary work through", async () => {
    const { body: decision } = await apiJson("/api/investor/decisions", {
      method: "POST",
      body: {
        title: nextName("A decision"), context: "Money is involved",
        options: [{ option: "Do it" }, { option: "Do not" }], stakes: "low",
      },
    });
    await api(`/api/investor/decisions/${decision.data.id}/red-team`, {
      method: "POST",
      body: {
        ways_this_loses: ["a", "b", "c"], disconfirming_evidence: ["d"],
        walk_away_line: "e", verdict: "proceed",
      },
    });

    await recordState("depleted", "high");

    const commit = await apiJson(`/api/investor/decisions/${decision.data.id}/commit`, {
      method: "POST", body: { chosen_option: "Do it", rationale: "Because." },
    });
    expect(commit.status).toBe(409);
    expect(commit.body.error).toMatch(/Not now/);

    const { body: track } = await apiJson("/api/wealth/tracks", {
      method: "POST", body: { name: nextName("Track"), target_allocation_bps: 1000 },
    });
    const allocate = await apiJson("/api/wealth/allocations", {
      method: "POST", body: { track_id: track.data.id, amount_micros: 1000 * USD },
    });
    expect(allocate.status).toBe(409);

    // Recording a meeting, capturing memory, reading anything: untouched.
    const memory = await apiJson("/api/memory", { method: "POST", body: { title: "Still fine", body: "Capture works." } });
    expect(memory.status).toBe(201);
  });

  it("lets everything through again once the state is cleared", async () => {
    await recordState("stretched", "high");
    const blocked = await apiJson("/api/governance/check/capital_allocation");
    expect(blocked.body.data.allowed).toBe(false);

    const cleared = await apiJson("/api/governance/state/clear", { method: "POST", body: {} });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.current.risk_class).toBe("low");

    const after = await apiJson("/api/governance/check/capital_allocation");
    expect(after.body.data.allowed).toBe(true);

    const again = await apiJson("/api/governance/state/clear", { method: "POST", body: {} });
    expect(again.status).toBe(409);
  });

  it("does not let a Tuesday gate a Friday", async () => {
    const { body } = await apiJson("/api/governance/state", {
      method: "POST", body: { state: "activated", risk_class: "high", hours: 1 },
    });
    await env.DB
      .prepare(`UPDATE emotional_states SET ts = ?, valid_until = ? WHERE id = ?`)
      .bind(Date.now() - 3 * DAY, Date.now() - 2 * DAY, body.data.state.id)
      .run();

    const current = await apiJson("/api/governance/state");
    expect(current.body.data.current.risk_class).toBe("low");
    expect((await apiJson("/api/governance/check/trade")).body.data.allowed).toBe(true);
  });

  it("takes only the states and risk classes it knows", async () => {
    expect((await apiJson("/api/governance/state", { method: "POST", body: { state: "fine" } })).status).toBe(400);
    expect(
      (await apiJson("/api/governance/state", { method: "POST", body: { state: "steady", risk_class: "critical" } })).status,
    ).toBe(400);
    expect(
      (await apiJson("/api/governance/state", { method: "POST", body: { state: "steady", hours: 0 } })).status,
    ).toBe(400);
  });
});

describe("Phase 19 — the approvals layer consults the rights table", () => {
  it("holds a protected approval kind while the state stands, and never holds a deferral", async () => {
    const approvalId = await insertApproval({ kind: "trade", title: "Buy something" });
    await recordState("grieving", "high");

    const decided = await apiJson(`/api/approvals/${approvalId}/decide`, {
      method: "POST", body: { decision: "approved" },
    });
    expect(decided.status).toBe(409);
    expect(decided.body.error).toMatch(/Not now/);
    expect(await row(`SELECT status FROM approvals WHERE id = ?`, approvalId)).toMatchObject({ status: "pending" });

    // Postponing is always available: canon holds decisions, not the person.
    const deferred = await apiJson(`/api/approvals/${approvalId}/decide`, {
      method: "POST", body: { decision: "deferred", note: "Not today." },
    });
    expect(deferred.status).toBe(200);
    expect(deferred.body.data.approval.status).toBe("deferred");
  });

  it("lets an unprotected kind be decided in the same state", async () => {
    const approvalId = await insertApproval({ kind: "task_output", origin_type: null, origin_id: null });
    await recordState("depleted", "high");

    const decided = await apiJson(`/api/approvals/${approvalId}/decide`, {
      method: "POST", body: { decision: "approved" },
    });
    expect(decided.status).toBe(200);
  });

  it("refuses a decision the rights table gives to someone else", async () => {
    await env.DB
      .prepare(`UPDATE decision_rights SET decider = 'external' WHERE action_class = 'spend'`)
      .run();
    const approvalId = await insertApproval({ kind: "spend" });

    const { status, body } = await apiJson(`/api/approvals/${approvalId}/decide`, {
      method: "POST", body: { decision: "approved" },
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/not the Boss's call/);
    expect(body.hint).toMatch(/external/);
  });

  it("publishes the rights it enforces", async () => {
    const { body } = await apiJson("/api/governance/decision-rights");
    expect(body.data.rights.length).toBeGreaterThanOrEqual(10);
    const byClass = Object.fromEntries(body.data.rights.map((r: any) => [r.action_class, r]));
    expect(byClass.trade.protected).toBe(true);
    expect(byClass.task_output.protected).toBe(false);
    for (const right of body.data.rights) expect(right.rationale).toBeTruthy();
  });
});

describe("Phase 19 — canon §4, the Compliance Sentinel", () => {
  it("checks the whole watch list and flags what is actually true", async () => {
    const { status, body } = await apiJson("/api/governance/sentinel/run", { method: "POST", body: {} });
    expect(status).toBe(201);
    expect(body.data.checked).toBe(WATCH_LIST.length);
    expect(WATCH_LIST.length).toBeGreaterThanOrEqual(10);

    // A fresh database has never snapshotted, which is exactly what the vault
    // watch item exists to catch.
    const raised = body.data.raised.map((r: any) => r.watch_key);
    expect(raised).toContain("stale_vault");

    const flags = await apiJson("/api/governance/flags");
    expect(flags.body.data.some((f: any) => f.watch_key === "stale_vault")).toBe(true);
    for (const flag of flags.body.data) expect(flag.summary).toBeTruthy();
  });

  it("does not double the board when it runs twice", async () => {
    await api("/api/governance/sentinel/run", { method: "POST", body: {} });
    const first = (await all(`SELECT id FROM compliance_flags`)).length;
    const second = await apiJson("/api/governance/sentinel/run", { method: "POST", body: {} });
    expect(second.body.data.raised).toEqual([]);
    expect(second.body.data.already_open.length).toBeGreaterThan(0);
    expect((await all(`SELECT id FROM compliance_flags`)).length).toBe(first);
  });

  it("catches a high-risk state, an overdue maintenance item and an uncovered job type", async () => {
    await recordState("activated", "high");
    await env.DB
      .prepare(`UPDATE maintenance_items SET due_at = ? WHERE key = 'restore_drill'`)
      .bind(Date.now() - DAY)
      .run();
    await env.DB.prepare(`DELETE FROM active_defaults WHERE job_type = 'coaching'`).run();

    const { body } = await apiJson("/api/governance/sentinel/run", { method: "POST", body: {} });
    const raised = body.data.raised.map((r: any) => r.watch_key);
    expect(raised).toContain("high_risk_state");
    expect(raised).toContain("overdue_maintenance");
    expect(raised).toContain("uncovered_job_type");

    const flag = await row(`SELECT summary FROM compliance_flags WHERE watch_key = 'overdue_maintenance'`);
    expect(flag!.summary).toMatch(/restore drill/i);
  });

  it("clears a maintenance flag when the work is actually done", async () => {
    await env.DB.prepare(`UPDATE maintenance_items SET due_at = ? WHERE key = 'rotate_passcode'`).bind(Date.now() - DAY).run();
    await api("/api/governance/sentinel/run", { method: "POST", body: {} });
    expect(await all(`SELECT id FROM compliance_flags WHERE watch_key = 'overdue_maintenance' AND subject_id = 'rotate_passcode' AND status = 'open'`)).toHaveLength(1);

    await api("/api/governance/maintenance/rotate_passcode/done", { method: "POST", body: {} });
    expect(await all(`SELECT id FROM compliance_flags WHERE watch_key = 'overdue_maintenance' AND subject_id = 'rotate_passcode' AND status = 'open'`)).toHaveLength(0);

    const item = await row(`SELECT last_done_at, due_at FROM maintenance_items WHERE key = 'rotate_passcode'`);
    expect(item!.last_done_at).toBeGreaterThan(0);
    expect(item!.due_at).toBeGreaterThan(Date.now());
  });

  it("distinguishes clearing a flag from deciding to live with it", async () => {
    await api("/api/governance/sentinel/run", { method: "POST", body: {} });
    const flag = (await all(`SELECT id FROM compliance_flags WHERE status = 'open'`))[0];

    const noReason = await apiJson(`/api/governance/flags/${flag.id}/accept`, { method: "POST", body: {} });
    expect(noReason.status).toBe(400);
    expect(noReason.body.hint).toMatch(/decided to live with it/);

    const accepted = await apiJson(`/api/governance/flags/${flag.id}/accept`, {
      method: "POST", body: { note: "Known, and fine until the next drill." },
    });
    expect(accepted.body.data.status).toBe("accepted");

    const again = await apiJson(`/api/governance/flags/${flag.id}/clear`, { method: "POST", body: {} });
    expect(again.status).toBe(409);
  });

  it("runs on the nightly cron as its own recorded step", async () => {
    const { default: worker } = await import("../src/server/index");
    const { createExecutionContext, waitOnExecutionContext } = await import("cloudflare:test");
    const ctx = createExecutionContext();
    await worker.scheduled!({ cron: "0 3 * * *", scheduledTime: Date.now(), noRetry() {} } as any, env, ctx);
    await waitOnExecutionContext(ctx);

    const run = await row(`SELECT steps FROM cron_runs ORDER BY started_at DESC LIMIT 1`);
    const step = JSON.parse(run!.steps).find((s: any) => s.name === "compliance_sentinel");
    expect(step.status).toBe("ok");
  });
});

describe("Phase 19 — canon §17, anti-dependency", () => {
  it("asks what would survive this system, and answers from real rows", async () => {
    const { body } = await apiJson("/api/governance/anti-dependency");
    expect(body.data.checks.length).toBeGreaterThanOrEqual(6);
    for (const check of body.data.checks) {
      expect(check.question).toMatch(/\?$/);
      expect(check.detail).toBeTruthy();
    }
    // A fresh database depends on this system entirely, and says so.
    expect(body.data.failing).toBeGreaterThan(0);
    expect(body.data.verdict).toMatch(/on this system alone/);

    const keys = body.data.checks.map((c: any) => c.key);
    expect(keys).toContain("offline_library");
    expect(keys).toContain("verified_snapshot");
    expect(keys).toContain("portable_export");
    expect(keys).toContain("provider_plurality");
  });

  it("notices when a dependency is actually reduced", async () => {
    const before = await apiJson("/api/governance/anti-dependency");
    const exportCheck = (c: any) => c.checks.find((x: any) => x.key === "portable_export");
    expect(exportCheck(before.body.data).pass).toBe(false);

    const { body: memory } = await apiJson("/api/memory", { method: "POST", body: { title: "Portable", body: "Something to export." } });
    await api("/api/knowledge/surfaces/life_wiki/items", { method: "POST", body: { item_id: memory.data.id } });
    await api("/api/knowledge/exports", { method: "POST", body: {} });

    const after = await apiJson("/api/governance/anti-dependency");
    expect(exportCheck(after.body.data).pass).toBe(true);
    // Filing onto an offline surface and exporting both reduce dependence, so
    // this asserts movement rather than an exact count.
    expect(after.body.data.passing).toBeGreaterThan(before.body.data.passing);
    expect(after.body.data.failing).toBeLessThan(before.body.data.failing);
  });
});

describe("Phase 19 — the mode card, playbooks, brand and learning", () => {
  it("issues a mode card from live state", async () => {
    const { body } = await apiJson("/api/governance/mode-card");
    expect(body.data.cost_mode).toBeTruthy();
    expect(body.data.trading.live_enabled).toBe(false);
    expect(body.data.protected_actions.length).toBeGreaterThanOrEqual(5);
    expect(body.data.protected_actions.every((a: any) => a.allowed_now)).toBe(true);
    expect(body.data.boundary).toMatch(/No state-based hold/);

    await recordState("grieving", "high");
    const held = await apiJson("/api/governance/mode-card");
    expect(held.body.data.protected_actions.every((a: any) => a.allowed_now)).toBe(false);
    expect(held.body.data.boundary).toMatch(/held/);
    expect(held.body.data.emotional_state.risk_class).toBe("high");
  });

  it("surfaces the playbook whose condition is true right now", async () => {
    const quiet = await apiJson("/api/governance/playbooks");
    expect(quiet.body.data.playbooks.length).toBeGreaterThanOrEqual(6);
    expect(quiet.body.data.applies_now.map((p: any) => p.key)).toContain("vault_stale");

    await env.DB
      .prepare(`UPDATE trading_authority SET kill_switch = 1`)
      .run();
    const engaged = await apiJson("/api/governance/playbooks");
    expect(engaged.body.data.applies_now.map((p: any) => p.key)).toContain("kill_switch_engaged");
    const playbook = engaged.body.data.applies_now.find((p: any) => p.key === "kill_switch_engaged");
    expect(playbook.steps.length).toBeGreaterThanOrEqual(3);
  });

  it("holds a draft against what the brand never does", async () => {
    const clean = await apiJson("/api/governance/brand/check", {
      method: "POST", body: { text: "The round closed at a 30% step-up. The data room is open until Friday." },
    });
    expect(clean.body.data.clean).toBe(true);

    const hyped = await apiJson("/api/governance/brand/check", {
      method: "POST", body: { text: "Huge news! 🚀 This is going to be massive." },
    });
    expect(hyped.body.data.clean).toBe(false);
    expect(hyped.body.data.matches).toContain("Emoji in outbound work");
  });

  it("keeps what an incident taught", async () => {
    const { status, body } = await apiJson("/api/governance/learning", {
      method: "POST",
      body: {
        source_type: "incident", title: "Restores need rehearsing",
        lesson: "A backup nobody has restored is a hope, not a backup.",
      },
    });
    expect(status).toBe(201);
    const listing = await apiJson("/api/governance/learning");
    expect(listing.body.data[0].id).toBe(body.data.id);
  });
});

/**
 * The acceptance sentence, walked end to end.
 */
describe("Phase 19 — acceptance", () => {
  it("a protected action is refused under a high-risk state, recorded and explained; the sentinel flags the watch list", async () => {
    // Nothing is held before anything is recorded.
    expect((await apiJson("/api/governance/check/capital_allocation")).body.data.allowed).toBe(true);

    await recordState("grieving", "high", "A death in the family.");

    const { body: track } = await apiJson("/api/wealth/tracks", {
      method: "POST", body: { name: nextName("Venture"), target_allocation_bps: 2000 },
    });
    const refused = await apiJson("/api/wealth/allocations", {
      method: "POST", body: { track_id: track.data.id, amount_micros: 250_000 * USD, kind: "deployed" },
    });

    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/Not now/);
    expect(refused.body.error).toMatch(/grieving/);
    expect(refused.body.error).toMatch(/still be here/);
    expect(refused.body.hint).toMatch(/§18/);

    // Refused, and nothing moved.
    expect(await all(`SELECT id FROM capital_allocations`)).toHaveLength(0);

    // Recorded, with the action and the state on the flag.
    const flag = await row(`SELECT * FROM compliance_flags WHERE watch_key = 'protected_action_blocked'`);
    expect(flag).toBeTruthy();
    expect(JSON.parse(flag!.detail)).toMatchObject({ action_class: "capital_allocation", state: "grieving" });
    expect(await row(`SELECT action FROM audit_log WHERE action = 'protected_action_blocked'`)).toBeTruthy();

    // And the sentinel reports the whole watch list, flagging what is true.
    const sentinel = await apiJson("/api/governance/sentinel/run", { method: "POST", body: {} });
    expect(sentinel.body.data.checked).toBe(WATCH_LIST.length);
    const raised = sentinel.body.data.raised.map((r: any) => r.watch_key);
    expect(raised).toContain("high_risk_state");
    expect(raised).toContain("stale_vault");

    // The refusal's own flag is on the board beside the sentinel's, raised by
    // the gate rather than by a scan.
    const board = await apiJson("/api/governance/flags");
    expect(board.body.data.map((f: any) => f.watch_key)).toContain("protected_action_blocked");

    // Cleared, and the same allocation goes through.
    await api("/api/governance/state/clear", { method: "POST", body: {} });
    const allowed = await apiJson("/api/wealth/allocations", {
      method: "POST", body: { track_id: track.data.id, amount_micros: 250_000 * USD, kind: "deployed" },
    });
    expect(allowed.status).toBe(201);
  });
});
