-- 0262 — Three of the twelve firm notices were West Peek's, and every Boss OS employee was reading
--        them before every run.
--
-- ─── Found by the hostile sweep of Settings › Governance, 19 September 2026 ──
--
-- The panel printed "THE MANAGING PARTNERS ARE SEQUOIA TAYLOR AND SCOOTER TAYLOR", "WEST PEEK LIVE
-- IS THE ONLY PLATFORM FOR VIRTUAL EVENTS" and "WEST PEEK PRODUCTIONS IS SCOOTER'S OWN BUSINESS, NOT
-- PART OF THE FUND" — and `prompt/notices.ts` puts every row of this table in front of EVERY
-- employee run (CONFIRMED: production holds all twelve; `firmNoticeBlock` renders them all). Boss
-- OS has one principal (ADR-026), no Managing Partners, no fund, no Productions. These three are
-- West Peek OS's law, copied in with the chassis, and they were teaching Camille, Monique, Simone,
-- Danielle, Zora, Kendra and Toni who the partners of a different business are.
--
-- Her rule, the same afternoon: the two businesses never blend. Boss OS tracks nothing of West
-- Peek's raise (0261 series), and its employees carry none of West Peek's notices. The nine that
-- remain are how THIS firm works: nothing is sent from the OS, two labels on every card, say what
-- you do not know, arrivals are claims, employees propose, retire reversibly, owned work is never
-- dropped, silence is not a blocker, a quiet run says why.
--
-- A DELETE, in a migration, with the reason on it — reversible by re-seeding from 0254 — because a
-- notice has no retired column and "retire reversibly" is about her records, not about a rule
-- that was never Boss OS's to hold.
DELETE FROM boss_notices WHERE id IN ('fnt_managing_partners', 'fnt_west_peek_live', 'fnt_productions_is_separate');

-- The two-labels notice named "Sequoia or Scooter" as the internal audience. In Boss OS the
-- internal audience is its one principal; the rest of the notice is unchanged.
UPDATE boss_notices
   SET body = replace(body, 'Internal is Sequoia or Scooter.', 'Internal is Sequoia.')
 WHERE id = 'fnt_lp_names_never_train';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0262_boss_west_peeks_notices_are_not_boss_os_law');
