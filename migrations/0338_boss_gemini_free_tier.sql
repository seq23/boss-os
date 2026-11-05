-- GOOGLE GEMINI, DIRECT, FREE TIER (owner, 4 Nov 2026).
--
-- A backend, a provider and the two models Google serves on its free tier, reached at ONE host
-- (GEMINI_HOST in src/worker/boss/router/backends.ts) with the Worker secret GEMINI_API_KEY. No
-- migration sets the key. The owner set it on 4 Nov 2026, so the provider and backend arrive enabled
-- (enabling follows the key); a missing key still refuses every call by name (adapterCredential).
--
-- THE FREE TIER TRAINS ON PROMPTS. Google's terms let it use free-tier content to improve its
-- products, so both rows are data_use = 'TRAINS_ON_PROMPTS' and policy.ts refuses them any
-- private-model-only work (a committed LP's name, deal terms). Public work (summaries, prospect
-- research, meeting prep for a prospect) may use them. routeIsBilled is false only for these two
-- slugs on bk_gemini (guard.ts FREE_ROUTES); the same models through OpenRouter stay the paid
-- fallback, untouched.

INSERT OR IGNORE INTO providers (id, name, base_url, api_key_var, enabled) VALUES
  ('prv_gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta', 'GEMINI_API_KEY', 1);

INSERT OR IGNORE INTO execution_backends
  (id, display_name, class, capabilities, allowed_kinds, forbidden_actions,
   credential_ref, security_notes, monthly_ceiling_micros, status, status_reason) VALUES
  ('bk_gemini', 'Google Gemini (free tier)', 'cloud_model',
   '["completion","reasoning","summarise","classify"]',
   '["research","document","classify","summarise"]',
   '["commit","merge","push","deploy","secret_read"]',
   'GEMINI_API_KEY',
   'Egress from the Worker to one host, reached only through the Boss router. Free tier only: Google may train on what it is sent, so no private-model-only work reaches it. Search grounding for research.',
   -- $0 ceiling: free-tier models only. A paid Gemini call goes through OpenRouter, which has its own.
   0, 'enabled',
   'GEMINI_API_KEY is set as a Worker secret (owner, 4 Nov 2026). Free-tier models only.');

-- The six free-tier ids the owner verified live on her key (billing off) on 4 Nov 2026.
-- gemini-4-argon and gemini-3.1-pro-preview* are NOT free and are not here.
-- Google Search grounding is free ONLY on gemini-2.5-flash (2.5 Flash Lite is closed to new users;
-- grounding on 3.x answers 429 on the free tier). It retires 1 Dec 2026, so its row is kept to
-- research work (approved_task_kinds) and it is no default for anything else.
INSERT OR IGNORE INTO models
  (id, provider_id, slug, display_name, in_micros_1k, out_micros_1k, context_tokens, enabled,
   privacy_class, capability_tier, benchmark_status, max_risk, reasoning, approved_task_kinds,
   pricing_state, price_checked_at, price_source, data_use, data_use_source, data_use_checked_at)
VALUES
  ('mdl_gemini_25_flash_free', 'prv_gemini', 'gemini-2.5-flash',
   'Gemini 2.5 Flash with Google Search (Google, free)', 0, 0, 1048576, 1,
   'cloud', 'general', 'unbenchmarked', 'low', 1, '["research"]',
   'SOURCED', 1793836800000, 'https://ai.google.dev/gemini-api/docs/pricing and the live models list on her key with billing off, read 2026-11-04: free of charge on the free tier (owner, 4 Nov 2026).',
   'TRAINS_ON_PROMPTS', 'Google Gemini API terms: free-tier content may be used to improve Google products.', 1793836800000),
  ('mdl_gemini_38_flash_free', 'prv_gemini', 'gemini-3.8-flash',
   'Gemini 3.8 Flash (Google, free)', 0, 0, 1048576, 1,
   'cloud', 'general', 'unbenchmarked', 'low', 1, NULL,
   'SOURCED', 1793836800000, 'https://ai.google.dev/gemini-api/docs/pricing and the live models list on her key with billing off, read 2026-11-04: free of charge on the free tier (owner, 4 Nov 2026).',
   'TRAINS_ON_PROMPTS', 'Google Gemini API terms: free-tier content may be used to improve Google products.', 1793836800000),
  ('mdl_gemini_36_flash_free', 'prv_gemini', 'gemini-3.6-flash',
   'Gemini 3.6 Flash (Google, free)', 0, 0, 1048576, 1,
   'cloud', 'general', 'unbenchmarked', 'low', 1, NULL,
   'SOURCED', 1793836800000, 'https://ai.google.dev/gemini-api/docs/pricing and the live models list on her key with billing off, read 2026-11-04: free of charge on the free tier (owner, 4 Nov 2026).',
   'TRAINS_ON_PROMPTS', 'Google Gemini API terms: free-tier content may be used to improve Google products.', 1793836800000),
  ('mdl_gemini_3_flash_preview_free', 'prv_gemini', 'gemini-3-flash-preview',
   'Gemini 3 Flash preview (Google, free)', 0, 0, 1048576, 1,
   'cloud', 'general', 'unbenchmarked', 'low', 1, NULL,
   'SOURCED', 1793836800000, 'https://ai.google.dev/gemini-api/docs/pricing and the live models list on her key with billing off, read 2026-11-04: free of charge on the free tier (owner, 4 Nov 2026).',
   'TRAINS_ON_PROMPTS', 'Google Gemini API terms: free-tier content may be used to improve Google products.', 1793836800000),
  ('mdl_gemini_35_flash_lite_free', 'prv_gemini', 'gemini-3.5-flash-lite',
   'Gemini 3.5 Flash Lite (Google, free)', 0, 0, 1048576, 1,
   'cloud', 'fast', 'unbenchmarked', 'low', 0, NULL,
   'SOURCED', 1793836800000, 'https://ai.google.dev/gemini-api/docs/pricing and the live models list on her key with billing off, read 2026-11-04: free of charge on the free tier (owner, 4 Nov 2026).',
   'TRAINS_ON_PROMPTS', 'Google Gemini API terms: free-tier content may be used to improve Google products.', 1793836800000),
  ('mdl_gemini_31_flash_lite_free', 'prv_gemini', 'gemini-3.1-flash-lite',
   'Gemini 3.1 Flash Lite (Google, free)', 0, 0, 1048576, 1,
   'cloud', 'fast', 'unbenchmarked', 'low', 0, NULL,
   'SOURCED', 1793836800000, 'https://ai.google.dev/gemini-api/docs/pricing and the live models list on her key with billing off, read 2026-11-04: free of charge on the free tier (owner, 4 Nov 2026).',
   'TRAINS_ON_PROMPTS', 'Google Gemini API terms: free-tier content may be used to improve Google products.', 1793836800000);

-- The two meeting-prep research steps, each pinned to its models (model_job_policies, 0337). Free
-- only; no model fits means a named stop, never research written from a model's memory.
INSERT OR IGNORE INTO model_job_policies (job_key, label, allowed_model_ids, paid_allowed, min_capability_tier, on_no_model) VALUES
  ('meeting_prep_search', 'Meeting prep: Google search', '["mdl_gemini_25_flash_free"]', 0, 'fast', 'stop'),
  ('meeting_prep_write',  'Meeting prep: writing from their pages', '["mdl_gemini_36_flash_free","mdl_gemini_3_flash_preview_free"]', 0, 'general', 'stop');

-- The key, watched like every other credential: a missing key is a named row, never a silent gap.
INSERT OR IGNORE INTO credential_probes
  (id, label, what_depends, state, fix_steps, max_age_hours, created_at, updated_at) VALUES
  ('cred_gemini_key', 'The Gemini key',
   'Free research and summaries on Google Gemini, with Google Search grounding for meeting prep. Without it they run on the other free routes or her Mac.',
   'unknown',
   'Set GEMINI_API_KEY as a Worker secret (wrangler secret put GEMINI_API_KEY), then npm run backend:provision -- bk_gemini.',
   168, unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0338_boss_gemini_free_tier');
