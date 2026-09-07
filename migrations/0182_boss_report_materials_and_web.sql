-- The two things the first live report run said it needed, in its own words.
--
-- The run claimed, executed, wrote its file and reported back — the whole chain — and delivered a
-- report with status "failed" naming exactly what stopped it:
--
--   Spec at boss-os/docs/boss/EXECUTIVE_INTELLIGENCE.md   Denied — outside this run's only allowed
--                                                          directory. Denied on Read and on cat.
--   WebSearch                                              Denied — no approval surface.
--
-- BOTH REFUSALS WERE CORRECT AND NEITHER IS FIXED BY WIDENING allowed_paths. Adding the repository
-- to a daily unattended run's write scope would hand it the system that schedules it. And
-- `--permission-prompts none` genuinely means nobody can say yes, so a tool needing permission is
-- a tool that is off — which for a research run is the difference between reading the news and
-- inventing it.
--
-- MATERIALS: the runner copies named files INTO the sandbox under their base names before the run
-- starts. The run reads a copy in its own directory and is granted no access to where the original
-- lives. A material that cannot be placed is a REFUSAL, not a warning — a run that proceeds without
-- the spec it was told to follow produces something confident and unmoored, which is precisely what
-- the failed attempt described.
--
-- WEB_TOOLS: an explicit, enumerated grant. The runner refuses anything outside WebSearch and
-- WebFetch, both read-only, and the forbidden list — commit, merge, push, deploy, secret_read — is
-- untouched. `--allowedTools` takes whatever it is handed, so the list of what may be asked for is
-- the whole control, and it lives in the runner rather than in this row.
--
-- The prompt loses its absolute path to the spec and gains the file it will actually find beside it.

UPDATE standing_duties
   SET task_input = json_set(
         COALESCE(task_input, '{}'),
         '$.requested.materials', json_array('/Users/sequoiataylor/GitHub/boss-os/docs/boss/EXECUTIVE_INTELLIGENCE.md'),
         '$.requested.web_tools', json_array('WebSearch', 'WebFetch'),
         '$.prompt',
         'Produce today''s Executive Intelligence Report.' || char(10) || char(10) ||
         'The specification is in your working directory as EXECUTIVE_INTELLIGENCE.md. Read it and follow it. You have WebSearch and WebFetch; use them, and open the sources you cite rather than recalling them.' || char(10) || char(10) ||
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

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0182_boss_report_materials_and_web');
