-- THE FREE GROUNDED-GOOGLE RUNG FOR RESEARCH (owner, 6 Nov 2026: "what about google? what about the
-- chain?"). A research task whose seats are spent walks to Gemini 2.5 Flash with Google Search
-- grounding, one call per numbered part of the brief (src/worker/boss/research/grounded.ts), then a
-- free Gemini writes the answer-first summary from the cited lines only. Free only; no model fits
-- means a named stop, never research written from a model's memory. Additive.
INSERT OR IGNORE INTO model_job_policies (job_key, label, allowed_model_ids, paid_allowed, min_capability_tier, on_no_model) VALUES
  ('research_grounded_search', 'Research: Google-grounded search, one part at a time', '["mdl_gemini_25_flash_free"]', 0, 'fast', 'stop'),
  ('research_write',           'Research: the answer first, from the cited findings', '["mdl_gemini_36_flash_free","mdl_gemini_3_flash_preview_free","mdl_gemini_38_flash_free"]', 0, 'general', 'stop');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0347_boss_research_walks_to_free_google');
