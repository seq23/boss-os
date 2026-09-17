-- The Ahrefs pass runs weekly again, because that is how often the audits actually arrive.
--
-- ─── Her instruction, 17 September 2026 ─────────────────────────────────────
--
--   "fix danielle so she fixes the shit and does it on a schedule that makes sense"
--
-- This supersedes "1x per month is fine" of 13 September. That was a reasonable trade made without
-- the arrival data in front of her; this is the correction once the data existed. Both are hers.
--
-- ─── WHAT WAS MEASURED, AND IT IS THE WHOLE ARGUMENT ────────────────────────
--
-- The first pass ever to run completed at 08:43 on 17 September 2026 and reported its own search
-- evidence: 48 Site Audit messages from sa@ahrefs.com across 23 projects in 14 days. Two batches,
-- and both landed overnight into a THURSDAY, UTC:
--
--   Thu 2026-08-27  02:20 – 02:31 UTC
--   Thu 2026-09-03  01:07 – 03:58 UTC
--   Thu 2026-09-10  01:07 – 02:42 UTC
--   Thu 2026-09-17  01:13 – 01:57 UTC
--
-- Four consecutive Thursdays. Ahrefs recrawls the account on a seven-day rhythm, exactly as 0227
-- derived it from the first three.
--
-- AND THE NUMBERS MOVE AT THAT RHYTHM TOO, which is what makes a monthly pass wrong rather than
-- merely infrequent. Porchandparty901 went from 331 errors to 118 in one week. A pass that wakes on
-- the 1st grades a crawl that has been superseded three times: it opens pull requests for pages
-- already fixed, and misses the three weeks in between entirely. 0232 named that cost honestly —
-- "some findings are older when they are fixed" — and accepted it on her instruction. With four
-- crawls per pass rather than one, the cost is no longer "older", it is "never acted on".
--
-- ─── WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT ───────────────────────────
--
--   cadence   monthly -> weekly.
--   weekday   NULL -> 4 (Thursday; 0 = Sunday, per duties/cadence.ts).
--   next_due_at  the next Thursday STRICTLY AFTER today, at 11:00 UTC.
--
-- 06:00 America/Chicago is 11:00 UTC in summer and 12:00 in winter, and SQLite has no tz database
-- to choose between them. 11:00 is therefore correct in summer and one hour EARLY in winter —
-- deliberately the safe direction, because the daily tick asks "am I due?" at 06:00 local and must
-- find the answer already yes. Seeding late would push the run to Friday for ever. After the first
-- successful run the clock belongs to `nextDueAt()` in TypeScript, which has the zone rules.
--
-- `date('now','+1 day','weekday 4')` and not `date('now','weekday 4')`. SQLite's `weekday 4`
-- returns TODAY when today is already Thursday — and today IS Thursday, and the pass has already
-- run today. The naive form would seed a due date in the past and the duty would read overdue from
-- the moment this lands, which is the exact defect 0232 was written to repair. Stepping a day
-- first makes the seed "the next one that has not happened" on every day of the week.
--
-- ─── THE ONE-CHANCE-TO-FIRE SHAPE IS ALREADY GONE, AND IS NOT REINTRODUCED ──
--
-- 0232's hardest-won lesson is that "a schedule with one chance to fire looks identical whether it
-- is waiting or dead". That was fixed in the RUNNER, not in the cadence: the launchd entry fires
-- DAILY and cheaply and `duty-due.mjs` asks this row whether there is work, so `next_due_at` is the
-- only clock in the system. A Thursday slept through therefore costs a DAY — the tick on Friday
-- finds the duty still due and runs it — rather than costing the period. Going back to weekly does
-- not restore the old hazard, because the hazard never lived in the cadence column.
--
-- `task_input` IS NOT REWRITTEN, for the reason 0232 gave and it is worth repeating: it carries the
-- standing rule that local-guides-citation-velocity may never be auto-fixed, in `$.never` and again
-- in `success_criteria`, plus the named model and the reason the job must be local. A migration
-- that rebuilt the JSON to change a schedule is the obvious way to drop that exclusion without
-- anyone noticing. Only the schedule columns are touched.

UPDATE standing_duties
   SET cadence = 'weekly',
       weekday = 4,
       next_due_at = (unixepoch(date('now', '+1 day', 'weekday 4')) + 11 * 3600) * 1000
 WHERE id = 'duty_site_audit_repair';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0246_boss_the_ahrefs_pass_matches_how_the_audits_arrive');
