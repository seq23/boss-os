-- A real budget for the work that was being counted as free, sized to the plan she actually has.
--
-- ─── What was wrong, in an honest-looking way ───────────────────────────────
--
-- `bk_claude_code` is classified `no_vendor_call`, free, cost rank 0, with the note "Runs on the
-- owner's machine under her own session. This system is billed nothing for it." Every word is true
-- and the conclusion is false: SHE bears it. Measured runs are $3.88 for one executive report and
-- $2.04 for one sourcing sweep, and at the schedule as built that is about $207 a month.
--
-- A system that reports its most expensive worker as free is not being frugal. It is not looking.
--
-- ─── The constraint is her plan, not a bill ─────────────────────────────────
--
-- Her words: "im prob only paying $100 for my claude max and i need budget to do other things. id
-- like the employees to spend not a lot of money per week."
--
-- Claude Max is a flat subscription, so those dollar figures are EQUIVALENT USAGE rather than money
-- leaving her account. Which makes the real scarcity worse, not better: the employees and SHE draw
-- on the same plan. $207 a month of agent work against a $100 plan does not produce a bill — it
-- produces a week where she cannot use Claude Code for her own work because her staff spent it.
--
-- So the ceiling is $25 of equivalent usage a month — her stated preference, with $50 as the outer
-- limit she named. Most of the plan stays hers, and the on-demand work she asks for never counts
-- against a stop. 0196 sets the model per duty, which is what actually makes that affordable.
--
-- ─── How that is afforded: cheaper runs, not fewer of them ──────────────────
--
-- This migration shortens the two expensive prompts. It was not enough on its own — the run that
-- cost $3.88 was expensive because of the MODEL it used, which nothing was setting, and 0196 is
-- where that is fixed. Read the two together: this one decides what the work is, that one decides
-- what does it and how often.
--
--   · The report was twenty sections and thirty-one sources. She reads it at 7am before a day of
--     work; twenty sections is a newspaper. Six sections aimed at her actual businesses.
--   · Sourcing re-scanned the whole universe every day and re-found firms already on her list —
--     which is both the expense and the reason the list repeated itself. It now receives KNOWN.json
--     and hunts only what CHANGED. Two new names is a good day.
--
-- Cadence is left alone here and set in 0196, where the per-duty model makes the arithmetic real.

UPDATE execution_backends
   SET monthly_ceiling_micros = 25000000,
       status_reason = status_reason ||
         ' Monthly ceiling as of 0195, tightened again by 0196. This backend costs her Claude Max plan capacity even though it costs this system nothing, and reporting it as free is why nothing counted it. The employees and the owner draw on the same plan.'
 WHERE id = 'bk_claude_code';

-- ─── The briefing gets shorter, not rarer ────────────────────────────────────
UPDATE standing_duties
   SET task_input = json_set(
         COALESCE(task_input, '{}'),
         '$.requested.max_seconds', 600,
         '$.prompt',
         'Produce today''s Executive Intelligence Report. SIX SECTIONS AT MOST, and it must be readable in five minutes.' || char(10) || char(10) ||
         'The specification is in your working directory as EXECUTIVE_INTELLIGENCE.md — follow its standards for sourcing and honesty, but NOT its length. A previous run produced twenty sections and thirty-one sources. That is a newspaper, not a briefing, and she reads this at 7am before a day of work.' || char(10) || char(10) ||
         'Cover only what could change a decision she makes this week, aimed at her actual businesses: late-stage secondaries and private markets, a fundraise to family offices and endowments, and small web properties that live or die on search. Skip general market colour she can get anywhere.' || char(10) || char(10) ||
         'SKY.json holds every planetary position, her natal chart and today''s transits, computed by this system to about one arcminute. It is authoritative for anything astronomical — do not search the web for ephemeris data, and cite it as "Boss OS (computed)". If it is missing, file that section as a gap and carry on.' || char(10) || char(10) ||
         'You have WebSearch and WebFetch. Open the sources you cite rather than recalling them. Every figure carries a named source and the time it was read; anything unverified goes in gaps rather than being softened or omitted.' || char(10) || char(10) ||
         'Write delivers.json in the current working directory, rewriting it as you go rather than at the end:' || char(10) ||
         '  status      "complete" or "partial". Use "partial" whenever anything is unverified.' || char(10) ||
         '  summary     Two or three sentences. What actually changed since yesterday.' || char(10) ||
         '  sections    [{ heading, body }] — six at most.' || char(10) ||
         '  sources     [{ name, url, read_at }] — read_at is an ISO timestamp of when YOU opened it.' || char(10) ||
         '  gaps        [{ wanted, why }] — never omit a gap to look complete.' || char(10) ||
         '  corrections [{ was, now, why }] — where today contradicts a previous report.' || char(10) || char(10) ||
         'A short honest brief beats a long one. If little happened, say so in three sentences and stop.'
       )
 WHERE id = 'duty_exec_intel';

-- ─── Sourcing hunts only what changed ────────────────────────────────────────
--
-- HER CALL AGAINST MINE, TWICE. I first moved this to weekly for cost; she said the buyer hunt
-- should be daily, and she was right — the brokerage is her primary income, it is going badly, and
-- buyer flow is exactly what it lacks. She then set the real budget and said "2-3x per week if
-- needed", which 0196 implements as Monday, Wednesday and Friday. The saving here comes from the
-- run being incremental rather than from it running less.
UPDATE standing_duties
   SET task_input = json_set(
         COALESCE(task_input, '{}'),
         '$.requested.max_seconds', 600,
         '$.prompt',
         'Find buyers for private, late-stage technology secondaries — and today, find NEW ones.' || char(10) || char(10) ||
         'KNOWN.json in your working directory lists every firm already on her list. DO NOT DELIVER ANY OF THEM AGAIN. Re-finding the same institutions is what made this run expensive and useless: she has them, and a list that repeats itself is one she stops opening.' || char(10) || char(10) ||
         'Hunt what has CHANGED. A fund that just announced a secondaries vehicle or a new close. A mandate published in the last week or two. A named secondary transaction reported recently. A team hire that signals a direct-secondaries programme starting. Recency is the whole reason this runs daily.' || char(10) || char(10) ||
         'The mandate is unchanged: institutions buying private tech secondaries at $5M+ per position, $20M+ strongly preferred. Family offices, secondaries funds, crossover funds, sovereign and pension allocators with a direct programme. Skip anyone whose stated minimum is below $5M.' || char(10) || char(10) ||
         'Use WebSearch and WebFetch and OPEN the pages you cite. Every candidate needs a source that actually says they buy secondaries. A plausible-sounding firm with no source costs her a phone call to disprove.' || char(10) || char(10) ||
         'TWO GOOD NEW NAMES IS A GOOD DAY, and zero is a real answer. Say so rather than padding with firms already on the list or ones you could not verify — most days the market does not produce ten new secondaries buyers.' || char(10) || char(10) ||
         '── WHO HAS GONE QUIET ──' || char(10) || char(10) ||
         'CONTACTS.json holds her brokerage correspondents and the dates she last exchanged mail with them — addresses and dates only, no subjects and no contents. If it is absent, say so in gaps and skip this half; do not go looking for a mailbox.' || char(10) || char(10) ||
         'Her business runs on referrals, and a referral business decays silently. Read `days_since_she_wrote`: the conversations SHE keeps up are the ones that rot. Surface people with real history who have gone quiet, preferring a long relationship gone cold over someone who wrote twice last year. Do not infer what any relationship was about — you have dates and addresses and nothing more.' || char(10) || char(10) ||
         '── WHAT YOU MAY NOT DO ──' || char(10) || char(10) ||
         'Do not read any mailbox yourself. Do not add anyone to her network. She also asked for clients who might want something she recently discussed — that needs the contents of her mail, which you do not have and must not seek. Record it in gaps as not run.' || char(10) || char(10) ||
         '── OUTPUT ──' || char(10) || char(10) ||
         'WRITE delivers.json AFTER EVERY CANDIDATE YOU VERIFY, not at the end. You are on a hard timeout and whatever is in the file is what she gets.' || char(10) ||
         '  candidates  [{ name, kind, ticket_floor_usd, thesis, source_url, source_name, read_at }] — NEW only.' || char(10) ||
         '  dormant     [{ email, name, days_since_last, days_since_she_wrote, exchanges, why_it_matters }]' || char(10) ||
         '  gaps        [{ wanted, why }] — including "nothing new today", which is legitimate.' || char(10) ||
         '  notes       Anything she should know about how it went.'
       )
 WHERE id = 'duty_brokerage_sourcing';

-- The three weekly duties are capped at ten minutes apiece. None of them needs half an hour, and a
-- run that cannot finish in ten minutes is one that has wandered.
UPDATE standing_duties
   SET task_input = json_set(COALESCE(task_input, '{}'), '$.requested.max_seconds', 600)
 WHERE id IN ('duty_link_prospects', 'duty_tool_scout', 'duty_practice_week');

-- ─── What she is warned at ───────────────────────────────────────────────────
--
-- 70%, not 80%. On a shared plan the thing that matters is not the moment the budget runs out but
-- the moment her own capacity starts being eaten, and that is earlier than a billing threshold
-- would be. Early enough to change something; late enough not to cry wolf every month.
INSERT INTO settings (key, value, updated_at) VALUES
  ('agent_budget_warn_pct', '70', unixepoch() * 1000)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

/*
 * WHAT A BUDGET STOP DOES AND DOES NOT STOP.
 *
 * Her instruction: "if i ask for something they do it regardless and if we are out of budget or
 * dangerously so i get notified."
 *
 * So the ceiling governs SCHEDULED work only. A duty that would breach it is skipped with a named
 * reason and she is told. Anything she asks for runs, whatever the balance — a budget that can
 * refuse the owner makes her system less useful than no system, and it is her plan.
 */
INSERT INTO settings (key, value, updated_at) VALUES
  ('agent_budget_policy',
   'The monthly ceiling on execution_backends.bk_claude_code governs SCHEDULED duties only. Work the owner asks for directly always runs, whatever the balance. She is warned at agent_budget_warn_pct of the ceiling, and again whenever a duty is actually skipped. The figure is equivalent Claude Max usage, not a separate bill: the employees and the owner draw on the same plan, which is why the ceiling is half of it.',
   unixepoch() * 1000)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0195_boss_agent_budget');
