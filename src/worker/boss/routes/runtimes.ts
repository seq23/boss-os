/**
 * Phase 20 — the SEO/GEO and Document Compiler runtimes.
 *
 * Canon §37, §38, §78.15, §78.8. Both run as governed work: classified through
 * intake, given a permission envelope, resolved to a capability in the Phase 18
 * registry, and closed with an evidence packet. Neither calls a model, and
 * neither claims anything it cannot show the working for.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { ok, badRequest, notFound } from "../lib/http";
import {
  closeRuntimeJob, openRuntimeJob, openRuntimeTask, resolveRuntimeCapability, NO_NETWORK,
} from "../runtimes/run";
import { LIVE_SOURCES, SUPPLIED_SOURCE, compileDocument, verifyArtifact, type SectionSpec } from "../runtimes/compiler";
import { DEFERRED_CHECKS, probe, runChecks, scoreAudit } from "../runtimes/seo";

export const runtimes = new Hono<{ Bindings: Env; Variables: Vars }>();

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

// ─── Shared ───────────────────────────────────────────────────────────────────

runtimes.get("/jobs", async (c) => {
  const runtime = c.req.query("runtime");
  const rows = await c.env.DB
    .prepare(
      `SELECT j.*, cap.key AS capability_key FROM runtime_jobs j
    LEFT JOIN capabilities cap ON cap.id = j.capability_id
        ${runtime ? "WHERE j.runtime = ?" : ""}
        ORDER BY j.started_at DESC LIMIT 100`,
    )
    .bind(...(runtime ? [runtime] : []))
    .all<any>();
  return ok(c, (rows.results ?? []).map((j) => ({ ...j, input: JSON.parse(j.input), deferred: j.deferred ? JSON.parse(j.deferred) : null })));
});

runtimes.get("/jobs/:id", async (c) => {
  const id = c.req.param("id");
  const job = await c.env.DB.prepare(`SELECT * FROM runtime_jobs WHERE id = ?`).bind(id).first<any>();
  if (!job) throw notFound("No runtime job with that id");

  const [artifact, audit_, evidence] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM document_artifacts WHERE job_id = ?`).bind(id).first<any>(),
    c.env.DB.prepare(`SELECT * FROM seo_audits WHERE job_id = ?`).bind(id).first<any>(),
    job.evidence_packet_id
      ? c.env.DB.prepare(`SELECT * FROM evidence_packets WHERE id = ?`).bind(job.evidence_packet_id).first<any>()
      : Promise.resolve(null),
  ]);

  const probes = audit_
    ? await c.env.DB.prepare(`SELECT * FROM geo_probes WHERE audit_id = ? ORDER BY created_at`).bind(audit_.id).all<any>()
    : null;

  return ok(c, {
    job: { ...job, input: JSON.parse(job.input), deferred: job.deferred ? JSON.parse(job.deferred) : null },
    artifact: artifact ? { ...artifact, sections: JSON.parse(artifact.sections), manifest: JSON.parse(artifact.manifest) } : null,
    audit: audit_
      ? { ...audit_, checks: JSON.parse(audit_.checks), findings: JSON.parse(audit_.findings), deferred: JSON.parse(audit_.deferred) }
      : null,
    probes: probes?.results ?? [],
    evidence,
  });
});

// ─── Document Compiler — canon §38 ────────────────────────────────────────────

runtimes.get("/compiler/sources", async (c) =>
  ok(c, {
    sources: [
      { key: SUPPLIED_SOURCE, label: "Text supplied with the request" },
      ...Object.entries(LIVE_SOURCES).map(([key, s]) => ({ key, label: s.label })),
    ],
    note: "A section whose source returns nothing is recorded as absent, with the reason. The compiler assembles; it does not write.",
  }),
);

runtimes.post("/compiler/run", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const name = requiredText(b?.name, "A document name");
  const title = requiredText(b?.title, "A title");
  if (!Array.isArray(b?.sections) || b.sections.length === 0) {
    throw badRequest("A document needs sections", "Send [{ key, title, source, text }].");
  }

  const sections: SectionSpec[] = b.sections.map((s: any) => ({
    key: requiredText(s?.key, "A section key"),
    title: requiredText(s?.title, "A section title"),
    source: requiredText(s?.source, "A section source"),
    text: optionalText(s?.text) ?? undefined,
  }));

  const capability = await resolveRuntimeCapability(c.env.DB, "document_compiler");
  const { taskId, costMode } = await openRuntimeTask(c.env, {
    title: `Compile: ${title}`,
    kind: "drafting",
    input: { name, title, sections: sections.map((s) => ({ key: s.key, source: s.source })) },
  });
  const jobId = await openRuntimeJob(c.env.DB, {
    runtime: "document_compiler", kind: optionalText(b?.kind) ?? "document",
    title, input: { name, sections: sections.map((s) => s.key) },
    capabilityId: capability.id, taskId,
  });

  try {
    const result = await compileDocument(c.env, { jobId, name, title, sections, note: optionalText(b?.note) });

    const outcome = await closeRuntimeJob(c.env, {
      jobId, taskId, runtime: "document_compiler", capability, costMode,
      inputsUsed: { name, title, sections: sections.map((s) => ({ key: s.key, source: s.source })) },
      sourceMaterials: sections.map((s) => s.source),
      actionsTaken: [`Compiled ${sections.length} section(s)`, `Wrote ${result.r2_key}`],
      artifactsCreated: [{ id: result.artifactId, r2_key: result.r2_key, sha256: result.sha256, bytes: result.bytes }],
      checksRun: result.sections.map((s) => ({ section: s.key, present: s.present, sha256: s.sha256 })),
      unknowns: result.sections.filter((s) => !s.present).map((s) => ({ section: s.key, reason: s.reason })),
      deferred: [],
      nextHumanAction: result.sections.some((s) => !s.present)
        ? "Some sections had no source and are marked absent. Fill them or accept the gaps."
        : "Read it before it goes anywhere.",
      status: "complete",
    });

    await audit(c.env.DB, {
      actor: "boss", lane: "ops", entityType: "runtime_job", entityId: jobId, action: "document_compiled",
      detail: { artifact: result.artifactId, sha256: result.sha256, absent: result.manifest.absent },
    });

    return ok(c, { job_id: jobId, task_id: taskId, evidence_packet_id: outcome.evidenceId, ...result }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await closeRuntimeJob(c.env, {
      jobId, taskId, runtime: "document_compiler", capability, costMode,
      inputsUsed: { name, title }, sourceMaterials: [], actionsTaken: ["Compile failed"],
      artifactsCreated: [], checksRun: [], unknowns: [], deferred: [],
      nextHumanAction: "Read the error and fix the section that failed.",
      status: "failed", error: message,
    });
    throw err;
  }
});

runtimes.get("/compiler/artifacts", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT a.*, j.title FROM document_artifacts a JOIN runtime_jobs j ON j.id = a.job_id
        ORDER BY a.created_at DESC LIMIT 50`,
    )
    .all<any>();
  return ok(c, (rows.results ?? []).map((a) => ({ ...a, sections: JSON.parse(a.sections), manifest: JSON.parse(a.manifest) })));
});

runtimes.get("/compiler/artifacts/:id/verify", async (c) => ok(c, await verifyArtifact(c.env, c.req.param("id"))));

/** The compiled document itself, read back from R2 rather than from memory. */
runtimes.get("/compiler/artifacts/:id/content", async (c) => {
  const row = await c.env.DB
    .prepare(`SELECT r2_key, name FROM document_artifacts WHERE id = ?`).bind(c.req.param("id"))
    .first<{ r2_key: string; name: string }>();
  if (!row) throw notFound("No artifact with that id");
  const object = await c.env.VAULT.get(row.r2_key);
  if (!object) throw notFound("The artifact is not in R2");
  return ok(c, { name: row.name, r2_key: row.r2_key, content: await object.text() });
});

// ─── SEO/GEO — canon §37 ──────────────────────────────────────────────────────

runtimes.get("/seo/deferred", async (c) =>
  ok(c, {
    deferred: DEFERRED_CHECKS,
    reason:
      "This build has no network access. Indexation, links, positions, competitor coverage and real-user timings " +
      "cannot be observed from here, and are not estimated.",
  }),
);

/**
 * An audit run. It takes text, or an artifact this system compiled, and returns
 * per-check evidence — never a position, a ranking or a forecast.
 */
runtimes.post("/seo/run", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const questions: string[] = Array.isArray(b?.questions) ? b.questions.map((q: any) => String(q).trim()).filter(Boolean) : [];

  let text = optionalText(b?.text);
  let targetKind = "text";
  let target = "supplied text";

  if (!text && b?.artifact_id) {
    const artifact = await c.env.DB
      .prepare(`SELECT id, name, r2_key FROM document_artifacts WHERE id = ?`).bind(String(b.artifact_id))
      .first<{ id: string; name: string; r2_key: string }>();
    if (!artifact) throw badRequest("No artifact with that id");
    const object = await c.env.VAULT.get(artifact.r2_key);
    if (!object) throw badRequest("That artifact is not in R2");
    text = await object.text();
    targetKind = "artifact";
    target = artifact.id;
  }

  if (!text) {
    throw badRequest(
      "An audit needs something to read",
      "Send { text } or { artifact_id }. There is no network here, so a URL cannot be fetched.",
    );
  }
  if (b?.url) {
    throw badRequest(
      "A URL cannot be audited from here",
      `${NO_NETWORK}. Paste the content, or audit a compiled artifact.`,
    );
  }

  const capability = await resolveRuntimeCapability(c.env.DB, "seo_geo_runtime");
  const { taskId, costMode } = await openRuntimeTask(c.env, {
    title: `SEO/GEO audit: ${optionalText(b?.title) ?? target}`,
    kind: "research",
    input: { target, target_kind: targetKind, questions },
  });
  const jobId = await openRuntimeJob(c.env.DB, {
    runtime: "seo_geo", kind: "audit", title: optionalText(b?.title) ?? `Audit of ${target}`,
    input: { target, target_kind: targetKind, questions }, capabilityId: capability.id, taskId,
  });

  const { checks, findings } = runChecks(text, { title: optionalText(b?.title) });
  const probes = probe(text, questions);
  const { score, max } = scoreAudit(checks, probes);

  const auditId = newId("seo");
  const now = Date.now();
  await c.env.DB
    .prepare(
      `INSERT INTO seo_audits (id, job_id, target, target_kind, checks, findings, score, max_score, deferred, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      auditId, jobId, target, targetKind, JSON.stringify(checks), JSON.stringify(findings),
      score, max, JSON.stringify(DEFERRED_CHECKS), now,
    )
    .run();

  if (probes.length > 0) {
    await c.env.DB.batch(
      probes.map((p) =>
        c.env.DB
          .prepare(`INSERT INTO geo_probes (id, audit_id, question, answered, excerpt, attributable, note, created_at) VALUES (?,?,?,?,?,?,?,?)`)
          .bind(newId("gpr"), auditId, p.question, p.answered ? 1 : 0, p.excerpt, p.attributable ? 1 : 0, p.note, now),
      ),
    );
  }

  const outcome = await closeRuntimeJob(c.env, {
    jobId, taskId, runtime: "seo_geo", capability, costMode,
    inputsUsed: { target, target_kind: targetKind, questions, characters: text.length },
    sourceMaterials: [targetKind === "artifact" ? `document_artifacts:${target}` : "supplied text"],
    actionsTaken: [`Ran ${checks.length} static checks`, `Probed ${probes.length} question(s)`],
    artifactsCreated: [{ audit_id: auditId }],
    checksRun: checks.map((ch) => ({ key: ch.key, pass: ch.pass, observed: ch.observed, evidence: ch.evidence })),
    unknowns: probes.filter((p) => !p.answered).map((p) => ({ question: p.question, note: p.note })),
    deferred: DEFERRED_CHECKS,
    nextHumanAction: findings.length
      ? `${findings.length} thing(s) to fix before this goes out.`
      : "Nothing static is wrong with it. What happens in search is still unobservable from here.",
    status: "complete",
  });

  return ok(
    c,
    {
      job_id: jobId, task_id: taskId, evidence_packet_id: outcome.evidenceId,
      audit: { id: auditId, target, target_kind: targetKind, checks, findings, score, max_score: max },
      probes,
      deferred: DEFERRED_CHECKS,
      note: "Evidence, not a claim. Nothing here reports a ranking, and nothing here predicts one.",
    },
    201,
  );
});

runtimes.get("/seo/audits", async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT a.*, j.title FROM seo_audits a JOIN runtime_jobs j ON j.id = a.job_id ORDER BY a.created_at DESC LIMIT 50`)
    .all<any>();
  return ok(
    c,
    (rows.results ?? []).map((a) => ({
      ...a, checks: JSON.parse(a.checks), findings: JSON.parse(a.findings), deferred: JSON.parse(a.deferred),
    })),
  );
});
