-- The Executive Intelligence Report, made to the specification she handed over on 19 September 2026.
--
-- ─── Her brief, verbatim intent ─────────────────────────────────────────────
--
--   "I keep opening my OpenAI app and the executive briefing there is far superior to anything in
--    Boss OS and West Peek OS. I created a txt file of today's briefing, the model prompt, and the
--    list of sources and which model. Fix Boss OS's daily executive briefing to be just like the one
--    in my txt file. Delivered automatically daily to me only. It needs to be on par with the one I
--    get from OpenAI daily so I can turn that off and rely on Boss OS only. Leave astrology and
--    travel-map colours out — those live in the Spirit tab."
--
-- ─── What the last fourteen days of production established (CONFIRMED) ──────
--
--   · Every run: claude-haiku-4-5, a 900 s leash, four bullets a section. 3–7 minutes of research.
--   · 19 Sep dashboard: S&P 7,637.76 (+1.1%), Nasdaq 26,418 (+1.7%), Dow 51,778 (+0.6%) — against
--     7,650.5 (+0.17%), 26,522.5 (+0.40%), 51,682.6 (−0.18%) from the feed. Three of three wrong,
--     each with a citation. Provenance without accuracy.
--   · The prompt asserted "SpaceX is not publicly listed" — a fact frozen into an instruction whose
--     specification says to verify it daily. SPCX closed $152.71 on 18 Sep. 14 and 16 Sep's reports
--     said public; 19 Sep's said private.
--   · 15 Sep's sections are byte-identical to 14 Sep's: the run was killed at 900 s having spent $0,
--     and the runner read Sunday's delivers.json from the shared workspace and filed it as Tuesday.
--   · Fired at 07:00 (hourly cron; 06:30 misses the tick), claimed 07:10, landed 07:18–07:25.
--     The success criterion says "by 07:00". Never once met.
--
-- ─── What changes ───────────────────────────────────────────────────────────
--
-- 1. THE PROMPT LEAVES THE DATABASE. `src/worker/boss/duties/briefingSpec.ts` is the specification
--    — the file's production prompt, ported, astrology removed — and `materialise.ts` composes it on
--    every firing. `$.prompt` is removed from the duty row; `$.spec_module` names the module. Four
--    validators that hunted the newest migration for the prompt now read the module.
--
-- 2. LIVE MARKET DATA. `scripts/ops/market-snapshot.mjs` runs before the claim, writes MARKETS.json
--    (Yahoo Finance chart API + the U.S. Treasury's own par-yield CSV; free, keyless, probed), and the
--    Worker BUILDS the dashboard from it. A row the feed did not answer reads "not available at
--    HH:MM CT". SPCX is on the watchlist, so the feed answers public/private every morning.
--
-- 3. FOUR COLUMNS on the row: `checked_through` (the edition stamp, derived from evidence),
--    `prompt_version`, `market_data` (the snapshot as observed), `consulted` (the sources-consulted
--    ledger: every feed URL with its outcome, every cited source with its read time).
--
-- 4. THE MODEL RUNG: claude-sonnet-4-5 for the research-and-write pass, up from Haiku. It runs on her
--    Claude Code session (`bk_claude_code` is `agent_executed`, free rank 0 — "this system is billed
--    nothing for it"), so the API-dollar cost against the $2.50/day posture is $0.00. The CLI's
--    notional figure accrues to the backend's $50/month Claude Max proxy: Haiku ran $0.30–0.95 a
--    morning; Sonnet at this depth is expected at $1.00–1.80 and is measured on the first live run.
--    Opus is one field away (`$.requested.model`) and would be ~3× that notional, which would exhaust
--    the monthly proxy before the month ends — so it is not the default.
--
-- 5. THE LEASH: 900 → 1500 s. Twenty to forty web fetches is the depth the file's report has; the
--    run rewrites delivers.json as it goes so a kill still leaves a real partial report.
--
-- 6. THE CLOCK: 06:30 → 06:00 Central. The Worker's cron is hourly on the hour and Central is a
--    whole-hour offset, so 06:00 fires AT 06:00 — every day of the year — where 06:30 fired at
--    07:00. The Mac claims at 06:05 (new launchd slot), a 20–25 minute run lands by ~06:30, and the
--    stamp reads "Information checked through ~6:25 AM CT". On her screen at seven, as she asked.
--    `next_due_at` is recomputed here so the change takes effect tomorrow, not the day after.

ALTER TABLE executive_reports ADD COLUMN checked_through INTEGER;
ALTER TABLE executive_reports ADD COLUMN prompt_version TEXT;
ALTER TABLE executive_reports ADD COLUMN market_data TEXT;
ALTER TABLE executive_reports ADD COLUMN consulted TEXT NOT NULL DEFAULT '[]';

UPDATE standing_duties
   SET local_hour = 6,
       local_minute = 0,
       task_input = json_remove(
         json_set(
           task_input,
           '$.spec_module', 'executive_briefing',
           '$.requested.model', 'claude-sonnet-4-5-20250929',
           '$.requested.max_seconds', 1500
         ),
         '$.prompt'
       ),
       success_criteria = 'A report for today is on her screen by 07:00 America/Chicago carrying the edition stamp "Information checked through HH:MM CT"; every figure in the summary and the headlines carries an inline [n] citation that resolves to a real URL; the dashboard is built from the live market snapshot or reads "not available"; SpaceX''s listing status is established from the feed that morning; nothing astrological and nothing from the Money / Career / Travel Map appears; and anything unverified is a named gap.'
 WHERE id = 'duty_exec_intel';

-- Tomorrow's 06:00 Central, not the 06:30 already on the clock. 11:00 UTC while Central is on
-- daylight time (through 1 November 2026); the materialiser recomputes from the wall clock after
-- that, so the hour is right on both sides of the transition.
UPDATE standing_duties
   SET next_due_at = CASE
         WHEN next_due_at IS NULL THEN NULL
         ELSE ((next_due_at / 86400000) * 86400000) + 11 * 3600000
       END
 WHERE id = 'duty_exec_intel';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0257_boss_the_briefing_on_par_with_the_one_she_pays_for');
