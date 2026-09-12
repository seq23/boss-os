-- The best free brain in the building was never once offered the work.
--
-- ─── What she got, and what it cost ────────────────────────────────────────
--
-- On 12 September 2026 she emailed: "please help me find a seller of $1B+ of OpenAI shares. Route
-- this to whomever should handle this." Task `tsk_m2az87r6eh7s3qs2`. The answer:
--
--   "Classification: General Inquiry. Routing: Route to Customer Service Team."
--
-- The routing decision behind it, `rtd_m2b0p2mdcrt61m4g`, lists exactly three candidates:
--
--   mdl_kimi_k2       route       rejected     Fireworks is registered, not enabled
--   mdl_qwen_fast     route       rejected     Fireworks is registered, not enabled
--   mdl_cf_llama31_8b continuity  USED         estimate_micros 0, free
--
-- `mdl_cf_llama33_70b` — enabled, `capability_tier` general, on the enabled `bk_workers_ai` backend,
-- `in_micros_1k` 0 and `out_micros_1k` 0, i.e. free on Cloudflare's included allowance — does not
-- appear. Not rejected. Not screened. ABSENT.
--
-- ─── Why it was absent, which is the part worth keeping ────────────────────
--
-- Fireworks is disabled and stays disabled (cost rule: this system runs at $0). So every route in
-- the ops lane arrives at the continuity tier, which is sorted cheapest-first and then, at equal
-- cost, ALPHABETICALLY by display name. Both Workers AI models cost exactly 0. "Llama 3.1 8B" sorts
-- before "Llama 3.3 70B". The 8B is called, it succeeds, the loop stops.
--
-- A tie-break on spelling was making a capability decision, for free, on every mail-driven task this
-- system has ever run. `router/index.ts` now breaks a cost tie on capability tier, which fixes it
-- everywhere. THIS migration fixes it where it should never have depended on a tie-break at all.
--
-- ─── What changes here, and the design that was REJECTED ──────────────────
--
-- The obvious fix is to make the 70B the ops route's declared FALLBACK. It was tried and it is
-- wrong, and the reason is worth writing down so nobody tries it again:
--
--   A declared route model that answers is reported as `fallback`. A CONTINUITY model that answers
--   is reported as `degraded`, and carries "DEGRADED TIER" in `modelName` plus the notice "not a
--   promise of equal quality" onto every screen that renders it. Promoting the free 70B into the
--   route would therefore have SILENTLY REMOVED the label that tells her a weaker, free model
--   answered — buying visibility in the routing decision at the cost of honesty on the screen.
--   `tests/boss/router.test.ts` caught it: two tests flipped from `degraded` to `fallback`.
--
-- So the route declarations are UNCHANGED, and the actual defect is fixed where it lives: the
-- continuity tier's tie-break, in `shared/boss/router/candidateOrder.mjs`. Cost first, then
-- CAPABILITY, then the name. At $0 = $0 the 70B now sorts above the 8B, is screened first, and
-- appears in `routing_decisions` by name with `estimate_micros` 0 — as a candidate, which is the
-- thing it has never once been.
--
-- ─── And the two Workers AI rows are seeded here ──────────────────────────
--
-- They exist in production already, written by `provision-backend.mjs` when `bk_workers_ai` was
-- commissioned. They did NOT exist on a freshly migrated database, which means a fresh Boss OS had
-- no free continuity tier at all and every task in it failed the moment Fireworks refused. Seeding
-- them makes a new database match the live one.
--
-- COST: unchanged at $0. Both rows are the same Cloudflare included allowance, on a binding with no
-- key and no egress. No paid backend is enabled by this migration and no ceiling is added.
--
-- Guarded by `validate:free-brain` (scripts/validate/the-best-free-model-is-a-candidate.mjs).

INSERT OR IGNORE INTO providers (id, name, base_url, api_key_var, enabled) VALUES
  ('prv_workers_ai', 'Workers AI', 'binding:AI', 'AI', 1);

INSERT OR IGNORE INTO models
  (id, provider_id, slug, display_name, in_micros_1k, out_micros_1k, context_tokens, enabled,
   privacy_class, capability_tier, benchmark_status, max_risk) VALUES
  ('mdl_cf_llama31_8b', 'prv_workers_ai', '@cf/meta/llama-3.1-8b-instruct-fp8',
   'Llama 3.1 8B (Workers AI)', 0, 0, 8192, 1, 'cloud', 'fast', 'unbenchmarked', 'low'),
  ('mdl_cf_llama33_70b', 'prv_workers_ai', '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
   'Llama 3.3 70B (Workers AI)', 0, 0, 24000, 1, 'cloud', 'general', 'unbenchmarked', 'low');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0229_boss_the_free_70b_was_never_a_candidate');
