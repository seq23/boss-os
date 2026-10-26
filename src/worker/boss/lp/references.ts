/**
 * WARM REFERENCES (owner, 26 Oct 2026): the exact warm line an email sent to a person carried, and
 * its link, kept on that person's record so Simone's meeting prep can say "You wrote: …".
 *
 * Stored when the email is recorded as sent (recordProspectEvents, backfillTouches): one place, so
 * nothing that sends can skip it. Extraction is the shared rule (extractWarmReferences). The link is
 * checked on her Mac before it is ever quoted; `verified` is null until then.
 */
import { extractWarmReferences } from "../../../shared/boss/meetingPrep/prep.mjs";
import { newId } from "../lib/id";

export async function storeWarmReferences(db: D1Database, email: string, body: string | null | undefined, sentAt: number, source = "prospect_email"): Promise<number> {
  const refs = extractWarmReferences(body ?? "");
  const addr = String(email ?? "").toLowerCase().trim();
  if (!addr || refs.length === 0) return 0;
  for (const r of refs) {
    await db.prepare(
      `INSERT INTO warm_references (id, email, line, url, source, sent_at, created_at) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(email, url) DO UPDATE SET line = excluded.line, sent_at = MAX(warm_references.sent_at, excluded.sent_at)`,
    ).bind(newId("wrf"), addr, r.line, r.url, source, Math.floor(sentAt), Date.now()).run();
  }
  return refs.length;
}

/** Every prospect email on record since `since`: its warm lines stored. The 1 Sep backfill. */
export async function backfillWarmReferences(db: D1Database, since: number): Promise<{ scanned: number; stored: number }> {
  const rows = (await db.prepare(
    `SELECT p.email, t.body, t.sent_at FROM prospect_touches t JOIN prospects p ON p.id = t.prospect_id WHERE t.sent_at >= ? AND t.body IS NOT NULL`,
  ).bind(since).all<{ email: string; body: string; sent_at: number }>()).results ?? [];
  let stored = 0;
  for (const r of rows) stored += await storeWarmReferences(db, r.email, r.body, r.sent_at);
  return { scanned: rows.length, stored };
}

export async function listWarmReferences(db: D1Database) {
  return (await db.prepare(`SELECT email, line, url, source, sent_at, verified, checked_at FROM warm_references ORDER BY sent_at DESC LIMIT 2000`).all<any>()).results ?? [];
}

/** Her Mac's link check: `verified` 1 when it resolves, 0 when it does not (never quoted then). */
export async function markWarmReferences(db: D1Database, checks: Array<{ email: string; url: string; ok: boolean }>): Promise<number> {
  let n = 0;
  for (const c of checks) {
    const r = await db.prepare(`UPDATE warm_references SET verified = ?, checked_at = ? WHERE email = ? AND url = ?`)
      .bind(c.ok ? 1 : 0, Date.now(), String(c.email).toLowerCase(), String(c.url)).run();
    n += r.meta?.changes ?? 0;
  }
  return n;
}
