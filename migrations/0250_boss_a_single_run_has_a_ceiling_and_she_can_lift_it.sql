-- A PER-RUN CEILING, AND THE ONE WAY OVER IT THAT IS HERS.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT WAS MISSING · `budgets` covers a DAY and a MONTH and nothing smaller.
--
-- `per_run` appears once in this repository, in `src/worker/boss/duties/author.ts`, as an
-- ESTIMATE — 0.3 for judgement work and 0.05 otherwise — used to describe a duty. Nothing has ever
-- compared a call against it. So a single runaway call could take a third of the ops day before the
-- daily cap noticed, and the daily cap would then report the damage rather than prevent it.
--
-- It is not hypothetical. The output rate on `mdl_cf_llama33_70b` is $2.253 per million tokens
-- (0248) — nearly eight times its input rate — so one long generation, once the Workers AI daily
-- allowance is gone, is the single most expensive thing this system can do by accident. The day
-- budget is $1.75.
--
-- $0.75, MATCHING THE OTHER REPO, and matching the trading lane's whole daily budget. A run worth
-- more than that is a decision, and a decision belongs to her.
--
-- IT IS A SETTING RATHER THAN A COLUMN because it is one number for the whole system, and a
-- per-lane or per-model copy of it is the "two components each keeping their own list" defect with
-- extra steps. `getNumber` in `lib/settings.ts` already fails to the supplied default on an absent
-- or unparseable value, and `router/index.ts` supplies 750000 — so a hand-edited row cannot raise
-- the cap by becoming unreadable.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- AND THE BYPASS, WHICH SHE ASKED FOR IN THESE WORDS:
--
--   "if a task is going to take me over the caps daily or per run or monthly i need a way to
--    bypass"
--
-- MODELLED ON `STRATEGIC_SURGE` IN WEST PEEK OS (`src/worker/ai/runAi.ts`), which exists for
-- exactly this and has the right semantics: caps lift ONLY inside an unexpired, fully-specified
-- record, and an expired or malformed one resolves to the normal posture. Copied and diverged, per
-- this repository's rule — the sibling holds its surge as a JSON blob on a policy row, which is one
-- record for the whole firm, and this needs several bypasses to be able to exist and be told apart
-- afterwards. So it is a table.
--
-- ─── THE THREAT MODEL, WHICH IS WHAT THE COLUMNS ARE FOR ────────────────────
--
--   · AN AUTOMATION GRANTING ITSELF HEADROOM. The failure this is most likely to have. A duty hits
--     a cap, something helpful writes a bypass, and the cap is now decorative. `raised_by` is
--     constrained to 'owner' BY THE SCHEMA, so there is no value an employee, a duty or a cron can
--     put there. It is not a convention the code observes; the database refuses the row.
--   · A BYPASS THAT OUTLIVES ITS REASON. Every one expires. `expires_at` is NOT NULL and the
--     resolver treats absent, malformed and past identically — see `bypass.ts`.
--   · AN OPEN-ENDED SWITCH. There is none. `amount_micros` is NOT NULL and > 0: a bypass names a
--     number, and spending past that number is refused exactly as it would have been without one.
--     Nothing here turns `hard_stop` off, which is the mechanism she must never be offered, because
--     it is the one whose end state is silence.
--   · SPEND THAT CANNOT BE ACCOUNTED FOR AFTERWARDS. `usage_ledger.bypass_id` stamps every call
--     that ran under one, so a month reads as "the budget, plus these three decisions" rather than
--     as an unexplained overrun.
--   · A BYPASS NOBODY CAN FIND LATER. `reason` is NOT NULL with a real minimum length, the same
--     discipline `backfillOpportunitySchema` already applies to a pass — "old" satisfies a
--     non-empty check and tells a future reader nothing.
--   · REVOKING ONE. `revoked_at` rather than DELETE, so the record of a decision she changed her
--     mind about survives. A revoked bypass is over immediately.
--
-- WHAT IT DELIBERATELY DOES NOT DO: it does not raise the ceiling for everything for a while. It
-- lifts the named cap, by the named amount, until the named time, and it is visible in the ledger
-- afterwards. "Turn the cap off" is not one of the things this table can express.

CREATE TABLE spend_bypass (
  id            TEXT PRIMARY KEY,

  -- WHICH CAP. Named, not implied — "a bypass" that silently meant all three would be the
  -- open-ended switch wearing a bounded one's clothes. She asked for "daily or per run or monthly"
  -- and these are those three words.
  scope         TEXT NOT NULL CHECK (scope IN ('per_run','day','month')),

  -- Which lane's day or month. NULL for a per-run bypass, which belongs to no window.
  lane          TEXT,

  -- HOW MUCH, IN MICROS, AND IT IS A CEILING RATHER THAN A GRANT. For `per_run` it replaces the
  -- per-run cap for runs made while it is live. For `day` and `month` it is ADDED to that window's
  -- limit. Either way there is still a number, and spending past it still stops.
  amount_micros INTEGER NOT NULL CHECK (amount_micros > 0),

  -- WHY, in a sentence somebody can still understand in November. Twelve characters is the same
  -- minimum this repository already puts on a pass reason.
  reason        TEXT NOT NULL CHECK (length(trim(reason)) >= 12),

  -- WHO. The CHECK is the guard: there is no value here an employee or an automation can write.
  raised_by     TEXT NOT NULL DEFAULT 'owner' CHECK (raised_by = 'owner'),

  created_at    INTEGER NOT NULL,

  -- WHEN IT ENDS. NOT NULL, because the shape she must never be handed is the one with no end.
  expires_at    INTEGER NOT NULL,

  -- She changed her mind. Kept rather than deleted; a decision withdrawn is still a decision taken.
  revoked_at    INTEGER,
  revoked_reason TEXT,

  CHECK (expires_at > created_at)
);

-- The resolver asks one question — "is there a live bypass for this scope and lane" — and this is
-- that question's index.
CREATE INDEX idx_spend_bypass_live ON spend_bypass (scope, lane, expires_at);

-- ── The ledger says which spend was a decision ───────────────────────────────
--
-- NULL FOR ALMOST EVERYTHING, which is the point: a month's spend separates into the part the
-- budget allowed and the part she decided on, without anybody reconstructing it from timestamps.
ALTER TABLE usage_ledger ADD COLUMN bypass_id TEXT;

CREATE INDEX idx_usage_ledger_bypass ON usage_ledger (bypass_id) WHERE bypass_id IS NOT NULL;

-- ── The per-run cap itself ───────────────────────────────────────────────────
--
-- $0.75. `router/index.ts` passes the same figure as the default to `getNumber`, so an absent or
-- unparseable row holds the cap rather than removing it.
INSERT INTO settings (key, value, updated_at)
VALUES ('per_run_cap_micros', '750000', 1789603200000)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

-- The airlock classifies every table, and an unclassified one is refused rather than trusted
-- (v20.1 §11). A bypass is ordinary cloud-resident governance data — it holds an amount, a reason
-- and a time, and never any of the material the confidential line exists to protect.
-- ON CONFLICT DO NOTHING RATHER THAN `INSERT OR IGNORE`, and `subsystem` is not optional. The
-- first draft used OR IGNORE and omitted the column: `subsystem` is NOT NULL, the insert failed the
-- constraint, and OR IGNORE swallowed it — the table shipped unclassified and only
-- `validate:classification` noticed. OR IGNORE hides the error it was reached for; ON CONFLICT
-- names the one collision that is expected and lets every other failure be loud.
INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('spend_bypass', 'ops', 'CLOUD_SYNC', 'EXTERNAL_OK',
   'A spend decision the owner made: which cap, how much, why, and until when. It holds no LP name, '
   || 'no deal term and no content — a scope word, a number, a sentence of hers and two dates. It is '
   || 'the record that lets a month be read as "the budget, plus these decisions" rather than as an '
   || 'unexplained overrun, so it must travel with the ledger it explains.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0250_boss_a_single_run_has_a_ceiling_and_she_can_lift_it');
