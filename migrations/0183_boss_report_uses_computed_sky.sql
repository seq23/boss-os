-- Stop the report scraping for a sky this system already computes.
--
-- WHAT THE FIRST REAL REPORT FILED, VERBATIM, AS ONE OF ITS GAPS:
--
--   "The only ephemeris page I could open for this date publishes whole degrees only. astro-seek.com
--    (403), astrosofa.com (403), astrolibrary.org (404) and cafeastrology's daily page (404) all
--    failed retrieval... Per the spec's rule against quoting exact degrees without a real ephemeris,
--    I did not invent minutes. Positions carry ±1°."
--
-- Its reasoning was right in every particular and it still produced a worse answer than it had to.
-- Boss OS computes those positions from Standish elements with IAU 2006 precession — about one
-- arcminute — and the run had no way to ask. It was scraping what the machine it runs on knows.
--
-- Three of the report's eighteen gaps were this, every morning, for ever.
--
-- SO THE SKY IS PUT IN THE WORKSPACE BEFORE THE RUN. `scripts/ops/sky-snapshot.mjs` writes
-- SKY.json — every body's longitude, her natal chart and today's transits, with the timestamp it
-- was computed at — and the launch agent runs it immediately before claiming work. No material, no
-- credential and no network access is needed on the run's part; the file is simply already there.
--
-- AND IT FAILS SOFT. If the snapshot is missing the run files a gap for that one section and the
-- other nineteen still arrive, which is what the spec asks for anyway. The prompt says so plainly
-- rather than leaving the run to decide whether an absent file means it should go looking.

UPDATE standing_duties
   SET task_input = json_set(
         COALESCE(task_input, '{}'),
         '$.prompt',
         'Produce today''s Executive Intelligence Report.' || char(10) || char(10) ||
         'The specification is in your working directory as EXECUTIVE_INTELLIGENCE.md. Read it and follow it. You have WebSearch and WebFetch; use them, and open the sources you cite rather than recalling them.' || char(10) || char(10) ||
         'SKY.json in your working directory holds every planetary position, the natal chart and today''s transits, computed by this system to about one arcminute. It is the authoritative source for anything astronomical — do not search the web for ephemeris data, and cite it as "Boss OS (computed)" with its computed_at timestamp. If SKY.json is missing, file that section as a gap and carry on; do not go looking for it.' || char(10) || char(10) ||
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

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0183_boss_report_uses_computed_sky');
