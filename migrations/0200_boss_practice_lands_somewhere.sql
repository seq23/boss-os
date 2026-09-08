-- Imani's practice ran every Sunday for nothing, and this is where it lands.
--
-- ─── What was actually wrong ────────────────────────────────────────────────
--
-- `duty_practice_week` (0192) declares `delivers: 'practice_week'`. `duties/deliverReport.ts`
-- handles four keys — executive_reports, sourcing_candidates, link_prospects, tool_suggestions —
-- and that is not one of them. No table of that name existed either: 0192 wrote the data_policy row
-- classifying `practice_week` and then never created the thing it classified.
--
-- So the duty fired at 17:00 America/Chicago every Sunday, spent its ~$0.15 of her Claude Max plan,
-- wrote `delivers.json` into `~/.boss-os/practice`, and the Worker read that file, found no handler
-- for its key, and dropped it on the floor. Every signal said the duty was working. `last_run_at`
-- advanced, the task closed, an approval was raised. It succeeded at the wrong thing, which is this
-- codebase's favourite defect and the reason `validate:reachable` exists — except reachability asks
-- whether TABLES have writers, and this is a table that was never created at all, so there was
-- nothing for it to ask about. `validate:classification` is what caught it, on the orphan policy
-- row, and that validator was itself not wired into `npm run validate`. Two guards, one gap
-- between them.
--
-- `validate:duty-delivery` closes the gap generically: a validator that asserts every `delivers`
-- key a duty declares has a handler AND a table. This migration is the thing that has to exist
-- first, or that validator lands red on day one.
--
-- ─── And the deeper reason it was possible at all ───────────────────────────
--
-- This is precisely the failure the owner legislated against on 7 September: "she owns this
-- deliverable so she needs to make sure its done... she canot drop it. that goes for all employees
-- when i give them something to own." A duty is defined by FIRING; it cannot tell you it is
-- achieving nothing, because its success criterion is that it ran. Imani's did run, faithfully,
-- eleven times, at a cost, and the thing it existed to produce did not exist.
--
-- 0202 builds the general answer: an OWNED DELIVERABLE, whose terminal condition is evaluated
-- against the records rather than against whether a job succeeded, which stays on her screen and
-- gets louder until the world is actually true. Had that mechanism existed in August, "the week's
-- practice is readable on the Spirit screen" would have been shouting on Today since the day the
-- duty was created. Read the two migrations together: this one repairs the instance, that one
-- removes the class.
--
-- ─── Why the table is singular, and why that is not a slip ──────────────────
--
-- `practice_week`, not `practice_weeks`, because `validate:classification` matches a data_policy
-- entity to a table of the SAME NAME and 0192 already classified `practice_week`. Renaming the
-- policy row instead would move a residency decision the owner made — LOCAL_ONLY on both axes —
-- inside a migration whose subject is something else, which is precisely the move
-- `data-classification.mjs` was written to make visible. The table takes the classified name.
--
-- ─── The shape, which is the report's shape ─────────────────────────────────
--
-- One row per week, replaced rather than duplicated, exactly as `executive_reports` is one row per
-- day. A Sunday run that fails and is re-run on Monday must correct the week rather than produce a
-- second opinion about it.
--
-- Rituals, practice and body are stored as JSON rather than exploded into columns because the duty
-- produces at most one of each and the screen renders them whole. `gaps` is first-class for the
-- same reason it is on the report: 0192's own prompt says an honest short week is fine, and a gap
-- that is not stored is a gap that is not honest.

CREATE TABLE practice_week (
  id                TEXT PRIMARY KEY,
  -- The ISO week it is FOR, in her zone: `2026-W37`. Not the week it was written. Sunday is the
  -- LAST day of an ISO week, so the scheduled 17:00 Central run is still Sunday in UTC and looks
  -- fine — while any retry past 19:00 Central is already Monday in UTC, hence the next week, and
  -- would file the brief under the week that had just ended. That is the same defect
  -- `executive_reports.day_id` carries a paragraph about, arriving by the same route.
  week_id           TEXT NOT NULL,
  generated_at      INTEGER NOT NULL,
  task_id           TEXT,
  backend_run_id    TEXT,

  -- complete | partial | failed. Same vocabulary as the report, and for the same reason: a failed
  -- run still writes a row, so the screen can say when the last good week was rather than rendering
  -- a blank that looks identical to "nothing has ever run".
  status            TEXT NOT NULL CHECK (status IN ('complete','partial','failed')),

  -- [{ occasion, ritual, minutes, what_it_is_for }] — EMPTY IS THE COMMON CASE and it is correct.
  -- Most weeks hold no new or full moon, and 0192's prompt is explicit that inventing an occasion
  -- is how this becomes noise. An empty array here means "the sky offered nothing this week", which
  -- the screen states rather than hiding.
  rituals           TEXT NOT NULL DEFAULT '[]',
  -- { technique, claim, source_name, source_url, how_to_try_it }
  practice          TEXT,
  -- { suggestion, why }
  body              TEXT,
  gaps              TEXT NOT NULL DEFAULT '[]'
);

-- One row per week, so a re-run corrects rather than competes. `deliverPracticeWeek` upserts on it.
CREATE UNIQUE INDEX idx_practice_week ON practice_week(week_id);
CREATE INDEX idx_practice_generated ON practice_week(generated_at DESC);

-- No data_policy insert here: 0192 already classified `practice_week` LOCAL_ONLY on both axes with
-- the owner's reasoning, and that row is the one this table is named after. Re-stating it would
-- create two places holding one decision.

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0200_boss_practice_lands_somewhere');
