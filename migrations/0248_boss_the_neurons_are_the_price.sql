-- THE TWO MODELS THAT ACTUALLY RUN ARE THE TWO WITH NO PRICE.
--
-- `usage_ledger` holds fifteen rows in its entire life. All fifteen are `mdl_cf_llama33_70b`, all
-- fifteen record `cost_micros: 0`, and both Workers AI models carry `pricing_state = 'UNKNOWN'`
-- with no source and no check date. Every other model in the registry has been priced and
-- provenanced; the only ones anything has ever called have not.
--
-- The zeros in the ledger are not wrong — `backends/guard.ts` classes `bk_workers_ai` as
-- `included_allowance`, so a call inside the daily allowance costs nothing and the router records
-- nothing. But `models.in_micros_1k` is not the ledger; it is what `estimateCostMicros` uses to
-- decide whether a call is affordable BEFORE it is made, and a zero there says "this can never
-- cost anything", which is false the moment the allowance is gone.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WORKERS AI BILLS IN NEURONS, SO A PER-TOKEN FIGURE IS A CONVERSION.
--
-- The instruction for this work was explicit: record the neuron rate and the conversion, not a
-- derived number presented as a quote. The good news is that no derivation is required, and saying
-- why matters more than the numbers.
--
-- [W1] https://developers.cloudflare.com/workers-ai/platform/pricing/ — retrieved 17 September
--      2026. Cloudflare publishes EVERY model in BOTH units, in two adjacent columns, and states
--      in its own words: "The Price in Tokens column is equivalent to the Price in Neurons
--      column". The page also states the allowance and the rate:
--
--          10,000 Neurons per day at no charge
--          $0.011 per 1,000 Neurons beyond that
--
--      So the per-token figure stored below is COPIED FROM THE VENDOR'S OWN TOKEN COLUMN. It is
--      not a neuron figure this migration divided. That is the difference between a quote and a
--      derivation, and it is the whole reason this row may be marked SOURCED.
--
-- THE NEURON FIGURES ARE RECORDED ANYWAY, and the conversion is shown, because the neuron column
-- is the one the bill is actually computed in and a reader who only ever sees dollars cannot check
-- the allowance against anything. The arithmetic below is a CHECK on Cloudflare's two columns, run
-- once here so a future reader does not have to wonder whether they agree:
--
--   model                                   neurons/M      × $0.011/1k      published $/M    agrees
--   ──────────────────────────────────────  ─────────────  ───────────────  ───────────────  ──────
--   llama-3.1-8b-instruct-fp8      input       13,778        $0.151558        $0.152          yes
--                                  output      26,128        $0.287408        $0.287          yes
--   llama-3.3-70b-instruct-fp8-fast input      26,668        $0.293348        $0.293          yes
--                                  output     204,805        $2.252855        $2.253          yes
--
--   Four figures, four agreements, to the rounding Cloudflare itself prints. The two columns are
--   the same fact and either may be quoted.
--
-- THE UNIT, once, because it is easy to get wrong by a factor of a thousand. `in_micros_1k` is USD
-- micros per 1,000 tokens. $1.00 per 1M tokens = 1,000 micros per 1k tokens. So $0.152/M is 152,
-- $0.287/M is 287, $0.293/M is 293, and $2.253/M is 2253.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT.
--
-- IT DOES NOT MAKE WORKERS AI COST MONEY. `freeTier()` in `backends/guard.ts` returns
-- `included_allowance` for `bk_workers_ai` from the BACKEND, not from a price column, and the
-- router still records `cost_micros = 0` for a free route. Nothing about the $0 posture moves.
--
-- WHAT IT MAKES POSSIBLE is the estimate. Until now a Workers AI call estimated at exactly zero,
-- so the per-run cap, the task's permission envelope and the lane budget had nothing to compare
-- against and could not have refused one however large it was. A real rate means the same call is
-- now PRICED before it runs, which is what lets a cap predict rather than only react.
--
-- THE ONE THING THIS SYSTEM STILL CANNOT SEE is how much of the 10,000 daily Neurons is left. A
-- Worker has no API for its own remaining allowance, and the router already says so in the ledger
-- detail it writes on every free call: "$0 here is the tier's price and not a measurement." That
-- sentence stays true and stays honest. What this migration adds is the price of the call AFTER
-- the allowance, which is the number that was missing.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- AND THE STANDARD 0174 SET IS KEPT. `mdl_kimi_k2` remains ILLUSTRATIVE — its price note refuses
-- to launder a third-party tracker into a vendor quote and says "a tracker is not the vendor". It
-- is UNTOUCHED here. Nothing in this migration promotes a figure that could not be confirmed, and
-- the Fireworks pair keeps exactly the state it earned.
--
-- Plan: docs/boss/PLAN_v21.md Stage 8, item 1. Canon: Phase 6.

-- The neuron rate and the allowance, stored where the product can read them rather than only in a
-- comment. They are a property of the ACCOUNT, not of a model, which is why they are settings and
-- not columns: both models are billed against the same daily allowance at the same rate.
INSERT INTO settings (key, value, updated_at) VALUES
  ('workers_ai_free_neurons_per_day', '10000', 1789603200000),
  ('workers_ai_micros_per_1k_neurons', '11000', 1789603200000),
  ('workers_ai_price_source',
   'https://developers.cloudflare.com/workers-ai/platform/pricing/ retrieved 2026-09-17: '
   || '"10,000 Neurons per day at no charge", then "$0.011 per 1,000 Neurons". 11000 micros = '
   || '$0.011. Cloudflare publishes each model in both Neurons and Tokens and states the two '
   || 'columns are equivalent, so models.in_micros_1k quotes the token column directly rather '
   || 'than converting from neurons.',
   1789603200000)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

UPDATE models SET
  in_micros_1k     = 152,
  out_micros_1k    = 287,
  pricing_state    = 'SOURCED',
  price_checked_at = 1789603200000,
  price_source     =
    'Cloudflare Workers AI pricing, retrieved 2026-09-17: '
    || 'https://developers.cloudflare.com/workers-ai/platform/pricing/ — @cf/meta/llama-3.1-8b-instruct-fp8 '
    || 'is published as $0.152 per M input tokens and $0.287 per M output tokens, and as 13,778 '
    || 'neurons per M input and 26,128 neurons per M output. QUOTED FROM THE TOKEN COLUMN, not '
    || 'converted: Cloudflare states "The Price in Tokens column is equivalent to the Price in '
    || 'Neurons column". Checked against the neuron column at the published $0.011/1,000 neurons — '
    || '13,778 x 0.011/1000 = $0.15156 and 26,128 x 0.011/1000 = $0.28741, both agreeing with the '
    || 'token column to Cloudflare''s own rounding. Stored 152/287 micros per 1k tokens. Billing is '
    || 'against an included allowance of 10,000 neurons a day; a Worker cannot read how much of '
    || 'that remains, so this is the price of a call BEYOND the allowance and never a measurement '
    || 'of what a given call cost.'
WHERE id = 'mdl_cf_llama31_8b';

UPDATE models SET
  in_micros_1k     = 293,
  out_micros_1k    = 2253,
  pricing_state    = 'SOURCED',
  price_checked_at = 1789603200000,
  price_source     =
    'Cloudflare Workers AI pricing, retrieved 2026-09-17: '
    || 'https://developers.cloudflare.com/workers-ai/platform/pricing/ — @cf/meta/llama-3.3-70b-instruct-fp8-fast '
    || 'is published as $0.293 per M input tokens and $2.253 per M output tokens, and as 26,668 '
    || 'neurons per M input and 204,805 neurons per M output. QUOTED FROM THE TOKEN COLUMN, not '
    || 'converted: Cloudflare states "The Price in Tokens column is equivalent to the Price in '
    || 'Neurons column". Checked against the neuron column at the published $0.011/1,000 neurons — '
    || '26,668 x 0.011/1000 = $0.29335 and 204,805 x 0.011/1000 = $2.25286, both agreeing with the '
    || 'token column to Cloudflare''s own rounding. Stored 293/2253 micros per 1k tokens. Note the '
    || 'output rate is nearly eight times the input rate, which is why a long generation on this '
    || 'model is the most expensive thing the free tier can do once the allowance is gone. Billing '
    || 'is against an included allowance of 10,000 neurons a day; a Worker cannot read how much of '
    || 'that remains, so this is the price of a call BEYOND the allowance and never a measurement.'
WHERE id = 'mdl_cf_llama33_70b';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0248_boss_the_neurons_are_the_price');
