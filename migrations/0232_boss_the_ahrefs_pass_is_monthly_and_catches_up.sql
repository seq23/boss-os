-- The Ahrefs pass runs monthly, and its seeded due date stops lying about when.
--
-- ─── Her instruction ────────────────────────────────────────────────────────
--
--   "u should look into this and fix it so danielle does this ahref sweep on a schedule
--    (1x per month is fine)"
--
-- ─── What was measured, 13 September 2026 ───────────────────────────────────
--
--   com.seq.boss-ahrefs-audit          LOADED, runs = 0, last exit code "(never exited)"
--   ~/Library/Logs/ahrefs-audit-fix/   empty — no launchd.log, no launchd.err
--   site_audit_findings                0 rows, ever
--   duty_site_audit_repair             last_run_at NULL, next_due_at 2026-09-12 00:15 (in the past)
--
-- The plist file itself is dated 11 Sep 18:06 — AFTER that week's Thursday 06:00 window. So the job
-- had never fired because its first occurrence had not come round, not because anything was broken.
-- The benign reading, and it is exactly the wrong design: a schedule with ONE chance to fire looks
-- identical whether it is waiting or dead.
--
-- ─── The real defect this migration fixes ───────────────────────────────────
--
-- 0227 seeded `next_due_at` as `unixepoch() * 1000 + 86400000` — TOMORROW — on a WEEKLY Thursday
-- duty. Its own comment states the rule it then broke:
--
--   "next_due_at is seeded in the same statement as the cadence, per 0197 — a duty whose cadence
--    and seed disagree is left due on the wrong day and nothing says so."
--
-- Tomorrow is not the next Thursday. So from the morning after 0227 landed, the duty row read
-- OVERDUE while the launchd job was correctly waiting for its window — and that contradiction is
-- what composed the line she found in Today's contract: "Danielle's Ahrefs pass has not reported".
-- The system was reporting a gap that did not exist, from a seed that disagreed with its own
-- schedule. Two clocks, no link, exactly as this repository keeps naming.
--
-- ─── What changes ───────────────────────────────────────────────────────────
--
--   cadence   weekly -> monthly, per her instruction.
--   weekday   4 -> NULL. `nextDueAt` ignores weekday for a monthly cadence; leaving Thursday in the
--             row would be a fact that no longer governs anything, which is how the next reader is
--             misled. A monthly duty fires on the 1st (duties/cadence.ts), at local_hour.
--   next_due_at  the 1st of NEXT month at 11:00 UTC.
--
-- WHY 11:00 UTC AND NOT A COMPUTED LOCAL 06:00. 06:00 America/Chicago is 11:00 UTC in summer and
-- 12:00 UTC in winter, and SQLite has no tz database to pick between them. 11:00 is therefore
-- correct in summer and one hour EARLY in winter — deliberately the safe direction, because the
-- launchd tick asks "am I due?" at 06:00 local and must find the answer already yes. Seeding late
-- would make the job skip the 1st and settle permanently on the 2nd. After the first successful
-- run the clock is owned by `nextDueAt()` in TypeScript, which has the zone rules and gets it exact.
--
-- ─── What is deliberately preserved, verbatim ───────────────────────────────
--
-- `task_input` IS NOT REWRITTEN. It carries the standing constraint that the repair lane may never
-- auto-fix local-guides-citation-velocity, in `$.never` and again in `success_criteria`, along with
-- the named model and the reason the job must be local. A migration that rebuilt the JSON to change
-- a cadence would be the obvious way to drop that exclusion without anyone noticing. Only the
-- schedule columns are touched.

UPDATE standing_duties
   SET cadence = 'monthly',
       weekday = NULL,
       next_due_at = (unixepoch(date('now', 'start of month', '+1 month')) + 11 * 3600) * 1000
 WHERE id = 'duty_site_audit_repair';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0232_boss_the_ahrefs_pass_is_monthly_and_catches_up');
