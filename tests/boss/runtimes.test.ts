import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { all, api, apiJson, row } from "./helpers";
import { DEFERRED_CHECKS, probe, runChecks } from "../../src/worker/boss/runtimes/seo";
import { NO_NETWORK } from "../../src/worker/boss/runtimes/run";

/**
 * Phase 20 — the SEO/GEO and Document Compiler runtimes.
 *
 * Acceptance: a document compile run produces a structured artifact with a
 * manifest and a SHA record; an SEO/GEO run produces an evidence packet, not a
 * claim.
 */

let seq = 0;
const nextName = (label: string) => `${label}-${(seq++).toString().padStart(3, "0")}`;

const GOOD_PAGE = [
  "# What Boss OS does about overdue commitments",
  "",
  "Overdue commitments surface on the Today screen the day they come due, as open loops.",
  "In this build 3 of 4 follow-ups reached the screen within 24 hours (source: test/relationships.test.ts).",
  "",
  "## How does a commitment become an open loop?",
  "",
  "A meeting capture writes follow-ups, and any follow-up past its due date is surfaced once.",
  "The link between them is stored, so the same commitment is never surfaced twice.",
  "See [the follow-up rules](https://example.invalid/follow-ups) for the exact conditions.",
  "",
  "## What happens when one is resolved?",
  "",
  "Resolving the loop closes the commitment, and the relationship is re-scored within 1 second.",
  "Dropping it instead costs relationship health, which is recorded rather than hidden.",
].join("\n");

const THIN_PAGE = [
  "Some thoughts",
  "",
  "We think this is probably the best approach for most people in most situations and it is likely that " +
  "anyone considering the alternatives will eventually come around to the same conclusion given enough time to " +
  "think about it properly which is what we have done here at length.",
].join("\n");

describe("Phase 20 — the runtimes run as governed work", () => {
  it("compiles a document as a classified task with an envelope and an evidence packet", async () => {
    const { status, body } = await apiJson("/api/runtimes/compiler/run", {
      method: "POST",
      body: {
        name: nextName("weekly"),
        title: "Weekly operating note",
        sections: [
          { key: "summary", title: "Where things stand", source: "supplied", text: "Steady week. Two decisions committed." },
          { key: "capital", title: "The book", source: "capital.book" },
        ],
      },
    });
    expect(status).toBe(201);

    const task = await row(`SELECT * FROM tasks WHERE id = ?`, body.data.task_id);
    expect(task!.intake_kind).toBeTruthy();
    expect(task!.envelope_id).toBeTruthy();
    expect(task!.status).toBe("done");

    const envelope = await row(`SELECT * FROM permission_envelopes WHERE id = ?`, task!.envelope_id);
    expect(envelope).toBeTruthy();

    const evidence = await row(`SELECT * FROM evidence_packets WHERE id = ?`, body.data.evidence_packet_id);
    expect(evidence!.task_id).toBe(body.data.task_id);
    expect(evidence!.final_status).toBe("done");
    expect(JSON.parse(evidence!.systems_touched)).toContain("document_compiler");
    expect(JSON.parse(evidence!.artifacts_created)[0].sha256).toBe(body.data.sha256);
  });

  it("records which capability ran it, and refuses a retired one", async () => {
    const { body } = await apiJson("/api/runtimes/compiler/run", {
      method: "POST",
      body: { name: nextName("note"), title: "A note", sections: [{ key: "s", title: "S", source: "supplied", text: "Text." }] },
    });
    const job = await row(`SELECT capability_id FROM runtime_jobs WHERE id = ?`, body.data.job_id);
    expect(job!.capability_id).toBe("cap_document_compiler");

    await env.DB.prepare(`UPDATE capabilities SET status = 'retired' WHERE key = 'document_compiler'`).run();
    const refused = await apiJson("/api/runtimes/compiler/run", {
      method: "POST",
      body: { name: nextName("note"), title: "A note", sections: [{ key: "s", title: "S", source: "supplied", text: "Text." }] },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/retired/);
  });

  it("is the current default for drafting, and says it is reviewable", async () => {
    const { body } = await apiJson("/api/capability/resolve/drafting");
    expect(body.data.capability.key).toBe("document_compiler");
    expect(await row(`SELECT reason FROM active_defaults WHERE job_type = 'drafting'`)).toMatchObject({
      reason: expect.stringMatching(/reviewable, not doctrine/),
    });
  });
});

describe("Phase 20 — the Document Compiler assembles and does not invent", () => {
  it("produces an artifact with a per-section manifest and a hash that verifies", async () => {
    const { body } = await apiJson("/api/runtimes/compiler/run", {
      method: "POST",
      body: {
        name: nextName("brief"),
        title: "Investor brief",
        note: "For the quarterly send",
        sections: [
          { key: "intro", title: "Where we are", source: "supplied", text: "The round is priced and closing." },
          { key: "asks", title: "What we need", source: "supplied", text: "Two intros and a signature." },
        ],
      },
    });

    expect(body.data.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.data.bytes).toBeGreaterThan(0);
    expect(body.data.sections).toHaveLength(2);
    for (const section of body.data.sections) {
      expect(section.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(section.present).toBe(true);
    }
    expect(body.data.manifest.note).toBe("For the quarterly send");
    expect(body.data.manifest.sections[0].key).toBe("intro");

    const verify = await apiJson(`/api/runtimes/compiler/artifacts/${body.data.artifactId}/verify`);
    expect(verify.body.data.ok).toBe(true);
    expect(verify.body.data.sha_match).toBe(true);

    // The file is really in R2 and really is the document.
    const object = await env.VAULT.get(body.data.r2_key);
    expect(object).toBeTruthy();
    const content = await object!.text();
    expect(content).toContain("# Investor brief");
    expect(content).toContain("The round is priced and closing.");

    const readBack = await apiJson(`/api/runtimes/compiler/artifacts/${body.data.artifactId}/content`);
    expect(readBack.body.data.content).toBe(content);
  });

  it("records an empty source as absent rather than filling it", async () => {
    const { body } = await apiJson("/api/runtimes/compiler/run", {
      method: "POST",
      body: {
        name: nextName("report"),
        title: "Monthly report",
        sections: [
          { key: "capital", title: "The book", source: "capital.book" },
          { key: "flags", title: "What is flagged", source: "governance.flags" },
        ],
      },
    });

    const absent = body.data.manifest.absent.map((a: any) => a.key);
    expect(absent).toContain("capital");
    for (const section of body.data.sections.filter((s: any) => !s.present)) {
      expect(section.reason).toMatch(/returned nothing|Recorded as absent/);
      expect(section.body).toMatch(/^_/);
    }
    expect(body.data.document).not.toMatch(/TODO|placeholder|lorem/i);

    // The evidence packet carries the gaps as unknowns rather than hiding them.
    const evidence = await row(`SELECT unknowns, next_human_action FROM evidence_packets WHERE id = ?`, body.data.evidence_packet_id);
    expect(JSON.parse(evidence!.unknowns).length).toBeGreaterThanOrEqual(1);
    expect(evidence!.next_human_action).toMatch(/marked absent/);
  });

  it("draws real rows when the source has something to say", async () => {
    const { body: track } = await apiJson("/api/wealth/tracks", {
      method: "POST", body: { name: nextName("Venture"), target_allocation_bps: 2000 },
    });
    await api("/api/wealth/allocations", {
      method: "POST", body: { track_id: track.data.id, amount_micros: 500_000_000_000, kind: "deployed" },
    });

    const { body } = await apiJson("/api/runtimes/compiler/run", {
      method: "POST",
      body: {
        name: nextName("book"), title: "The book",
        sections: [{ key: "capital", title: "By track", source: "capital.book" }],
      },
    });

    const section = body.data.sections[0];
    expect(section.present).toBe(true);
    expect(section.body).toContain(track.data.name);
    expect(section.body).toContain("$500000");
  });

  it("compiles the same inputs to the same hash", async () => {
    const sections = [{ key: "s", title: "Section", source: "supplied", text: "Exactly the same words." }];
    const first = await apiJson("/api/runtimes/compiler/run", {
      method: "POST", body: { name: "same", title: "Same document", sections },
    });
    const second = await apiJson("/api/runtimes/compiler/run", {
      method: "POST", body: { name: "same", title: "Same document", sections },
    });
    expect(second.body.data.sha256).toBe(first.body.data.sha256);
  });

  it("refuses a source it does not have", async () => {
    const { status, body } = await apiJson("/api/runtimes/compiler/run", {
      method: "POST",
      body: { name: "bad", title: "Bad", sections: [{ key: "x", title: "X", source: "the_internet" }] },
    });
    expect(status).toBe(400);
    expect(body.hint).toMatch(/supplied/);

    // The failure is recorded as a failed job with its own evidence packet.
    const job = await row(`SELECT * FROM runtime_jobs WHERE runtime = 'document_compiler' AND status = 'failed' ORDER BY started_at DESC LIMIT 1`);
    expect(job).toBeTruthy();
    expect(await row(`SELECT final_status FROM evidence_packets WHERE id = ?`, job!.evidence_packet_id)).toMatchObject({ final_status: "failed" });
  });

  it("lists the sources it can draw on", async () => {
    const { body } = await apiJson("/api/runtimes/compiler/sources");
    expect(body.data.sources.length).toBeGreaterThanOrEqual(6);
    expect(body.data.sources.map((s: any) => s.key)).toContain("supplied");
    expect(body.data.note).toMatch(/assembles; it does not write/);
  });
});

describe("Phase 20 — the SEO/GEO runtime produces evidence, not claims", () => {
  it("checks what it can read and names what it cannot", async () => {
    const { status, body } = await apiJson("/api/runtimes/seo/run", {
      method: "POST",
      body: {
        title: "Overdue commitments",
        text: GOOD_PAGE,
        questions: ["How does a commitment become an open loop?", "What happens when one is resolved?"],
      },
    });
    expect(status).toBe(201);

    // Evidence: every check says what it observed and what it read.
    for (const check of body.data.audit.checks) {
      expect(check.observed).toBeTruthy();
      expect(check.evidence).toBeTruthy();
      expect(typeof check.pass).toBe("boolean");
    }
    expect(body.data.audit.score).toBeGreaterThan(0);
    expect(body.data.audit.score).toBeLessThanOrEqual(body.data.audit.max_score);

    // No claim about rankings anywhere in the response.
    expect(body.data.note).toMatch(/Evidence, not a claim/);
    expect(JSON.stringify(body.data)).not.toMatch(/will rank|guaranteed|position \d|traffic increase/i);

    // And what cannot be observed is named rather than estimated.
    expect(body.data.deferred.map((d: any) => d.key)).toContain("serp_position");
    for (const d of body.data.deferred) expect(d.status).toBe(NO_NETWORK);
  });

  it("writes an evidence packet with the checks it ran", async () => {
    const { body } = await apiJson("/api/runtimes/seo/run", {
      method: "POST", body: { text: GOOD_PAGE, questions: ["How does a commitment become an open loop?"] },
    });

    const evidence = await row(`SELECT * FROM evidence_packets WHERE id = ?`, body.data.evidence_packet_id);
    expect(evidence).toBeTruthy();
    const checks = JSON.parse(evidence!.checks_run);
    expect(checks.length).toBeGreaterThanOrEqual(10);
    expect(checks[0].evidence).toBeTruthy();
    expect(JSON.parse(evidence!.risks_remaining).map((d: any) => d.key)).toContain("backlinks");
    expect(evidence!.final_status).toBe("done");
  });

  it("finds the real problems in a thin page and says how to fix them", async () => {
    const { body } = await apiJson("/api/runtimes/seo/run", {
      method: "POST", body: { text: THIN_PAGE, questions: ["What is the recommendation?"] },
    });

    const failed = body.data.audit.checks.filter((c: any) => !c.pass).map((c: any) => c.key);
    expect(failed).toContain("single_h1");
    expect(failed).toContain("substance");
    expect(failed).toContain("sentence_length");

    expect(body.data.audit.findings.length).toBeGreaterThanOrEqual(3);
    for (const finding of body.data.audit.findings) {
      expect(["high", "medium", "low"]).toContain(finding.severity);
      expect(finding.fix).toBeTruthy();
    }
    expect(body.data.probes[0].answered).toBe(false);
    expect(body.data.probes[0].note).toMatch(/Not answered/);
  });

  it("probes whether the answer is actually present and attributable", () => {
    const probes = probe(GOOD_PAGE, [
      "How does a commitment become an open loop?",
      "What is the pricing for enterprise customers?",
    ]);
    expect(probes[0]!.answered).toBe(true);
    expect(probes[0]!.excerpt).toBeTruthy();
    expect(probes[1]!.answered).toBe(false);
    expect(probes[1]!.excerpt).toBeNull();
  });

  it("audits a compiled artifact, closing the loop between the runtimes", async () => {
    const compiled = await apiJson("/api/runtimes/compiler/run", {
      method: "POST",
      body: {
        name: nextName("page"), title: "How overdue commitments surface",
        sections: [
          { key: "answer", title: "How does it work?", source: "supplied", text: "A follow-up past its due date is surfaced once, as an open loop. In 2 tests, 2 of 2 surfaced." },
          { key: "detail", title: "What happens when one is resolved?", source: "supplied", text: "Resolving the loop closes the commitment and re-scores the relationship (source: relationships tests)." },
        ],
      },
    });

    const { body } = await apiJson("/api/runtimes/seo/run", {
      method: "POST",
      body: {
        artifact_id: compiled.body.data.artifactId,
        questions: ["How does it work?", "What happens when one is resolved?"],
      },
    });

    expect(body.data.audit.target_kind).toBe("artifact");
    expect(body.data.audit.target).toBe(compiled.body.data.artifactId);
    expect(body.data.probes.every((p: any) => p.answered)).toBe(true);

    const evidence = await row(`SELECT source_materials FROM evidence_packets WHERE id = ?`, body.data.evidence_packet_id);
    expect(JSON.parse(evidence!.source_materials)[0]).toContain(compiled.body.data.artifactId);
  });

  it("refuses a URL rather than pretending to fetch it", async () => {
    const { status, body } = await apiJson("/api/runtimes/seo/run", {
      method: "POST", body: { url: "https://example.invalid/page", text: "something" },
    });
    expect(status).toBe(400);
    expect(body.hint).toContain(NO_NETWORK);
  });

  it("refuses an audit with nothing to read", async () => {
    const { status, body } = await apiJson("/api/runtimes/seo/run", { method: "POST", body: {} });
    expect(status).toBe(400);
    expect(body.hint).toMatch(/no network here/);
  });

  it("publishes what it cannot check", async () => {
    const { body } = await apiJson("/api/runtimes/seo/deferred");
    expect(body.data.deferred).toHaveLength(DEFERRED_CHECKS.length);
    expect(body.data.reason).toMatch(/not estimated/);
  });

  it("scores checks deterministically", () => {
    const first = runChecks(GOOD_PAGE, { title: "Overdue commitments" });
    const second = runChecks(GOOD_PAGE, { title: "Overdue commitments" });
    expect(second.checks.map((c) => c.pass)).toEqual(first.checks.map((c) => c.pass));
  });
});

/**
 * The acceptance sentence, walked end to end.
 */
describe("Phase 20 — acceptance", () => {
  it("a compile produces a hashed artifact with a manifest; an audit produces an evidence packet, not a claim", async () => {
    // The compile.
    const compiled = await apiJson("/api/runtimes/compiler/run", {
      method: "POST",
      body: {
        name: nextName("quarterly"),
        title: "Quarterly operating note",
        sections: [
          { key: "state", title: "Where things stand", source: "supplied", text: "Two decisions committed, 1 prediction resolved, 0 incidents open." },
          { key: "decisions", title: "Decisions", source: "decisions.recent" },
          { key: "flags", title: "Flagged", source: "governance.flags" },
        ],
      },
    });
    expect(compiled.status).toBe(201);
    expect(compiled.body.data.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(compiled.body.data.manifest.sections).toHaveLength(3);
    expect(compiled.body.data.manifest.sha256).toBe(compiled.body.data.sha256);

    const artifactRow = await row(`SELECT * FROM document_artifacts WHERE id = ?`, compiled.body.data.artifactId);
    expect(artifactRow!.sha256).toBe(compiled.body.data.sha256);
    expect(artifactRow!.r2_key).toBeTruthy();
    expect((await apiJson(`/api/runtimes/compiler/artifacts/${compiled.body.data.artifactId}/verify`)).body.data.ok).toBe(true);

    // The audit of what was compiled.
    const audited = await apiJson("/api/runtimes/seo/run", {
      method: "POST",
      body: { artifact_id: compiled.body.data.artifactId, questions: ["Where things stand?"] },
    });
    expect(audited.status).toBe(201);

    const evidence = await row(`SELECT * FROM evidence_packets WHERE id = ?`, audited.body.data.evidence_packet_id);
    expect(evidence).toBeTruthy();
    expect(JSON.parse(evidence!.checks_run).length).toBeGreaterThanOrEqual(10);
    expect(JSON.parse(evidence!.risks_remaining).length).toBe(DEFERRED_CHECKS.length);
    expect(evidence!.worker_used).toBe("system");

    // Both runs are governed tasks with envelopes, and both are on the job list.
    const jobs = await all(`SELECT * FROM runtime_jobs WHERE status = 'complete'`);
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    for (const job of jobs) {
      expect(job.task_id).toBeTruthy();
      expect(job.evidence_packet_id).toBeTruthy();
    }

    const listed = await apiJson("/api/runtimes/jobs");
    expect(listed.body.data.some((j: any) => j.id === compiled.body.data.job_id)).toBe(true);
  });
});
