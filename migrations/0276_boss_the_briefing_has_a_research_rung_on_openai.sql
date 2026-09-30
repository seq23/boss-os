-- 0276 — The executive briefing's research rung: OpenAI's own web search, when both seats are spent.
--
-- WHAT WAS MISSING (30 Sep 2026). When her Claude plan is out of usage and her ChatGPT seat is too (or
-- cannot run), the briefing walks to the CLOUD rungs — and a cloud rung is a plain chat completion: no
-- files, no web. The report that came back was a short brief with no sources and no current figures.
-- `queue/consumer.ts` now tries OpenAI with its web-search tool FIRST on those mornings
-- (`routeCompletion({ webSearch: true })`, `router/openai.ts`), and falls back to the ordinary walk when
-- the research rung is refused.
--
-- THE MODEL ROW IT NEEDS. `mdl_openai_frontier` is tier `frontier`, which the NORMAL cost mode refuses — it is
-- reached directly by coaching, not through the ladder. A search-enabled briefing routed to it would be
-- refused every morning. This adds the same model (gpt-4.1, same price) as `general`, so it can be a paid
-- continuity candidate. It carries NO `ladder_rung`, so it is not on the printed briefing ladder.
--
-- IT IS INERT UNTIL SHE COMMISSIONS OPENAI. `loadContinuityModels` requires the provider enabled and the
-- backend must be `enabled` to run; `prv_openai` is disabled and `bk_openai` is `registered` (0211) until she
-- stores OPENAI_API_KEY and enables the backend. This migration enables neither, and the lever still decides
-- whether any metered rung may run at all: at FREE_ONLY the research rung is refused before any call.
--
-- THE PRIVACY LABEL, AND WHO ASSERTED IT. The briefing's own wording ("commitment", "valuation",
-- "allocation", a rate) reads as deal material to the router's scan, which makes it private-model-only, and
-- a private-model-only run may go only to a route recorded `NO_TRAINING_CONTRACTUAL`. Without that label this
-- rung would be refused on every briefing and would exist for nothing. OpenAI's published API data policy is
-- that data sent through the API is not used to train its models unless the customer opts in. THE BUILD
-- AGENT COULD NOT RETRIEVE THAT PAGE (its network blocks openai.com and platform.openai.com), so this is
-- recorded as the OWNER'S instruction, not as a retrieved finding, and `data_use_checked_at` is NULL to say
-- no page was read. To withdraw it: UPDATE models SET data_use = 'UNKNOWN' WHERE id = 'mdl_openai_research';
--
-- PRICE: gpt-4.1 at $2.00 in / $8.00 out per million tokens is carried from `backends.ts` and is
-- ILLUSTRATIVE, not retrieved. Web search is billed per call on top ($10 per 1,000 calls), which the router
-- adds to the recorded cost (`WEB_SEARCH_CALL_MICROS`).

INSERT OR IGNORE INTO models
  (id, provider_id, slug, display_name, in_micros_1k, out_micros_1k, context_tokens, enabled,
   privacy_class, capability_tier, benchmark_status, max_risk, pricing_state, price_source)
VALUES
  ('mdl_openai_research', 'prv_openai', 'gpt-4.1', 'GPT-4.1 with web search (OpenAI)', 2000, 8000, 1000000, 1,
   'cloud', 'general', 'unbenchmarked', 'low', 'ILLUSTRATIVE',
   'gpt-4.1 at $2.00 input / $8.00 output per million tokens, carried from router/backends.ts where it was '
   || 'entered for the coaching row. NOT retrieved from the vendor by the build agent (openai.com was blocked '
   || 'from its network), so it is ILLUSTRATIVE, not SOURCED. Web search is billed per call on top, $10 per '
   || '1,000 calls, and router/openai.ts adds that to the recorded cost.');

UPDATE models SET
  data_use            = 'NO_TRAINING_CONTRACTUAL',
  data_use_checked_at = NULL,
  data_use_source     =
    'OWNER INSTRUCTION, 2026-09-30: treat OpenAI''s API as non-training, per OpenAI''s published API data '
    || 'policy (data sent through the API is not used to train its models unless the customer opts in). '
    || 'NOT RETRIEVED by the build agent — openai.com and platform.openai.com were blocked from its '
    || 'network — so no page was read and no date is claimed. Verify at '
    || 'https://platform.openai.com/docs/guides/your-data and withdraw with '
    || 'UPDATE models SET data_use = ''UNKNOWN'' WHERE id = ''mdl_openai_research''.'
WHERE id = 'mdl_openai_research';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0276_boss_the_briefing_has_a_research_rung_on_openai');
