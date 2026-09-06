/**
 * Phase 23 — continuity hardening.
 *
 * Canon §19, §46, §45.2, §45.3. The vault already snapshots, verifies, restores
 * and drills; this completes the Emergency Sovereignty Package around it — one
 * portable file, the documents that make it usable, and a drill that proves the
 * file alone is enough.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound } from "../lib/http";
import { sha256Hex } from "../lib/id";
import {
  CHECKLIST_STEPS, DISASTER_RECOVERY_RUNBOOK, INITIALIZATION_PROMPT, RESTORE_CHECKLIST, RUNBOOK_VERSION,
} from "../continuity/documents";
import { buildPackage, localModelStatus, runOfflineDrill } from "../continuity/sovereignty";

export const continuity = new Hono<{ Bindings: Env; Variables: Vars }>();

const DAY_MS = 86_400_000;

// ─── The documents ────────────────────────────────────────────────────────────

continuity.get("/runbook", async (c) =>
  ok(c, {
    version: RUNBOOK_VERSION,
    markdown: DISASTER_RECOVERY_RUNBOOK,
    note: "Carried verbatim in every sovereignty package, so it is readable when this endpoint is not.",
  }),
);

continuity.get("/checklist", async (c) =>
  ok(c, {
    markdown: RESTORE_CHECKLIST,
    steps: CHECKLIST_STEPS,
    note: "The drill checks exactly these steps against the package.",
  }),
);

continuity.get("/initialization-prompt", async (c) =>
  ok(c, {
    markdown: INITIALIZATION_PROMPT,
    note: "Hand this and a package to a system that has never seen Boss OS.",
  }),
);

// ─── The package ──────────────────────────────────────────────────────────────

continuity.get("/packages", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM sovereignty_packages ORDER BY ts DESC LIMIT 50`).all<any>();
  return ok(
    c,
    (rows.results ?? []).map((p) => ({
      ...p,
      manifest: p.manifest ? JSON.parse(p.manifest) : null,
      item_counts: p.item_counts ? JSON.parse(p.item_counts) : null,
    })),
  );
});

continuity.post("/packages", async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  const built = await buildPackage(c.env, b?.note ?? null);

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "sovereignty_package", entityId: built.id, action: "built",
    detail: { sha256: built.sha256, counts: built.item_counts },
  });
  await logEvent(c.env.DB, {
    level: built.manifest.absent.length ? "warn" : "info",
    scope: "continuity", event: "sovereignty_package_built", entityId: built.id,
    detail: { absent: built.manifest.absent.map((a) => a.kind) },
  });

  return ok(
    c,
    {
      ...built,
      note: built.manifest.absent.length
        ? `Built, with ${built.manifest.absent.length} thing(s) missing from it. Read the absent list before trusting it.`
        : "Built and complete. Verify it, then copy it.",
    },
    201,
  );
});

/** Re-reads the package from R2 and re-hashes it. */
continuity.get("/packages/:id/verify", async (c) => {
  const id = c.req.param("id");
  const record = await c.env.DB
    .prepare(`SELECT r2_key, sha256, bytes FROM sovereignty_packages WHERE id = ?`)
    .bind(id)
    .first<{ r2_key: string | null; sha256: string | null; bytes: number }>();
  if (!record) throw notFound("No package with that id");
  if (!record.r2_key) return ok(c, { ok: false, sha_match: false, reason: "The package never reached R2" });

  const object = await c.env.VAULT.get(record.r2_key);
  if (!object) return ok(c, { ok: false, sha_match: false, reason: "The package is not in R2" });

  const text = await object.text();
  const sha = await sha256Hex(text);
  const match = sha === record.sha256;

  if (match) {
    await c.env.DB.prepare(`UPDATE sovereignty_packages SET verified_at = ? WHERE id = ?`).bind(Date.now(), id).run();
  }

  return ok(c, {
    ok: match,
    sha_match: match,
    bytes: text.length,
    reason: match ? null : "The hash does not match what was recorded when it was written. Use an older copy.",
  });
});

/** The package itself, for copying to an SSD. */
continuity.get("/packages/:id/content", async (c) => {
  const record = await c.env.DB
    .prepare(`SELECT r2_key FROM sovereignty_packages WHERE id = ?`).bind(c.req.param("id"))
    .first<{ r2_key: string | null }>();
  if (!record?.r2_key) throw notFound("No package with that id, or it never reached R2");
  const object = await c.env.VAULT.get(record.r2_key);
  if (!object) throw notFound("The package is not in R2");
  return ok(c, { r2_key: record.r2_key, content: await object.text() });
});

// ─── The drill ────────────────────────────────────────────────────────────────

continuity.get("/drills", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM sovereignty_drills ORDER BY ts DESC LIMIT 50`).all<any>();
  return ok(
    c,
    (rows.results ?? []).map((d) => ({
      ...d,
      steps: JSON.parse(d.steps),
      failed_steps: d.failed_steps ? JSON.parse(d.failed_steps) : [],
      passed: Boolean(d.passed),
    })),
  );
});

/**
 * The acceptance test of this whole phase: a restore drill that completes from
 * the offline package alone.
 */
continuity.post("/drill", async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  let packageId = b?.package_id ? String(b.package_id) : null;

  if (!packageId) {
    const latest = await c.env.DB
      .prepare(`SELECT id FROM sovereignty_packages WHERE status = 'complete' ORDER BY ts DESC LIMIT 1`)
      .first<{ id: string }>();
    if (!latest) throw badRequest("No package to drill against", "Build one first at POST /api/continuity/packages.");
    packageId = latest.id;
  }

  const result = await runOfflineDrill(c.env, packageId);

  await audit(c.env.DB, {
    actor: "boss", lane: "ops", entityType: "sovereignty_drill", entityId: result.id, action: result.passed ? "passed" : "failed",
    detail: { package_id: packageId, failed_steps: result.failed_steps },
  });
  await logEvent(c.env.DB, {
    level: result.passed ? "info" : "error",
    scope: "continuity", event: "sovereignty_drill", entityId: result.id,
    detail: { passed: result.passed, failed: result.failed_steps },
  });

  return ok(c, result, 201);
});

// ─── The sovereignty status ───────────────────────────────────────────────────

/** Canon §106's local-model criterion, recorded honestly rather than met. */
continuity.get("/local-model", async (c) => ok(c, await localModelStatus(c.env.DB)));

/**
 * The whole Emergency Sovereignty Package in one read: what exists, when it was
 * last verified, when it was last drilled, and what is still missing.
 */
continuity.get("/", async (c) => {
  const now = Date.now();
  const [pkg, drill, snapshot, restore, offline, prompts, manual, local, maintenance] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM sovereignty_packages WHERE status = 'complete' ORDER BY ts DESC LIMIT 1`).first<any>(),
    c.env.DB.prepare(`SELECT * FROM sovereignty_drills ORDER BY ts DESC LIMIT 1`).first<any>(),
    c.env.DB.prepare(`SELECT ts FROM vault_snapshots WHERE status = 'complete' ORDER BY ts DESC LIMIT 1`).first<{ ts: number }>(),
    c.env.DB.prepare(`SELECT ts, status FROM vault_restores ORDER BY ts DESC LIMIT 1`).first<{ ts: number; status: string }>(),
    c.env.DB
      .prepare(
        `SELECT COUNT(DISTINCT m.id) AS n FROM knowledge_items k JOIN knowledge_surfaces s ON s.key = k.surface_key
           JOIN memory_items m ON m.id = k.item_id
          WHERE s.offline = 1 AND m.status = 'active' AND m.retired_at IS NULL`,
      )
      .first<{ n: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM prompt_library WHERE status = 'approved'`).first<{ n: number }>(),
    c.env.DB.prepare(`SELECT version FROM manual_versions ORDER BY version DESC LIMIT 1`).first<{ version: number }>(),
    localModelStatus(c.env.DB),
    c.env.DB
      .prepare(`SELECT key, title, due_at FROM maintenance_items WHERE kind = 'continuity' AND status = 'active' ORDER BY due_at`)
      .all<{ key: string; title: string; due_at: number }>(),
  ]);

  const components = [
    { key: "offline_library", label: "Offline library", present: (offline?.n ?? 0) > 0, detail: `${offline?.n ?? 0} item(s) filed on offline surfaces.` },
    { key: "operating_manual", label: "Personal Operating Manual", present: Boolean(manual), detail: manual ? `Version ${manual.version}.` : "Never generated." },
    { key: "prompt_library_backup", label: "Prompt library backup", present: (prompts?.n ?? 0) > 0, detail: `${prompts?.n ?? 0} approved prompt(s).` },
    { key: "initialization_prompt", label: "Initialization prompt", present: true, detail: "Carried in every package." },
    { key: "runbook", label: "Disaster recovery runbook", present: true, detail: `Version ${RUNBOOK_VERSION}, carried in every package.` },
    { key: "restore_checklist", label: "Restore checklist", present: true, detail: `${CHECKLIST_STEPS.length} checkable steps.` },
    { key: "sha_manifests", label: "SHA manifests", present: Boolean(pkg?.sha256), detail: pkg?.sha256 ? "Per item and per payload." : "No package built yet." },
    { key: "package", label: "Sovereignty package", present: Boolean(pkg), detail: pkg ? `Built ${Math.floor((now - pkg.ts) / DAY_MS)} day(s) ago.` : "Never built." },
    { key: "offline_drill", label: "Offline restore drill", present: Boolean(drill?.passed), detail: drill ? (drill.passed ? `Passed ${Math.floor((now - drill.ts) / DAY_MS)} day(s) ago.` : "The last drill failed.") : "Never run." },
    { key: "vault_snapshot", label: "Verified vault snapshot", present: Boolean(snapshot), detail: snapshot ? `${Math.floor((now - snapshot.ts) / DAY_MS)} day(s) old.` : "None." },
    { key: "restore_rehearsed", label: "Restore rehearsed", present: Boolean(restore), detail: restore ? `Last attempt ${restore.status}.` : "Never attempted." },
    { key: "local_model", label: "Local model", present: local.registered, detail: local.status },
  ];

  const missing = components.filter((c2) => !c2.present);
  return ok(c, {
    components,
    complete: missing.length === 0,
    missing: missing.map((m) => m.key),
    workflows: (maintenance.results ?? []).map((m) => ({ ...m, overdue: m.due_at < now })),
    verdict:
      missing.length === 0
        ? "The Emergency Sovereignty Package is complete and has been drilled."
        : `${missing.length} component(s) missing: ${missing.map((m) => m.label).join(", ")}.`,
    note:
      "Two of these — the external SSD copy and the offsite copy — are physical acts this system cannot verify. " +
      "They are tracked as maintenance items with cadences, and nothing here marks them done on their behalf.",
  });
});
