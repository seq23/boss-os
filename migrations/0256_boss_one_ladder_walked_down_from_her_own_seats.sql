-- ONE LADDER. WALK DOWN IT. PAY ONLY WHEN EVERYTHING FREE IS EXHAUSTED.
--
-- Her words, 17 September 2026: "we can move down the line from claude to anyone that is $0 that is
-- next best and last resort paid."
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- WHAT WAS ACTUALLY WRONG, AND IT WAS NOT THE MODEL LIST
--
-- The morning report runs frontier-quality on her Max seat at $0 through `bk_claude_code`. That is
-- the cheaper, better design and nothing here changes it. The gap is WHEN THE MAC IS ASLEEP, and
-- three separate faults made that gap worse than it looked:
--
--   1. `bk_openrouter` is `registered`, not `enabled`. `evaluateBackend`'s FIRST rule refuses any
--      backend that is not enabled, so BOTH free OpenRouter models registered in 0247 have never
--      been reachable by anything. Registered, priced, documented, and unreachable — "exists but
--      nothing invokes it", in the registry this repository keeps to catch exactly that.
--   2. The fall-through was Llama 3.3 70B on Workers AI, and a previous agent established that
--      neither it nor Gemma 3 27B is a reasoning model. There was no reasoning lane at any price.
--   3. `NORMAL.maxFallbackHops` is 1 and `MAX_FREE_HOPS` is 2. A ladder of thirteen rungs under a
--      limit of one paid hop is decoration. Both are raised in `governance.ts` and
--      `router/index.ts`; see the note on ordering below for why that is safe.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- EVERY RUNG COMPLETED A REAL GENERATION BEFORE IT WAS WRITTEN DOWN. 17 September 2026.
--
-- A lane that passes a read-only probe and then fails every real call is the failure the sibling
-- repository had the same night, and two of five keys in the vault were dead the same morning. So
-- the standard here is a completion: HTTP 200 with actual text back, through the same
-- `/chat/completions` shape the adapter uses. Anything that would not complete is registered
-- DISABLED with the refusal recorded verbatim — visible on Systems -> Models, not routable.
--
--   rung  slug                                      verdict   evidence
--   ----  ----------------------------------------  --------  ----------------------------------
--    100  nvidia/nemotron-3-ultra-550b-a55b:free     ACTIVE    200, "lane is alive", 91 reasoning tokens, cost 0
--    110  deepseek/deepseek-v4-flash-0731:free       ACTIVE    200, "lane is alive", 36 reasoning tokens, cost 0
--    120  z-ai/glm-5.2:free                          ACTIVE    200 on retry after one 429, "lane is alive"
--    130  nvidia/nemotron-3-super-120b-a12b:free     ACTIVE    200, "lane is alive", 89 reasoning tokens, cost 0
--     --  thinkingmachines/inkling:free              DISABLED  403 "is only available on agentic harnesses"
--     --  qwen/qwen3.8-27b:free                      DISABLED  429 "Provider returned error", four attempts
--    200  google/gemini-2.5-flash-lite               ACTIVE    200, "Lane is alive", cost $0.0000022
--    210  openai/gpt-5-mini                          ACTIVE    200, "lane is alive", 64 reasoning tokens
--    220  google/gemini-2.5-flash                    ACTIVE    200, "Lane is alive", cost $0.0000105
--    230  nvidia/nemotron-3-ultra-550b-a55b          ACTIVE    200, "lane is alive", 135 reasoning tokens
--    240  anthropic/claude-haiku-4.5                 ACTIVE    200, "lane is alive", cost $0.000047
--    250  anthropic/claude-sonnet-5                  ACTIVE    200, "lane is alive", cost $0.000114
--     --  anthropic/claude-sonnet-5:batch            DISABLED  404 "only available through the Batch API"
--
-- THE TWO DISABLED FREE ROWS ARE KEPT RATHER THAN OMITTED, for the reason 0247 keeps Fireworks: a
-- provider removed is a decision to re-make later; a row disabled with its refusal quoted is a
-- decision already made, and re-enabling is one UPDATE if the upstream capacity returns.
--
-- `anthropic/claude-sonnet-5:batch` is disabled for a STRUCTURAL reason rather than a transient
-- one — it is not served by `/chat/completions` at all — and it is also redundant: it prices
-- identically to `anthropic/claude-haiku-4.5` at rung 240, which does serve.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- PRICES. ALL READ LIVE FROM https://openrouter.ai/api/v1/models ON 17 SEPTEMBER 2026,
-- AND SIX OF THEM CHECKED AGAINST AN ACTUAL CHARGE.
--
-- `mdl_kimi_k2`'s note is this repository's standard — "a tracker is not the vendor" — so a feed
-- reading alone would be a price that was READ rather than a price that was CONFIRMED. The
-- probe recorded `usage.cost` on every paid completion, and for Sonnet 5 the response itemised
-- `upstream_inference_prompt_cost 0.000044` for 22 prompt tokens and `0.000070` for 7 completion
-- tokens — $2.00 and $10.00 per million exactly. That is a price checked against what was billed.
--
-- `in_micros_1k` is microdollars per 1,000 tokens, which is the per-million figure times 1000.
--
-- THE FREE ROWS ARE PRICED 0 AND THAT IS A FACT ABOUT THE SLUG, not a placeholder — 0247's
-- argument, unchanged, and `backends/guard.ts` proves a route free from the `:free` suffix rather
-- than from a price column. The probe corroborated it: every free completion returned `cost: 0`.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- THE CONFIDENTIAL LINE, AND THE THING THAT MAKES IT ENFORCEABLE RATHER THAN HOPED FOR
--
-- 0249 recorded every OpenRouter route as TRAINS_ON_PROMPTS, because whether a route trains is an
-- account setting on a web page that this Worker cannot read. That finding was correct and it is
-- now SUPERSEDED FOR THE PAID ROUTES ONLY, by a mechanism that is strictly better than a checkbox:
--
--   OpenRouter accepts `provider: { data_collection: "deny" }` ON THE REQUEST, and refuses to route
--   to any endpoint that collects. It is enforced by the vendor, per call, and it fails CLOSED —
--   a request it cannot satisfy returns 404 rather than quietly going somewhere that trains.
--
-- PROVEN BOTH WAYS on 17 September 2026, which is why this is a finding and not a reading:
--
--   POSITIVE  all six paid rungs served under the flag. The response names the upstream that took
--             it — Google, OpenAI, Venice, Amazon Bedrock, "Claude Platform on AWS" — so the
--             filter is visibly doing work rather than being ignored.
--   NEGATIVE  `nvidia/nemotron-3-ultra-550b-a55b:free` and `nvidia/nemotron-3-super-120b-a12b:free`
--             were REFUSED under the identical flag, verbatim: "No endpoints found matching your
--             data policy (Free model training)." The guard demonstrably removes lanes.
--
-- SO THE PAID RUNGS CARRY `NO_TRAINING_CONTRACTUAL` AND THE FREE RUNGS DO NOT, and the split is
-- carried by evidence rather than by vendor reputation. This takes the number of lanes that may
-- hold an LP name from ONE — Workers AI, 0249 — to NINE: two subscription seats and the six paid
-- rungs, plus Workers AI. That is the largest single thing in this migration.
--
-- AND THE CLAIM IS SELF-ENFORCING. `router/openrouter.ts` sends the flag on EVERY request to a
-- model this table marks non-training, not merely on requests the caller labelled private. A row
-- that claims to be private-capable therefore cannot be called without the vendor being asked to
-- honour that claim, and if the vendor cannot, the call fails instead of leaking. A test pins it.
--
-- ONE RESULT WORTH RECORDING BECAUSE IT CUTS AGAINST THE RULE. `deepseek/deepseek-v4-flash-0731:free`
-- ALSO served under `data_collection: "deny"`, so that particular free endpoint appears not to
-- collect. It is still registered TRAINS_ON_PROMPTS. "Free is training-permitting unless
-- established otherwise" is the rule that keeps this safe as endpoints change underneath us, and a
-- single observation that one endpoint currently behaves better is not an establishment — it is the
-- kind of fact that flips silently. Fail closed.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- THE $5 SUB-CAP, AND A COMMENT IN 0173 THAT SAYS THE OPPOSITE OF WHAT THE CODE DOES
--
-- 0173's OpenRouter row says "A zero ceiling means only free-tier models are eligible". THE CODE
-- DOES NOT DO THAT. `effectiveAllowance` reads `monthly_ceiling_micros > 0 ? ... : null` and a null
-- is simply left out of the `min()`, so a ceiling of zero means NO SUB-CAP AT ALL. `guard.ts` says
-- so correctly in its own words — "A CEILING OF 0 IS 'NO SUB-CAP STATED', NOT '$0 FOR THIS
-- BACKEND'" — and the two comments have been contradicting each other since 0173.
--
-- It has never mattered, because the lever sits at FREE_ONLY and nothing paid runs at any ceiling.
-- It would have mattered the first time she moved the lever: OpenRouter would have been free to
-- spend the entire ops lane with no figure of its own. So enabling it at 0 would have been the
-- unsafe act, and this sets an explicit $5.00/month — the same figure she already authorised on
-- `bk_anthropic` and `bk_openai`, for the same thing: a paid last resort.
--
-- SETTING A CAP AUTHORISES NOTHING. At FREE_ONLY the lever's own allowance is $0 and every metered
-- rung is refused `lever_free_only` before the ceiling is consulted. What the cap changes is the
-- day she pulls the lever, and it changes it in the conservative direction.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- THE SECOND SUBSCRIPTION SEAT
--
-- `bk_codex` is Codex CLI on her ChatGPT Plus seat, and it is the same shape as `bk_claude_code`:
-- `agent_executed`, claimed by the sync agent, no credential in the Worker. Verified on the machine
-- rather than assumed — `/opt/homebrew/bin/codex`, `@openai/codex` 0.135.0, `~/.codex/auth.json`
-- carrying `auth_mode = "chatgpt"` and a NULL `OPENAI_API_KEY`, plan claim `plus`, and a real
-- generation returning "lane is alive" for $0 marginal against the subscription.
--
-- WHY A SECOND SEAT MATTERS MORE THAN A SECOND MODEL. Addendum §1: no critical capability may
-- depend permanently on one external provider. Rung 0 was ONE seat; if her Claude plan is
-- exhausted or the Mac is busy, everything fell to the cloud. Two seats at $0 is the first real
-- continuity this tier has had.
--
-- REGISTERED, NOT ENABLED, and that is 0173's rule rather than a hedge: `bk_claude_code` sat at
-- `registered` until Stage 2 shipped the runner that executes it. The runner for this one ships in
-- the same branch (`scripts/sync-agent/backends/codex.mjs`), so it is enabled here — enabling
-- follows the executor existing, exactly as it follows a key existing.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- HOW THE ORDER IS DECIDED, AND WHY A COLUMN RATHER THAN A SORT
--
-- Stage 5 orders the continuity tier cheapest-first. Every free route costs 0, so they all TIE, and
-- the tie used to fall through to `display_name.localeCompare` — the exact defect
-- `candidateOrder.mjs` exists to record, which once sent a $1B block trade to an 8B model because
-- "Llama 3.1" sorts before "Llama 3.3". Four new free rungs would have been ordered by spelling.
--
-- `ladder_rung` is the seeded order, read by the comparator BETWEEN cost and capability. It is not
-- a second opinion about cost: the paid rungs' rung order and their price order are identical by
-- construction, and `validate:ladder` fails if they ever disagree.
--
-- IT IS A SEED, NOT A VERDICT. `experienceRank` is folded into the same sort key at a weight larger
-- than any price, so a lane whose work gets REWORKED or REJECTED sinks below one that has never
-- been tried, and a proven lane rises. The rung decides only what happens before there is evidence.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- TIERS, AND WHY NOTHING ON THE LADDER IS `frontier`
--
-- `capability_tier` in this schema is a COST-MODE GATE, not a description of how good a model is.
-- `COST_MODE_POLICY.NORMAL.allowedTiers` is `["fast","general"]`, and NORMAL is the live mode — so
-- a rung registered `frontier` is refused at Stage 2 on every ordinary run and the ladder simply
-- stops above it. A last resort that cannot be reached is not a last resort, it is the "runs but
-- inert" defect with a reassuring name on it.
--
-- So every rung is `general`, INCLUDING Sonnet 5, and the honest reading of that is: it is eligible
-- in the balanced cost mode, which is what the owner asked for. It is still the DEAREST rung and
-- cost ordering still puts it last, so "general" costs nothing here — the ladder, not the tier, is
-- what keeps it from being chosen.
--
-- `mdl_anthropic_frontier` and `mdl_openai_frontier` keep `frontier` and are untouched. They are
-- reached directly by the coaching route in `backends.ts`, not by walking this ladder, so the word
-- still means what it meant.
--
-- `validate:ladder` fails if any enabled rung is unreachable in the live cost mode.
--
-- Plan: docs/boss/PLAN_v21.md Stage 4 (continuity: fallback and cost). Canon: Phase 6 §3.1,
-- Sovereignty Addendum §1 and §3.1.

-- ── Is this route a reasoning model? ─────────────────────────────────────────────────────────
--
-- DEFAULT 0, so a model added later is not a reasoning model until somebody says it is. Same shape
-- as 0249's `data_use` default: an unrecorded property is a negative, never a blank to be filled in
-- optimistically at the call site.
--
-- It is metadata rather than a routing rule — the ladder decides order — and `validate:ladder`
-- asserts every rung carries it, which is what stops a non-reasoning model being slotted into a
-- reasoning ladder later without anyone noticing.
ALTER TABLE models ADD COLUMN reasoning INTEGER NOT NULL DEFAULT 0;

-- ── Where this model sits on the one ladder ──────────────────────────────────────────────────
--
-- NULL means "not on the ladder", and the comparator sorts NULL last. That is deliberate: a model
-- nobody placed does not get to jump the queue on a default of zero.
--
-- Gaps of ten between rungs so a lane can be inserted later without renumbering the ladder, which
-- is the kind of churn that turns a diff nobody can read into a migration nobody checks.
ALTER TABLE models ADD COLUMN ladder_rung INTEGER;

-- ── The four free reasoning rungs that completed a real generation ───────────────────────────

INSERT OR IGNORE INTO models
  (id, provider_id, slug, display_name, in_micros_1k, out_micros_1k, context_tokens, enabled,
   privacy_class, capability_tier, benchmark_status, max_risk, reasoning, ladder_rung,
   pricing_state, price_checked_at, price_source)
VALUES
  ('mdl_or_nemotron_ultra_free', 'prv_openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free',
   'Nemotron 3 Ultra 550B (OpenRouter, free)', 0, 0, 1000000, 1,
   'cloud', 'general', 'unbenchmarked', 'low', 1, 100,
   'SOURCED', 1789603200000,
   'https://openrouter.ai/api/v1/models read 2026-09-17: prompt 0, completion 0, context 1000000, '
   || 'supported_parameters includes "reasoning". The :free suffix is OpenRouter''s own convention '
   || 'for an endpoint billed at zero, which is the fact backends/guard.ts checks. Corroborated by '
   || 'a real completion the same day: HTTP 200, "lane is alive", usage.cost 0, 91 reasoning tokens.'),

  ('mdl_or_deepseek_v4_free', 'prv_openrouter', 'deepseek/deepseek-v4-flash-0731:free',
   'DeepSeek V4 Flash (OpenRouter, free)', 0, 0, 1048576, 1,
   'cloud', 'general', 'unbenchmarked', 'low', 1, 110,
   'SOURCED', 1789603200000,
   'https://openrouter.ai/api/v1/models read 2026-09-17: prompt 0, completion 0, context 1048576, '
   || 'reasoning supported. Real completion the same day: HTTP 200, "lane is alive", usage.cost 0, '
   || '36 reasoning tokens.'),

  ('mdl_or_glm52_free', 'prv_openrouter', 'z-ai/glm-5.2:free',
   'GLM 5.2 (OpenRouter, free)', 0, 0, 32768, 1,
   'cloud', 'general', 'unbenchmarked', 'low', 1, 120,
   'SOURCED', 1789603200000,
   'https://openrouter.ai/api/v1/models read 2026-09-17: prompt 0, completion 0, context 32768, '
   || 'reasoning supported. Real completion the same day after one transient 429: HTTP 200, '
   || '"lane is alive". The shortest context on the ladder, which is why it sits below the two 1M rungs.'),

  ('mdl_or_nemotron_super_free', 'prv_openrouter', 'nvidia/nemotron-3-super-120b-a12b:free',
   'Nemotron 3 Super 120B (OpenRouter, free)', 0, 0, 262144, 1,
   'cloud', 'general', 'unbenchmarked', 'low', 1, 130,
   'SOURCED', 1789603200000,
   'https://openrouter.ai/api/v1/models read 2026-09-17: prompt 0, completion 0, context 262144, '
   || 'reasoning supported. Real completion the same day: HTTP 200, "lane is alive", usage.cost 0, '
   || '89 reasoning tokens.');

-- ── The two free lanes that would NOT serve. Registered, disabled, refusal quoted ────────────

INSERT OR IGNORE INTO models
  (id, provider_id, slug, display_name, in_micros_1k, out_micros_1k, context_tokens, enabled,
   privacy_class, capability_tier, benchmark_status, max_risk, reasoning, ladder_rung,
   pricing_state, price_checked_at, price_source)
VALUES
  ('mdl_or_inkling_free', 'prv_openrouter', 'thinkingmachines/inkling:free',
   'Inkling (OpenRouter, free)', 0, 0, 1048576, 0,
   'cloud', 'general', 'unbenchmarked', 'low', 1, NULL,
   'SOURCED', 1789603200000,
   'Free in the feed read 2026-09-17, and NOT ROUTABLE FROM THIS WORKER. A real call returned '
   || 'HTTP 403, verbatim: "thinkingmachines/inkling:free is only available on agentic harnesses. '
   || 'Try plugging it into a coding agent or productivity app listed on ...". A Cloudflare Worker '
   || 'is not an agentic harness, so this is a structural refusal rather than a transient one and '
   || 'no retry changes it. Disabled rather than deleted: if the vendor opens the endpoint, '
   || 'enabling is one UPDATE.'),

  ('mdl_or_qwen38_free', 'prv_openrouter', 'qwen/qwen3.8-27b:free',
   'Qwen 3.8 27B (OpenRouter, free)', 0, 0, 262144, 0,
   'cloud', 'general', 'unbenchmarked', 'low', 1, NULL,
   'SOURCED', 1789603200000,
   'Free in the feed read 2026-09-17, and it would not complete: HTTP 429 "Provider returned '
   || 'error" on four attempts with backoff, while z-ai/glm-5.2:free recovered from the identical '
   || 'error on its first retry. Upstream capacity, not a credential. Disabled because a lane that '
   || 'has never completed a generation may not be routable — that is the failure this whole '
   || 'migration was written to avoid. Re-probe and enable if the capacity returns.');

-- ── The six paid rungs. Cheapest first, every one private-capable ────────────────────────────

INSERT OR IGNORE INTO models
  (id, provider_id, slug, display_name, in_micros_1k, out_micros_1k, context_tokens, enabled,
   privacy_class, capability_tier, benchmark_status, max_risk, reasoning, ladder_rung,
   pricing_state, price_checked_at, price_source)
VALUES
  ('mdl_or_gemini_flash_lite', 'prv_openrouter', 'google/gemini-2.5-flash-lite',
   'Gemini 2.5 Flash Lite (OpenRouter)', 100, 400, 1048576, 1,
   'cloud', 'general', 'unbenchmarked', 'low', 1, 200,
   'SOURCED', 1789603200000,
   'https://openrouter.ai/api/v1/models read 2026-09-17: $0.10 in / $0.40 out per million tokens. '
   || 'Confirmed against a real charge the same day: HTTP 200, "Lane is alive", usage.cost '
   || '$0.0000022. The cheapest metered rung on the ladder.'),

  ('mdl_or_gpt5_mini', 'prv_openrouter', 'openai/gpt-5-mini',
   'GPT-5 mini (OpenRouter)', 250, 2000, 400000, 1,
   'cloud', 'general', 'unbenchmarked', 'low', 1, 210,
   'SOURCED', 1789603200000,
   'https://openrouter.ai/api/v1/models read 2026-09-17: $0.25 in / $2.00 out per million tokens. '
   || 'Confirmed against a real charge the same day: HTTP 200, "lane is alive", 64 reasoning '
   || 'tokens, usage.cost $0.000212.'),

  ('mdl_or_gemini_flash', 'prv_openrouter', 'google/gemini-2.5-flash',
   'Gemini 2.5 Flash (OpenRouter)', 300, 2500, 1048576, 1,
   'cloud', 'general', 'unbenchmarked', 'low', 1, 220,
   'SOURCED', 1789603200000,
   'https://openrouter.ai/api/v1/models read 2026-09-17: $0.30 in / $2.50 out per million tokens. '
   || 'Confirmed against a real charge the same day: HTTP 200, "Lane is alive", usage.cost '
   || '$0.0000105.'),

  ('mdl_or_nemotron_ultra', 'prv_openrouter', 'nvidia/nemotron-3-ultra-550b-a55b',
   'Nemotron 3 Ultra 550B (OpenRouter, metered)', 625, 3125, 262144, 1,
   'cloud', 'general', 'unbenchmarked', 'low', 1, 230,
   'SOURCED', 1789603200000,
   'https://openrouter.ai/api/v1/models read 2026-09-17: $0.625 in / $3.125 out per million '
   || 'tokens. Confirmed against a real charge the same day: HTTP 200, "lane is alive", 135 '
   || 'reasoning tokens, usage.cost $0.0003975, served by Venice under data_collection=deny. '
   || 'THE SAME MODEL AS RUNG 100 BY A PAID ROAD, which is the shape a fallback should have: when '
   || 'the free endpoint is exhausted the work does not silently get a weaker brain, it gets the '
   || 'same brain and a bill.'),

  ('mdl_or_haiku45', 'prv_openrouter', 'anthropic/claude-haiku-4.5',
   'Claude Haiku 4.5 (OpenRouter)', 1000, 5000, 200000, 1,
   'cloud', 'general', 'unbenchmarked', 'low', 1, 240,
   'SOURCED', 1789603200000,
   'https://openrouter.ai/api/v1/models read 2026-09-17: $1.00 in / $5.00 out per million tokens. '
   || 'Confirmed against a real charge the same day: HTTP 200, "lane is alive", usage.cost '
   || '$0.000047, served by Amazon Bedrock under data_collection=deny.'),

  ('mdl_or_sonnet5', 'prv_openrouter', 'anthropic/claude-sonnet-5',
   'Claude Sonnet 5 (OpenRouter)', 2000, 10000, 1000000, 1,
   'cloud', 'general', 'unbenchmarked', 'low', 1, 250,
   'SOURCED', 1789603200000,
   'https://openrouter.ai/api/v1/models read 2026-09-17: $2.00 in / $10.00 out per million tokens. '
   || 'CONFIRMED AGAINST AN ACTUAL CHARGE rather than a tracker, which is the mdl_kimi_k2 standard: '
   || 'a real completion the same day itemised upstream_inference_prompt_cost $0.000044 for 22 '
   || 'prompt tokens and $0.000070 for 7 completion tokens — $2.00 and $10.00 per million exactly. '
   || 'Served by "Claude Platform on AWS" under data_collection=deny. The last rung on the ladder.');

-- The batch endpoint, registered and disabled for a structural reason.
INSERT OR IGNORE INTO models
  (id, provider_id, slug, display_name, in_micros_1k, out_micros_1k, context_tokens, enabled,
   privacy_class, capability_tier, benchmark_status, max_risk, reasoning, ladder_rung,
   pricing_state, price_checked_at, price_source)
VALUES
  ('mdl_or_sonnet5_batch', 'prv_openrouter', 'anthropic/claude-sonnet-5:batch',
   'Claude Sonnet 5, batch (OpenRouter)', 1000, 5000, 1000000, 0,
   'cloud', 'general', 'unbenchmarked', 'low', 1, NULL,
   'SOURCED', 1789603200000,
   '$1.00 in / $5.00 out per million in the feed read 2026-09-17 — half of Sonnet 5 — and NOT '
   || 'REACHABLE BY THIS ADAPTER. A real call returned HTTP 404, verbatim: "This model is only '
   || 'available through the Batch API. Use the /api/beta/batches endpoint instead." That is a '
   || 'different protocol, not a different model, and router/openrouter.ts speaks '
   || '/chat/completions. It is also redundant at this price: anthropic/claude-haiku-4.5 at rung '
   || '240 costs the same and does serve. Disabled, with the reason, rather than left looking '
   || 'available.');

-- ── The incumbent free routes take their place on the same ladder ────────────────────────────
--
-- ONE LADDER MEANS ONE LADDER. Leaving the Workers AI rows unranked would have sorted them NULL-last
-- behind every new lane, which is wrong twice over: they are free, and Workers AI is the one route
-- 0249 established as contractually non-training, so it is the only free lane an LP name may reach.
--
-- They sit BELOW the four free reasoning rungs and ABOVE everything metered. None of them is a
-- reasoning model, which is the gap this migration exists to close — but they cost nothing and they
-- work, so they are tried before any money is spent.
UPDATE models SET ladder_rung = 140, reasoning = 0 WHERE id = 'mdl_cf_llama33_70b';
UPDATE models SET ladder_rung = 150, reasoning = 0 WHERE id = 'mdl_or_llama33_free';
UPDATE models SET ladder_rung = 160, reasoning = 0 WHERE id = 'mdl_or_gemma3_free';
UPDATE models SET ladder_rung = 170, reasoning = 0 WHERE id = 'mdl_cf_llama31_8b';

-- ── Data use, per rung, from the evidence above ──────────────────────────────────────────────
--
-- 0249 set every `prv_openrouter` row to TRAINS_ON_PROMPTS. That stays true for the free rungs and
-- is superseded for the paid ones. The UPDATE is written against the explicit id list rather than
-- against `provider_id`, so a free row added later cannot be swept into the private lane by a
-- migration that was not thinking about it.

UPDATE models SET
  data_use            = 'TRAINS_ON_PROMPTS',
  data_use_checked_at = 1789603200000,
  data_use_source     =
    'https://openrouter.ai/docs/features/privacy-and-logging: whether a free route trains is an '
    || 'account setting this Worker cannot read, and separate settings exist for free and paid '
    || 'models. DEMONSTRATED 2026-09-17: calling nvidia/nemotron-3-ultra-550b-a55b:free and '
    || 'nvidia/nemotron-3-super-120b-a12b:free with provider.data_collection="deny" returned HTTP '
    || '404, verbatim "No endpoints found matching your data policy (Free model training)" — the '
    || 'vendor itself classifies these endpoints as training on prompts. Not established otherwise, '
    || 'and not-established fails closed. LP names and deal terms do not come here.'
WHERE id IN ('mdl_or_nemotron_ultra_free', 'mdl_or_deepseek_v4_free', 'mdl_or_glm52_free',
             'mdl_or_nemotron_super_free', 'mdl_or_inkling_free', 'mdl_or_qwen38_free');

UPDATE models SET
  data_use            = 'NO_TRAINING_CONTRACTUAL',
  data_use_checked_at = 1789603200000,
  data_use_source     =
    'ESTABLISHED BY ENFORCEMENT RATHER THAN BY A VENDOR''S REPUTATION, 2026-09-17. OpenRouter '
    || 'accepts provider.data_collection="deny" on the request and refuses to route to any endpoint '
    || 'that collects; router/openrouter.ts sends that flag on every call to a model this table '
    || 'marks non-training, so the claim on this row cannot be relied upon without the vendor being '
    || 'asked to honour it, and a request it cannot satisfy returns 404 rather than going somewhere '
    || 'that trains. PROVEN POSITIVELY: all six paid rungs completed a real generation under the '
    || 'flag, the response naming the upstream that served it (Google, OpenAI, Venice, Amazon '
    || 'Bedrock, Claude Platform on AWS). PROVEN NEGATIVELY: two free rungs were refused 404 under '
    || 'the identical flag, so the filter demonstrably removes lanes rather than being ignored. '
    || 'This is a stronger guarantee than the account checkbox 0249 could not read, because it is '
    || 'per-request and fails closed. If OpenRouter ever stops honouring the parameter, these lanes '
    || 'stop serving instead of quietly leaking.'
WHERE id IN ('mdl_or_gemini_flash_lite', 'mdl_or_gpt5_mini', 'mdl_or_gemini_flash',
             'mdl_or_nemotron_ultra', 'mdl_or_haiku45', 'mdl_or_sonnet5', 'mdl_or_sonnet5_batch');

-- ── OpenRouter gets switched on, with a figure of its own ────────────────────────────────────

UPDATE execution_backends
   SET status                 = 'enabled',
       monthly_ceiling_micros = 5000000,
       capabilities           = '["completion","reasoning","summarise","classify"]',
       status_reason          =
         'Enabled 17 September 2026 with an explicit $5.00 monthly sub-cap. It had sat at '
         || '"registered" since 0173, which meant evaluateBackend refused it at its first rule and '
         || 'the two free models registered in 0247 were never reachable by anything. '
         || 'THE CAP IS NOT AN AUTHORISATION TO SPEND: the spend lever is at FREE_ONLY, so every '
         || 'metered rung is refused before a ceiling is consulted, and only the :free slugs run. '
         || 'It is set because 0173''s comment claimed a $0 ceiling means "free-tier models only" '
         || 'and the code does the opposite — effectiveAllowance treats 0 as NO SUB-CAP STATED, so '
         || 'enabling at 0 would have let OpenRouter spend the whole ops lane the day she moves the '
         || 'lever. $5.00 matches the ceilings already set on bk_anthropic and bk_openai.'
 WHERE id = 'bk_openrouter';

-- ── The second subscription seat ─────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO execution_backends
  (id, display_name, class, capabilities, allowed_kinds, forbidden_actions,
   credential_ref, security_notes, monthly_ceiling_micros, status, status_reason) VALUES
  ('bk_codex', 'Codex CLI', 'agent_executed',
   '["agentic_coding","repo_edit","test_run","review","completion","reasoning"]',
   '["repo_work","research","document","summarise","classify"]',
   -- IDENTICAL TO bk_claude_code'S LIST, deliberately. 0173: "no backend can be the one that
   -- quietly got more authority than the others." A second seat that could commit would be exactly
   -- that, and the runner enforces this list rather than requesting it of the CLI.
   '["commit","merge","push","deploy","secret_read"]',
   'local:codex-chatgpt-session',
   'Runs on the owner''s Mac via the Batch 5 agent, the same shape as bk_claude_code. NO KEY EXISTS IN THE WORKER AND NONE IS REQUESTED: verified on the machine 2026-09-17, ~/.codex/auth.json carries auth_mode "chatgpt" with a NULL OPENAI_API_KEY, so it authenticates against her ChatGPT Plus session and the cloud half holds no credential that could be spent. Invoked read-only and non-interactively (--sandbox read-only, stdin closed); the runner strips every credential-shaped variable from the child environment and scans each command before it runs, exactly as the Claude Code adapter does.',
   0, 'enabled',
   'Enabled 17 September 2026. Codex CLI 0.135.0 at /opt/homebrew/bin/codex on her ChatGPT Plus seat, plan claim "plus", valid to 2027-01-03. A real generation was completed before this row was written: exit 0, "lane is alive", 14,895 tokens, $0 marginal against the subscription. Enabling follows the executor existing, the way it follows a key existing — scripts/sync-agent/backends/codex.mjs ships in the same change, so unlike bk_claude_code at 0173 this row is not waiting on a runner. SPEND KIND IS PLAN EQUIVALENT, NOT MONEY: like bk_claude_code, the figures here are subscription usage and no card is charged.');

-- `free` rather than `capped`, and the two words are not interchangeable here. `freeTier()` returns
-- `no_vendor_call` for every `agent_executed` backend, so this route passes the spend gates because
-- THIS SYSTEM IS BILLED NOTHING FOR IT — not because a ceiling was generous. `cost_basis` carries
-- the other half, which is 0239's lesson: the figures on this row are subscription usage and no card
-- is charged, and a screen that showed a dollar sign without saying so had her reading a fake
-- invoice for a week.
--
-- bk_claude_code is `capped` with `ceiling_source = 'plan'` because she asked to keep a reserve of
-- her own Max plan back from the employees. No equivalent reserve machinery exists for the Plus
-- seat, and inventing one she has not asked for would be a budget nobody set.
UPDATE execution_backends
   SET spend_kind = 'free', cost_basis = 'plan_equivalent', ceiling_source = 'stored'
 WHERE id = 'bk_codex';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0256_boss_one_ladder_walked_down_from_her_own_seats');
