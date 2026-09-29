-- 0275 — The four other seat duties walk her two $0 seats, not one.
--
-- WHERE THIS STARTED. 0258 (19 Sep 2026) gave the Executive Intelligence Report a ladder — Claude Code,
-- then Codex, then the cloud rungs — after she asked whether the briefing ran on her two $0 lanes and the
-- answer was no. The other four `agent` duties were left exactly as they were: each names ONE seat,
-- `bk_claude_code`, so a day her Claude plan is spent (or the Mac's Claude seat cannot authenticate) is a
-- day they fail, with `bk_codex` enabled, priced, proven with a real generation, and idle beside it.
--
--   duty_brokerage_sourcing   Brokerage Sourcing Sweep      claude-sonnet-5
--   duty_link_prospects       Backlink prospecting          claude-haiku-4-5
--   duty_practice_week        Practice — the week ahead     claude-haiku-4-5
--   duty_tool_scout           Tools worth knowing about     claude-haiku-4-5
--
-- WHAT THIS DOES: sets `backend_ladder` to [bk_claude_code, bk_codex] on each. Nothing else changes about
-- how they run: `queue/consumer.ts` already walks `input.backend_ladder` for ANY duty (it was written for
-- the briefing but reads the task's own input), `/claim` already lets a seat take a run parked for an
-- earlier seat on that run's own ladder, and a run whose seat reports a spent plan is now released to the
-- next seat (routes/backends.ts, 0274's companion change).
--
-- EACH SEAT KEEPS ITS OWN MODEL. `model_by_backend` carries the model each duty already runs on Claude
-- Code (read from the row, not retyped here, so this cannot drift from it) and NULL for Codex — a Codex
-- run handed a Claude model id cannot start, which is the fault 0258 recorded for the briefing.
--
-- NO `cloud_fallback`. These four read the live web (WebSearch/WebFetch) and write a file the Mac
-- delivers. A cloud completion cannot open a page, and a model asked to recall this week's news produces
-- something that looks exactly like research and cites what it never read — the reason the briefing's
-- cloud rungs are described as a last resort and these are not given one at all. When both seats are out
-- of usage the duty fails with both sentences on the task, as it does today.
--
-- IDEMPOTENT: touches only rows that do not already carry a ladder, so a re-run, or a duty that later
-- gets its own, is left alone.
UPDATE standing_duties
   SET task_input = json_set(
         task_input,
         '$.backend_ladder', json('["bk_claude_code","bk_codex"]'),
         '$.requested.model_by_backend', json_object(
           'bk_claude_code', json_extract(task_input, '$.requested.model'),
           'bk_codex', NULL
         )
       )
 WHERE id IN ('duty_brokerage_sourcing', 'duty_link_prospects', 'duty_practice_week', 'duty_tool_scout')
   AND json_extract(task_input, '$.backend_ladder') IS NULL
   AND json_extract(task_input, '$.requested') IS NOT NULL;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0275_boss_the_other_seat_duties_walk_to_codex');
