-- Giving the report duty a workspace, because the runner is a SCOPED runner and rightly said no.
--
-- WHAT THE FIRST REAL DISPATCH FOUND. The chain now works end to end — the consumer dispatched, the
-- guard admitted it, the agent on the Mac claimed it, executed, and reported back — and the answer
-- came back "refused: repo_path must be an absolute path". That is the runner behaving exactly as
-- designed: it will not run without an explicit directory, and its own comment says "no paths given"
-- must never be read as "all paths". A run with no scope is an unscoped run.
--
-- SO THE DUTY GETS A SCOPE RATHER THAN THE RUNNER LOSING ITS RULE. Nothing about the boundary is
-- relaxed here; the work simply says where it happens.
--
-- THE WORKSPACE IS NOT A REPOSITORY, AND THAT IS THE POINT. `~/.boss-os/reports` holds nothing but
-- the run's own scratch output. Research is not repo work: it should not be pointed at code it has
-- no business editing, and pointing it at `boss-os` would have given a daily unattended run write
-- scope over the system that schedules it. The runner's git probe returns empty for a non-git
-- directory, which is the correct reading — there is no tree to have changed.
--
-- HOW THE REPORT GETS BACK. The run writes `delivers.json` in that workspace; the adapter reads the
-- FILE and attaches it to the evidence packet; `/backends/report` hands it to
-- `duties/deliverReport.ts`, which writes the day's row. The file matters: everything in a run's
-- summary is the CLI's own account, and fishing JSON out of prose would mean a summary that merely
-- quoted some JSON could become a delivered report. A file this process read is evidence; a summary
-- is a claim.

UPDATE standing_duties
   SET task_input = json_set(
         COALESCE(task_input, '{}'),
         '$.requested.repo_path', '/Users/sequoiataylor/.boss-os/reports',
         '$.requested.allowed_paths', json_array('/Users/sequoiataylor/.boss-os/reports'),
         -- Twenty minutes. The duty fires at 06:30 so the report is THERE at 07:00, and a run still
         -- thinking at 06:50 has already missed the only deadline it has.
         '$.requested.max_seconds', 1200,
         '$.prompt',
         'Produce today''s Executive Intelligence Report.' || char(10) || char(10) ||
         'Read the specification at /Users/sequoiataylor/GitHub/boss-os/docs/boss/EXECUTIVE_INTELLIGENCE.md and follow it. Do not modify that file or anything else in that repository — you are here to research and write one JSON file.' || char(10) || char(10) ||
         'Write your output to delivers.json in the current working directory, as a single JSON object:' || char(10) ||
         '  status      "complete" or "partial". Use "partial" whenever anything is unverified.' || char(10) ||
         '  summary     Two or three sentences. What actually changed since yesterday.' || char(10) ||
         '  sections    [{ heading, body }] — the report itself.' || char(10) ||
         '  sources     [{ name, url, read_at }] — read_at is an ISO timestamp of when YOU opened it.' || char(10) ||
         '  gaps        [{ wanted, why }] — everything you could not verify. Never omit a gap to look complete.' || char(10) ||
         '  corrections [{ was, now, why }] — where today contradicts a previous report.' || char(10) || char(10) ||
         'Every figure carries a named source and the time it was read. If you cannot verify something, say so in gaps rather than leaving it out or softening it — a report that names what is missing is worth more than one that reads complete and is not. If the research fails entirely, still write delivers.json with status "failed" and put the reason in summary.'
       )
 WHERE id = 'duty_exec_intel';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0181_boss_report_workspace');
