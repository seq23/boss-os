import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, api, apiJson, inMaintenanceWindow, insertTask, row } from "./helpers";
import { DISCOVERY_TRIGGERS, SERIOUS_JOB_TYPES, DEFERRED_JOB_TYPES } from "../../src/worker/boss/routes/capability";

/**
 * Phase 18 — Capability Intelligence.
 *
 * Acceptance: every serious job type has an active default; alternatives are
 * benched rather than silently mixed into runtime; and a patch cannot mutate a
 * critical capability without approval.
 */

const DAY = 86_400_000;

let seq = 0;
const nextKey = (label: string) => `${label}_${(seq++).toString().padStart(3, "0")}`;

async function registerCapability(over: Record<string, unknown> = {}) {
  const { status, body } = await apiJson("/api/capability", {
    method: "POST",
    body: {
      key: nextKey("candidate"),
      name: "A candidate capability",
      job_type: "research",
      summary: "Does the job differently.",
      how_it_works: "By some other means.",
      cost_model: "Per call.",
      latency_profile: "Seconds.",
      limits: ["Cannot do the thing the default does best"],
      failure_modes: ["Times out under load"],
      ...over,
    },
  });
  expect(status).toBe(201);
  return body.data.capability as any;
}

describe("Phase 18 — the registry", () => {
  it("carries the twenty-two-field Capability Package canon specifies", async () => {
    const columns = await all(`PRAGMA table_info(capabilities)`);
    const names = columns.map((c: any) => c.name);
    expect(names.length).toBe(25); // twenty-two, plus id and the two timestamps
    for (const field of [
      "key", "name", "category", "job_type", "summary", "how_it_works", "inputs", "outputs",
      "dependencies", "cost_model", "latency_profile", "risk_class", "privacy_class", "criticality",
      "maturity", "benchmark_score", "benchmark_note", "limits", "failure_modes", "evidence",
      "status", "version",
    ]) {
      expect(names).toContain(field);
    }
  });

  it("describes only mechanisms this build actually has", async () => {
    const { body } = await apiJson("/api/capability");
    expect(body.data.length).toBeGreaterThanOrEqual(15);
    for (const cap of body.data) {
      expect(JSON.parse(cap.limits).length).toBeGreaterThanOrEqual(1);
      expect(JSON.parse(cap.failure_modes).length).toBeGreaterThanOrEqual(1);
      expect(JSON.parse(cap.evidence).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("refuses a package that claims no limits", async () => {
    const { status, body } = await apiJson("/api/capability", {
      method: "POST",
      body: {
        key: "perfect", name: "Perfect", job_type: "research", summary: "It just works",
        how_it_works: "Magic", cost_model: "Free", latency_profile: "Instant",
        failure_modes: ["none"],
      },
    });
    expect(status).toBe(400);
    expect(body.hint).toMatch(/has not been used yet/);
  });

  it("refuses a job type that is not canonical", async () => {
    const { status } = await apiJson("/api/capability", {
      method: "POST",
      body: {
        key: "odd", name: "Odd", job_type: "vibes", summary: "s", how_it_works: "h",
        cost_model: "c", latency_profile: "l", limits: ["x"], failure_modes: ["y"],
      },
    });
    expect(status).toBe(400);
  });
});

describe("Phase 18 — every serious job type has a default", () => {
  it("covers all of them, and defers the one it cannot honestly cover", async () => {
    const { status, body } = await apiJson("/api/capability/coverage");
    expect(status).toBe(200);
    expect(body.data.uncovered).toEqual([]);
    expect(body.data.covered).toBe(SERIOUS_JOB_TYPES.length);
    expect(body.data.deferred.map((d: any) => d.job_type)).toEqual(Object.keys(DEFERRED_JOB_TYPES));
    expect(body.data.deferred[0].phase).toBe(21);

    for (const entry of body.data.job_types) {
      expect(entry.default).toBeTruthy();
      expect(entry.default.reason).toBeTruthy();
    }
  });

  it("resolves a job to exactly one capability, and never to the bench", async () => {
    const { body } = await apiJson("/api/capability/resolve/research");
    expect(body.data.capability.key).toBe("router_model");
    expect(body.data.benched.map((b: any) => b.key)).toContain("local_model");
    expect(body.data.note).toMatch(/do not run/);

    // The benched alternative is not active anywhere.
    const local = await row(`SELECT status FROM capabilities WHERE key = 'local_model'`);
    expect(local!.status).toBe("benched");
    expect(await all(`SELECT job_type FROM active_defaults WHERE capability_id = 'cap_local_model'`)).toEqual([]);
  });

  it("says so plainly for the job type it cannot run yet", async () => {
    const { body } = await apiJson("/api/capability/resolve/west_peek_bridge");
    expect(body.data.capability).toBeNull();
    expect(body.data.deferred.phase).toBe(21);
    expect(body.data.note).toMatch(/none is pretended/);
  });

  it("treats a job type with no default as a trigger rather than a gap", async () => {
    await env.DB.prepare(`DELETE FROM active_defaults WHERE job_type = 'coaching'`).run();
    const { body } = await apiJson("/api/capability/resolve/coaching");
    expect(body.data.capability).toBeNull();
    expect(body.data.trigger).toBe("no_default");

    const coverage = await apiJson("/api/capability/coverage");
    expect(coverage.body.data.uncovered).toContain("coaching");
  });
});

describe("Phase 18 — the bench is not a rotation", () => {
  it("benches an alternative without letting it run", async () => {
    const candidate = await registerCapability({ job_type: "drafting" });
    expect(candidate.status).toBe("benched");

    const benched = await apiJson("/api/capability/bench", {
      method: "POST",
      body: { job_type: "drafting", capability_key: candidate.key, note: "Worth a look." },
    });
    expect(benched.status).toBe(201);
    expect(benched.body.data.note).toMatch(/does not run/);

    const resolved = await apiJson("/api/capability/resolve/drafting");
    // Phase 20 made Document Compiler Mode the current default for drafting and
    // benched the packet compiler — reviewable, per canon §78.8, not doctrine.
    expect(resolved.body.data.capability.key).toBe("document_compiler");
    expect(resolved.body.data.benched.map((b: any) => b.key)).toContain("prompt_compiler");
    expect(resolved.body.data.benched.some((b: any) => b.key === candidate.key)).toBe(true);
  });

  it("promotes a candidate, and puts the one it replaced back on the bench", async () => {
    const candidate = await registerCapability({ job_type: "research", name: "Another researcher" });
    const { body: benched } = await apiJson("/api/capability/bench", {
      method: "POST", body: { job_type: "research", capability_key: candidate.key },
    });

    const promoted = await apiJson(`/api/capability/bench/${benched.data.bench.id}/promote`, {
      method: "POST", body: { reason: "It benchmarked better on the same tasks." },
    });
    expect(promoted.status).toBe(200);
    expect(promoted.body.data.default.capability_id).toBe(candidate.id);
    expect(promoted.body.data.default.previous_capability_id).toBe("cap_router_model");

    const resolved = await apiJson("/api/capability/resolve/research");
    expect(resolved.body.data.capability.key).toBe(candidate.key);
    // The outgoing default is benched rather than deleted.
    expect(resolved.body.data.benched.some((b: any) => b.key === "router_model")).toBe(true);
    expect(await row(`SELECT status FROM capabilities WHERE id = 'cap_router_model'`)).toMatchObject({ status: "benched" });
  });

  it("refuses to bench what is already the default, or bench twice", async () => {
    const first = await apiJson("/api/capability/bench", {
      method: "POST", body: { job_type: "research", capability_key: "router_model" },
    });
    expect(first.status).toBe(409);

    const candidate = await registerCapability({ job_type: "trading" });
    await api("/api/capability/bench", { method: "POST", body: { job_type: "trading", capability_key: candidate.key } });
    const again = await apiJson("/api/capability/bench", {
      method: "POST", body: { job_type: "trading", capability_key: candidate.key },
    });
    expect(again.status).toBe(409);
  });

  it("rejects a candidate without disturbing what runs", async () => {
    const candidate = await registerCapability({ job_type: "research" });
    const { body: benched } = await apiJson("/api/capability/bench", {
      method: "POST", body: { job_type: "research", capability_key: candidate.key },
    });
    await api(`/api/capability/bench/${benched.data.bench.id}/reject`, { method: "POST", body: { reason: "Worse on cost." } });

    expect(await row(`SELECT status FROM bench_candidates WHERE id = ?`, benched.data.bench.id)).toMatchObject({ status: "rejected" });
    const resolved = await apiJson("/api/capability/resolve/research");
    expect(resolved.body.data.capability.key).toBe("router_model");
  });
});

describe("Phase 18 — search is trigger-based", () => {
  it("names the nine triggers and refuses a search without one", async () => {
    const { body } = await apiJson("/api/capability/triggers");
    expect(body.data.triggers).toHaveLength(9);
    expect(DISCOVERY_TRIGGERS.map((t) => t.key)).toEqual([
      "repeated_failure", "high_value", "high_risk", "new_link_provided", "scheduled_window",
      "cost_too_high", "better_benchmark", "no_default", "bloat",
    ]);
    expect(body.data.rule).toMatch(/tool-chasing/);

    const untriggered = await apiJson("/api/capability/discovery", {
      method: "POST", body: { note: "Saw a shiny new tool" },
    });
    expect(untriggered.status).toBe(400);
    expect(untriggered.body.hint).toMatch(/continuous tool-chasing/);

    const bogus = await apiJson("/api/capability/discovery", {
      method: "POST", body: { trigger: "curiosity", note: "It looked good" },
    });
    expect(bogus.status).toBe(400);
  });

  it("records a triggered search and its review", async () => {
    const { status, body } = await apiJson("/api/capability/discovery", {
      method: "POST",
      body: {
        trigger: "cost_too_high", job_type: "research",
        note: "The default costs more per research task than the work is worth.",
        link: "https://example.invalid/alternative",
      },
    });
    expect(status).toBe(201);
    expect(body.data.status).toBe("new");

    const reviewed = await apiJson(`/api/capability/discovery/${body.data.id}/review`, {
      method: "POST", body: { outcome: "dismissed", note: "Cost is fine once the envelope is set properly." },
    });
    expect(reviewed.body.data.status).toBe("dismissed");
    expect(reviewed.body.data.review_note).toMatch(/envelope/);

    const again = await apiJson(`/api/capability/discovery/${body.data.id}/review`, {
      method: "POST", body: { outcome: "actioned" },
    });
    expect(again.status).toBe(409);
  });
});

describe("Phase 18 — after-action review reads real traces", () => {
  it("reads the tasks that actually ran, and does nothing when nothing went wrong", async () => {
    await insertTask({ intake_kind: "research", status: "done" });
    await insertTask({ intake_kind: "research", status: "done" });

    const { status, body } = await apiJson("/api/capability/reviews/run", {
      method: "POST", body: { job_type: "research" },
    });
    expect(status).toBe(201);
    expect(body.data.tasks_examined).toBeGreaterThanOrEqual(2);
    expect(body.data.failures).toBe(0);
    expect(body.data.outcome).toBe("no_action");
    expect(body.data.patch_id).toBeNull();
  });

  it("proposes a patch and raises a discovery when the same job keeps failing", async () => {
    const failed: string[] = [];
    for (let i = 0; i < 4; i++) {
      failed.push(await insertTask({ intake_kind: "drafting", status: "failed", title: `Failed draft ${i}` }));
    }

    const { body } = await apiJson("/api/capability/reviews/run", {
      method: "POST", body: { job_type: "drafting" },
    });
    expect(body.data.failures).toBe(4);
    expect(body.data.outcome).toBe("patch_proposed");
    expect(body.data.patch_id).toBeTruthy();

    // The findings cite the tasks they came from.
    const evidence = body.data.findings.flatMap((f: any) => f.evidence);
    expect(failed.some((id) => evidence.includes(id))).toBe(true);

    const discovery = await row(`SELECT * FROM discovery_inbox WHERE id = ?`, body.data.discovery_id);
    expect(discovery!.trigger_key).toBe("repeated_failure");
    expect(JSON.parse(discovery!.evidence).task_ids.length).toBeGreaterThan(0);

    const patch = await row(`SELECT * FROM capability_patches WHERE id = ?`, body.data.patch_id);
    expect(patch!.status).toBe("proposed");
    expect(patch!.proposed_by).toBe("after_action_review");
  });

  it("says so when there is nothing to conclude", async () => {
    const { body } = await apiJson("/api/capability/reviews/run", {
      method: "POST", body: { job_type: "model_benchmark", window_start: 0, window_end: 1 },
    });
    expect(body.data.tasks_examined).toBe(0);
    expect(body.data.findings[0].text).toMatch(/Nothing to conclude/);
  });
});

describe("Phase 18 — a core capability does not change on somebody's say-so", () => {
  it("holds a core patch behind an approval and applies it only when approved", async () => {
    const before = await row(`SELECT version, latency_profile FROM capabilities WHERE key = 'approval_inbox'`);

    const { status, body } = await apiJson("/api/capability/patches", {
      method: "POST",
      body: {
        capability_key: "approval_inbox",
        changes: { latency_profile: "As fast as the Boss decides, usually within the day." },
        reason: "The old wording implied an SLA.",
      },
    });
    expect(status).toBe(201);
    expect(body.data.patch.status).toBe("proposed");
    expect(body.data.patch.requires_approval).toBe(1);
    expect(body.data.note).toMatch(/core capability/);

    // Nothing changed yet.
    const during = await row(`SELECT version, latency_profile FROM capabilities WHERE key = 'approval_inbox'`);
    expect(during!.latency_profile).toBe(before!.latency_profile);
    expect(during!.version).toBe(before!.version);

    // And it cannot be forced through the side door.
    const forced = await apiJson(`/api/capability/patches/${body.data.patch.id}/apply`, { method: "POST", body: {} });
    expect(forced.status).toBe(409);
    expect(forced.body.hint).toMatch(/does not change on somebody's say-so/);

    const decided = await apiJson(`/api/approvals/${body.data.approval_id}/decide`, {
      method: "POST", body: { decision: "approved", note: "Fair." },
    });
    expect(decided.body.data.execution.status).toBe("executed");

    const after = await row(`SELECT version, latency_profile FROM capabilities WHERE key = 'approval_inbox'`);
    expect(after!.latency_profile).toMatch(/within the day/);
    expect(after!.version).toBe(before!.version + 1);
    expect(await row(`SELECT status FROM capability_patches WHERE id = ?`, body.data.patch.id)).toMatchObject({ status: "applied" });
  });

  it("closes a core patch that is refused", async () => {
    const { body } = await apiJson("/api/capability/patches", {
      method: "POST",
      body: { capability_key: "paper_broker", changes: { risk_class: "low" }, reason: "It feels low risk." },
    });
    await api(`/api/approvals/${body.data.approval_id}/decide`, {
      method: "POST", body: { decision: "rejected", note: "It moves money. It is not low risk." },
    });

    const patch = await row(`SELECT status, review_note FROM capability_patches WHERE id = ?`, body.data.patch.id);
    expect(patch!.status).toBe("rejected");
    expect(patch!.review_note).toMatch(/moves money/);
    expect(await row(`SELECT risk_class FROM capabilities WHERE key = 'paper_broker'`)).toMatchObject({ risk_class: "high" });
  });

  it("applies a patch to a standard capability immediately, and records it", async () => {
    const before = await row(`SELECT version FROM capabilities WHERE key = 'prompt_compiler'`);
    const { status, body } = await apiJson("/api/capability/patches", {
      method: "POST",
      body: {
        capability_key: "prompt_compiler",
        changes: { benchmark_score: 82, benchmark_note: "Scored against twenty compiled packets." },
        reason: "First benchmark run.",
      },
    });
    expect(status).toBe(201);
    expect(body.data.patch.status).toBe("applied");
    expect(body.data.capability.benchmark_score).toBe(82);
    expect(body.data.capability.version).toBe(before!.version + 1);
  });

  it("refuses to patch a field that is not part of the package", async () => {
    const { status, body } = await apiJson("/api/capability/patches", {
      method: "POST",
      body: { capability_key: "prompt_compiler", changes: { key: "renamed" }, reason: "Tidier." },
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/not a patchable field/);
  });
});

describe("Phase 18 — the standing cadence", () => {
  it("runs as a recorded cron step", async () => {
    const { default: worker } = await import("../../src/worker/boss/index");
    const { createExecutionContext, waitOnExecutionContext } = await import("cloudflare:test");
    const ctx = createExecutionContext();
    await worker.scheduled!({ cron: "0 3 * * *", scheduledTime: inMaintenanceWindow(), noRetry() {} } as any, env, ctx);
    await waitOnExecutionContext(ctx);

    const run = await row(`SELECT steps FROM cron_runs ORDER BY started_at DESC LIMIT 1`);
    const steps = JSON.parse(run!.steps);
    const step = steps.find((s: any) => s.name === "capability_cadence");
    expect(step).toBeTruthy();
    expect(step.status).toBe("ok");
  });

  it("raises a no-default discovery on the monthly scan", async () => {
    await env.DB.prepare(`DELETE FROM active_defaults WHERE job_type = 'coaching'`).run();

    // The scan runs on the first of the month; ask it directly for the check.
    const { body } = await apiJson("/api/capability/cadence/run", { method: "POST", body: {} });
    if (body.data.ran) {
      expect(body.data.monthly_scan.discoveries_raised).toContain("coaching");
      const raised = await all(`SELECT * FROM discovery_inbox WHERE trigger_key = 'no_default' AND job_type = 'coaching'`);
      expect(raised.length).toBe(1);
    } else {
      // Not the first of the month: the step is a deliberate no-op and says so.
      expect(body.data.reason).toMatch(/first of the month/);
    }
  });
});

/**
 * The acceptance sentence, walked end to end.
 */
describe("Phase 18 — acceptance", () => {
  it("every serious job defaults, alternatives stay benched, and a core patch waits for review", async () => {
    const coverage = await apiJson("/api/capability/coverage");
    expect(coverage.body.data.uncovered).toEqual([]);
    expect(coverage.body.data.covered).toBe(SERIOUS_JOB_TYPES.length);

    // An alternative exists, is visible, and does not run.
    const alternative = await registerCapability({ job_type: "decision_support", name: "A second decision tool" });
    await api("/api/capability/bench", {
      method: "POST", body: { job_type: "decision_support", capability_key: alternative.key },
    });
    const resolved = await apiJson("/api/capability/resolve/decision_support");
    expect(resolved.body.data.capability.key).toBe("decision_journal");
    expect(resolved.body.data.benched.some((b: any) => b.key === alternative.key)).toBe(true);

    // A patch to that core capability does not touch it until it is approved.
    const patch = await apiJson("/api/capability/patches", {
      method: "POST",
      body: {
        capability_key: "decision_journal",
        changes: { maturity: "deprecated" },
        reason: "Testing that this cannot happen quietly.",
      },
    });
    expect(patch.body.data.patch.status).toBe("proposed");
    expect(await row(`SELECT maturity FROM capabilities WHERE key = 'decision_journal'`)).toMatchObject({ maturity: "proven" });

    await api(`/api/approvals/${patch.body.data.approval_id}/decide`, {
      method: "POST", body: { decision: "rejected", note: "No." },
    });
    expect(await row(`SELECT maturity FROM capabilities WHERE key = 'decision_journal'`)).toMatchObject({ maturity: "proven" });
  });
});
