-- The briefing walks the ladder: her two $0 seats in order, then the free rungs, then paid.
--
-- ─── Her question, 19 September 2026 ───────────────────────────────────────
--
--   "the Boss OS briefing is run using my two $0 lanes first, right — Claude and OpenAI? The
--    ladder is working?"
--
-- THE ANSWER WAS NO, AND THIS IS THE FIX. `duty_exec_intel.task_input.backend_id` named ONE seat.
-- `queue/consumer.ts` dispatched to it and, on a guard refusal (ceiling spent, backend disabled),
-- FAILED the task: "Change the backend on the duty." `/claim` handed a run only to the seat it was
-- parked for (`r.backend_id = ?`), so a Mac whose Claude seat could not authenticate left the run
-- unclaimed while its Codex seat sat idle beside it. `bk_codex` was enabled on 17 September, priced,
-- proven with a real generation — and unreachable by this duty by any path. Second on the ladder in
-- the migration comments; nowhere in the code.
--
-- ─── What changes ───────────────────────────────────────────────────────────
--
-- 1. `backend_ladder` on the duty: ["bk_claude_code", "bk_codex"], in the order she named them.
--    The consumer walks it; each refusal is a `ladder_step` event on the task; the next seat is
--    tried. `model_by_backend` gives each seat its own model — Sonnet 4.5 on Claude Code, her seat's
--    default on Codex — because one `requested.model` handed a Claude id to whichever seat claimed.
-- 2. `cloud_fallback`: when both seats refuse, the walk continues into the cloud router — the free
--    rungs first by the shipped comparator, paid last — and the rung's reply is delivered through the
--    same door, graded by the same grader, with `written_by` naming the rung on her screen.
-- 3. `/claim` accepts `fallback_from`: a seat may take a run parked for an EARLIER seat on the same
--    ladder when the Mac reports that seat cannot authenticate. The run is re-labelled to the seat
--    that took it and the hand-off is a task event.
-- 4. `written_by` on `executive_reports`: which seat or rung wrote the morning, so "her Claude seat"
--    is never implied over a report Codex or a free rung produced.
--
-- The materialiser re-stamps 1 and 2 from `briefingLadder.ts` on every firing; the row is where the
-- values are visible, the module is where they are decided.

ALTER TABLE executive_reports ADD COLUMN written_by TEXT;

UPDATE standing_duties
   SET task_input = json_set(
         task_input,
         '$.backend_ladder', json('["bk_claude_code","bk_codex"]'),
         '$.cloud_fallback', json('true'),
         '$.requested.model_by_backend', json('{"bk_claude_code":"claude-sonnet-4-5-20250929","bk_codex":null}')
       )
 WHERE id = 'duty_exec_intel';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0258_boss_the_briefing_walks_her_two_seats_then_the_rungs');
