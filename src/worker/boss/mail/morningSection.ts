/**
 * ONE way a Worker producer writes its section of Simone's morning email: checked by
 * morningSectionProblems (the same rule the Mac's writer and POST /morning/section use), then
 * upserted fresh. Returns the problems; an empty list means it was written.
 * `onceADay` keeps a section already written today (the 8Raise footer's rule).
 */
import { morningSectionProblems } from "../../../shared/boss/mail/morningSections.mjs";

export async function putMorningSection(
  db: D1Database,
  a: { section: string; job: string | null | undefined; day: string; obj: unknown; now: number; onceADay?: boolean },
): Promise<string[]> {
  const problems = morningSectionProblems(a.obj as any);
  if (problems.length) return problems;
  await db.prepare(
    `INSERT INTO morning_sections (section, job, day, body, status, told_at, created_at, updated_at) VALUES (?,?,?,?,'fresh',NULL,?,?)
     ON CONFLICT(section) DO UPDATE SET job = excluded.job, day = excluded.day, body = excluded.body, status = 'fresh', told_at = NULL, updated_at = excluded.updated_at${a.onceADay ? " WHERE morning_sections.day != excluded.day" : ""}`,
  ).bind(a.section, a.job ?? null, a.day, JSON.stringify(a.obj), a.now, a.now).run();
  return [];
}
