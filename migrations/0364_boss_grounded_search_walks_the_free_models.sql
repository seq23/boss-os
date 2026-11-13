-- GROUNDED SEARCH MAY ASK EVERY FREE GEMINI MODEL, NOT ONE (repair, 13 Nov 2026).
--
-- Both grounded-search jobs listed exactly one model, gemini-2.5-flash, which retires 1 Dec 2026 and
-- was already dead on a sister key: free research had one model and then none. The router now walks
-- the free models and learns from the key's answers (router/experience.ts: a 404 "no longer
-- available" disables a model for good, a 429 on grounding passes it over until the daily reset).
-- Still free only (`paid_allowed` stays 0). Guarded: a list she has edited on Settings is left alone.
UPDATE model_job_policies
   SET allowed_model_ids = '["mdl_gemini_25_flash_free","mdl_gemini_38_flash_free","mdl_gemini_36_flash_free","mdl_gemini_3_flash_preview_free","mdl_gemini_35_flash_lite_free","mdl_gemini_31_flash_lite_free"]'
 WHERE job_key IN ('research_grounded_search', 'meeting_prep_search')
   AND allowed_model_ids = '["mdl_gemini_25_flash_free"]';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0364_boss_grounded_search_walks_the_free_models');
