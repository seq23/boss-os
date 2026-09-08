-- The escalation said 371 days, and it had been five.
--
-- ─── The bug, which the mechanism caught on itself ──────────────────────────
--
-- 0202 seeded `del_kdp_publication.blocked_since` as 1756771200000, described in the comment above
-- it as "2 September 2026, when Publish first refused". That epoch is 2 September 2025. So the
-- first thing the new escalation ladder ever said was that Simone had been blocked for 371 days —
-- top of the ladder, on the first render, for a block that started on the 2nd of this month.
--
-- WHY THIS MATTERS MORE THAN AN OFF-BY-A-YEAR USUALLY WOULD. The whole point of the ladder is that
-- the words get sharper as a block ages, so she can tell a new problem from a rotting one at a
-- glance. A commitment that opens at maximum volume destroys exactly that signal, and the second one
-- of these cries wolf the ladder becomes noise she scrolls past — which is the silence it was built
-- to replace. Same reason the three live titles carried a 2025 `went_live_at`: a book published last
-- week reading as published last year makes the register wrong about the one thing it is for.
--
-- It was caught by reading the alert the mechanism produced, on production, rather than by a test —
-- which is the honest note to leave here. No test asserts a real-world date, and none should; the
-- check that works is looking at what the thing actually says.
--
-- ─── And the blocker stopped being a reason ─────────────────────────────────
--
-- The first determination posted by the watcher overwrote `blocker` with its own text, so the
-- escalation on Today read "Simone is blocked on Every authored book published — <what the last run
-- found>". Those are two different facts. THE BLOCKER IS WHY THE WORK IS STUCK — the account flag,
-- the case number, the fact that three titles published from this same account — and it changes
-- rarely and deliberately. What a given run found is a determination, it changes every run, and it
-- already has a table and a screen of its own.
--
-- Letting a run rewrite the standing reason turns the escalation into a log line and loses the one
-- sentence she needs to act on. `routes/kdp.ts` no longer passes a blocker at all, and the original
-- reason is restored here.

UPDATE owned_deliverables
   SET blocked_since = 1788307200000,   -- 2026-09-02T00:00:00Z, when Publish first refused
       last_activity_at = MAX(COALESCE(last_activity_at, 0), 1788790980000), -- the 7 Sep watcher run
       blocker = 'A server-side flag on the KDP account. Publish returns "fix the highlighted errors" with nothing highlighted and a hidden alert reading "Account Information Incomplete". All four account sections read complete and three titles published from the same account on 1-2 September. Amazon case #51496198 is the only route to it.',
       updated_at = unixepoch() * 1000
 WHERE id = 'del_kdp_publication';

-- The three that prove the account works, published on 1-2 September 2026 rather than 2025.
UPDATE kdp_titles
   SET went_live_at = 1788307200000, state_changed_at = 1788307200000, updated_at = unixepoch() * 1000
 WHERE state = 'live' AND went_live_at = 1756771200000;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0203_boss_block_started_this_year');
