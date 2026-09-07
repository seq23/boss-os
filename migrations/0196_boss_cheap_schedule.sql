-- $3.88 for a briefing was ridiculous, and the reason was a sledgehammer nobody had aimed.
--
-- HER WORDS: "the executive report should not cost $3.88 per run thats ridiculous - i was getting it
-- from openai at a $20/mo account .....it should be cents." She is right, and the cause is not the
-- work — it is what was doing the work.
--
-- That run used the most expensive model available, agentically, for ten minutes, fetching thirty
-- pages, to produce twenty sections. A briefing that reads pages and summarises them does not need
-- Opus. The envelope has supported a `model` flag the whole time and NOTHING WAS SETTING IT, so
-- every duty silently ran on the default — which is the right default for editing a codebase and
-- absurd for writing a summary.
--
-- ─── The budget she actually has ────────────────────────────────────────────
--
-- "my max i want to spend on boss OS across all of it per month is like $50 if that i prefer $25."
--
-- Claude Max is a flat subscription, so these are EQUIVALENT USAGE figures rather than a separate
-- bill — which makes the scarcity worse rather than better, because the employees and she draw on
-- the same plan. $207 a month of agent work against a $100 plan is a week where she cannot use
-- Claude Code for her own work because her staff spent it.
--
-- Ceiling: $25. Warned at 70%. Hers to raise.
--
-- ─── Where the money now goes ───────────────────────────────────────────────
--
--   Executive report    Haiku, 5 min, 6 sections   daily            ~$0.15   ~$4.50/mo
--   Buyer sourcing      Sonnet, 5 min, incremental Mon/Wed/Fri      ~$0.30   ~$3.90/mo
--   Backlink prospects  Haiku, 10 min              Monday           ~$0.20   ~$0.90/mo
--   Tool scouting       Haiku, 10 min              Thursday         ~$0.20   ~$0.90/mo
--   Practice week       Haiku, 10 min              Sunday           ~$0.15   ~$0.65/mo
--                                                                            ≈ $11/mo
--
-- Under half the preferred ceiling, with the daily briefing intact and buyer hunting three times a
-- week — which is what she asked for when she said "2-3x per week if needed".
--
-- ─── Why sourcing keeps the better model ────────────────────────────────────
--
-- The report summarises pages that already say what they say. Sourcing makes a JUDGEMENT — whether
-- a firm genuinely buys secondaries at her size — and a wrong yes costs her a phone call and some
-- credibility with a counterparty. That judgement is worth four times the price of a summary, and
-- it is the only place here where it is.

ALTER TABLE standing_duties ADD COLUMN weekdays TEXT; -- json array, DAILY duties only. Null = every day.

-- ─── The report: cheapest model, shortest leash ──────────────────────────────
UPDATE standing_duties
   SET task_input = json_set(
         COALESCE(task_input, '{}'),
         '$.requested.model', 'claude-haiku-4-5-20251001',
         '$.requested.max_seconds', 300
       )
 WHERE id = 'duty_exec_intel';

-- ─── Sourcing: three days a week, mid-tier model, incremental ────────────────
UPDATE standing_duties
   SET weekdays = json_array(1, 3, 5),
       name = 'Brokerage Sourcing Sweep (Mon/Wed/Fri)',
       task_input = json_set(
         COALESCE(task_input, '{}'),
         '$.requested.model', 'claude-sonnet-5',
         '$.requested.max_seconds', 300
       )
 WHERE id = 'duty_brokerage_sourcing';

-- ─── The three weeklies: cheapest model, ten minutes ─────────────────────────
UPDATE standing_duties
   SET task_input = json_set(
         COALESCE(task_input, '{}'),
         '$.requested.model', 'claude-haiku-4-5-20251001',
         '$.requested.max_seconds', 600
       )
 WHERE id IN ('duty_link_prospects', 'duty_tool_scout', 'duty_practice_week');

-- ─── The ceiling ─────────────────────────────────────────────────────────────
UPDATE execution_backends
   SET monthly_ceiling_micros = 25000000,
       status_reason = status_reason ||
         ' Monthly ceiling $25 of equivalent usage as of 0196. Every duty now names a model rather than defaulting to the most expensive one, which is what made a single briefing cost $3.88.'
 WHERE id = 'bk_claude_code';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0196_boss_cheap_schedule');
