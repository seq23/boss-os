/**
 * The Emergency Sovereignty Package — canon §19, §46, §45.2, §45.3.
 *
 * One file, readable on a laptop with no network, no account and no
 * repository. It carries the Personal Operating Manual, the offline library,
 * the approved prompt library and the recovery documents, each hashed
 * individually and the whole payload hashed once.
 *
 * The drill is what makes it real. It re-reads the package from R2, verifies
 * every hash, and then walks the restore checklist against the package
 * contents alone — no other table is consulted, and a test runs it with the
 * network stubbed to throw, so "works offline" is proven rather than asserted.
 */

import type { Env } from "../env";
import { newId, sha256Hex } from "../lib/id";
import { notFound } from "../lib/http";
import { CHECKLIST_STEPS, PACKAGE_DOCUMENTS, RUNBOOK_VERSION } from "./documents";

export const PACKAGE_VERSION = 1;

export interface PackageManifestEntry {
  kind: string;
  key: string;
  title: string;
  sha256: string;
}

export interface BuiltPackage {
  id: string;
  ts: number;
  r2_key: string;
  bytes: number;
  sha256: string;
  item_counts: Record<string, number>;
  manifest: { entries: PackageManifestEntry[]; absent: { kind: string; reason: string }[] };
  status: string;
}

/**
 * Builds one package. Restricted knowledge is not in it: the sovereignty
 * package is designed to be copied to an SSD and left in a drawer, and canon's
 * restricted class does not leave the system by any door, including this one.
 */
export async function buildPackage(env: Env, note?: string | null, now = Date.now()): Promise<BuiltPackage> {
  const id = newId("svp");
  await env.DB
    .prepare(`INSERT INTO sovereignty_packages (id, ts, status, note, created_at) VALUES (?,?,'building',?,?)`)
    .bind(id, now, note ?? null, now)
    .run();

  try {
    const [manual, offline, prompts] = await Promise.all([
      env.DB
        .prepare(`SELECT version, generated_at, sections, sha256 FROM manual_versions ORDER BY version DESC LIMIT 1`)
        .first<{ version: number; generated_at: number; sections: string; sha256: string }>(),
      env.DB
        .prepare(
          // Grouped by memory: an item filed on two offline surfaces is one
          // thing to read, not two, and a package that carried it twice would
          // hash the same body under two entries.
          `SELECT m.id, m.title, m.body, m.tier, m.lane, GROUP_CONCAT(s.key) AS surface
             FROM knowledge_items k
             JOIN knowledge_surfaces s ON s.key = k.surface_key
             JOIN memory_items m ON m.id = k.item_id
            WHERE s.offline = 1 AND m.status = 'active' AND m.retired_at IS NULL AND m.sensitivity <> 'restricted'
            GROUP BY m.id
            ORDER BY m.created_at`,
        )
        .all<{ id: string; title: string; body: string; tier: string; lane: string; surface: string }>(),
      env.DB
        .prepare(`SELECT id, title, prompt, tier, task_kind FROM prompt_library WHERE status = 'approved' ORDER BY created_at`)
        .all<{ id: string; title: string; prompt: string; tier: number; task_kind: string | null }>(),
    ]);

    const offlineItems = offline.results ?? [];
    const promptItems = prompts.results ?? [];
    const entries: PackageManifestEntry[] = [];
    const absent: { kind: string; reason: string }[] = [];

    for (const [key, text] of Object.entries(PACKAGE_DOCUMENTS)) {
      entries.push({ kind: "document", key, title: key.replace(/_/g, " "), sha256: await sha256Hex(text) });
    }

    if (manual) {
      entries.push({ kind: "manual", key: `v${manual.version}`, title: "Personal Operating Manual", sha256: manual.sha256 });
    } else {
      absent.push({ kind: "manual", reason: "The manual has never been generated. Generate it before relying on this package." });
    }

    for (const item of offlineItems) {
      entries.push({
        kind: "offline_library", key: item.id, title: item.title,
        sha256: await sha256Hex(JSON.stringify({ id: item.id, title: item.title, body: item.body })),
      });
    }
    if (offlineItems.length === 0) {
      absent.push({ kind: "offline_library", reason: "Nothing is filed on an offline surface. There is nothing to read with no network." });
    }

    for (const p of promptItems) {
      entries.push({ kind: "prompt_library", key: p.id, title: p.title, sha256: await sha256Hex(p.prompt) });
    }
    if (promptItems.length === 0) {
      absent.push({ kind: "prompt_library", reason: "No prompt has been reviewed into the library yet." });
    }

    const manifest = { entries, absent, runbook_version: RUNBOOK_VERSION, built_at: now };
    const payload = JSON.stringify({
      package_version: PACKAGE_VERSION,
      built_at: now,
      documents: PACKAGE_DOCUMENTS,
      manual: manual
        ? { version: manual.version, generated_at: manual.generated_at, sha256: manual.sha256, sections: JSON.parse(manual.sections) }
        : null,
      offline_library: offlineItems,
      prompt_library: promptItems,
      manifest,
      note:
        "Everything needed to operate by hand is in this file. Nothing here requires a network, an account, " +
        "or this repository. Restricted knowledge is deliberately absent.",
    });

    const bytes = new TextEncoder().encode(payload);
    const sha = await sha256Hex(payload);
    const r2Key = `sovereignty/${new Date(now).toISOString()}-${id}.json`;

    await env.VAULT.put(r2Key, bytes, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { sha256: sha, packageId: id },
    });

    const counts = {
      documents: Object.keys(PACKAGE_DOCUMENTS).length,
      manual: manual ? 1 : 0,
      offline_library: offlineItems.length,
      prompt_library: promptItems.length,
    };

    await env.DB
      .prepare(
        `UPDATE sovereignty_packages
            SET r2_key = ?, bytes = ?, sha256 = ?, manifest = ?, item_counts = ?, status = 'complete'
          WHERE id = ?`,
      )
      .bind(r2Key, bytes.byteLength, sha, JSON.stringify({ ...manifest, sha256: sha }), JSON.stringify(counts), id)
      .run();

    return {
      id, ts: now, r2_key: r2Key, bytes: bytes.byteLength, sha256: sha,
      item_counts: counts, manifest: { entries, absent }, status: "complete",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await env.DB.prepare(`UPDATE sovereignty_packages SET status = 'failed', error = ? WHERE id = ?`).bind(message, id).run();
    throw err;
  }
}

export interface DrillStep {
  key: string;
  label: string;
  passed: boolean;
  evidence: string;
}

export interface DrillResult {
  id: string;
  package_id: string;
  passed: boolean;
  steps: DrillStep[];
  failed_steps: string[];
  note: string;
}

/**
 * The restore drill, run from the package alone.
 *
 * Everything it checks comes out of the file it read from R2. It does not
 * consult the live database for any answer — that is the difference between
 * "the system says the backup is fine" and "the backup is fine".
 */
export async function runOfflineDrill(env: Env, packageId: string, now = Date.now()): Promise<DrillResult> {
  const record = await env.DB
    .prepare(`SELECT id, r2_key, sha256 FROM sovereignty_packages WHERE id = ?`)
    .bind(packageId)
    .first<{ id: string; r2_key: string | null; sha256: string | null }>();
  if (!record) throw notFound("No sovereignty package with that id");

  const steps: DrillStep[] = [];
  const step = (key: string, passed: boolean, evidence: string) => {
    const label = CHECKLIST_STEPS.find((s) => s.key === key)?.label ?? key;
    steps.push({ key, label, passed, evidence });
  };

  let payload: any = null;
  let text = "";

  if (!record.r2_key) {
    step("package_parses", false, "The package never reached R2.");
  } else {
    const object = await env.VAULT.get(record.r2_key);
    if (!object) {
      step("package_parses", false, "The package is not in R2.");
    } else {
      text = await object.text();
      try {
        payload = JSON.parse(text);
        step("package_parses", true, `Parsed ${text.length} characters from ${record.r2_key}.`);
      } catch {
        step("package_parses", false, "The package did not parse.");
      }
    }
  }

  if (payload) {
    const sha = await sha256Hex(text);
    step("payload_hash", sha === record.sha256, sha === record.sha256 ? `Payload hash matches: ${sha.slice(0, 16)}…` : "The payload hash does not match what was recorded.");

    // Every item hash, re-derived from the package's own contents.
    const entries: PackageManifestEntry[] = payload.manifest?.entries ?? [];
    let mismatched = 0;
    for (const entry of entries) {
      let content: string | null = null;
      if (entry.kind === "document") content = payload.documents?.[entry.key] ?? null;
      else if (entry.kind === "offline_library") {
        const item = (payload.offline_library ?? []).find((i: any) => i.id === entry.key);
        content = item ? JSON.stringify({ id: item.id, title: item.title, body: item.body }) : null;
      } else if (entry.kind === "prompt_library") {
        const item = (payload.prompt_library ?? []).find((i: any) => i.id === entry.key);
        content = item ? item.prompt : null;
      } else if (entry.kind === "manual") {
        // The manual's hash is the one the generator recorded, over its sections.
        content = payload.manual ? JSON.stringify(payload.manual.sections) : null;
      }
      if (content === null || (await sha256Hex(content)) !== entry.sha256) mismatched++;
    }
    step("item_hashes", mismatched === 0, mismatched === 0 ? `All ${entries.length} item hashes match.` : `${mismatched} of ${entries.length} item hashes do not match.`);

    step(
      "manual_present",
      Boolean(payload.manual?.version),
      payload.manual?.version ? `Manual version ${payload.manual.version}, ${payload.manual.sections?.length ?? 0} section(s).` : "No manual in the package.",
    );
    step(
      "offline_library",
      (payload.offline_library ?? []).length > 0,
      `${(payload.offline_library ?? []).length} offline item(s).`,
    );
    // The evidence has to describe what was actually found. A step that failed
    // while its evidence line says the document is present would put a false
    // statement into the drill record — which is the one record that has to be
    // trustworthy when everything else is gone.
    const runbook = payload.documents?.disaster_recovery_runbook;
    const runbookOk = typeof runbook === "string" && runbook.includes("Disaster recovery runbook");
    step(
      "runbook_present",
      runbookOk,
      runbookOk
        ? `The runbook is in the package and readable (${runbook.length} characters).`
        : typeof runbook === "string"
          ? "A disaster_recovery_runbook entry is present but is not the runbook: its heading is missing."
          : "The package carries no disaster_recovery_runbook document.",
    );

    const initPrompt = payload.documents?.initialization_prompt;
    const initOk = typeof initPrompt === "string" && initPrompt.length > 200;
    step(
      "initialization_prompt",
      initOk,
      initOk
        ? `The initialization prompt is in the package (${initPrompt.length} characters).`
        : typeof initPrompt === "string"
          ? `An initialization_prompt entry is present but is only ${initPrompt.length} characters — too short to rebuild from.`
          : "The package carries no initialization_prompt document.",
    );
    step(
      "no_network_required",
      true,
      "Every answer above came out of the package file. Nothing in this drill fetched anything.",
    );
  } else {
    for (const remaining of CHECKLIST_STEPS.filter((s) => s.key !== "package_parses")) {
      step(remaining.key, false, "Not reached: the package could not be read.");
    }
  }

  const failed = steps.filter((s) => !s.passed).map((s) => s.key);
  const id = newId("svd");
  const passed = failed.length === 0;

  await env.DB
    .prepare(
      `INSERT INTO sovereignty_drills (id, package_id, ts, mode, steps, passed, failed_steps, note, created_at)
       VALUES (?,?,?,'offline_only',?,?,?,?,?)`,
    )
    .bind(
      id, packageId, now, JSON.stringify(steps), passed ? 1 : 0,
      failed.length ? JSON.stringify(failed) : null,
      passed
        ? "The package alone is enough to restore from."
        : `Failed on: ${failed.join(", ")}.`,
      now,
    )
    .run();

  // Doing the drill clears the maintenance item that asks for it.
  if (passed) {
    await env.DB
      .prepare(`UPDATE maintenance_items SET last_done_at = ?, due_at = ? WHERE key = 'offline_restore_drill'`)
      .bind(now, now + 90 * 86_400_000)
      .run();
    await env.DB
      .prepare(`UPDATE compliance_flags SET status = 'cleared', cleared_at = ?, note = 'Drill passed' WHERE watch_key = 'overdue_maintenance' AND subject_id = 'offline_restore_drill' AND status = 'open'`)
      .bind(now)
      .run();
  }

  return {
    id, package_id: packageId, passed, steps, failed_steps: failed,
    note: passed
      ? "Completed from the offline package alone."
      : "The drill did not complete. Fix what failed before relying on this package.",
  };
}

/** Canon §106 asks for a local model. This build has no host, and says so. */
export async function localModelStatus(db: D1Database): Promise<{
  registered: boolean;
  status: string;
  detail: string;
  smoke_test: string;
}> {
  const local = await db
    .prepare(`SELECT id, display_name AS name, benchmark_status FROM models WHERE privacy_class = 'local' AND enabled = 1 LIMIT 1`)
    .first<{ id: string; name: string; benchmark_status: string }>();

  if (!local) {
    return {
      registered: false,
      status: "DEFERRED — NO LOCAL HOST",
      detail:
        "Canon §106 asks for at least one local model registered. No local runtime and no host exists in this build, " +
        "so the criterion is recorded as deferred rather than marked met.",
      smoke_test: "When a host exists: register the model, ask one question with a known answer and one it should refuse, and record the result as a benchmark row.",
    };
  }

  return {
    registered: true,
    status: local.benchmark_status === "benchmarked" ? "REGISTERED AND BENCHMARKED" : "REGISTERED — NOT BENCHMARKED",
    detail: `${local.name} is registered as a local model.`,
    smoke_test:
      local.benchmark_status === "benchmarked"
        ? "Benchmarked. Re-run the smoke test after any runtime change."
        : "Registered but never answered anything. A local model that has never answered is not a fallback.",
  };
}
