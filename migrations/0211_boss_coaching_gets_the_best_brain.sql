-- Coaching is the one route that gets the expensive model, on purpose.
--
-- ─── Her instruction ───────────────────────────────────────────────────────
--
--   "i think for coaching it is imperative that i use the best models with the best thinking brains
--    and the most integrity."
--
-- ─── What was actually happening, verified rather than read off the source ─
--
-- A real coaching turn against production on 9 September, with throwaway text:
--
--   CONSENT: 200 {"granted":true,"backend_id":"bk_workers_ai"}
--   TURN:    200 {"reply":"Is today's anchor set?","degraded":false,"off_route":true}
--   usage_ledger: mdl_cf_llama31_8b · "Llama 3.1 8B (Workers AI)" · 301 in / 8 out · cost_micros 0
--
-- So the feature WORKS — the comments in `coaching/run.ts` about Fireworks having no key describe a
-- condition that is already handled, not a dead route. `off_route: true` is expected and documented:
-- the route's declared primary is Fireworks, which has no key, so every turn arrives via the
-- continuity tier. `degraded: false` is the honest answer to the question she would ask — the model
-- that answered belonged to the backend she consented to.
--
-- AND THE COACH FOR HER INTERIOR LIFE WAS AN 8-BILLION-PARAMETER MODEL ANSWERING IN FOUR WORDS.
-- Free, correct, governed, and the wrong instrument.
--
-- ─── The exemption, stated so it cannot be "optimised" later ───────────────
--
-- Every duty in this system was pushed DOWN to the cheapest model that could do the job; one
-- briefing cost $3.88 by inheriting the default and 0196 fixed it by naming a cheap model
-- everywhere. This migration does the opposite in exactly one place, and the reason is not comfort:
-- coaching is the only route whose output is reasoning about her own life, and there is no cheaper
-- model that produces the same thing more slowly. Anyone reading this later and seeing an expensive
-- model on one route should know it was chosen, argued for, and is not an oversight.
--
-- THE BUDGET MUST NOT TOUCH IT. The standing policy is that the monthly ceiling stops SCHEDULED work
-- and never stops her. Coaching is her opening a screen and typing, so it is her asking directly. It
-- must not be skipped for budget and it must not quietly fall back mid-conversation — a cheaper
-- model answering without her knowing is the worst available outcome, because she would be taking
-- advice from something other than what she agreed to. `CoachingResult.degraded` exists for exactly
-- that and the screen shows it.
--
-- ─── Direct, not through OpenRouter ────────────────────────────────────────
--
-- Her question was "so open ai or anthropic - maybe using openrouter?". OpenRouter stays wired and
-- stays right for utility work — one key, free variants, trivial switching. It is wrong HERE because
-- it adds a party to the one conversation whose whole design is about minimising who sees her words.
-- Both frontier providers are registered so she can run a week on each and keep whichever she trusts
-- more when it disagrees with her; picking on reputation is not testable and that is.
--
-- ─── REGISTERED, NOT ENABLED, BECAUSE THE KEYS ARE HERS TO SUPPLY ──────────
--
-- 0173's rule: registering is not commissioning, and a registry that arrives switched on is one
-- whose first run is also its first test. Neither key is in the vault today, so both rows land
-- `registered` with the reason on the row, and the credential prober carries the same fact to Today
-- with the exact command. THIS IS THE ONE LEGITIMATE STOP — a secret only she can supply — and it is
-- a named, self-explaining item on a screen rather than a line in a report.

INSERT OR IGNORE INTO providers (id, name, base_url, api_key_var, enabled) VALUES
  ('prv_openai', 'OpenAI', 'https://api.openai.com/v1', 'OPENAI_API_KEY', 0);

-- `prv_anthropic` already exists from 0153, disabled and with no model rows. It stays disabled here
-- for the same reason the new one does: the key is not in the vault yet.

INSERT OR IGNORE INTO execution_backends
  (id, display_name, class, capabilities, allowed_kinds, forbidden_actions,
   credential_ref, security_notes, monthly_ceiling_micros, status, status_reason) VALUES

  ('bk_anthropic', 'Anthropic', 'cloud_model',
   '["completion","reasoning","summarise","classify"]',
   '["research","document","classify","summarise"]',
   '["commit","merge","push","deploy","secret_read"]',
   'ANTHROPIC_API_KEY',
   'Egress from the Worker to one host, reached only through the Boss router, which applies cost mode, budget, privacy class and risk ceiling before the call. Called DIRECTLY rather than through OpenRouter because coaching is the route whose design is about minimising who sees her words, and a proxy is an extra party in exactly that conversation.',
   -- A REAL CEILING RATHER THAN ZERO. Zero means free-tier-only, which for a paid provider means
   -- never — and a backend that can never run is the "exists but nothing invokes it" defect with a
   -- budget line. $5/month is roughly 15 coaching mornings at the measured shape of a turn.
   5000000, 'registered',
   'Awaiting ANTHROPIC_API_KEY in the vault: npm run vault:set ANTHROPIC_API_KEY, then npm run vault:sync:cloudflare, then npm run backend:provision -- bk_anthropic.'),

  ('bk_openai', 'OpenAI', 'cloud_model',
   '["completion","reasoning","summarise","classify"]',
   '["research","document","classify","summarise"]',
   '["commit","merge","push","deploy","secret_read"]',
   'OPENAI_API_KEY',
   'The second frontier provider, so no critical capability depends permanently on one vendor. Same router, same guards, same one host.',
   5000000, 'registered',
   'Awaiting OPENAI_API_KEY in the vault: npm run vault:set OPENAI_API_KEY, then npm run vault:sync:cloudflare, then npm run backend:provision -- bk_openai.');

-- ─── Which one serves coaching, as a setting rather than a migration ───────
--
-- "Make switching a one-line change rather than a migration." So the choice lives in `settings` and
-- the screen reads it. Workers AI until a frontier key exists, because a setting pointing at a
-- backend that cannot answer would be a coaching screen that fails at the first sentence — and the
-- failure would land on whoever typed it, at 6am, which is the worst place this system can put one.
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('coaching_backend', 'bk_workers_ai', unixepoch() * 1000);

-- ─── The two keys, watched like every other credential ────────────────────
--
-- Same register, same daily prober, same self-explaining alert. A key she has not supplied is not a
-- silent gap: it is a row that says what is missing, what it unlocks, and the three commands.
INSERT OR IGNORE INTO credential_probes
  (id, label, what_depends, state, fix_steps, max_age_hours, created_at, updated_at) VALUES
  ('cred_anthropic_key', 'The Anthropic key',
   'Morning coaching on a frontier model. Without it coaching still works, on Llama 3.1 8B through Workers AI — free, and answering your morning in four words.',
   'unknown',
   'npm run vault:set ANTHROPIC_API_KEY   then   npm run vault:sync:cloudflare   then   npm run backend:provision -- bk_anthropic. Finally set coaching_backend to bk_anthropic under Settings. Roughly $0.01 a morning at the measured length of a turn.',
   168, unixepoch() * 1000, unixepoch() * 1000),

  ('cred_openai_key', 'The OpenAI key',
   'The second frontier option for coaching, so you can run a week on each and keep whichever you trust more when it disagrees with you.',
   'unknown',
   'npm run vault:set OPENAI_API_KEY   then   npm run vault:sync:cloudflare   then   npm run backend:provision -- bk_openai. Finally set coaching_backend to bk_openai under Settings.',
   168, unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0211_boss_coaching_gets_the_best_brain');
