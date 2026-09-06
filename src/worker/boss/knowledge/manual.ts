/**
 * The Personal Operating Manual — canon §45.
 *
 * It is generated from promoted memory and never typed. That is the whole
 * design: a manual somebody writes by hand is an aspiration, and a manual
 * assembled from what actually earned promotion is a description.
 *
 * Regeneration is content-addressed. If nothing has changed since the last
 * version, no version is written — "it regenerated" and "it changed" are
 * different claims, and a version list that grows on every button press cannot
 * tell you which.
 */

import { newId, sha256Hex } from "../lib/id";

/** Only promoted memory reaches the manual. Capture is a note, not a rule. */
export const MANUAL_TIERS = ["working", "canon"] as const;

/** Restricted knowledge is held, but it does not go into a document meant to be read aloud. */
export const MANUAL_EXCLUDED_SENSITIVITY = "restricted";

export interface ManualEntry {
  item_id: string;
  title: string;
  body: string;
  tier: string;
  lane: string;
  filed_at: number;
  note: string | null;
}

export interface ManualSection {
  surface: string;
  title: string;
  description: string;
  entries: ManualEntry[];
}

export interface ManualVersion {
  id: string;
  version: number;
  generated_at: number;
  sections: ManualSection[];
  item_count: number;
  sha256: string;
  supersedes_id: string | null;
  unchanged: boolean;
  /** Filings on manual surfaces that were left out, and why. Filings, not distinct memories. */
  excluded: { retired: number; restricted: number; unpromoted: number };
}

interface Row {
  surface_key: string;
  surface_name: string;
  surface_description: string;
  surface_order: number;
  item_id: string;
  title: string;
  body: string;
  tier: string;
  lane: string;
  filed_at: number;
  note: string | null;
}

/**
 * Builds the manual from what is currently filed, promoted, live and not
 * restricted — and counts what it left out, so the document can say what it is
 * not showing rather than quietly being incomplete.
 */
export async function generateManual(
  db: D1Database,
  now = Date.now(),
  note?: string | null,
): Promise<ManualVersion> {
  const rows = await db
    .prepare(
      `SELECT s.key AS surface_key, s.name AS surface_name, s.description AS surface_description,
              s.surface_order, m.id AS item_id, m.title, m.body, m.tier, m.lane,
              k.filed_at, k.note
         FROM knowledge_items k
         JOIN knowledge_surfaces s ON s.key = k.surface_key
         JOIN memory_items m ON m.id = k.item_id
        WHERE s.in_manual = 1
          AND s.backing = 'memory'
          AND m.status = 'active'
          AND m.retired_at IS NULL
          AND m.tier IN ('working','canon')
          AND m.sensitivity <> 'restricted'
        ORDER BY s.surface_order ASC, m.tier DESC, m.created_at ASC`,
    )
    .all<Row>();

  const excluded = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN m.retired_at IS NOT NULL THEN 1 ELSE 0 END),0) AS retired,
         COALESCE(SUM(CASE WHEN m.retired_at IS NULL AND m.sensitivity = 'restricted' THEN 1 ELSE 0 END),0) AS restricted,
         COALESCE(SUM(CASE WHEN m.retired_at IS NULL AND m.sensitivity <> 'restricted'
                            AND m.tier NOT IN ('working','canon') THEN 1 ELSE 0 END),0) AS unpromoted
       FROM knowledge_items k
       JOIN knowledge_surfaces s ON s.key = k.surface_key
       JOIN memory_items m ON m.id = k.item_id
      WHERE s.in_manual = 1 AND s.backing = 'memory' AND m.status = 'active'`,
    )
    .first<{ retired: number; restricted: number; unpromoted: number }>();

  const sections: ManualSection[] = [];
  for (const row of rows.results ?? []) {
    let section = sections.find((s) => s.surface === row.surface_key);
    if (!section) {
      section = {
        surface: row.surface_key,
        title: row.surface_name,
        description: row.surface_description,
        entries: [],
      };
      sections.push(section);
    }
    section.entries.push({
      item_id: row.item_id,
      title: row.title,
      body: row.body,
      tier: row.tier,
      lane: row.lane,
      filed_at: row.filed_at,
      note: row.note,
    });
  }

  const sourceIds = sections.flatMap((s) => s.entries.map((e) => e.item_id));
  // Hashed over the content only. The generation timestamp is deliberately not
  // part of it, or every regeneration would look like a change.
  const sha = await sha256Hex(JSON.stringify(sections));

  const latest = await db
    .prepare(`SELECT * FROM manual_versions ORDER BY version DESC LIMIT 1`)
    .first<{ id: string; version: number; generated_at: number; sha256: string; item_count: number; supersedes_id: string | null }>();

  if (latest && latest.sha256 === sha) {
    return {
      id: latest.id,
      version: latest.version,
      generated_at: latest.generated_at,
      sections,
      item_count: latest.item_count,
      sha256: sha,
      supersedes_id: latest.supersedes_id,
      unchanged: true,
      excluded: {
        retired: excluded?.retired ?? 0,
        restricted: excluded?.restricted ?? 0,
        unpromoted: excluded?.unpromoted ?? 0,
      },
    };
  }

  const id = newId("man");
  const version = (latest?.version ?? 0) + 1;
  await db
    .prepare(
      `INSERT INTO manual_versions
         (id, version, generated_at, sections, source_item_ids, item_count, sha256, supersedes_id, note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, version, now, JSON.stringify(sections), JSON.stringify(sourceIds),
      sourceIds.length, sha, latest?.id ?? null, note ?? null, now,
    )
    .run();

  return {
    id,
    version,
    generated_at: now,
    sections,
    item_count: sourceIds.length,
    sha256: sha,
    supersedes_id: latest?.id ?? null,
    unchanged: false,
    excluded: {
      retired: excluded?.retired ?? 0,
      restricted: excluded?.restricted ?? 0,
      unpromoted: excluded?.unpromoted ?? 0,
    },
  };
}
