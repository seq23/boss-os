/** Small typed accessors over the settings table. */

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = ?`).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function getSettings(db: D1Database, keys: string[]): Promise<Record<string, string>> {
  if (!keys.length) return {};
  const placeholders = keys.map(() => "?").join(",");
  const rows = await db
    .prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
    .bind(...keys)
    .all<{ key: string; value: string }>();
  const out: Record<string, string> = {};
  for (const r of rows.results ?? []) out[r.key] = r.value;
  return out;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, Date.now())
    .run();
}

export async function getBool(db: D1Database, key: string, fallback: boolean): Promise<boolean> {
  const v = await getSetting(db, key);
  if (v === null) return fallback;
  return v === "true" || v === "1";
}

export async function getNumber(db: D1Database, key: string, fallback: number): Promise<number> {
  const v = await getSetting(db, key);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
