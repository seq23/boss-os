-- THE SPEND GRADIENT, AND THE EVIDENCE THAT A MODEL CAN DO A JOB.
--
-- Two things that look separate and are the same defect twice:
--
--   1. There was no gradient. There was a LEVER with three positions and a hard stop at the end,
--      and between them nothing. Spend went from "fine" to "refused" with no interval in which the
--      system got more careful on its own, so the only instrument for "be a bit more frugal this
--      month" was her, by hand, noticing.
--
--   2. `benchmark_status` is 'unbenchmarked' on five of six models and `model_evaluation` has never
--      held a row. Every routing preference in this system is therefore decided on PAPER — a price
--      column and a capability tier somebody typed — and never on whether the model has actually
--      done the job. That is precisely how an 8B model came to answer a $1B secondary question
--      with "Route to Customer Service Team" (see 0229): cheapest-looking won, and nothing in the
--      database could say it had never done that work well.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. THE LIVE DEFAULT IS MODERATE.
--
-- `settings.spend_lever` has never been seeded. `spendLeverState` resolves an absent value to
-- FREE_ONLY, which is the correct FAIL-CLOSED behaviour for a value it cannot trust and the wrong
-- POSTURE for a system she uses — it means every paid backend commissioned in 0247 has been
-- unreachable since the day it was enabled, and nothing said so.
--
-- SEEDING IT DOES NOT WEAKEN THE FAIL-CLOSED RULE. The code default stays FREE_ONLY, so a
-- misspelled or hand-deleted value still lands at $0. What changes is that the row now EXISTS and
-- says MODERATE, which is a decision on the record rather than an absence being read as one.
--
-- The moderate allowance is left unseeded on purpose: `spendLeverState` seeds it from the ops
-- month budget, which is a figure she recognises because she set it.
INSERT INTO settings (key, value, updated_at)
VALUES ('spend_lever', 'MODERATE', CAST(strftime('%s','now') AS INTEGER) * 1000)
ON CONFLICT (key) DO UPDATE SET value = 'MODERATE', updated_at = excluded.updated_at
WHERE settings.value NOT IN ('FREE_ONLY', 'MODERATE', 'OPEN');

-- A row that already holds one of her three positions is HER HAND and is not overwritten. The
-- WHERE clause above is that guarantee: this migration installs a default where there was none and
-- repairs a value that is not a position, and it never overrules a choice she made.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. WHAT A MODEL HAS ACTUALLY DONE, BY (TASK KIND, MODEL).
--
-- `model_evaluation` already exists and is the right table for a BENCHMARK — a score, a method, a
-- sample size, produced by somebody deliberately measuring. This is the other half: the outcome of
-- REAL WORK, recorded as it happens, keyed by the thing the router actually asks about.
--
-- THREE OUTCOMES, AND THE SOURCE MATTERS MORE THAN THE OUTCOME.
--
--   succeeded   the work stood
--   reworked    it was usable but somebody had to fix it
--   rejected    it was sent back
--
-- `source` separates 'router' (the call returned and nothing sent it back) from 'human' (she, or
-- whoever decided the approval, said so). THE DISTINCTION IS THE WHOLE POINT. "It did not throw"
-- is not "it did the job well", and a confidence built out of router rows alone would be exactly
-- the paper confidence this table exists to replace. `router/experience.ts` requires human-sourced
-- rows before any model is called proven; router rows alone can only ever say "unknown".
--
-- APPEND-ONLY, like every other evidence table here (D15). A record of what happened that can be
-- edited afterwards is not a record.
CREATE TABLE model_job_outcome (
  id             TEXT PRIMARY KEY,
  ts             INTEGER NOT NULL,
  task_kind      TEXT NOT NULL,
  model_id       TEXT NOT NULL REFERENCES models(id),
  outcome        TEXT NOT NULL CHECK (outcome IN ('succeeded','reworked','rejected')),
  source         TEXT NOT NULL CHECK (source IN ('router','human','benchmark')),
  lane           TEXT,
  task_id        TEXT,
  usage_id       TEXT,
  note           TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_model_job_outcome ON model_job_outcome (task_kind, model_id, ts DESC);
CREATE INDEX idx_model_job_outcome_model ON model_job_outcome (model_id, ts DESC);

CREATE TRIGGER model_job_outcome_reject_update
BEFORE UPDATE ON model_job_outcome
BEGIN
  SELECT RAISE(ABORT, 'model_job_outcome is append-only: UPDATE rejected (D15)');
END;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE TABLE STARTS EMPTY, AND NOTHING SEEDS IT.
--
-- It would be easy, and wrong, to back-fill this from `usage_ledger` so the screens have something
-- to show. `usage_ledger` holds almost nothing, none of it carries a human verdict, and inventing
-- confidence from it is the defect in its purest form. AN UNPROVEN MODEL IS UNKNOWN, NOT GOOD.
-- `router/experience.ts` says so in code, and says out loud how many runs it needs before it can
-- say anything else.

-- The classification and merge policy rows, so the two scans that examine every table do not have
-- to guess. Operating machinery: no personal content of its own, append-only.
INSERT OR IGNORE INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('model_job_outcome', 'router', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'Operating machinery. Holds a task kind, a model id and a verdict. No personal content of its own.');

UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'model_job_outcome';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0253_boss_the_gradient_and_what_a_model_has_actually_done');
