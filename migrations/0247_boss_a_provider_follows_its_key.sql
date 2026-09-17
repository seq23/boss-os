-- ENABLING FOLLOWS THE KEY. IT NEVER PRECEDES IT.
--
-- Two rows in this database were telling the opposite lie about the same fact, in opposite
-- directions, and each one cost something different.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LIE ONE · FIREWORKS IS ENABLED AND THERE IS NO KEY.
--
-- `prv_fireworks` carries `enabled = 1` and owns BOTH models the ops route names — `mdl_kimi_k2`
-- is `rt_ops_default`'s primary and `mdl_qwen_fast` is its fallback. Production's secrets are
-- BOSS_PASSCODE, BOSS_SESSION_SECRET and OPENROUTER_API_KEY. There is no FIREWORKS_API_KEY and
-- there never has been.
--
-- So the ops route's first two candidates are both guaranteed to fail, every time, and the router
-- discovers it one candidate at a time at the moment of the call. That is not free: it is two
-- wasted screening passes, two `availability` rejections in every routing decision, and a primary
-- model that has never once run written into the route as though it were the normal answer. The
-- decision log for `tsk_m2bk7zfffhjatvsf` shows exactly this — "Fireworks is registered, not
-- enabled" sitting at the top of a four-candidate list.
--
-- DISABLED, NOT DELETED. The models keep their rows, their prices and their provenance; the wiring
-- in `router/backends.ts` stays. The day a key exists, enabling is one UPDATE and the route works
-- without anything being rebuilt. A provider removed is a decision to re-make later; a provider
-- disabled with its reason recorded is a decision already made.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LIE TWO · OPENROUTER_API_KEY IS SET AND OPENROUTER IS NOT IN `providers` AT ALL.
--
-- A paid credential this Worker holds, on an egress allowlist, that nothing in the system can
-- reach. `bk_openrouter` exists in `execution_backends`, the adapter exists in
-- `router/openrouter.ts`, the wiring exists in `router/backends.ts` with two models named in it —
-- and `providers` has no `prv_openrouter` row, so `loadModel` and `loadContinuityModels` both join
-- it away and the whole lane is invisible to the router.
--
-- THE CHOICE WAS: give it a lane, or say plainly the key should be removed. IT GETS A LANE, and
-- the reason is that it costs nothing to give it one.
--
--   · The two models registered here are `:free` variants, and `backends/guard.ts` proves a route
--     free from the SLUG rather than from a price column — "OpenRouter bills nothing for a model
--     whose slug ends in :free. Any other slug is metered." So this adds zero dollars of exposure
--     at any lever position, including OPEN, because nothing metered is registered.
--   · It is the only continuity tier this system has that is not Workers AI. Today, when the
--     Workers AI daily allowance runs out, there is nowhere left to go: Fireworks has no key,
--     Anthropic and OpenAI are disabled, and the local runtime is a deferred slot. A free tier with
--     no second free tier behind it is a single point of failure for every duty that runs.
--   · Removing the key instead would close the gap by making the system smaller, and would have to
--     be undone the first time the allowance ran out on a morning she needed the report.
--
-- WHAT IT MAY NOT DO. OpenRouter's account settings govern whether prompts may reach providers
-- that train on them, and there are SEPARATE SETTINGS FOR FREE AND PAID MODELS
-- (https://openrouter.ai/docs/features/privacy-and-logging, retrieved 17 September 2026). This
-- Worker cannot read that setting, so it cannot establish that a free route does not train.
-- Migration 0249 records that as `TRAINS_ON_PROMPTS` and the router refuses LP names and deal
-- terms to it — structurally, before a request is formed. The lane is for mechanical work.
--
-- AND IT IS STILL NOT ENABLED AS A BACKEND. `execution_backends.bk_openrouter` stays `registered`.
-- Registering models is what makes the lane REACHABLE; commissioning the backend is a separate,
-- deliberate act, and 0173's shape is that those are two decisions. This migration makes one of
-- them.
--
-- Plan: docs/boss/PLAN_v21.md Stage 4 (continuity: fallback and cost). Canon: Phase 6, §3.1.

-- ── Fireworks: the key does not exist, so neither does the provider ─────────────────────────────

UPDATE providers SET enabled = 0 WHERE id = 'prv_fireworks';

-- The registry row says the same thing in the words the owner reads on Systems -> Backends. It was
-- already `registered` rather than `enabled`; what was missing was the REASON, and a status with no
-- reason is the thing a person has to go and reconstruct.
UPDATE execution_backends
   SET status_reason =
       'No FIREWORKS_API_KEY is set on this Worker, and enabling follows the key rather than '
       || 'preceding it. Both models on this provider stay registered with their prices and their '
       || 'provenance; set the secret and enable the provider and the ops route works unchanged.'
 WHERE id = 'bk_fireworks';

-- ── OpenRouter: the credential gets something it can reach ──────────────────────────────────────
--
-- base_url and api_key_var match `CLOUD_BACKENDS` in `src/worker/boss/router/backends.ts` exactly.
-- That file is the authority on the wire — "THE HOST IS A CONSTANT HERE, NOT A COLUMN" — and a row
-- that disagreed with it would be a second opinion about where a request goes.

INSERT OR IGNORE INTO providers (id, name, base_url, api_key_var, enabled)
VALUES ('prv_openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 'OPENROUTER_API_KEY', 1);

-- Prices are 0 and that is a SOURCED fact about these slugs, not a placeholder: the `:free` suffix
-- is OpenRouter's own convention for an endpoint it bills nothing for, and it is the same fact the
-- guard checks. `max_risk` is low and `benchmark_status` is unbenchmarked, because nothing here has
-- been benchmarked and a risk clearance is a promotion that needs evidence and an approved card.

INSERT OR IGNORE INTO models
  (id, provider_id, slug, display_name, in_micros_1k, out_micros_1k, context_tokens, enabled,
   privacy_class, capability_tier, benchmark_status, max_risk,
   pricing_state, price_checked_at, price_source)
VALUES
  ('mdl_or_llama33_free', 'prv_openrouter', 'meta-llama/llama-3.3-70b-instruct:free',
   'Llama 3.3 70B (OpenRouter, free)', 0, 0, 65536, 1,
   'cloud', 'general', 'unbenchmarked', 'low',
   'SOURCED', 1789603200000,
   'https://openrouter.ai/docs/faq, retrieved 2026-09-17: OpenRouter passes through provider '
   || 'pricing with no markup, and a model whose slug carries the :free suffix is billed at zero. '
   || 'The zero here is a fact about the SLUG, which is observable, and not a figure copied from a '
   || 'price column. A route on any other slug on this provider is metered and is not registered.'),
  ('mdl_or_gemma3_free', 'prv_openrouter', 'google/gemma-3-27b-it:free',
   'Gemma 3 27B (OpenRouter, free)', 0, 0, 96000, 1,
   'cloud', 'fast', 'unbenchmarked', 'low',
   'SOURCED', 1789603200000,
   'https://openrouter.ai/docs/faq, retrieved 2026-09-17: the :free suffix is OpenRouter''s own '
   || 'convention for an endpoint billed at zero, which is the same fact backends/guard.ts checks '
   || 'to prove a route free. Observable from the slug, not copied from a price column.');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0247_boss_a_provider_follows_its_key');
