import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, api, apiJson, row, stubFetch } from "./helpers";
import { CHECKLIST_STEPS } from "../../src/worker/boss/continuity/documents";

/**
 * Phase 23 — continuity hardening.
 *
 * Acceptance: a documented restore drill completes from the offline package
 * alone. "Alone" is proven rather than asserted — the drill runs with global
 * fetch stubbed to throw, so anything reaching for the network would fail
 * loudly instead of passing quietly.
 */

const DAY = 86_400_000;

let seq = 0;
const nextTitle = (label: string) => `${label} ${(seq++).toString().padStart(3, "0")}`;

/** Puts something on an offline surface and generates the manual. */
async function seedKnowledge() {
  const { body: memory } = await apiJson("/api/memory", {
    method: "POST",
    body: { title: nextTitle("How the accounts are arranged"), body: "The standing facts.", sensitivity: "internal" },
  });
  await env.DB.prepare(`UPDATE memory_items SET tier = 'working' WHERE id = ?`).bind(memory.data.id).run();
  await api("/api/knowledge/surfaces/offline_library/items", { method: "POST", body: { item_id: memory.data.id } });
  await api("/api/knowledge/surfaces/lessons_learned/items", { method: "POST", body: { item_id: memory.data.id } });
  await api("/api/knowledge/manual/generate", { method: "POST", body: {} });
  return memory.data.id;
}

async function buildPackage() {
  const { status, body } = await apiJson("/api/continuity/packages", { method: "POST", body: {} });
  expect(status).toBe(201);
  return body.data;
}

describe("Phase 23 — the documents travel with the package", () => {
  it("publishes the runbook, the checklist and the initialization prompt", async () => {
    const runbook = await apiJson("/api/continuity/runbook");
    expect(runbook.body.data.markdown).toContain("Disaster recovery runbook");
    expect(runbook.body.data.markdown).toContain("External SSD workflow");
    expect(runbook.body.data.markdown).toContain("Offsite copy workflow");
    expect(runbook.body.data.markdown).toContain("Local model smoke test");
    expect(runbook.body.data.note).toMatch(/readable when this endpoint is not/);

    const checklist = await apiJson("/api/continuity/checklist");
    expect(checklist.body.data.steps).toHaveLength(CHECKLIST_STEPS.length);
    expect(checklist.body.data.markdown).toContain("- [ ]");

    const prompt = await apiJson("/api/continuity/initialization-prompt");
    expect(prompt.body.data.markdown).toContain("never seen Boss OS");
    expect(prompt.body.data.markdown).toContain("An absent input is recorded as absent");
  });
});

describe("Phase 23 — the sovereignty package", () => {
  it("carries the manual, the offline library and the approved prompts, each hashed", async () => {
    const memoryId = await seedKnowledge();

    const built = await buildPackage();
    expect(built.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(built.item_counts.documents).toBe(3);
    expect(built.item_counts.manual).toBe(1);
    expect(built.item_counts.offline_library).toBe(1);

    for (const entry of built.manifest.entries) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.title).toBeTruthy();
    }

    // It really is one readable file, and it really contains the knowledge.
    const object = await env.VAULT.get(built.r2_key);
    const payload = JSON.parse(await object!.text());
    expect(payload.manual.version).toBe(1);
    expect(payload.offline_library[0].id).toBe(memoryId);
    expect(payload.documents.disaster_recovery_runbook).toContain("Disaster recovery runbook");
    expect(payload.note).toMatch(/Restricted knowledge is deliberately absent/);
  });

  it("leaves restricted knowledge out of the package entirely", async () => {
    const { body: restricted } = await apiJson("/api/memory", {
      method: "POST", body: { title: "Restricted fact", body: "Never leaves.", sensitivity: "restricted" },
    });
    await env.DB.prepare(`UPDATE memory_items SET tier = 'working' WHERE id = ?`).bind(restricted.data.id).run();
    await api("/api/knowledge/surfaces/offline_library/items", { method: "POST", body: { item_id: restricted.data.id } });

    const built = await buildPackage();
    const object = await env.VAULT.get(built.r2_key);
    const text = await object!.text();
    expect(text).not.toContain("Restricted fact");
    expect(text).not.toContain("Never leaves.");
  });

  it("says what is missing rather than shipping a package that looks complete", async () => {
    const built = await buildPackage();
    const absent = built.manifest.absent.map((a: any) => a.kind);
    expect(absent).toContain("manual");
    expect(absent).toContain("offline_library");
    expect(built.note).toMatch(/missing from it/);

    const stored = await row(`SELECT status FROM sovereignty_packages WHERE id = ?`, built.id);
    expect(stored!.status).toBe("complete");
  });

  it("verifies, and refuses to verify a package that was altered", async () => {
    await seedKnowledge();
    const built = await buildPackage();

    const verified = await apiJson(`/api/continuity/packages/${built.id}/verify`);
    expect(verified.body.data.ok).toBe(true);
    expect((await row(`SELECT verified_at FROM sovereignty_packages WHERE id = ?`, built.id))!.verified_at).toBeGreaterThan(0);

    await env.VAULT.put(built.r2_key, "tampered");
    const again = await apiJson(`/api/continuity/packages/${built.id}/verify`);
    expect(again.body.data.ok).toBe(false);
    expect(again.body.data.reason).toMatch(/Use an older copy/);
  });

  it("hands the package over for copying to an SSD", async () => {
    await seedKnowledge();
    const built = await buildPackage();
    const { body } = await apiJson(`/api/continuity/packages/${built.id}/content`);
    expect(JSON.parse(body.data.content).package_version).toBe(1);
  });
});

describe("Phase 23 — the offline drill", () => {
  it("fails honestly when the package is incomplete", async () => {
    const built = await buildPackage();
    const { body } = await apiJson("/api/continuity/drill", { method: "POST", body: { package_id: built.id } });

    expect(body.data.passed).toBe(false);
    expect(body.data.failed_steps).toContain("manual_present");
    expect(body.data.failed_steps).toContain("offline_library");
    expect(body.data.note).toMatch(/did not complete/);

    // Every step still reports what it saw.
    for (const step of body.data.steps) expect(step.evidence).toBeTruthy();
  });

  it("fails when the package cannot be read, rather than reporting success", async () => {
    await seedKnowledge();
    const built = await buildPackage();
    await env.VAULT.delete(built.r2_key);

    const { body } = await apiJson("/api/continuity/drill", { method: "POST", body: { package_id: built.id } });
    expect(body.data.passed).toBe(false);
    expect(body.data.steps[0].evidence).toMatch(/not in R2/);
    expect(body.data.failed_steps.length).toBe(CHECKLIST_STEPS.length);
  });

  it("catches a tampered package through the item hashes", async () => {
    await seedKnowledge();
    const built = await buildPackage();

    const object = await env.VAULT.get(built.r2_key);
    const payload = JSON.parse(await object!.text());
    payload.offline_library[0].body = "Quietly changed.";
    await env.VAULT.put(built.r2_key, JSON.stringify(payload));

    const { body } = await apiJson("/api/continuity/drill", { method: "POST", body: { package_id: built.id } });
    expect(body.data.passed).toBe(false);
    expect(body.data.failed_steps).toContain("payload_hash");
    expect(body.data.failed_steps).toContain("item_hashes");
  });

  /*
   * The drill record is the one thing that has to be trustworthy when the rest
   * of the system is gone. A step that failed while its evidence line reads
   * "the runbook is in the package and readable" would be a false statement in
   * the only surviving record, so the evidence has to describe what was found.
   */
  it("says what it actually found when a document is missing from the package", async () => {
    await seedKnowledge();
    const built = await buildPackage();

    const object = await env.VAULT.get(built.r2_key);
    const payload = JSON.parse(await object!.text());
    delete payload.documents.disaster_recovery_runbook;
    payload.documents.initialization_prompt = "too short";
    await env.VAULT.put(built.r2_key, JSON.stringify(payload));

    const { body } = await apiJson("/api/continuity/drill", { method: "POST", body: { package_id: built.id } });
    expect(body.data.passed).toBe(false);
    expect(body.data.failed_steps).toContain("runbook_present");
    expect(body.data.failed_steps).toContain("initialization_prompt");

    const steps: { key: string; passed: boolean; evidence: string }[] = body.data.steps;
    const runbook = steps.find((s) => s.key === "runbook_present")!;
    expect(runbook.passed).toBe(false);
    expect(runbook.evidence).toMatch(/carries no disaster_recovery_runbook/);
    // The failing step must not describe the document as present.
    expect(runbook.evidence).not.toMatch(/is in the package and readable/);

    const initPrompt = steps.find((s) => s.key === "initialization_prompt")!;
    expect(initPrompt.passed).toBe(false);
    expect(initPrompt.evidence).toMatch(/too short to rebuild from/);
    expect(initPrompt.evidence).not.toMatch(/^The initialization prompt is in the package/);
  });

  it("describes the documents it did find, with their sizes", async () => {
    await seedKnowledge();
    const built = await buildPackage();
    const { body } = await apiJson("/api/continuity/drill", { method: "POST", body: { package_id: built.id } });

    const steps: { key: string; passed: boolean; evidence: string }[] = body.data.steps;
    expect(steps.find((s) => s.key === "runbook_present")!.evidence).toMatch(/readable \(\d+ characters\)/);
    expect(steps.find((s) => s.key === "initialization_prompt")!.evidence).toMatch(/\(\d+ characters\)/);
  });

  it("records every drill, passed or failed", async () => {
    await seedKnowledge();
    const built = await buildPackage();
    await api("/api/continuity/drill", { method: "POST", body: { package_id: built.id } });

    const drills = await apiJson("/api/continuity/drills");
    expect(drills.body.data.length).toBeGreaterThanOrEqual(1);
    expect(drills.body.data[0].steps.length).toBe(CHECKLIST_STEPS.length);
    expect(drills.body.data[0].mode).toBe("offline_only");
  });

  it("drills the newest package when none is named", async () => {
    await seedKnowledge();
    const built = await buildPackage();
    const { body } = await apiJson("/api/continuity/drill", { method: "POST", body: {} });
    expect(body.data.package_id).toBe(built.id);
  });

  it("refuses to drill when nothing has been built", async () => {
    const { status, body } = await apiJson("/api/continuity/drill", { method: "POST", body: {} });
    expect(status).toBe(400);
    expect(body.hint).toMatch(/Build one first/);
  });
});

describe("Phase 23 — the sovereignty status", () => {
  it("reports each component and what is still missing", async () => {
    const empty = await apiJson("/api/continuity");
    expect(empty.body.data.complete).toBe(false);
    expect(empty.body.data.missing).toContain("package");
    expect(empty.body.data.missing).toContain("offline_drill");
    expect(empty.body.data.verdict).toMatch(/missing/);
    expect(empty.body.data.note).toMatch(/physical acts this system cannot verify/);

    // The documents are always present; they ship with the code.
    const byKey = Object.fromEntries(empty.body.data.components.map((c: any) => [c.key, c]));
    expect(byKey.runbook.present).toBe(true);
    expect(byKey.restore_checklist.present).toBe(true);
    expect(byKey.initialization_prompt.present).toBe(true);
  });

  it("records canon §106's local model as deferred rather than met", async () => {
    const { body } = await apiJson("/api/continuity/local-model");
    expect(body.data.registered).toBe(false);
    expect(body.data.status).toBe("DEFERRED — NO LOCAL HOST");
    expect(body.data.detail).toMatch(/recorded as deferred rather than marked met/);
    expect(body.data.smoke_test).toMatch(/record the result as a benchmark row/);
  });

  it("tracks the physical workflows as cadences it cannot verify", async () => {
    const { body } = await apiJson("/api/continuity");
    const keys = body.data.workflows.map((w: any) => w.key);
    expect(keys).toContain("copy_package_to_ssd");
    expect(keys).toContain("offsite_copy");
    expect(keys).toContain("offline_restore_drill");
  });
});

/**
 * The acceptance sentence: a documented restore drill completes from the
 * offline package alone — proven by running it with no network available.
 */
describe("Phase 23 — acceptance", () => {
  it("the drill completes from the package alone, with the network unavailable", async () => {
    // Build a package with real knowledge in it.
    await seedKnowledge();
    const { body: memory } = await apiJson("/api/memory", {
      method: "POST", body: { title: "What must be readable offline", body: "The standing arrangements.", sensitivity: "internal" },
    });
    await env.DB.prepare(`UPDATE memory_items SET tier = 'canon' WHERE id = ?`).bind(memory.data.id).run();
    await api("/api/knowledge/surfaces/offline_library/items", { method: "POST", body: { item_id: memory.data.id } });
    await api("/api/knowledge/manual/generate", { method: "POST", body: {} });

    // The prompt library backup is part of the package, so one reviewed prompt
    // goes in before it can be complete.
    const compiled = await apiJson("/api/prompt/packets", {
      method: "POST", body: { request: "Draft the standard investor update", tier: 1 },
    });
    const promoted = await apiJson(`/api/prompt/packets/${compiled.body.data.packet.id}/promote`, {
      method: "POST", body: { title: "Investor update" },
    });
    await api(`/api/approvals/${promoted.body.data.approval_id}/decide`, {
      method: "POST", body: { decision: "approved", note: "Keep it." },
    });

    const built = await buildPackage();
    expect(built.manifest.absent).toEqual([]);
    expect(built.item_counts.prompt_library).toBe(1);
    expect(built.note).toMatch(/Built and complete/);

    // Now run the drill with the network stubbed to throw. Anything reaching
    // outward would fail rather than pass quietly.
    const restore = stubFetch(() => {
      throw new Error("There is no network in a disaster.");
    });
    let result: any;
    try {
      const { status, body } = await apiJson("/api/continuity/drill", { method: "POST", body: { package_id: built.id } });
      expect(status).toBe(201);
      result = body.data;
    } finally {
      restore();
    }

    expect(result.passed).toBe(true);
    expect(result.failed_steps).toEqual([]);
    expect(result.steps.map((s: any) => s.key)).toEqual(CHECKLIST_STEPS.map((s) => s.key));
    expect(result.note).toMatch(/Completed from the offline package alone/);

    const noNetwork = result.steps.find((s: any) => s.key === "no_network_required");
    expect(noNetwork.passed).toBe(true);
    expect(noNetwork.evidence).toMatch(/came out of the package file/);

    // The drill is recorded, and doing it clears the maintenance item that asks for it.
    const drill = await row(`SELECT * FROM sovereignty_drills WHERE id = ?`, result.id);
    expect(drill!.passed).toBe(1);
    const item = await row(`SELECT last_done_at, due_at FROM maintenance_items WHERE key = 'offline_restore_drill'`);
    expect(item!.last_done_at).toBeGreaterThan(0);
    expect(item!.due_at).toBeGreaterThan(Date.now() + 80 * DAY);

    // And the sovereignty status now reports the package and the drill as present.
    const { body: status } = await apiJson("/api/continuity");
    const byKey = Object.fromEntries(status.data.components.map((c: any) => [c.key, c]));
    expect(byKey.package.present).toBe(true);
    expect(byKey.offline_drill.present).toBe(true);
    expect(byKey.operating_manual.present).toBe(true);
    expect(byKey.offline_library.present).toBe(true);
    expect(byKey.sha_manifests.present).toBe(true);
    // Local model stays honestly absent.
    expect(byKey.local_model.present).toBe(false);
  });
});
