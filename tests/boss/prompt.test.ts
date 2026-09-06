import { describe, expect, it } from "vitest";
import { all, api, apiJson, insertTask, row } from "./helpers";
import { TIER_1_TRIGGERS, compilePacket, detectTriggers, scorePacket } from "../src/server/prompt/compile";
import { PEDESTAL_NAMES } from "../src/server/routes/prompt";

/**
 * Phase 17 — Prompt Intelligence and the Mastery Lens Bench.
 *
 * Acceptance: a rough request produces a Tier-1 packet with a lens stack, a
 * counter-lens and a score; and no prompt enters the library without review.
 * The canon rules around that — the trigger list, the No Pedestal Law, the
 * single ledger — are tested by trying to break them.
 */

let seq = 0;
const nextTitle = (label: string) => `${label} ${(seq++).toString().padStart(3, "0")}`;

async function compile(body: Record<string, unknown>) {
  const { status, body: response } = await apiJson("/api/prompt/packets", { method: "POST", body });
  expect(status).toBe(201);
  return response.data as any;
}

describe("Phase 17 — the bench", () => {
  it("ships the initial lenses across canon's categories", async () => {
    const { status, body } = await apiJson("/api/prompt/lenses");
    expect(status).toBe(200);
    expect(body.data.lenses.length).toBeGreaterThanOrEqual(15);
    expect(body.data.lenses.length).toBeLessThanOrEqual(20);
    expect(body.data.categories.length).toBeGreaterThanOrEqual(6);

    for (const lens of body.data.lenses) {
      expect(lens.method.length).toBeGreaterThanOrEqual(3);
      expect(lens.questions.length).toBeGreaterThanOrEqual(1);
      expect(lens.failure_modes.length).toBeGreaterThanOrEqual(1);
      expect(lens.origin).toBeTruthy();
      expect([1, 2, 3]).toContain(lens.tier_minimum);
    }
  });

  it("carries the nineteen-field schema canon specifies", async () => {
    const columns = await all(`PRAGMA table_info(mastery_lenses)`);
    const names = columns.map((c: any) => c.name);
    // Nineteen content fields, plus id and the two timestamps.
    expect(names.length).toBe(22);
    for (const field of [
      "key", "name", "category", "summary", "method", "questions", "moves", "failure_modes",
      "counter_lens_key", "best_for", "avoid_for", "tier_minimum", "risk_posture",
      "evidence_required", "output_shape", "origin", "status", "review_note", "version",
    ]) {
      expect(names).toContain(field);
    }
  });

  it("gives every lens something that argues with it", async () => {
    const { body } = await apiJson("/api/prompt/lenses");
    const keys = new Set(body.data.lenses.map((l: any) => l.key));
    for (const lens of body.data.lenses) {
      expect(lens.counter_lens_key).toBeTruthy();
      expect(keys).toContain(lens.counter_lens_key);
      expect(lens.counter_lens_key).not.toBe(lens.key);
    }
  });

  it("keeps the No Pedestal Law: no lens is named for a person", async () => {
    const { body } = await apiJson("/api/prompt/lenses");
    const text = body.data.lenses.map((l: any) => `${l.name} ${l.origin}`).join(" ").toLowerCase();
    for (const name of PEDESTAL_NAMES) expect(text).not.toContain(name);
    expect(body.data.law.key).toBe("no_pedestal");

    const named = await apiJson("/api/prompt/lenses", {
      method: "POST",
      body: {
        key: "munger_inversion", name: "Munger Inversion", origin: "Munger", summary: "Invert",
        method: ["a", "b", "c"], questions: ["q"], moves: ["m"], failure_modes: ["f"], output_shape: "x",
      },
    });
    expect(named.status).toBe(400);
    expect(named.body.error).toMatch(/No Pedestal Law/);

    const possessive = await apiJson("/api/prompt/lenses", {
      method: "POST",
      body: {
        key: "someones_lens", name: "Ackman's Screen", origin: "activist investing", summary: "Screen",
        method: ["a", "b", "c"], questions: ["q"], moves: ["m"], failure_modes: ["f"], output_shape: "x",
      },
    });
    expect(possessive.status).toBe(400);
    expect(possessive.body.hint).toMatch(/possessive is the tell/);

    const attributed = await apiJson("/api/prompt/lenses", {
      method: "POST",
      body: {
        key: "attributed", name: "Constraint Walk", origin: "operations research", summary: "Walk the constraints",
        method: ["a", "b", "c"], questions: ["q"], moves: ["m"], failure_modes: ["f"], output_shape: "x",
        named_after: "Someone Famous",
      },
    });
    expect(attributed.status).toBe(400);
    expect(attributed.body.hint).toMatch(/no field for whose lens/i);
  });

  it("takes a real method onto the bench", async () => {
    const { status, body } = await apiJson("/api/prompt/lenses", {
      method: "POST",
      body: {
        key: nextTitle("pre_mortem").replace(/\s+/g, "_"),
        name: "Pre-Mortem", category: "risk", origin: "project management practice",
        summary: "Assume it failed and explain why.",
        method: ["Assume failure", "Write the post-mortem", "Fix the top cause now"],
        questions: ["Why did this fail?"], moves: ["Adds a pre-mortem section"],
        failure_modes: ["Manufactures pessimism"], output_shape: "Failure story, then mitigations.",
        best_for: ["engineering"], tier_minimum: 2,
      },
    });
    expect(status).toBe(201);
    expect(body.data.status).toBe("active");
  });

  it("refuses a lens with a method that is not a method", async () => {
    const { status } = await apiJson("/api/prompt/lenses", {
      method: "POST",
      body: {
        key: "thin", name: "Think Harder", origin: "vibes", summary: "Think about it",
        method: ["Think"], questions: ["?"], moves: ["m"], failure_modes: ["f"], output_shape: "x",
      },
    });
    expect(status).toBe(400);
  });
});

describe("Phase 17 — canon §76.3, the tier is not a preference", () => {
  it("detects every trigger canon lists", () => {
    const cases: Record<string, string> = {
      repo_work: "Refactor the repository migration",
      investor_materials: "Draft the investor update for our LPs",
      outbound_email: "Write an email to the head of product",
      marketing: "Marketing copy for the launch",
      legal_adjacent: "Review this contract for liability",
      financial_decision: "Decide the capital allocation for the quarter",
      document_compiler: "Compile the quarterly document",
      private_data: "Summarise this medical record",
      external_action: "Publish the announcement",
      vendor_change: "Switch vendor for the storage contract",
      canonical_document: "Update the operating manual",
    };
    for (const [key, request] of Object.entries(cases)) {
      const hits = detectTriggers(request, null, "private");
      expect(hits.map((h) => h.key)).toContain(key);
    }
    expect(TIER_1_TRIGGERS).toHaveLength(11);
  });

  it("overrules a light pass on work canon says is always tier 1", async () => {
    const packet = await compile({
      request: "Quick note to the LPs about the quarter",
      tier: 3,
    });
    expect(packet.packet.tier).toBe(1);
    expect(packet.packet.tier_reason).toMatch(/overruled/);
    expect(packet.packet.triggers.map((t: any) => t.key)).toContain("investor_materials");
  });

  it("treats restricted sensitivity as private-data work", async () => {
    const packet = await compile({ request: "Summarise these notes", sensitivity: "restricted" });
    expect(packet.packet.tier).toBe(1);
    expect(packet.packet.triggers.map((t: any) => t.key)).toContain("private_data");
  });

  it("leaves ordinary work at the tier that was asked for", async () => {
    const packet = await compile({ request: "Suggest three names for a houseplant", tier: 3 });
    expect(packet.packet.tier).toBe(3);
    expect(packet.packet.triggers).toEqual([]);
    expect(packet.packet.lens_stack).toHaveLength(1);
    expect(packet.packet.pov_card_keys).toHaveLength(0);
  });

  it("previews the decision without storing anything", async () => {
    const before = (await all(`SELECT id FROM prompt_packets`)).length;
    const { body } = await apiJson("/api/prompt/preview", {
      method: "POST", body: { request: "Draft the vendor renewal email" },
    });
    expect(body.data.tier).toBe(1);
    expect(body.data.triggers.length).toBeGreaterThanOrEqual(2);
    expect((await all(`SELECT id FROM prompt_packets`)).length).toBe(before);
  });
});

describe("Phase 17 — compilation", () => {
  it("turns a rough request into a packet with a stack, a counter-lens and a score", async () => {
    const result = await compile({
      request: "help me decide whether to lead this round",
      task_kind: "decision_support",
    });

    const { packet, score } = result;
    expect(packet.tier).toBe(1);
    expect(packet.lens_stack.length).toBe(4);
    expect(packet.counter_lens_key).toBeTruthy();
    expect(packet.lens_stack).not.toContain(packet.counter_lens_key);
    expect(packet.pov_card_keys.length).toBe(2);

    expect(packet.compiled_prompt).toContain("METHOD");
    expect(packet.compiled_prompt).toContain("COUNTER-CHECK");
    expect(packet.compiled_prompt).toContain("OUTPUT CONTRACT");
    expect(packet.compiled_prompt).toContain("REFUSALS");
    expect(packet.compiled_prompt).not.toMatch(/TODO|FIXME|placeholder/i);

    expect(score.total).toBeGreaterThan(0);
    expect(score.total).toBeLessThanOrEqual(score.max_total);
    expect(score.dimensions.find((d: any) => d.key === "counter_lens").points).toBeGreaterThan(0);
    for (const dimension of score.dimensions) expect(dimension.why).toBeTruthy();

    const stored = await row(`SELECT * FROM prompt_packets WHERE id = ?`, packet.id);
    expect(stored!.tier).toBe(1);
    const storedScore = await row(`SELECT * FROM prompt_scores WHERE packet_id = ?`, packet.id);
    expect(storedScore!.total).toBe(score.total);
  });

  it("compiles the same request the same way twice", async () => {
    const first = await compile({ request: "Draft the contract summary", task_kind: "legal" });
    const second = await compile({ request: "Draft the contract summary", task_kind: "legal" });
    expect(second.packet.lens_stack).toEqual(first.packet.lens_stack);
    expect(second.packet.counter_lens_key).toBe(first.packet.counter_lens_key);
    expect(second.score.total).toBe(first.score.total);
  });

  it("scores a thin packet below a full one", () => {
    const lenses = [
      {
        key: "a", name: "A", category: "product", summary: "s", method: '["1","2","3"]', questions: '["q"]',
        moves: '["m"]', failure_modes: '["f"]', counter_lens_key: "b", best_for: "[]", avoid_for: "[]",
        tier_minimum: 3, risk_posture: "balanced", evidence_required: 0, output_shape: "o", origin: "x", status: "active",
      },
      {
        key: "b", name: "B", category: "risk", summary: "s", method: '["1","2","3"]', questions: '["q"]',
        moves: '["m"]', failure_modes: '["f"]', counter_lens_key: "a", best_for: "[]", avoid_for: "[]",
        tier_minimum: 1, risk_posture: "balanced", evidence_required: 1, output_shape: "o", origin: "x", status: "active",
      },
    ];
    const povs = [{ key: "p", name: "P", stance: "s", wants: "[]", fears: "[]", questions: '["q"]', tier_minimum: 1 }];

    const light = scorePacket(compilePacket({ request: "short one", requestedTier: 3 }, lenses, povs, "text"));
    const full = scorePacket(
      compilePacket(
        { request: "A much longer request with real detail about what is needed and why it matters here", requestedTier: 1 },
        lenses, povs, "text",
      ),
    );
    expect(full.total).toBeGreaterThan(light.total);
  });

  it("links the trace to the ledgers that already exist", async () => {
    const taskId = await insertTask({ title: "A routed task" });
    const packet = await compile({ request: "Write the release notes", task_id: taskId });

    const traces = await all(`SELECT * FROM prompt_traces WHERE packet_id = ?`, packet.packet.id);
    expect(traces).toHaveLength(1);
    expect(traces[0].task_id).toBe(taskId);

    const listing = await apiJson("/api/prompt/traces");
    expect(listing.body.data.note).toMatch(/adds no third ledger/);
    expect(listing.body.data.traces.some((t: any) => t.packet_id === packet.packet.id)).toBe(true);
  });

  it("refuses a packet pointing at a task that does not exist", async () => {
    const { status } = await apiJson("/api/prompt/packets", {
      method: "POST", body: { request: "Something", task_id: "tsk_nope" },
    });
    expect(status).toBe(400);
  });

  it("reads back the whole packet, including how it was scored", async () => {
    const compiled = await compile({ request: "Prepare the board memo on the fundraise" });
    const { body } = await apiJson(`/api/prompt/packets/${compiled.packet.id}`);
    expect(body.data.packet.sections.method.length).toBe(body.data.packet.lens_stack.length);
    expect(body.data.packet.sections.counter_check.lens).toBe(body.data.packet.counter_lens_key);
    expect(body.data.score.dimensions.length).toBeGreaterThanOrEqual(6);
    expect(body.data.library).toBeNull();
  });
});

describe("Phase 17 — canon §76.17, nothing enters the library without review", () => {
  it("proposes rather than promotes, and refuses use until it is approved", async () => {
    const compiled = await compile({ request: "Draft the standard investor update" });
    const { status, body } = await apiJson(`/api/prompt/packets/${compiled.packet.id}/promote`, {
      method: "POST", body: { title: "Investor update" },
    });
    expect(status).toBe(201);
    expect(body.data.library.status).toBe("proposed");
    expect(body.data.note).toMatch(/Proposed, not added/);

    const approval = await row(`SELECT * FROM approvals WHERE id = ?`, body.data.approval_id);
    expect(approval!.kind).toBe("prompt_library_promotion");
    expect(approval!.status).toBe("pending");

    const early = await apiJson(`/api/prompt/library/${body.data.library.id}/use`, { method: "POST", body: {} });
    expect(early.status).toBe(409);
    expect(early.body.hint).toMatch(/reviewed prompts only/);

    // Approving in the inbox is what admits it.
    const decided = await apiJson(`/api/approvals/${body.data.approval_id}/decide`, {
      method: "POST", body: { decision: "approved", note: "Good template." },
    });
    expect(decided.status).toBe(200);
    expect(decided.body.data.execution.status).toBe("executed");

    const entry = await row(`SELECT * FROM prompt_library WHERE id = ?`, body.data.library.id);
    expect(entry!.status).toBe("approved");
    expect(entry!.review_note).toMatch(/Good template/);

    const used = await apiJson(`/api/prompt/library/${body.data.library.id}/use`, { method: "POST", body: {} });
    expect(used.status).toBe(200);
    expect(used.body.data.uses).toBe(1);
  });

  it("closes the entry when the review says no", async () => {
    const compiled = await compile({ request: "Draft a cold outreach email" });
    const { body } = await apiJson(`/api/prompt/packets/${compiled.packet.id}/promote`, {
      method: "POST", body: { title: "Cold outreach" },
    });

    await api(`/api/approvals/${body.data.approval_id}/decide`, {
      method: "POST", body: { decision: "rejected", note: "Too generic to keep." },
    });

    const entry = await row(`SELECT status, review_note FROM prompt_library WHERE id = ?`, body.data.library.id);
    expect(entry!.status).toBe("rejected");
    expect(entry!.review_note).toMatch(/Too generic/);

    const use = await apiJson(`/api/prompt/library/${body.data.library.id}/use`, { method: "POST", body: {} });
    expect(use.status).toBe(409);
  });

  it("will not propose the same packet twice", async () => {
    const compiled = await compile({ request: "Draft the quarterly note" });
    await api(`/api/prompt/packets/${compiled.packet.id}/promote`, { method: "POST", body: { title: "Quarterly" } });
    const again = await apiJson(`/api/prompt/packets/${compiled.packet.id}/promote`, {
      method: "POST", body: { title: "Quarterly again" },
    });
    expect(again.status).toBe(409);
  });
});

/**
 * The acceptance sentence, walked end to end.
 */
describe("Phase 17 — acceptance", () => {
  it("a rough request becomes a Tier-1 packet with a stack, a counter-lens and a score, and the library stays gated", async () => {
    const rough = "should we put money into this deal";

    const { packet, score } = await compile({ request: rough });
    expect(packet.tier).toBe(1);
    expect(packet.triggers.map((t: any) => t.key)).toContain("financial_decision");
    expect(packet.lens_stack.length).toBe(4);
    expect(packet.counter_lens_key).toBeTruthy();
    expect(packet.lens_stack).not.toContain(packet.counter_lens_key);
    expect(score.total).toBeGreaterThan(50);

    // The packet names its method and where each lens came from — a discipline,
    // never a person.
    const detail = await apiJson(`/api/prompt/packets/${packet.id}`);
    for (const step of detail.body.data.packet.sections.method) {
      expect(step.origin).toBeTruthy();
      expect(PEDESTAL_NAMES.some((n) => step.origin.toLowerCase().includes(n))).toBe(false);
    }
    expect(detail.body.data.packet.sections.counter_check.questions.length).toBeGreaterThan(0);
    expect(detail.body.data.packet.sections.output_contract.must_include.length).toBeGreaterThanOrEqual(3);

    // And it cannot reach the library on its own.
    const promoted = await apiJson(`/api/prompt/packets/${packet.id}/promote`, {
      method: "POST", body: { title: "Deal decision packet" },
    });
    expect(promoted.body.data.library.status).toBe("proposed");
    const library = await apiJson("/api/prompt/library?status=approved");
    expect(library.body.data.some((l: any) => l.id === promoted.body.data.library.id)).toBe(false);
  });
});
