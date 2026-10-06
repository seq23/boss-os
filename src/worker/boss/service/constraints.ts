/**
 * HER STANDING CONSTRAINTS, AND THE ONE PRACTICES BLOCK EVERY EMPLOYEE RUN READS (R19, 6 Oct 2026).
 *
 * A line she marks `Always: …`, `Never: …`, `Standing rule: …` or `Constraint: …` in any email to
 * boss@ is registered here (`standingConstraintsIn`), once, and from then on rides in front of every
 * employee's work in `servicePracticesBlock` — obeyed without restating, never asked about.
 *
 * West Peek OS keeps one register per partner; Boss OS has one principal, so it keeps one register.
 */
import type { Env } from "../env";
import { newId } from "../lib/id";
import { servicePracticesBlock } from "../../../shared/boss/service/practices.mjs";

const keyOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Register the lines; returns how many were new. The same rule said twice is one row. */
export async function recordConstraints(env: Env, lines: readonly string[], source: string, mailId: string | null): Promise<number> {
  let added = 0;
  for (const body of lines.map((l) => String(l).replace(/\s+/g, " ").trim()).filter((l) => l.length >= 6).slice(0, 20)) {
    const out = await env.DB
      .prepare(
        `INSERT INTO boss_operator_constraint (id, body, body_key, source, mail_id, created_at)
         VALUES (?,?,?,?,?,?) ON CONFLICT(body_key) DO NOTHING`,
      )
      .bind(newId("con"), body.slice(0, 400), keyOf(body).slice(0, 400), source.slice(0, 120), mailId, Date.now())
      .run();
    added += out.meta?.changes ?? 0;
  }
  return added;
}

/** Every constraint on record, oldest first. */
export async function constraintsOnRecord(db: D1Database): Promise<string[]> {
  const rows = await db.prepare(`SELECT body FROM boss_operator_constraint ORDER BY created_at ASC, id ASC LIMIT 40`).all<{ body: string }>();
  return (rows.results ?? []).map((r) => r.body);
}

/**
 * The block for a prompt. NOT wrapped in a try/catch, like the firm's notices: an employee running
 * without the standing practices, quietly, is worse than a task that fails saying they could not be read.
 */
export async function practicesBlock(db: D1Database): Promise<string> {
  return servicePracticesBlock(await constraintsOnRecord(db));
}
