/**
 * Portable knowledge export — canon §45, §64.
 *
 * The point of a portable export is that it survives this system: a single
 * JSON file, hashed per item and as a whole, written through the existing vault
 * path in R2 and verifiable by re-reading it.
 *
 * Restricted knowledge follows the law the router already keeps: it does not
 * leave by default. Including it takes an explicit allowlist and the same kind
 * of typed confirmation the vault's replace path demands, and the export is
 * marked as containing it. What was left out is recorded in the manifest, so an
 * export can never quietly be a partial one.
 */

import type { Env } from "../env";
import { newId, sha256Hex } from "../lib/id";
import { badRequest, conflict } from "../lib/http";

export const RESTRICTED_CONFIRMATION = "INCLUDE RESTRICTED";

export interface ExportOptions {
  scope?: string;
  includeRestricted?: boolean;
  confirm?: string | null;
  note?: string | null;
}

export interface ExportManifestEntry {
  item_id: string;
  title: string;
  tier: string;
  lane: string;
  sensitivity: string;
  surfaces: string[];
  sha256: string;
}

export interface ExportResult {
  id: string;
  ts: number;
  scope: string;
  r2_key: string;
  bytes: number;
  sha256: string;
  item_count: number;
  restricted_included: number;
  restricted_excluded: number;
  manifest: {
    entries: ExportManifestEntry[];
    excluded: { item_id: string; reason: string }[];
    manual_version: number | null;
    surfaces: { key: string; name: string; items: number }[];
  };
  status: string;
}

interface ItemRow {
  id: string;
  lane: string;
  tier: string;
  title: string;
  body: string;
  sensitivity: string;
  status: string;
  retired_at: number | null;
  created_at: number;
  surfaces: string;
}

/**
 * Writes one export and its manifest. Retired memory is never exported: it
 * stopped surfacing, and an export is a surface.
 */
export async function exportKnowledge(env: Env, options: ExportOptions = {}): Promise<ExportResult> {
  const scope = options.scope ?? "all";
  const includeRestricted = Boolean(options.includeRestricted);

  if (includeRestricted && options.confirm !== RESTRICTED_CONFIRMATION) {
    throw conflict(
      "Exporting restricted knowledge needs an explicit confirmation",
      `Send confirm: "${RESTRICTED_CONFIRMATION}". Restricted content leaving the system is a decision, not a default.`,
    );
  }

  if (scope !== "all") {
    const surface = await env.DB.prepare(`SELECT key FROM knowledge_surfaces WHERE key = ?`).bind(scope).first();
    if (!surface) throw badRequest("No surface with that key", "Use 'all' or a surface key from GET /api/knowledge/surfaces.");
  }

  const id = newId("kex");
  const ts = Date.now();
  await env.DB
    .prepare(`INSERT INTO knowledge_exports (id, ts, scope, status) VALUES (?,?,?,'running')`)
    .bind(id, ts, scope)
    .run();

  try {
    const rows = await env.DB
      .prepare(
        `SELECT m.id, m.lane, m.tier, m.title, m.body, m.sensitivity, m.status, m.retired_at, m.created_at,
                (SELECT GROUP_CONCAT(k2.surface_key) FROM knowledge_items k2 WHERE k2.item_id = m.id) AS surfaces
           FROM memory_items m
          WHERE m.status = 'active'
            AND m.retired_at IS NULL
            AND EXISTS (
              SELECT 1 FROM knowledge_items k
               JOIN knowledge_surfaces s ON s.key = k.surface_key
               WHERE k.item_id = m.id AND (? = 'all' OR k.surface_key = ?)
            )
          ORDER BY m.created_at ASC`,
      )
      .bind(scope, scope)
      .all<ItemRow>();

    const entries: ExportManifestEntry[] = [];
    const excluded: { item_id: string; reason: string }[] = [];
    const documents: Record<string, unknown>[] = [];
    let restrictedIncluded = 0;
    let restrictedExcluded = 0;

    for (const row of rows.results ?? []) {
      const isRestricted = row.sensitivity === "restricted";
      if (isRestricted && !includeRestricted) {
        restrictedExcluded++;
        excluded.push({
          item_id: row.id,
          reason: "restricted class, and this export was not allowlisted for restricted content",
        });
        continue;
      }
      if (isRestricted) restrictedIncluded++;

      const surfaces = (row.surfaces ?? "").split(",").filter(Boolean);
      const document = {
        item_id: row.id,
        title: row.title,
        body: row.body,
        tier: row.tier,
        lane: row.lane,
        sensitivity: row.sensitivity,
        surfaces,
        created_at: row.created_at,
      };
      documents.push(document);
      entries.push({
        item_id: row.id,
        title: row.title,
        tier: row.tier,
        lane: row.lane,
        sensitivity: row.sensitivity,
        surfaces,
        sha256: await sha256Hex(JSON.stringify(document)),
      });
    }

    const [manual, surfaces] = await Promise.all([
      env.DB.prepare(`SELECT version, sections, sha256 FROM manual_versions ORDER BY version DESC LIMIT 1`)
        .first<{ version: number; sections: string; sha256: string }>(),
      env.DB
        .prepare(
          `SELECT s.key, s.name, COUNT(k.id) AS items
             FROM knowledge_surfaces s
        LEFT JOIN knowledge_items k ON k.surface_key = s.key
            GROUP BY s.key ORDER BY s.surface_order`,
        )
        .all<{ key: string; name: string; items: number }>(),
    ]);

    const manifest = {
      entries,
      excluded,
      manual_version: manual?.version ?? null,
      surfaces: surfaces.results ?? [],
    };

    const payload = JSON.stringify({
      export_version: 1,
      generated_at: ts,
      scope,
      restricted_included: restrictedIncluded > 0,
      documents,
      manual: manual ? { version: manual.version, sha256: manual.sha256, sections: JSON.parse(manual.sections) } : null,
      manifest,
    });

    const bytes = new TextEncoder().encode(payload);
    const sha = await sha256Hex(payload);
    const r2Key = `knowledge/${new Date(ts).toISOString()}-${id}.json`;

    await env.VAULT.put(r2Key, bytes, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { sha256: sha, exportId: id },
    });

    await env.DB
      .prepare(
        `UPDATE knowledge_exports
            SET r2_key = ?, bytes = ?, sha256 = ?, manifest = ?, item_count = ?,
                restricted_included = ?, restricted_excluded = ?, status = 'complete'
          WHERE id = ?`,
      )
      .bind(
        r2Key, bytes.byteLength, sha, JSON.stringify(manifest), entries.length,
        restrictedIncluded, restrictedExcluded, id,
      )
      .run();

    return {
      id, ts, scope, r2_key: r2Key, bytes: bytes.byteLength, sha256: sha,
      item_count: entries.length, restricted_included: restrictedIncluded,
      restricted_excluded: restrictedExcluded, manifest, status: "complete",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await env.DB
      .prepare(`UPDATE knowledge_exports SET status = 'failed', error = ? WHERE id = ?`)
      .bind(message, id)
      .run();
    throw err;
  }
}

/** Re-reads the export from R2 and re-hashes it. A manifest nobody checks is a promise. */
export async function verifyExport(env: Env, id: string): Promise<{
  ok: boolean;
  sha_match: boolean;
  bytes: number;
  items_present: number;
  items_expected: number;
  reason: string | null;
}> {
  const record = await env.DB
    .prepare(`SELECT r2_key, sha256, item_count FROM knowledge_exports WHERE id = ?`)
    .bind(id)
    .first<{ r2_key: string | null; sha256: string | null; item_count: number }>();
  if (!record?.r2_key) {
    return { ok: false, sha_match: false, bytes: 0, items_present: 0, items_expected: 0, reason: "No export with that id, or it never reached R2" };
  }

  const object = await env.VAULT.get(record.r2_key);
  if (!object) {
    return { ok: false, sha_match: false, bytes: 0, items_present: 0, items_expected: record.item_count, reason: "The export is not in R2" };
  }

  const text = await object.text();
  const sha = await sha256Hex(text);
  let itemsPresent = 0;
  try {
    itemsPresent = (JSON.parse(text).documents ?? []).length;
  } catch {
    return { ok: false, sha_match: false, bytes: text.length, items_present: 0, items_expected: record.item_count, reason: "The export did not parse" };
  }

  const shaMatch = sha === record.sha256;
  return {
    ok: shaMatch && itemsPresent === record.item_count,
    sha_match: shaMatch,
    bytes: text.length,
    items_present: itemsPresent,
    items_expected: record.item_count,
    reason: shaMatch ? null : "The hash does not match what was recorded when it was written",
  };
}
