import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { takeSnapshot } from "../../src/worker/boss/routes/vault";
import { apiJson, insertMemory, row, all } from "./helpers";

const post = (path: string, body?: unknown) => apiJson(path, { method: "POST", body: body ?? {} });

describe("Phase 3 — continuity vault", () => {
  it("writes a snapshot to R2 with a hash that verifies", async () => {
    const snapshot = await takeSnapshot(env, "test");
    expect(snapshot.bytes).toBeGreaterThan(0);

    const { status, body } = await apiJson(`/api/vault/snapshots/${snapshot.id}/verify`);
    expect(status).toBe(200);
    expect(body.data.sha_match).toBe(true);
    expect(body.data.parse.ok).toBe(true);
  });

  it("covers every table the system needs to be rebuilt", async () => {
    const snapshot = await takeSnapshot(env, "coverage");
    const counts = snapshot.counts;
    expect(Object.keys(counts)).toContain("approvals");
    expect(Object.keys(counts)).toContain("trading_authority");
    expect(Object.keys(counts)).toContain("evidence_packets");
    expect(Object.keys(counts)).toContain("permission_envelopes");
  });

  it("passes a restore drill end to end", async () => {
    const { status, body } = await post("/api/vault/drill");
    expect(status).toBe(200);
    expect(body.data.passed).toBe(true);
    expect(body.data.missing_tables).toEqual([]);
    expect(body.data.sha_match).toBe(true);
  });

  it("verifies a snapshot without writing anything", async () => {
    const memId = await insertMemory({ title: "Before verify" });
    const snapshot = await takeSnapshot(env, "verify-src");
    await env.DB.prepare(`DELETE FROM memory_items WHERE id = ?`).bind(memId).run();

    const { body } = await post("/api/vault/restore", { snapshot_id: snapshot.id, mode: "verify" });
    expect(body.data.status).toBe("verified");
    // verify must not resurrect anything
    expect(await row(`SELECT id FROM memory_items WHERE id = ?`, memId)).toBeNull();
  });

  it("restores a deleted row in merge mode", async () => {
    const memId = await insertMemory({ title: "Restore me" });
    const snapshot = await takeSnapshot(env, "merge-src");
    await env.DB.prepare(`DELETE FROM memory_items WHERE id = ?`).bind(memId).run();
    expect(await row(`SELECT id FROM memory_items WHERE id = ?`, memId)).toBeNull();

    const { status, body } = await post("/api/vault/restore", { snapshot_id: snapshot.id, mode: "merge" });
    expect(status).toBe(201);
    expect(body.data.status).toBe("applied");
    const restored = await row(`SELECT title FROM memory_items WHERE id = ?`, memId);
    expect(restored!.title).toBe("Restore me");
  });

  it("leaves existing rows untouched in merge mode", async () => {
    const memId = await insertMemory({ title: "Original" });
    const snapshot = await takeSnapshot(env, "merge-keep");
    await env.DB.prepare(`UPDATE memory_items SET title = 'Edited since' WHERE id = ?`).bind(memId).run();

    await post("/api/vault/restore", { snapshot_id: snapshot.id, mode: "merge" });
    expect((await row(`SELECT title FROM memory_items WHERE id = ?`, memId))!.title).toBe("Edited since");
  });

  it("refuses a replace without the explicit confirmation", async () => {
    const snapshot = await takeSnapshot(env, "replace-guard");
    const { status, body } = await post("/api/vault/restore", { snapshot_id: snapshot.id, mode: "replace" });
    expect(status).toBe(409);
    expect(body.hint).toContain("REPLACE");
  });

  it("rejects a payload whose hash does not match and writes nothing", async () => {
    const { status, body } = await post("/api/vault/restore", {
      payload: JSON.stringify({ tables: { lanes: [] } }),
      sha256: "0".repeat(64),
      mode: "merge",
    });
    expect(status).toBe(422);
    expect(body.error).toContain("Integrity check failed");

    const failed = await row(`SELECT status FROM vault_restores ORDER BY ts DESC LIMIT 1`);
    expect(failed!.status).toBe("failed");
  });

  it("rejects a file that is not a snapshot at all", async () => {
    const { status, body } = await post("/api/vault/restore", { payload: "not json", mode: "verify" });
    expect(status).toBe(422);
    expect(body.error).toContain("not valid JSON");
  });

  it("replaces a fully populated database without tripping a foreign key", async () => {
    // Build the whole graph: assessment → proposal → approval → employee →
    // task → envelope → evidence, plus an order and its approval. This is the
    // shape that would break a naive restore ordering.
    const assessment = await post("/api/intake/assessments", {
      request: "Rebuild my recovery practice for low energy days",
      recurring: true, distinct_domain: true, permission_sensitive: true,
      memory_boundary: true, risk_bearing: true,
    });
    await post("/api/intake/proposals", {
      name: "Recovery Coach", role: "Coaching", purpose: "Recovery coaching",
      duties: ["coach"], permissions: {}, memory_boundary: "ops only",
      approval_rules: "always", model_policy: "route default",
      success_criteria: "s", retirement_criteria: "r",
      assessment_id: assessment.body.data.id,
    });
    await post("/api/tasks", { title: "Draft a summary of the quarter" });
    await post("/api/trading/orders", {
      account_id: "acct_paper", symbol: "BTC", side: "buy", qty: 1, ref_price: 50000,
    });
    await insertMemory({ title: "Survives a replace" });

    // Phase 13's chain joins the graph: organization → person → relationship →
    // meeting → brief and capture → follow-up → the open loop it raised. Every
    // link is a foreign key, and the loop belongs to a day.
    const org = await post("/api/relationships/organizations", { name: "Vault Test Partners", kind: "fund" });
    const person = await post("/api/relationships/people", {
      full_name: "Vault Test Person", role: "Partner", organization_id: org.body.data.id,
    });
    await post("/api/relationships", { person_id: person.body.data.id, strategic_importance: 70 });
    const meeting = await post("/api/relationships/meetings", {
      person_id: person.body.data.id, title: "Vault test meeting",
      purpose: "Prove continuity covers the relationship graph", scheduled_at: Date.now(),
    });
    await post(`/api/relationships/meetings/${meeting.body.data.id}/brief`);
    await post(`/api/relationships/meetings/${meeting.body.data.id}/capture`, {
      notes: "They asked for the memo.",
      commitments_made: [{ text: "Send the memo", due_at: Date.now() - 86_400_000 }],
    });
    await apiJson("/api/today");

    // Phase 14's chain: thesis → deal → decision → red team and prediction,
    // and entity → vehicle → track → allocation pointing at the decision.
    const thesis = await post("/api/investor/theses", {
      title: "Vault test thesis", statement: "It holds", invalidated_by: "It stops holding",
    });
    const deal = await post("/api/investor/deals", { name: "Vault test deal", thesis_id: thesis.body.data.id });
    const decision = await post("/api/investor/decisions", {
      title: "Vault test decision", context: "Prove continuity covers the investor graph",
      options: [{ option: "Invest" }, { option: "Pass" }], stakes: "high", deal_id: deal.body.data.id,
    });
    await post(`/api/investor/decisions/${decision.body.data.id}/red-team`, {
      ways_this_loses: ["a", "b", "c"], disconfirming_evidence: ["d"],
      walk_away_line: "e", verdict: "proceed",
    });
    const prediction = await post("/api/investor/predictions", {
      decision_id: decision.body.data.id, statement: "It closes", probability_bps: 6000,
      resolution_criteria: "Signed or not", resolves_at: Date.now() + 86_400_000,
    });
    await post(`/api/investor/decisions/${decision.body.data.id}/commit`, {
      chosen_option: "Invest", rationale: "The thesis holds",
    });
    await post(`/api/investor/predictions/${prediction.body.data.id}/resolve`, { outcome: "true" });

    const entity = await post("/api/wealth/entities", { name: "Vault Test Holdings", kind: "llc" });
    const vehicle = await post("/api/wealth/vehicles", {
      entity_id: entity.body.data.id, name: "Vault test SPV", kind: "spv", value_micros: 1_000_000,
    });
    const track = await post("/api/wealth/tracks", { name: "Vault test track", target_allocation_bps: 1000 });
    await post("/api/wealth/allocations", {
      track_id: track.body.data.id, vehicle_id: vehicle.body.data.id,
      decision_id: decision.body.data.id, amount_micros: 1_000_000, kind: "deployed",
    });

    // Phase 15's chain: a memory filed onto a surface, retired, and the manual
    // version generated from what was left.
    const filed = await insertMemory({ title: "Filed and promoted", tier: "working" });
    const retired = await insertMemory({ title: "Retired but kept", tier: "working" });
    await post("/api/knowledge/surfaces/lessons_learned/items", { item_id: filed });
    await post("/api/knowledge/surfaces/lessons_learned/items", { item_id: retired });
    await post(`/api/memory/${retired}/retire`, { reason: "Superseded" });
    await post("/api/knowledge/manual/generate", {});
    await post("/api/knowledge/exports", {});

    // Phase 16's chain: a manifestation with evidence, a ritual with a run, and
    // the computed almanac and day rows the Spirit screen materialises.
    const manifestation = await post("/api/spirit/manifestations", {
      title: "Vault test manifestation", statement: "It closes", first_action: "Do the first thing",
    });
    await post(`/api/spirit/manifestations/${manifestation.body.data.id}/evidence`, {
      kind: "action", description: "Did the first thing",
    });
    const ritual = await post("/api/spirit/rituals", { name: "Vault test ritual", cadence: "weekly", steps: ["Sit"] });
    await post(`/api/spirit/rituals/${ritual.body.data.id}/done`, {});
    await post("/api/spirit/contributions", { kind: "help", recipient: "Someone" });
    await post("/api/spirit/ancestors", { who: "Someone remembered", minutes: 10 });
    await post("/api/spirit/dreams", { body: "A dream" });
    await apiJson("/api/spirit/day");

    // Phases 17–23: a packet promoted into the library behind an approval, a
    // capability patched, a governance flag and a refused handoff, both
    // runtimes, a quant scorecard, and a sovereignty package with its drill.
    const packet = await post("/api/prompt/packets", { request: "Draft the investor update", tier: 1 });
    const promoted = await post(`/api/prompt/packets/${packet.body.data.packet.id}/promote`, { title: "Investor update" });
    await post(`/api/approvals/${promoted.body.data.approval_id}/decide`, { decision: "approved", note: "Keep it." });

    await post("/api/capability/patches", {
      capability_key: "prompt_compiler", changes: { benchmark_score: 70 }, reason: "First benchmark.",
    });
    await post("/api/capability/discovery", { trigger: "high_value", note: "Worth a look at the alternative." });
    await post("/api/capability/reviews/run", { job_type: "research" });

    await post("/api/governance/state", { state: "steady", risk_class: "low", hours: 2 });
    await post("/api/governance/sentinel/run", {});
    await post("/api/governance/learning", { title: "Restores need rehearsing", lesson: "A backup nobody restored is a hope." });
    await post("/api/governance/ip", { name: "Boss OS", kind: "trademark", renewal_at: Date.now() + 86_400_000 });

    const document = await post("/api/runtimes/compiler/run", {
      name: "vault-test", title: "Vault test document",
      sections: [{ key: "s", title: "Section", source: "supplied", text: "Some words to audit later." }],
    });
    await post("/api/runtimes/seo/run", { artifact_id: document.body.data.artifactId, questions: ["What is this?"] });

    await post("/api/bridge/handoffs", {
      direction: "outbound", category: "personal_health", title: "Refused on purpose",
      summary: "Should not cross.", payload_ref: "external:nope", payload_kind: "external",
    }).catch(() => {});

    const strategy = await post("/api/trading/strategies", {
      name: "Vault test strategy", thesis: "A spread that closes", market: "crypto",
      timeframe: "intraday", risk_controls: "Post-only limits",
    });
    await post("/api/quant/scorecards", {
      strategy_id: strategy.body.data.id, stage_from: "research", stage_to: "backtest",
      criteria: [{ key: "hypothesis", requirement: "Written", observed: "Written", met: true }],
    });
    await post("/api/quant/engines/eng_primary/kill-switch-probe", {});

    const pkg = await post("/api/continuity/packages", {});
    await post("/api/continuity/drill", { package_id: pkg.body.data.id });

    const snapshot = await takeSnapshot(env, "fk-graph");
    const { status, body } = await post("/api/vault/restore", {
      snapshot_id: snapshot.id, mode: "replace", confirm: "REPLACE",
    });

    expect(status).toBe(201);
    expect(body.data.status).toBe("applied");
    expect(body.data.applied.approvals).toBeGreaterThan(0);
    expect(body.data.applied.agent_proposals).toBeGreaterThan(0);
    expect(body.data.applied.trading_orders).toBeGreaterThan(0);
    expect(body.data.applied.tasks).toBeGreaterThan(0);
    expect(body.data.applied.relationships).toBeGreaterThan(0);
    expect(body.data.applied.meeting_briefs).toBeGreaterThan(0);
    expect(body.data.applied.meeting_captures).toBeGreaterThan(0);
    expect(body.data.applied.follow_ups).toBeGreaterThan(0);
    expect(body.data.applied.decisions).toBeGreaterThan(0);
    expect(body.data.applied.predictions).toBeGreaterThan(0);
    expect(body.data.applied.red_team_reviews).toBeGreaterThan(0);
    expect(body.data.applied.calibrations).toBeGreaterThan(0);
    expect(body.data.applied.capital_allocations).toBeGreaterThan(0);
    expect(body.data.applied.knowledge_items).toBeGreaterThan(0);
    expect(body.data.applied.knowledge_retirements).toBeGreaterThan(0);
    expect(body.data.applied.manual_versions).toBeGreaterThan(0);
    expect(body.data.applied.knowledge_surfaces).toBe(12);
    expect(body.data.applied.manifestations).toBeGreaterThan(0);
    expect(body.data.applied.manifestation_evidence).toBeGreaterThan(0);
    expect(body.data.applied.ritual_runs).toBeGreaterThan(0);
    expect(body.data.applied.astro_calendar).toBeGreaterThan(0);
    expect(body.data.applied.astro_days).toBeGreaterThan(0);
    expect(body.data.applied.prompt_packets).toBeGreaterThan(0);
    expect(body.data.applied.prompt_library).toBeGreaterThan(0);
    expect(body.data.applied.capability_patches).toBeGreaterThan(0);
    expect(body.data.applied.after_action_reviews).toBeGreaterThan(0);
    expect(body.data.applied.compliance_flags).toBeGreaterThan(0);
    expect(body.data.applied.emotional_states).toBeGreaterThan(0);
    expect(body.data.applied.ip_assets).toBeGreaterThan(0);
    expect(body.data.applied.learning_entries).toBeGreaterThan(0);
    expect(body.data.applied.runtime_jobs).toBeGreaterThan(0);
    expect(body.data.applied.document_artifacts).toBeGreaterThan(0);
    expect(body.data.applied.seo_audits).toBeGreaterThan(0);
    expect(body.data.applied.bridge_handoffs).toBeGreaterThan(0);
    expect(body.data.applied.promotion_scorecards).toBeGreaterThan(0);
    expect(body.data.applied.kill_switch_probes).toBeGreaterThan(0);
    expect(body.data.applied.sovereignty_packages).toBeGreaterThan(0);
    expect(body.data.applied.sovereignty_drills).toBeGreaterThan(0);

    // Every table came back with the row count the snapshot recorded. The two
    // journals the restore itself writes to are checked for "at least", since
    // recording the restore is the correct behaviour.
    const journals = new Set(["audit_log", "system_events"]);
    for (const [table, count] of Object.entries(snapshot.counts)) {
      if (!count) continue;
      const after = await row(`SELECT COUNT(*) AS n FROM ${table}`);
      if (journals.has(table)) {
        expect(after!.n).toBeGreaterThanOrEqual(count);
      } else {
        expect(`${table}=${after!.n}`).toBe(`${table}=${count}`);
      }
    }
  });

  it("records every restore attempt, successful or not", async () => {
    const before = (await all(`SELECT id FROM vault_restores`)).length;
    const snapshot = await takeSnapshot(env, "history");
    await post("/api/vault/restore", { snapshot_id: snapshot.id, mode: "verify" });
    await post("/api/vault/restore", { payload: "broken", mode: "verify" });
    const after = (await all(`SELECT id FROM vault_restores`)).length;
    expect(after).toBe(before + 2);
  });
});
