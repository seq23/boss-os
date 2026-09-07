-- Return on effort: six income lines, finite hours, and until now not one measured outcome.
--
-- WHAT WAS WRONG, and it is not a missing table. The system counted ACTIVITY everywhere — touches
-- logged, candidates surfaced, deals staged, loops opened, LP emails sent — and recorded no result
-- against any of it. That is not a neutral gap. A screen that shows six lines with activity on each
-- and outcome on none makes all six look equally alive, so the line that has produced nothing in a
-- year is indistinguishable from the line that produced everything, and the only tiebreak left is
-- which one she happens to feel like working on.
--
-- The numbers she already knows, and which nothing in here could tell her:
--
--   · 542 LP emails       →  4 replies      (0.7%)
--   · 23 Search Console properties → 24 clicks in 28 days
--   · brokerage           →  0 closed
--
-- Every one of those is a RATIO. "542 emails sent" on its own is vanity — it is the number that
-- makes a bad month feel like a busy one — and the whole point of this table is that the numerator
-- and the denominator arrive together or not at all.
--
-- ─── Why a contribution table rather than a metrics table ────────────────────
--
-- Follow the split that already governs everything else here: the Worker computes what it holds,
-- and a local job on her Mac contributes what only it can reach. The Claude Code runner strips every
-- credential from its environment, so nothing in the cloud can read the LP tracker or Search
-- Console; those numbers can only arrive by being POSTed in from her machine.
--
-- So this table holds ONLY the contributed half. The D1-side half — touches, candidates, deals,
-- prospects — is computed live at read time in `today/returns.ts` and deliberately not stored,
-- because a stored copy of a number D1 already holds is a second source of truth that will
-- eventually disagree with the first.
--
-- ─── NULL is not zero, and this is the column that carries the distinction ───
--
-- `outcome_count` is nullable ON PURPOSE and the rest of the design rests on it.
--
--   0    = we measured, and the answer was none. The line produced nothing.
--   NULL = we have no way to see the outcome at all. The line is UNMEASURED.
--
-- Conflating those is the single most expensive mistake this feature could make. YouTube has no
-- revenue signal anywhere in this system; if it renders as "0" beside a brokerage that genuinely
-- closed nothing, she reads two dead lines where there is one dead line and one blind spot, and the
-- correct action for those is opposite — stop working the first, instrument the second.
--
-- ─── No ranking, and no table shape that invites one ─────────────────────────
--
-- There is no `score`, no `rank`, no `return_bps`. Her instruction, and she is right about the
-- reason: the brokerage cannot carry a weekly target because a deal takes two weeks to six months,
-- so a column that sorted lines by measured return would put the engine of the business at the
-- bottom every month it happened to be mid-cycle. The ledger reports; she judges.

CREATE TABLE line_returns (
  id             TEXT PRIMARY KEY,
  -- The income line, keyed to `src/worker/boss/today/projects.ts`. The endpoint refuses a key that
  -- is not in PROJECTS: an income line that appears because something POSTed it is exactly the
  -- "fourth active project with no decision behind it" that projects.ts exists to prevent.
  line           TEXT NOT NULL,
  -- 'YYYY-MM', or 'all' for a lifetime figure the source cannot bucket by month. Both are real and
  -- they are never added together.
  period         TEXT NOT NULL,
  -- Where the number came from, so a wrong figure is traceable to the job that wrote it.
  source         TEXT NOT NULL,
  -- The effort, named in her words rather than a metric key: "LP emails sent", "impressions earned".
  effort_label   TEXT NOT NULL,
  effort_count   INTEGER NOT NULL,
  outcome_label  TEXT NOT NULL,
  -- NULL means unmeasured. See above; this is the whole design.
  outcome_count  INTEGER,
  -- Why the outcome is unmeasured, required whenever outcome_count IS NULL. A blank that explains
  -- itself is information; a blank that does not is an accusation against the line.
  unmeasured_why TEXT,
  -- How many days of activity the numbers cover, when the source has a window (Search Console reads
  -- 28 days). NULL when the period is the window.
  window_days    INTEGER,
  note           TEXT,
  measured_at    INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

-- One row per line, per period, per source. Re-running the contributor overwrites rather than
-- appends: these are measurements of a period, not events in it, and a second run on the same day
-- must not double the month.
CREATE UNIQUE INDEX idx_line_return_slot ON line_returns(line, period, source);
CREATE INDEX idx_line_return_period ON line_returns(period, line);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('line_returns', 'wealth', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Counts of her own activity and its results, per income line: emails sent, replies received, impressions, clicks. No person, firm, client or counterparty appears — the contributor aggregates before it sends, and the endpoint has no column to put a name in. External processing is unrestricted because there is nothing here to leak: seven integers and the labels on them.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0198_boss_line_returns');
