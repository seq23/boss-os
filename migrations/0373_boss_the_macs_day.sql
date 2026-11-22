-- THE MAC'S DAY (her ruling 21 Nov 2026, Central, every day).
--
-- "all the renderings that need the mac will work from 11pm to 7am and then ill let my mac rest from 7-10am and
-- all other jobs need to begin at10am onward if its something i need first thing in the morning it needs to
-- happen before 7", settled as "we can do 10-7", and "do not let my ... morning email /briefs suffer ... give
-- them ample time". Heavy work 22:00-06:55; the Mac is OFF 07:00-10:00; every other Mac job from 10:00; every
-- morning job done by 06:30 with twice its worst measured runtime to spare.
--
-- Mac duties move WITH their launchd entries (scripts/ops/install-agent-launchd.sh, same change); the Schedule
-- (src/shared/boss/schedule/manifest.json) is the record. next_due_at as 0327: the next such slot STRICTLY AFTER
-- today, the Central time in UTC as it stands in winter (+6 h).

-- duty_archive_audit: fri 10:35
UPDATE standing_duties SET weekday = 5, local_hour = 10, local_minute = 35, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 5')) + 16 * 3600 + 35 * 60) * 1000 WHERE id = 'duty_archive_audit';
-- duty_buyer_hunt: tue 10:05
UPDATE standing_duties SET weekday = 2, local_hour = 10, local_minute = 5, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 2')) + 16 * 3600 + 5 * 60) * 1000 WHERE id = 'duty_buyer_hunt';
-- duty_filing_research: tue 10:05
UPDATE standing_duties SET weekday = 2, local_hour = 10, local_minute = 5, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 2')) + 16 * 3600 + 5 * 60) * 1000 WHERE id = 'duty_filing_research';
-- duty_interest_nudge: day1 11:25
UPDATE standing_duties SET local_hour = 11, local_minute = 25, next_due_at = (unixepoch(date('now', 'start of month', '+1 month', '+0 days')) + 17 * 3600 + 25 * 60) * 1000 WHERE id = 'duty_interest_nudge';
-- duty_kdp_publish: sun 22:15 (heavy (a browser run): Sunday night 22:15)
UPDATE standing_duties SET weekday = 0, local_hour = 22, local_minute = 15, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 0')) + 28 * 3600 + 15 * 60) * 1000 WHERE id = 'duty_kdp_publish';
-- duty_kdp_surface: day1 10:30
UPDATE standing_duties SET local_hour = 10, local_minute = 30, next_due_at = (unixepoch(date('now', 'start of month', '+1 month', '+0 days')) + 16 * 3600 + 30 * 60) * 1000 WHERE id = 'duty_kdp_surface';
-- duty_ledger_hunt: daily 04:00 (same chain, after the extract (~3 min))
UPDATE standing_duties SET local_hour = 4, local_minute = 0, next_due_at = (unixepoch(date('now', '+1 day')) + 10 * 3600 + 0 * 60) * 1000 WHERE id = 'duty_ledger_hunt';
-- duty_deal_grid: daily 03:45 (same chain)
UPDATE standing_duties SET local_hour = 3, local_minute = 45, next_due_at = (unixepoch(date('now', '+1 day')) + 9 * 3600 + 45 * 60) * 1000 WHERE id = 'duty_deal_grid';
-- duty_inbound_supply: daily 03:45 (the capital chain starts 03:45: worst chain ~76 min, twice that ends 06:17)
UPDATE standing_duties SET local_hour = 3, local_minute = 45, next_due_at = (unixepoch(date('now', '+1 day')) + 9 * 3600 + 45 * 60) * 1000 WHERE id = 'duty_inbound_supply';
-- duty_mac_cleanup: daily 11:05
UPDATE standing_duties SET local_hour = 11, local_minute = 5, next_due_at = (unixepoch(date('now', '+1 day')) + 17 * 3600 + 5 * 60) * 1000 WHERE id = 'duty_mac_cleanup';
-- duty_outside_locks: fri 11:35
UPDATE standing_duties SET weekday = 5, local_hour = 11, local_minute = 35, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 5')) + 17 * 3600 + 35 * 60) * 1000 WHERE id = 'duty_outside_locks';
-- duty_people_worth_a_call: mon 10:55
UPDATE standing_duties SET weekday = 1, local_hour = 10, local_minute = 55, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 1')) + 16 * 3600 + 55 * 60) * 1000 WHERE id = 'duty_people_worth_a_call';
-- duty_prospect_discovery: mon 10:35
UPDATE standing_duties SET weekday = 1, local_hour = 10, local_minute = 35, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 1')) + 16 * 3600 + 35 * 60) * 1000 WHERE id = 'duty_prospect_discovery';
-- duty_prospects: mon,tue,wed,thu,fri 10:40
UPDATE standing_duties SET local_hour = 10, local_minute = 40, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 1')) + 16 * 3600 + 40 * 60) * 1000 WHERE id = 'duty_prospects';
-- duty_lp8_drip: mon,tue,wed,thu,fri 10:45
UPDATE standing_duties SET local_hour = 10, local_minute = 45, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 1')) + 16 * 3600 + 45 * 60) * 1000 WHERE id = 'duty_lp8_drip';
-- duty_risk_watch: daily 10:35
UPDATE standing_duties SET local_hour = 10, local_minute = 35, next_due_at = (unixepoch(date('now', '+1 day')) + 16 * 3600 + 35 * 60) * 1000 WHERE id = 'duty_risk_watch';
-- duty_scooter_sheet: tue 10:15
UPDATE standing_duties SET weekday = 2, local_hour = 10, local_minute = 15, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 2')) + 16 * 3600 + 15 * 60) * 1000 WHERE id = 'duty_scooter_sheet';
-- duty_search_readiness_repair: tue 22:15 (heavy: Tuesday night 22:15)
UPDATE standing_duties SET weekday = 2, local_hour = 22, local_minute = 15, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 2')) + 28 * 3600 + 15 * 60) * 1000 WHERE id = 'duty_search_readiness_repair';
-- duty_seller_hunt: thu 10:05
UPDATE standing_duties SET weekday = 4, local_hour = 10, local_minute = 5, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 4')) + 16 * 3600 + 5 * 60) * 1000 WHERE id = 'duty_seller_hunt';
-- duty_t2r_groups: mon,tue,wed,thu,fri 10:55
UPDATE standing_duties SET local_hour = 10, local_minute = 55, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 1')) + 16 * 3600 + 55 * 60) * 1000 WHERE id = 'duty_t2r_groups';
-- duty_owner_mail_watch: daily 10:25
UPDATE standing_duties SET local_hour = 10, local_minute = 25, next_due_at = (unixepoch(date('now', '+1 day')) + 16 * 3600 + 25 * 60) * 1000 WHERE id = 'duty_owner_mail_watch';
-- duty_site_audit_repair: thu 22:15 (heavy: Thursday night 22:15)
UPDATE standing_duties SET weekday = 4, local_hour = 22, local_minute = 15, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 4')) + 28 * 3600 + 15 * 60) * 1000 WHERE id = 'duty_site_audit_repair';
-- duty_exec_intel: daily 04:00 (the Executive Intelligence Report: 06:00 -> 04:00, so the Mac's 04:05 claim has it on her screen long before 06:30 (worst run ~25 min, twice that to spare))
UPDATE standing_duties SET local_hour = 4, local_minute = 0, next_due_at = (unixepoch(date('now', '+1 day')) + 10 * 3600 + 0 * 60) * 1000 WHERE id = 'duty_exec_intel';
-- duty_credentials: daily 03:40 (before the first agent tick, as before (now 04:05))
UPDATE standing_duties SET local_hour = 3, local_minute = 40, next_due_at = (unixepoch(date('now', '+1 day')) + 9 * 3600 + 40 * 60) * 1000 WHERE id = 'duty_credentials';
-- duty_lp_daily: daily 05:45 (Monique's held LP replies: 05:45, retry 06:00, both done long before the 06:40 email)
UPDATE standing_duties SET local_hour = 5, local_minute = 45, next_due_at = (unixepoch(date('now', '+1 day')) + 11 * 3600 + 45 * 60) * 1000 WHERE id = 'duty_lp_daily';

-- duty_grid_watch: daily 05:55 (a morning producer: done by 06:30 with twice its worst runtime to spare, before the 06:05/06:14 catch-up)
UPDATE standing_duties SET local_hour = 5, local_minute = 55, next_due_at = (unixepoch(date('now', '+1 day')) + 11 * 3600 + 55 * 60) * 1000 WHERE id = 'duty_grid_watch';
-- duty_eightraise_budget: daily 05:58 (a morning producer: done by 06:30 with twice its worst runtime to spare, before the 06:05/06:14 catch-up)
UPDATE standing_duties SET local_hour = 5, local_minute = 58, next_due_at = (unixepoch(date('now', '+1 day')) + 11 * 3600 + 58 * 60) * 1000 WHERE id = 'duty_eightraise_budget';

-- duty_brokerage_sourcing: mon,wed,fri 10:30 (after the 04:00 report, never beside it on the one seat; the Mac is back at 10:00)
UPDATE standing_duties SET local_hour = 10, local_minute = 30, next_due_at = (unixepoch(date('now', '+1 day', 'weekday 1')) + 16 * 3600 + 30 * 60) * 1000 WHERE id = 'duty_brokerage_sourcing';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0373_boss_the_macs_day');
