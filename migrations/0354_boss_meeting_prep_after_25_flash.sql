-- MEETING PREP OUTLIVES GEMINI 2.5 FLASH (7 Nov 2026; loop olp_m6mnjapa3tdhv3d3).
--
-- gemini-2.5-flash, the one free model with Google Search grounding, retires on 1 Dec 2026. After
-- that the grounded step errors and research goes on to Brave Search and the guest's own pages,
-- which a free model writes from. That writer was pinned to two Gemini 3 models and confined to
-- Gemini, so a Gemini outage or quota left prep with nothing. It now walks the next free Gemini
-- models, then OpenRouter's free models (src/shared/boss/router/jobPolicy.mjs MEETING_PREP_WRITERS).
-- Only a row still on the 0338 default changes: a list she set on the Settings screen is hers.
-- Free only (paid_allowed stays 0). No live business record changes.
UPDATE model_job_policies
   SET allowed_model_ids = '["mdl_gemini_38_flash_free","mdl_gemini_36_flash_free","mdl_gemini_3_flash_preview_free","mdl_or_nemotron_ultra_free","mdl_or_deepseek_v4_free","mdl_or_nemotron_super_free","mdl_or_llama33_free"]'
 WHERE job_key = 'meeting_prep_write'
   AND allowed_model_ids = '["mdl_gemini_36_flash_free","mdl_gemini_3_flash_preview_free"]';
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0354_boss_meeting_prep_after_25_flash');
