-- 0282 — OUTREACH NEVER WRITES TO A WEBSITE VENDOR (9 Oct 2026).
--
-- The first production list run admitted justin@dds.cloud for a Beverly Hills practice: an address
-- scraped from the practice's footer that belongs to its website vendor. `pickEmail` now refuses a
-- scraped address on another domain unless the public listing itself names it. This removes every
-- not-yet-contacted prospect whose address is off the website's domain and returns its website to
-- the queue, so the new rule decides it again. Nobody here was ever emailed (state = 'new').
UPDATE outreach_candidates SET state = 'pending', detail = 're-read under the own-domain rule (0282)'
 WHERE state = 'ok' AND detail IN (
   SELECT email FROM outreach_prospects
    WHERE state = 'new' AND source = 'openstreetmap+website' AND instr(website, email_domain) = 0);

DELETE FROM outreach_prospects
 WHERE state = 'new' AND source = 'openstreetmap+website' AND instr(website, email_domain) = 0;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0282_boss_outreach_never_writes_to_a_website_vendor');
