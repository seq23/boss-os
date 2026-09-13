-- The ceiling follows her plan, $0 says which kind of $0 it is, and a plan figure stops looking
-- like a bill.
--
-- ─── Her words, 13 September 2026 ───────────────────────────────────────────
--
-- "i see nothing in systems about controlling costs and setting monthly budgets that all got sent
--  to the backends tab? so claude cieling is $50? i want claude ceiling to be whatever my plan
--  allows; idk maybe rethink this whole budget thing and give me a budget ceiling for each thing
--  there..idk / arent we on medium level of costs? what happened to the lever?"
--
-- ─── The live state, measured before changing anything ──────────────────────
--
--   bk_claude_code    ceiling $50.00  spent $17.03  enabled
--   bk_workers_ai     ceiling  $0.00  spent  $0.00  enabled
--   bk_anthropic      ceiling  $5.00  spent  $0.00  registered
--   bk_fireworks      ceiling  $0.00  spent  $0.00  registered
--   bk_openai         ceiling  $5.00  spent  $0.00  registered
--   bk_openrouter     ceiling  $0.00  spent  $0.00  registered
--   bk_local_runtime  ceiling  $0.00  spent  $0.00  disabled
--   settings          cost_mode = NORMAL, spend_lever = MODERATE, moderate = $25.00
--
-- ─── THE LEVER WAS NEVER MISSING. IT WAS INVISIBLE ──────────────────────────
--
-- "arent we on medium level of costs? what happened to the lever?" — she is on MODERATE at $25/mo
-- with cost_mode NORMAL, which IS the medium she remembers. Both live in Settings and neither
-- appears on Systems, so from her seat the lever she was given had vanished. That half is a screen
-- change, not a data one, and it lands in `Systems.tsx` beside these columns.
--
-- ─── $0 MEANT THREE OPPOSITE THINGS ─────────────────────────────────────────
--
--   bk_workers_ai     $0 because it is FREE — an included allowance on an account already paid for
--   bk_openrouter     $0 because NOTHING IS AUTHORISED — free-tier models only until she says so
--   bk_local_runtime  $0 because it is OFF
--
-- One number, three meanings, and the screen showed the number. `Backends.tsx` has had the
-- vocabulary the whole time — it renders "FREE", "NO CAP" and "up to $x" from a `spend.kind` — and
-- no row ever carried a kind for it to read. Two components each keeping their own idea, with no
-- link between them. `spend_kind` is that link.
--
-- ─── AND IT IS NOT MONEY ────────────────────────────────────────────────────
--
-- `bk_claude_code` runs on her Claude subscription. The "$17.03 spent" is EQUIVALENT USAGE against
-- a flat fee: no money left her account and none will. 0195 says it ("that is Claude Max capacity
-- you also use, not a bill") and 0222 says it again ("this backend runs on her own subscription and
-- attributes no per-run charge") — and the SCREEN said neither, so she has been reading a fake
-- invoice for a week. `cost_basis` carries that fact next to the figure, which is what 0222 meant
-- when it warned about "an authoritative-looking number that misleads".
--
-- ─── THE CEILING IS DERIVED FROM THE PLAN, AND RESERVES RATHER THAN CAPS ────
--
-- The $50 is a number she authorised on 9 September and 0222 records it as "headroom, not a
-- response to observed spend". She is superseding it, and a larger hardcoded number would be the
-- same defect with a bigger digit — it goes stale the moment she changes plan and nothing notices.
--
-- She has said two things that sound contradictory and are not. Today: "whatever my plan allows."
-- In 0195, the real worry: "a week where she cannot use Claude Code for her own work because her
-- staff spent it." Both are honoured by INVERTING THE CONTROL: employees may draw the whole plan
-- MINUS a reserve she keeps for herself. Zero the reserve and it is literally whatever the plan
-- allows; the 25% default protects the thing she was actually afraid of. A cap asks her to guess a
-- number; a reserve asks how much she wants left, which is a question she can answer.
--
-- `ceiling_source = 'plan'` makes `bk_claude_code` take its ceiling from `router/plan.ts` at LOAD,
-- so the dispatch guard, the spend guard, the budget alert on Today and the Backends screen all see
-- the derived figure without any of them being taught about plans. The stored 50000000 stays in the
-- column as the historical record of what she authorised; nothing reads it any more.
--
-- ─── THE DAILY FIGURE STAYS DERIVED ─────────────────────────────────────────
--
-- 0222 found a $2/day cap under a $50/month ceiling — $60 against $50, two limits that could not
-- both be honoured — and fixed it by deriving the day from the month. That derivation was done by
-- hand in SQL, so it would have gone stale the moment the ceiling moved. It now divides the DERIVED
-- ceiling by 31 in `router/plan.ts`, and the rows below are brought into line with the new figure
-- one last time by hand so the stored budgets are not left contradicting it in the meantime.
--
--   Claude Max (5x) $100.00/mo, 25% reserved = $75.00 for the employees, $2.42/day.

ALTER TABLE execution_backends ADD COLUMN spend_kind TEXT NOT NULL DEFAULT 'capped';
ALTER TABLE execution_backends ADD COLUMN cost_basis TEXT NOT NULL DEFAULT 'invoiced';
ALTER TABLE execution_backends ADD COLUMN ceiling_source TEXT NOT NULL DEFAULT 'stored';

-- Free: an included allowance on an account already paid for. No key, no egress, no per-call charge.
UPDATE execution_backends SET spend_kind = 'free', cost_basis = 'free' WHERE id = 'bk_workers_ai';

-- Off by decision. A ceiling on something that cannot run is not a fact about money.
UPDATE execution_backends SET spend_kind = 'off', cost_basis = 'free' WHERE id = 'bk_local_runtime';

-- Nothing authorised. $0 here means free tiers only, and `backends/guard.ts` already enforces it.
UPDATE execution_backends SET spend_kind = 'capped', cost_basis = 'invoiced'
 WHERE id IN ('bk_openrouter', 'bk_fireworks');

-- A card is charged if these are ever enabled. Capped, and the $5 stands until she moves it.
UPDATE execution_backends SET spend_kind = 'capped', cost_basis = 'invoiced'
 WHERE id IN ('bk_anthropic', 'bk_openai');

-- Her subscription. Derived from the plan, and its figures are usage rather than money.
UPDATE execution_backends
   SET spend_kind = 'capped', cost_basis = 'plan_equivalent', ceiling_source = 'plan'
 WHERE id = 'bk_claude_code';

-- ─── The plan itself ────────────────────────────────────────────────────────
--
-- Claude Max (5x) at $100/month is what she is on. The reserve defaults to 25% so the default
-- behaviour protects her own week without her having to think about it, and she can zero it.
INSERT INTO settings (key, value, updated_at) VALUES
  ('plan_tier', 'claude_max_5x', unixepoch() * 1000),
  ('plan_reserve_pct', '25', unixepoch() * 1000)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

-- The stored budget rows, brought into line with the derived figures one last time. From here on
-- `router/plan.ts` is the source and these follow it.
UPDATE budgets SET limit_micros = 75000000 WHERE id = 'bdg_ops_month';
UPDATE budgets SET limit_micros = 2419354 WHERE id = 'bdg_ops_day';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0239_boss_the_ceiling_is_whatever_the_plan_allows');
