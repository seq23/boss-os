-- Stage 8, item 1 — the cost ledger's prices, checked against the vendors' published rate cards.
--
-- WHAT WAS WRONG. `0153_boss_seed.sql` says in its own third line: "Verify against your provider's
-- current rate card before you trust the cost ledger — these are placeholders." Nobody had. Every
-- figure the product reports — the $/day ops budget on Settings, the spend-by-model panel, and every
-- budget hard stop in `budgets` — is computed from `models.in_micros_1k` / `models.out_micros_1k` by
-- `src/worker/boss/router/policy.ts`. The arithmetic was proven and the inputs were unsourced.
--
-- WHAT THIS MIGRATION DOES, AND DELIBERATELY DOES NOT DO. Both stored prices were checked against
-- the vendor's own published pricing on 6 September 2026. **Neither number changes**, because
-- checking is what the task actually was and the check did not find a wrong number: one price is
-- confirmed exactly right against the current card, and the other could not be confirmed at all.
-- Inventing a "corrected" figure for the second would have replaced an acknowledged placeholder
-- with a number that looks authoritative and is not — which in a cost ledger is strictly worse.
--
-- So the change is provenance, carried as data rather than as prose in a file nobody opens. After
-- this, every price in the ledger says where it came from and when it was last checked, and a price
-- that could not be confirmed says so in the row itself. `GET /api/models` selects `m.*`, so the
-- Model Registry screen inherits the fields without any code change. A price with no provenance is
-- the same defect as a wrong price: neither can be audited.
--
-- THE VOCABULARY IS NOT NEW. `pricing_state` reuses the exact four words the chassis already uses in
-- `provider_model.pricing_state` (0015_provider_cost.sql) — SOURCED, ILLUSTRATIVE, STALE, UNKNOWN —
-- so the two halves of this Worker describe price confidence in one language rather than two.
--
--   SOURCED      the vendor's own published page states this price; the row cites it
--   ILLUSTRATIVE a number is present and no vendor price has been read for it
--   STALE        was sourced once, and the vendor has since changed or withdrawn the card
--   UNKNOWN      not checked
--
-- ─────────────────────────────────────────────────────────────────────────────
-- SOURCES, WITH RETRIEVAL DATES. All retrieved 6 September 2026.
--
-- [S1] https://docs.fireworks.ai/serverless/pricing — Fireworks' serverless rate card. For models
--      not individually listed on the headline table it publishes a size-based tier, priced
--      uniformly for input and output with no separate cached-input rate:
--          < 4B parameters ............ $0.10 / 1M tokens
--          4B – 16B ................... $0.20 / 1M
--          > 16B (dense) .............. $0.90 / 1M
--          MoE, up to 56B ............. $0.50 / 1M
--          MoE, 56.1B – 176B .......... $1.20 / 1M
--      There is no tier above 176B for MoE models. The headline per-model table lists current
--      releases (Kimi K3, DeepSeek V4, GLM 5.3, Qwen 3.8 Max and similar); neither model registered
--      in this database appears on it.
--
-- [S2] https://fireworks.ai/models/fireworks/qwen2p5-72b-instruct — the model's own Fireworks page.
--      "Mixture-of-Experts: No | Parameters: 72.7B". Dense and above 16B, so [S1]'s $0.90/1M tier is
--      the published price, applied identically to input and output.
--
-- [S3] https://fireworks.ai/models/fireworks/kimi-k2-instruct — the model's own Fireworks page.
--      1.02T parameters, MoE, 131k context. It carries no price, it is absent from [S1]'s headline
--      table, and at 1.02T it sits above the top MoE size tier [S1] publishes. **No vendor-published
--      price for this model exists to copy.**
--
-- [S4] https://developers.cloudflare.com/workers-ai/platform/pricing/ — Workers AI. "10,000 Neurons
--      per day at no charge", then "$0.011 / 1,000 Neurons". Cloudflare publishes each model in BOTH
--      units and states "The Price in Tokens column is equivalent to the Price in Neurons column".
--      Recorded here for Stage 4, which will register Workers AI models: they are convertible to
--      this table's per-token unit honestly, from Cloudflare's own token column, and must be — not
--      by guessing a token price from a neuron figure. Not inserted now; Workers AI has no row in
--      `models` and adding one is a routing decision, not a price correction.
--
-- [S5] https://openrouter.ai/docs/faq — OpenRouter. "We pass through the pricing of the underlying
--      providers without any markup", and price is per-model, per-million-tokens, with different
--      prompt and completion rates. There is therefore no OpenRouter rate card to copy into this
--      table: a price would have to be recorded per routed model. It has no row in `models` either.
--      Its `execution_backends` ceiling is $0, so only free-tier models are eligible regardless.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE UNIT, once, because it is easy to get wrong by a factor of a thousand.
-- `in_micros_1k` is USD micros per 1,000 tokens. $1.00 per 1M tokens = 1,000 micros per 1k tokens.
-- So the stored 900 is $0.90/1M, and the stored 2500 is $2.50/1M.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROW BY ROW.
--
-- mdl_qwen_fast · Qwen 2.5 72B · stored 900 in / 900 out = $0.90 / $0.90 per 1M.
--   CONFIRMED CORRECT. [S2] gives 72.7B dense; [S1]'s "> 16B" tier is $0.90/1M applied uniformly to
--   input and output. The stored pair matches the published card exactly, including the equal
--   input/output figure that reads like a placeholder and is in fact how Fireworks prices this tier.
--   No change to the numbers. State becomes SOURCED and the row now cites [S1] + [S2].
--
-- mdl_kimi_k2 · Kimi K2 Instruct · stored 600 in / 2500 out = $0.60 / $2.50 per 1M.
--   LEFT ALONE, DELIBERATELY, WITH THE REASON RECORDED. Per [S3] Fireworks publishes no price for
--   this model, and per [S1] its 1.02T MoE size falls above every size tier on the card, so there is
--   nothing to derive it from either. Third-party cost aggregators report $0.60 / $2.50 for it on
--   Fireworks — the same pair already stored, which suggests the seed copied a real historical rate
--   rather than inventing one — but a third-party tracker is not the vendor and this ledger does not
--   get to launder one into the other. The numbers stay exactly as they are and the row now says
--   they are unconfirmed. ILLUSTRATIVE, checked and not confirmed on 6 Sep 2026.
--
--   A note for whoever picks this up: the honest resolutions are to run one real call and read the
--   invoice (Stage 8's second item, which needs the owner's key and her money), or to route this
--   lane at a model Fireworks does price today. Both are decisions above a price correction, so
--   neither is taken here.
--
-- WHAT THIS DOES NOT CLAIM. It does not claim the ledger is now proven. Stage 8's second item — one
-- real inference call reconciled against one real invoice line — is untouched and still open, and
-- `docs/boss/DECISIONS.md` BD-001 is updated to say exactly which of its two items closed and which
-- did not.
--
-- Plan: docs/boss/PLAN_v21.md Stage 8, item 1. Canon: Phase 6.

ALTER TABLE models ADD COLUMN pricing_state TEXT NOT NULL DEFAULT 'UNKNOWN'
  CHECK (pricing_state IN ('SOURCED','ILLUSTRATIVE','STALE','UNKNOWN'));

-- The citation itself. A URL and what it said, so the next person re-checks in one click instead of
-- repeating the search.
ALTER TABLE models ADD COLUMN price_source TEXT;

-- WHEN IT WAS LAST LOOKED AT — which is a different fact from whether it was confirmed. A row that
-- was checked and could not be confirmed must be distinguishable from one nobody has opened, or
-- "unconfirmed" decays into "unexamined" and the check gets done twice or never.
ALTER TABLE models ADD COLUMN price_checked_at INTEGER;

-- A LITERAL DATE, NOT unixepoch(). This records when a human-directed check read the vendor's page —
-- 2026-09-06T00:00:00Z — not when the migration happened to be applied to a given database. Using
-- `now` here would restamp the check as fresh on every environment that applies it later, which is
-- the precise dishonesty this column exists to prevent.

UPDATE models SET
  pricing_state    = 'SOURCED',
  price_checked_at = 1788652800000,
  price_source     = 'Fireworks serverless rate card, size-based tier, retrieved 2026-09-06: https://docs.fireworks.ai/serverless/pricing — models over 16B parameters that are not individually listed are $0.90 per 1M tokens, uniform across input and output. https://fireworks.ai/models/fireworks/qwen2p5-72b-instruct gives 72.7B, Mixture-of-Experts: No. Stored 900/900 micros per 1k tokens = $0.90/$0.90 per 1M, matching the card exactly. Unchanged because it was already right.'
WHERE id = 'mdl_qwen_fast';

UPDATE models SET
  pricing_state    = 'ILLUSTRATIVE',
  price_checked_at = 1788652800000,
  price_source     = 'NOT CONFIRMED. Checked 2026-09-06 and no vendor-published price was found. https://fireworks.ai/models/fireworks/kimi-k2-instruct carries no price; the model is absent from the headline table at https://docs.fireworks.ai/serverless/pricing; and at 1.02T MoE it is above that page''s top size tier (MoE 56.1B-176B), so no tier applies either. Third-party trackers report $0.60/$2.50 per 1M, matching the stored 600/2500 micros per 1k, but a tracker is not the vendor. The stored numbers are left exactly as seeded rather than replaced by a guess, and are hereby marked unconfirmed.'
WHERE id = 'mdl_kimi_k2';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0174_boss_model_price_provenance');
