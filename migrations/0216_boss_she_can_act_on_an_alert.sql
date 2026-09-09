-- She could read an alert and do nothing else. That is why the KDP one sat for a week saying
-- something untrue.
--
-- ─── Her words ─────────────────────────────────────────────────────────────
--
--   "i also need to be able to refresh critical alerts and / or dismiss / mark resolved? i dont know
--    u need to figure it out and add it"
--
-- She is naming the gap rather than the solution, and the naive version of each of those three
-- breaks something established earlier today. So all three exist and each is built against its own
-- failure mode.
--
-- ─── REFRESH RE-RUNS THE CHECK. It does not re-fetch the row ───────────────
--
-- Every alert on Today is computed on read, so a plain reload already re-reads the database — and
-- would tell her exactly what it told her a minute ago, because the underlying facts are only
-- established by something going and looking. Refresh therefore RE-EVALUATES: the terminal checks
-- run, the deliverables that have become true are closed, and the answer is timestamped so she can
-- see how fresh it is. The credential prober cannot be re-run from the Worker — it lives on her Mac
-- and uses credentials the Worker does not hold — so the refresh says when it last ran rather than
-- pretending to have re-run it. Claiming a check happened is the defect, not a missing feature.
--
-- ─── RESOLVED IS DETECTED, NEVER ASSERTED ──────────────────────────────────
--
-- This is the one that matters. `TERMINAL_CHECKS` exists precisely so nothing can close a
-- commitment by claiming it — an employee, a run and a job are all refused. A HUMAN MARKING
-- SOMETHING RESOLVED IS THE SAME CLAIM WEARING DIFFERENT CLOTHES. If she marks the West Peek grant
-- resolved and Scooter has not granted it, the system believes a false thing and stops telling her,
-- which is precisely the blindness this entire day has been about.
--
-- So "mark resolved" RE-VERIFIES. It runs the check; if the world agrees she is right, it closes.
-- IF THE CHECK CONTRADICTS HER, IT SAYS SO AND STAYS OPEN. She is not overruled — she is told what
-- the records say, and offered the dismiss below, which is honest about not being a resolution.
--
-- ─── DISMISS IS A DIFFERENT THING AND BOTH ARE NEEDED ──────────────────────
--
-- "Stop showing me this, it is not resolved." A real and reasonable state — she may know something
-- the system does not, or simply not want it today. Three properties keep it from becoming the
-- silence it looks like:
--
--   1. IT EXPIRES. `until` is a date, defaulted to seven days. A permanent mute on a live problem is
--      the failure mode this whole system is built against, so there is no way to express one.
--   2. IT BREAKS IF THINGS GET WORSE. `severity_at_dismissal` is recorded, and an alert that comes
--      back louder than it was ignores the dismissal. Deciding not to look at a medium is not
--      deciding not to look at a critical.
--   3. IT COSTS A REASON. Not to make it tedious — so that next week the alert can say "you
--      dismissed this on 9 Sep because X" rather than arriving as if it were new, which is how the
--      grant item went unnoticed for three weeks.
--
-- Dismissed is not hidden either: the count is on the screen and the list is one click away.

CREATE TABLE alert_dismissals (
  id            TEXT PRIMARY KEY,
  -- The alert's own identity, which is its source id where it has one and a hash of its text where
  -- it does not. Computed the same way on every render so a dismissal survives a reword.
  alert_key     TEXT NOT NULL,
  -- Kept for the screen, so a dismissal can say what it silenced without re-deriving it.
  alert_text    TEXT NOT NULL,
  -- Her sentence. Required: an unexplained dismissal is indistinguishable from a misclick.
  reason        TEXT NOT NULL,
  -- low < medium < high < critical, as it stood when she dismissed it. A louder one ignores this.
  severity_at_dismissal TEXT NOT NULL,
  dismissed_at  INTEGER NOT NULL,
  -- WHEN IT COMES BACK. There is deliberately no way to say "never".
  until         INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_dismissal_live ON alert_dismissals(alert_key, until);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('alert_dismissals', 'duties', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Which alerts she has chosen not to look at, for how long, and why. Operating machinery: a key, a sentence of hers and two dates.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0216_boss_she_can_act_on_an_alert');
