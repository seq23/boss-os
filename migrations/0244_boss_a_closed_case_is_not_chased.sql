-- 0244 — A closed case is not chased.
--
-- ─── What happened, 14 September 2026 ────────────────────────────────────────
--
-- At 09:23 Central, `com.seq.kdp-watch` fired on schedule and Simone emailed her — subject
-- "KDP case update" — that support had diagnosed the cover problem, that seven covers were ready
-- for her approval, and that once approved "I can upload them and publish all 7 titles
-- immediately". She had approved those covers on 9 September. Six of the seven titles had been Live
-- on the bookshelf since the 12th. She replied at 09:27: "please close out the kdp upload issue.
-- The books have been published and the error resolved."
--
-- Three things let that email go out, and this migration fixes the two that live in the database.
--
--   1. THE CASE-CHASE DUTY WAS ALREADY GONE FROM PRODUCTION AND ITS LAUNCHD JOB WAS NOT.
--      `duty_kdp_publication` is absent from `standing_duties` on production — no migration
--      deleted it, no route can, no audit row records it; it was removed by hand at some point
--      after 11 September. `duty-run.sh kdp-watch.sh` therefore refused to record the run ("No
--      standing duty names kdp-watch.sh as its local job") — and ran the watcher anyway, because
--      the wrapper reports after the work. A job whose duty has been retired kept its schedule.
--      This migration retires the duty in the record so the migrations, the installer and the
--      validators agree with production, and the installer no longer writes the job.
--
--   2. THE REGISTER HAD NO WORD FOR A TITLE THAT IS SIMPLY UNPUBLISHED. The seventh title reads
--      Draft on the bookshelf: nothing refuses it, it has just not been sent. `blocked` would keep a
--      cleared case open; `in_review` would claim Amazon is looking at it. So `draft` is added.
--      SQLite cannot alter a CHECK constraint, so the table is rebuilt — ten rows.
--
--   3. (In code, not here.) `POST /kdp/check` re-blocked the commitment on every `needs-her`
--      whatever the register said; it now asks the register first. `kdp-watch.sh` and
--      `kdp-publish.mjs` read `chase.open` from `GET /kdp` before they read any mail, and stop at a
--      named stop when it is false. And a message from her that says "close out" beside the name of
--      one open commitment now STOPS that commitment, by rule, before any model sees it.
--
-- The surface duty — `duty_kdp_surface`, "read everything Amazon sends and decide what it means" —
-- is untouched. That is what she asked for going forward, in the same email.

-- ─── The register can say "draft" ────────────────────────────────────────────
CREATE TABLE kdp_titles_new (
  id             TEXT PRIMARY KEY,
  title_ref      TEXT NOT NULL,
  label          TEXT,
  -- blocked    — Publish refuses. The account-level flag.
  -- draft      — nobody has published it. Nothing refuses it. Hers to send when she wants it out.
  -- in_review  — submitted and awaiting Amazon.
  -- live       — actually published, which is the only state that ends the commitment.
  -- withdrawn  — hers to set, for anything she decides not to publish.
  state          TEXT NOT NULL DEFAULT 'blocked' CHECK (state IN ('blocked','draft','in_review','live','withdrawn')),
  note           TEXT,
  first_seen_at  INTEGER NOT NULL,
  state_changed_at INTEGER NOT NULL,
  went_live_at   INTEGER,
  updated_at     INTEGER NOT NULL
);
INSERT INTO kdp_titles_new (id, title_ref, label, state, note, first_seen_at, state_changed_at, went_live_at, updated_at)
  SELECT id, title_ref, label, state, note, first_seen_at, state_changed_at, went_live_at, updated_at FROM kdp_titles;
DROP INDEX IF EXISTS idx_kdp_title_ref;
DROP INDEX IF EXISTS idx_kdp_title_state;
DROP TABLE kdp_titles;
ALTER TABLE kdp_titles_new RENAME TO kdp_titles;
CREATE UNIQUE INDEX idx_kdp_title_ref ON kdp_titles(title_ref);
CREATE INDEX idx_kdp_title_state ON kdp_titles(state, state_changed_at DESC);

-- ─── The case-chase duty is retired ──────────────────────────────────────────
--
-- Already absent on production. Deleted here so every environment agrees, and so
-- `validate:launchd-duty-link` stops demanding a launchd job for a duty that has ended. Its history
-- stays: `kdp_case_checks`, the audit rows and the deliverable all keep their references.
DELETE FROM duty_runs WHERE duty_id = 'duty_kdp_publication';
DELETE FROM standing_duties WHERE id = 'duty_kdp_publication';

-- The commitment no longer names a duty that does not exist. Its own state is hers to set and was
-- set by her email; nothing here touches it.
UPDATE owned_deliverables SET duty_id = NULL, updated_at = unixepoch() * 1000
 WHERE id = 'del_kdp_publication' AND duty_id = 'duty_kdp_publication';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0244_boss_a_closed_case_is_not_chased');
