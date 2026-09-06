/**
 * Document Compiler Mode — canon §38, §78.8, §78.15.
 *
 * It assembles, it does not write. Each section comes from a named source: a
 * live query against a real table, or text the Boss supplied. A section whose
 * source produced nothing is recorded as absent, with the reason, rather than
 * filled with something plausible — the same rule Today follows for a subsystem
 * that does not exist yet.
 *
 * The output is a real file in R2 with a per-section manifest and a hash of the
 * whole, so "this is the document I sent" is a checkable claim later.
 */

import type { Env } from "../env";
import { newId, sha256Hex } from "../lib/id";
import { badRequest } from "../lib/http";

export interface SectionSpec {
  key: string;
  title: string;
  /** Where the content comes from: a named live source, or supplied text. */
  source: string;
  text?: string;
}

export interface CompiledSection {
  key: string;
  title: string;
  source: string;
  body: string;
  present: boolean;
  reason: string | null;
  bytes: number;
  sha256: string;
}

/**
 * The live sources a document may draw on. Each one reads a real table, and
 * each returns markdown or null — null meaning "nothing to say", which is
 * recorded as absence rather than as an empty section.
 */
export const LIVE_SOURCES: Record<string, { label: string; run: (env: Env) => Promise<string | null> }> = {
  "today.summary": {
    label: "Today's briefing lines",
    run: async (env) => {
      const day = await env.DB
        .prepare(`SELECT id, day_flow_json FROM days ORDER BY date_ts DESC LIMIT 1`)
        .first<{ id: string; day_flow_json: string | null }>();
      if (!day?.day_flow_json) return null;
      const blocks = JSON.parse(day.day_flow_json) as { key: string; content: any }[];
      const briefing = blocks.find((b) => b.key === "executive_briefing");
      if (!briefing?.content?.lines?.length) return null;
      return briefing.content.lines.map((l: string) => `- ${l}`).join("\n");
    },
  },
  "capital.book": {
    label: "The book, by track",
    run: async (env) => {
      const rows = await env.DB
        .prepare(
          `SELECT t.name, COALESCE(SUM(CASE WHEN a.kind IN ('returned','written_off') THEN -a.amount_micros ELSE a.amount_micros END),0) AS allocated
             FROM wealth_tracks t LEFT JOIN capital_allocations a ON a.track_id = t.id
            WHERE t.status <> 'closed' GROUP BY t.id ORDER BY allocated DESC`,
        )
        .all<{ name: string; allocated: number }>();
      const list = rows.results ?? [];
      if (list.length === 0) return null;
      return list.map((t) => `- ${t.name}: $${(t.allocated / 1_000_000).toFixed(0)}`).join("\n");
    },
  },
  "decisions.recent": {
    label: "Decisions committed recently",
    run: async (env) => {
      const rows = await env.DB
        .prepare(`SELECT title, chosen_option, committed_at FROM decisions WHERE status IN ('committed','resolved') ORDER BY committed_at DESC LIMIT 10`)
        .all<{ title: string; chosen_option: string | null; committed_at: number | null }>();
      const list = rows.results ?? [];
      if (list.length === 0) return null;
      return list
        .map((d) => `- ${d.title} — ${d.chosen_option ?? "unrecorded"}${d.committed_at ? ` (${new Date(d.committed_at).toISOString().slice(0, 10)})` : ""}`)
        .join("\n");
    },
  },
  "calibration.latest": {
    label: "The current calibration score",
    run: async (env) => {
      const row = await env.DB
        .prepare(`SELECT predictions_scored, brier_score_bps, overconfidence_bps FROM calibrations ORDER BY ts DESC LIMIT 1`)
        .first<{ predictions_scored: number; brier_score_bps: number | null; overconfidence_bps: number | null }>();
      if (!row || row.predictions_scored === 0) return null;
      return [
        `- Predictions scored: ${row.predictions_scored}`,
        `- Brier score: ${((row.brier_score_bps ?? 0) / 10_000).toFixed(2)}`,
        `- Over/under-confidence: ${((row.overconfidence_bps ?? 0) / 100).toFixed(1)} points`,
      ].join("\n");
    },
  },
  "knowledge.manual": {
    label: "The Personal Operating Manual, by section",
    run: async (env) => {
      const row = await env.DB.prepare(`SELECT version, sections FROM manual_versions ORDER BY version DESC LIMIT 1`).first<{ version: number; sections: string }>();
      if (!row) return null;
      const sections = JSON.parse(row.sections) as { title: string; entries: { title: string }[] }[];
      if (sections.length === 0) return null;
      return sections.map((s) => `- ${s.title}: ${s.entries.length} entr${s.entries.length === 1 ? "y" : "ies"}`).join("\n");
    },
  },
  "governance.flags": {
    label: "Open compliance flags",
    run: async (env) => {
      const rows = await env.DB
        .prepare(`SELECT watch_key, summary FROM compliance_flags WHERE status = 'open' ORDER BY ts DESC LIMIT 10`)
        .all<{ watch_key: string; summary: string }>();
      const list = rows.results ?? [];
      if (list.length === 0) return null;
      return list.map((f) => `- ${f.summary}`).join("\n");
    },
  },
  "relationships.overdue": {
    label: "Commitments that are late",
    run: async (env) => {
      const rows = await env.DB
        .prepare(
          `SELECT f.title, p.full_name, f.due_at FROM follow_ups f JOIN people p ON p.id = f.person_id
            WHERE f.status = 'open' AND f.due_at < ? ORDER BY f.due_at ASC LIMIT 10`,
        )
        .bind(Date.now())
        .all<{ title: string; full_name: string; due_at: number }>();
      const list = rows.results ?? [];
      if (list.length === 0) return null;
      return list.map((f) => `- ${f.title} — ${f.full_name} (due ${new Date(f.due_at).toISOString().slice(0, 10)})`).join("\n");
    },
  },
};

/** `supplied` means the text came with the request rather than from a table. */
export const SUPPLIED_SOURCE = "supplied";

export interface CompileResult {
  artifactId: string;
  name: string;
  r2_key: string;
  bytes: number;
  sha256: string;
  sections: CompiledSection[];
  manifest: Record<string, unknown>;
  document: string;
}

/**
 * Compiles one document. Deterministic given the same rows: the manifest hashes
 * the content, and the generation time is kept out of the hashed body so a
 * recompile that changed nothing is visibly the same document.
 */
export async function compileDocument(
  env: Env,
  args: { jobId: string; name: string; title: string; sections: SectionSpec[]; note?: string | null },
  now = Date.now(),
): Promise<CompileResult> {
  if (args.sections.length === 0) throw badRequest("A document needs at least one section");

  const compiled: CompiledSection[] = [];
  for (const spec of args.sections) {
    let body: string | null = null;
    let reason: string | null = null;

    if (spec.source === SUPPLIED_SOURCE) {
      body = (spec.text ?? "").trim() || null;
      if (!body) reason = "Nothing was supplied for this section.";
    } else {
      const source = LIVE_SOURCES[spec.source];
      if (!source) throw badRequest(`"${spec.source}" is not a source this compiler knows`, `One of: ${SUPPLIED_SOURCE}, ${Object.keys(LIVE_SOURCES).join(", ")}.`);
      body = await source.run(env);
      if (!body) reason = `${source.label} returned nothing. Recorded as absent rather than filled.`;
    }

    const text = body ?? `_${reason}_`;
    compiled.push({
      key: spec.key,
      title: spec.title,
      source: spec.source,
      body: text,
      present: body !== null,
      reason,
      bytes: new TextEncoder().encode(text).byteLength,
      sha256: await sha256Hex(text),
    });
  }

  const document = [
    `# ${args.title}`,
    "",
    ...compiled.flatMap((s) => [`## ${s.title}`, "", s.body, ""]),
  ].join("\n");

  const bytes = new TextEncoder().encode(document);
  const sha = await sha256Hex(document);
  const artifactId = newId("dar");
  const r2Key = `documents/${new Date(now).toISOString()}-${artifactId}.md`;

  await env.VAULT.put(r2Key, bytes, {
    httpMetadata: { contentType: "text/markdown" },
    customMetadata: { sha256: sha, artifactId },
  });

  const manifest = {
    name: args.name,
    title: args.title,
    compiled_at: now,
    sha256: sha,
    bytes: bytes.byteLength,
    note: args.note ?? null,
    sections: compiled.map((s) => ({
      key: s.key, title: s.title, source: s.source, present: s.present,
      reason: s.reason, bytes: s.bytes, sha256: s.sha256,
    })),
    absent: compiled.filter((s) => !s.present).map((s) => ({ key: s.key, reason: s.reason })),
    sources_available: [SUPPLIED_SOURCE, ...Object.keys(LIVE_SOURCES)],
  };

  await env.DB
    .prepare(
      `INSERT INTO document_artifacts (id, job_id, name, format, r2_key, bytes, sha256, sections, manifest, created_at)
       VALUES (?,?,?,'markdown',?,?,?,?,?,?)`,
    )
    .bind(
      artifactId, args.jobId, args.name, r2Key, bytes.byteLength, sha,
      JSON.stringify(manifest.sections), JSON.stringify(manifest), now,
    )
    .run();

  return { artifactId, name: args.name, r2_key: r2Key, bytes: bytes.byteLength, sha256: sha, sections: compiled, manifest, document };
}

/** Re-reads the artifact from R2 and re-hashes it. A manifest nobody checks is a promise. */
export async function verifyArtifact(env: Env, id: string): Promise<{
  ok: boolean;
  sha_match: boolean;
  bytes: number;
  reason: string | null;
}> {
  const row = await env.DB
    .prepare(`SELECT r2_key, sha256, bytes FROM document_artifacts WHERE id = ?`)
    .bind(id)
    .first<{ r2_key: string; sha256: string; bytes: number }>();
  if (!row) return { ok: false, sha_match: false, bytes: 0, reason: "No artifact with that id" };

  const object = await env.VAULT.get(row.r2_key);
  if (!object) return { ok: false, sha_match: false, bytes: 0, reason: "The artifact is not in R2" };

  const text = await object.text();
  const sha = await sha256Hex(text);
  return {
    ok: sha === row.sha256,
    sha_match: sha === row.sha256,
    bytes: new TextEncoder().encode(text).byteLength,
    reason: sha === row.sha256 ? null : "The hash does not match what was recorded when it was written",
  };
}
