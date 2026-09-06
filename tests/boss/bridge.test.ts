import { describe, expect, it } from "vitest";
import { all, api, apiJson, row } from "./helpers";
import { FORBIDDEN_CATEGORIES, checkCategory } from "../../src/worker/boss/bridge/categories";
import { CHASSIS_FIRM_TABLES } from "./chassisTables";

/**
 * Phase 21 — the Firm OS bridge and separation.
 *
 * Acceptance: a forbidden-category handoff is refused at the boundary, in both
 * directions, proven by test. The rest of this file tries the other ways round
 * it — an unknown category, a private memory under an allowed category, and an
 * approval that arrives after the rules changed.
 */

let seq = 0;
const nextTitle = (label: string) => `${label} ${(seq++).toString().padStart(3, "0")}`;

async function propose(over: Record<string, unknown> = {}) {
  return apiJson("/api/bridge/handoffs", {
    method: "POST",
    body: {
      direction: "outbound",
      category: "deliverable",
      title: nextTitle("A deliverable"),
      summary: "The finished report, by reference.",
      payload_ref: "external:dropbox/report.pdf",
      payload_kind: "external",
      ...over,
    },
  });
}

describe("Phase 21 — the forbidden list", () => {
  it("refuses every forbidden category in both directions", async () => {
    for (const forbidden of FORBIDDEN_CATEGORIES) {
      for (const direction of ["outbound", "inbound"] as const) {
        const verdict = checkCategory(forbidden.key, direction);
        expect(verdict.allowed).toBe(false);
        expect(verdict.reason).toContain("never crosses the firm boundary");
      }
    }
    expect(FORBIDDEN_CATEGORIES.length).toBeGreaterThanOrEqual(10);
  });

  it("refuses an unknown category rather than waving it through", () => {
    const verdict = checkCategory("something_new", "outbound");
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/allowlist/);
  });

  it("publishes both lists and says why the forbidden one is in code", async () => {
    const { body } = await apiJson("/api/bridge/categories");
    expect(body.data.allowed.length).toBeGreaterThanOrEqual(5);
    expect(body.data.forbidden.length).toBe(FORBIDDEN_CATEGORIES.length);
    for (const item of body.data.forbidden) expect(item.reason).toBeTruthy();
    expect(body.data.rule).toMatch(/edit at 2am/);
  });

  it("answers what would happen without proposing anything", async () => {
    const before = (await all(`SELECT id FROM bridge_handoffs`)).length;
    const { body } = await apiJson("/api/bridge/check/outbound/personal_health");
    expect(body.data.allowed).toBe(false);
    expect((await all(`SELECT id FROM bridge_handoffs`)).length).toBe(before);
  });
});

describe("Phase 21 — refusals at the boundary", () => {
  it("refuses a forbidden outbound handoff, records it, and raises nothing to approve", async () => {
    const { status, body } = await propose({
      direction: "outbound",
      category: "personal_health",
      title: "Latest bloodwork",
      summary: "Results from the annual check.",
      payload_ref: "external:health/2026-06.pdf",
    });

    expect(status).toBe(409);
    expect(body.error).toMatch(/never crosses the firm boundary/);
    expect(body.error).toMatch(/no business in it/);

    const handoff = await row(`SELECT * FROM bridge_handoffs WHERE category = 'personal_health'`);
    expect(handoff!.status).toBe("refused");
    expect(handoff!.approval_id).toBeNull();
    expect(handoff!.refusal_reason).toBeTruthy();

    // Nothing to decide: a refused category never reaches the inbox.
    expect(await all(`SELECT id FROM approvals WHERE kind = 'bridge_handoff'`)).toHaveLength(0);

    // And it is on the compliance board.
    const flag = await row(`SELECT * FROM compliance_flags WHERE watch_key = 'bridge_refusal'`);
    expect(flag!.subject_id).toBe(handoff!.id);
    expect(await row(`SELECT event FROM system_events WHERE event = 'handoff_refused'`)).toBeTruthy();
  });

  it("refuses a forbidden inbound handoff too", async () => {
    const { status, body } = await propose({
      direction: "inbound",
      category: "client_pii",
      title: "Client contact list",
      summary: "Names and numbers from the engagement.",
      payload_ref: "external:firm/clients.csv",
    });

    expect(status).toBe(409);
    expect(body.error).toMatch(/personal data does not belong in a personal system/);

    const handoff = await row(`SELECT * FROM bridge_handoffs WHERE category = 'client_pii'`);
    expect(handoff!.direction).toBe("inbound");
    expect(handoff!.status).toBe("refused");
  });

  it("refuses an unknown category from either side", async () => {
    for (const direction of ["outbound", "inbound"] as const) {
      const { status, body } = await propose({ direction, category: "misc" });
      expect(status).toBe(409);
      expect(body.error).toMatch(/not on the approved list/);
    }
    expect((await all(`SELECT id FROM bridge_handoffs WHERE status = 'refused'`)).length).toBe(2);
  });

  it("refuses a private or restricted memory even under an allowed category", async () => {
    const { body: restricted } = await apiJson("/api/memory", {
      method: "POST", body: { title: "Private note", body: "Not for anyone.", sensitivity: "restricted" },
    });
    const refused = await propose({
      category: "deliverable", payload_kind: "memory", payload_ref: restricted.data.id,
      title: "A note", summary: "Sending a memory across.",
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/restricted content does not leave the system/i);

    const { body: privateItem } = await apiJson("/api/memory", {
      method: "POST", body: { title: "Ordinary note", body: "Default classification." },
    });
    const alsoRefused = await propose({
      category: "deliverable", payload_kind: "memory", payload_ref: privateItem.data.id,
      title: "Another note", summary: "Sending a private memory.",
    });
    expect(alsoRefused.status).toBe(409);
    expect(alsoRefused.body.error).toMatch(/classed private/);

    // The refusals are recorded with the check that caught them.
    const flags = await all(`SELECT * FROM compliance_flags WHERE watch_key = 'bridge_refusal'`);
    expect(flags.length).toBe(2);
    expect(flags[0].severity).toBe("high");
  });

  it("carries an internal memory once it is classified for it", async () => {
    const { body: memory } = await apiJson("/api/memory", {
      method: "POST", body: { title: "Scope note", body: "What the engagement covers.", sensitivity: "internal" },
    });
    const { status, body } = await propose({
      category: "engagement_scope", payload_kind: "memory", payload_ref: memory.data.id,
      title: "Scope", summary: "The agreed scope, by reference.",
    });
    expect(status).toBe(201);
    expect(body.data.checks.some((c: any) => c.key === "payload_sensitivity" && c.passed)).toBe(true);
  });

  it("refuses a reference to something that does not exist", async () => {
    const { status } = await propose({ payload_kind: "memory", payload_ref: "mem_nope" });
    expect(status).toBe(400);
  });
});

describe("Phase 21 — an approved crossing", () => {
  it("proposes rather than crosses, and the firm cannot approve its own request", async () => {
    const { status, body } = await propose({ title: "Q3 report", summary: "The finished report, by reference." });
    expect(status).toBe(201);
    expect(body.data.handoff.status).toBe("proposed");
    expect(body.data.note).toMatch(/cannot approve its own request/);

    const approval = await row(`SELECT * FROM approvals WHERE id = ?`, body.data.approval_id);
    expect(approval!.kind).toBe("bridge_handoff");
    expect(approval!.status).toBe("pending");

    const decided = await apiJson(`/api/approvals/${body.data.approval_id}/decide`, {
      method: "POST", body: { decision: "approved", note: "Fine to send." },
    });
    expect(decided.body.data.execution.status).toBe("executed");

    const crossed = await row(`SELECT * FROM bridge_handoffs WHERE id = ?`, body.data.handoff.id);
    expect(crossed!.status).toBe("crossed");
    expect(crossed!.crossed_at).toBeGreaterThan(0);
  });

  it("does not cross when the approval is refused", async () => {
    const { body } = await propose({ title: "Draft memo" });
    await api(`/api/approvals/${body.data.approval_id}/decide`, {
      method: "POST", body: { decision: "rejected", note: "Not this one." },
    });

    const handoff = await row(`SELECT status, refusal_reason FROM bridge_handoffs WHERE id = ?`, body.data.handoff.id);
    expect(handoff!.status).toBe("rejected");
    expect(handoff!.refusal_reason).toMatch(/Not this one/);
  });

  it("re-checks the category at the moment of crossing", async () => {
    const { body } = await propose({ title: "Something to send" });
    // The row is tampered with between proposal and decision.
    await api("/api/system/audit").catch(() => {});
    const { env } = await import("cloudflare:test");
    await env.DB
      .prepare(`UPDATE bridge_handoffs SET category = 'personal_finance' WHERE id = ?`)
      .bind(body.data.handoff.id)
      .run();

    const decided = await apiJson(`/api/approvals/${body.data.approval_id}/decide`, {
      method: "POST", body: { decision: "approved" },
    });
    expect(decided.body.data.execution.status).toBe("failed");

    const handoff = await row(`SELECT status, refusal_reason FROM bridge_handoffs WHERE id = ?`, body.data.handoff.id);
    expect(handoff!.status).toBe("refused");
    expect(handoff!.refusal_reason).toMatch(/Re-checked at the moment of crossing/);
  });
});

describe("Phase 21 — separation is the default state", () => {
  it("states what keeps each dimension separate, and counts the exceptions", async () => {
    const { body } = await apiJson("/api/bridge/separation");
    const dimensions = body.data.separation.map((s: any) => s.dimension);
    // Canon's enumerated dimensions, governance and runtime environments included.
    for (const expected of [
      "Repositories", "Permissions", "Memory", "Governance", "Budgets",
      "Approvals", "Audit logs", "Deployment scopes", "Runtime environments",
    ]) {
      expect(dimensions).toContain(expected);
    }
    for (const item of body.data.separation) expect(item.kept_by).toBeTruthy();
    expect(body.data.note).toMatch(/Separation is the default state/);
    expect(body.data.crossings).toBe(0);
    expect(body.data.refusals).toBe(0);
  });

  /*
   * Canon: a separation claim that is not directly proven stays labelled
   * unproven rather than being rounded up. This repository can prove what it
   * does not contain; it cannot prove anything about the firm's deployment, and
   * the disclosure has to say which is which.
   */
  it("labels every dimension with what actually backs it", async () => {
    const { body } = await apiJson("/api/bridge/separation");
    const valid = ["locally_enforced", "locally_absent", "externally_unproven"];
    for (const item of body.data.separation) {
      expect(valid).toContain(item.proof);
      // Anything not locally enforced has to say why it falls short of proof.
      if (item.proof !== "locally_enforced") {
        if (item.unproven_because) expect(item.unproven_because.length).toBeGreaterThan(20);
      }
    }
  });

  it("does not round a cross-system claim up to proven", async () => {
    const { body } = await apiJson("/api/bridge/separation");
    const byDimension = Object.fromEntries(body.data.separation.map((s: any) => [s.dimension, s]));

    // The firm's runtime is not in this repository and cannot be inspected.
    expect(byDimension["Runtime environments"].proof).toBe("externally_unproven");
    expect(body.data.externally_unproven).toContain("Runtime environments");

    // Repositories and deployment scopes are proven by absence, not asserted as
    // facts about the other system.
    expect(byDimension["Repositories"].proof).toBe("locally_absent");
    expect(byDimension["Repositories"].unproven_because).toMatch(/another repository/);
    expect(byDimension["Deployment scopes"].proof).toBe("locally_absent");

    // The boundary the code really does enforce is still claimed as enforced.
    expect(byDimension["Memory"].proof).toBe("locally_enforced");
    expect(byDimension["Governance"].proof).toBe("locally_enforced");
    expect(byDimension["Approvals"].proof).toBe("locally_enforced");

    expect(body.data.proven_locally).toBe(body.data.separation.length - body.data.externally_unproven.length);
    expect(body.data.note).toMatch(/is not evidence that two systems are separate/);
  });

  /**
   * Phase 21's premise is that the bridge is the only thing here that knows the firm exists.
   * Cloning the West Peek chassis broke that: four firm_* tables now sit in the same database.
   *
   * The invariant is NOT relaxed to "some firm tables are fine". The four are named, and any
   * fifth fails this test - so the breach cannot quietly widen while the fund domain is being
   * removed, and the day the last one goes this returns to asserting an empty set on its own.
   */
  it("keeps no firm tables beyond the ones the clone brought in", async () => {
    const tables = await all(`SELECT name FROM sqlite_master WHERE type = 'table'`);
    const names = tables.map((t: any) => t.name);
    expect(names.length).toBeGreaterThan(0);
    const firm = names.filter((n: string) => n.startsWith("firm_")).sort();
    expect(firm).toEqual([...CHASSIS_FIRM_TABLES].sort());
    expect(names).toContain("bridge_handoffs");
  });
});

/**
 * The acceptance sentence, in both directions.
 */
describe("Phase 21 — acceptance", () => {
  it("a forbidden-category handoff is refused at the boundary, outbound and inbound", async () => {
    const outbound = await propose({
      direction: "outbound",
      category: "journal",
      title: "This week's journal",
      summary: "Reflections from the week.",
      payload_ref: "external:journal/2026-w33",
    });
    expect(outbound.status).toBe(409);
    expect(outbound.body.error).toMatch(/never crosses/);

    const inbound = await propose({
      direction: "inbound",
      category: "client_confidential",
      title: "Client strategy deck",
      summary: "Their internal plan.",
      payload_ref: "external:firm/client-deck",
    });
    expect(inbound.status).toBe(409);
    expect(inbound.body.error).toMatch(/never crosses/);

    // Both refusals are recorded, with their direction, and neither reached the inbox.
    const refused = await all(`SELECT direction, category, status, approval_id FROM bridge_handoffs WHERE status = 'refused'`);
    expect(refused.map((r: any) => r.direction).sort()).toEqual(["inbound", "outbound"]);
    for (const r of refused) expect(r.approval_id).toBeNull();
    expect(await all(`SELECT id FROM approvals WHERE kind = 'bridge_handoff'`)).toHaveLength(0);

    // An allowed category still goes through the inbox, and only then crosses.
    const allowed = await propose({ category: "invoice_reference", title: "Invoice 118", summary: "Reference only." });
    expect(allowed.status).toBe(201);
    expect(allowed.body.data.handoff.status).toBe("proposed");
    await api(`/api/approvals/${allowed.body.data.approval_id}/decide`, { method: "POST", body: { decision: "approved" } });
    expect(await row(`SELECT status FROM bridge_handoffs WHERE id = ?`, allowed.body.data.handoff.id)).toMatchObject({ status: "crossed" });

    const separation = await apiJson("/api/bridge/separation");
    expect(separation.body.data.crossings).toBe(1);
    expect(separation.body.data.refusals).toBe(2);
  });
});
