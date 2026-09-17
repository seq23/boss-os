-- THE CONFIDENTIAL LINE, RECORDED AS DATA SO THE ROUTER CAN ENFORCE IT.
--
-- The owner has ruled: LP NAMES AND DEAL TERMS ARE CONFIDENTIAL. This system holds them in
-- `lps`, `lp_record`, `lp_commitment`, `lp_claim`, `diligence_claim`, `deals`, `organizations`,
-- `people`, `investment_opportunity` and `capital_book_line`. Every model registered here is
-- `privacy_class = 'cloud'`, the free ones included, so "is it cloud" does not separate the route
-- that may hold that material from the route that may not.
--
-- THE FACT THAT DOES SEPARATE THEM is whether the route's own terms permit training on what is
-- sent to it, and until now this database recorded that fact NOWHERE. It could not have been
-- enforced, because it could not have been read.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THREE STATES, AND THE THIRD IS THE HONEST ONE.
--
--   NO_TRAINING_CONTRACTUAL  the vendor states in its own published terms that it does not train
--                            on what is sent; the row cites where it says so
--   TRAINS_ON_PROMPTS        the terms permit it, or leave it to a setting this Worker cannot read
--   UNKNOWN                  not established
--
-- `UNKNOWN` AND `TRAINS_ON_PROMPTS` ARE TREATED IDENTICALLY BY THE ROUTER. That is the whole
-- design. "We could not find out" and "yes it trains" have the same consequence for a name that
-- must not leak, and a schema that distinguishes them only in the reporting is the correct shape:
-- the reader learns which it was, the enforcement does not care.
--
-- THE DEFAULT IS `UNKNOWN`, WHICH MEANS A MODEL ADDED LATER IS RESTRICTED BY DEFAULT. A row that
-- arrives with no data-use finding cannot receive LP names until somebody writes down why it may.
-- That is the same shape `airlock.ts` uses for classification — "An entity nobody classified is not
-- an open question to be resolved later at the call site; it is a refusal."
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT WAS ACTUALLY CHECKED, AND HOW. All retrieved 17 September 2026.
--
-- [D1] https://developers.cloudflare.com/workers-ai/platform/data-usage/ — Cloudflare, verbatim:
--      "Cloudflare does not use your Customer Content to (1) train any AI models made available on
--      Workers AI or (2) improve any Cloudflare or third-party services", and would do so only
--      with explicit consent. On retention: Customer Content "may be stored by Cloudflare if you
--      specifically use a storage service (e.g., R2, KV, DO, Vectorize, etc.) in conjunction with
--      Workers AI" — i.e. not by default. This is an unambiguous contractual statement covering the
--      exact question, so both Workers AI models are NO_TRAINING_CONTRACTUAL.
--
--      It is worth saying plainly what this buys: WORKERS AI IS THE ONLY ROUTE IN THIS SYSTEM THAT
--      MAY CURRENTLY HOLD AN LP NAME, and it is also the free one. The confidential line and the $0
--      posture happen to point the same way, which is lucky rather than designed, and the line
--      would hold either way.
--
-- [D2] https://openrouter.ai/docs/features/privacy-and-logging — OpenRouter, verbatim: "On your
--      account settings page, you can set whether you would like to allow routing to providers that
--      may train on your data (according to their own policies). There are separate settings for
--      paid and free models."
--
--      So whether a free OpenRouter route trains is a property of an ACCOUNT SETTING ON A WEB PAGE,
--      not of the API, and this Worker has no way to read it. It is therefore not established, and
--      not-established is restricted. TRAINS_ON_PROMPTS.
--
--      NOTE WHAT WE ARE NOT DOING. We are not asserting OpenRouter trains on her prompts; the
--      setting may well be off. We are asserting that NOTHING HERE CAN PROVE IT IS OFF, and a
--      confidential line that rests on a checkbox somebody could flip in a browser is not a line.
--      If she wants that lane to carry LP names, the honest path is a screenshot of the setting and
--      a migration that cites it — a deliberate act with a diff behind it, which is what this
--      column is for.
--
-- [D3] Fireworks — CHECKED AND NOT ESTABLISHED, and the method is recorded because a claim of
--      absence needs one. https://fireworks.ai/terms-of-service 308-redirects to a PDF at
--      cdn.sanity.io whose text streams are font-subset glyph data; it could not be read
--      programmatically and no statement about training on customer prompts was extracted from it.
--      No other Fireworks page was found stating the position. UNKNOWN, therefore restricted.
--
--      Both Fireworks models are disabled as of 0247 anyway — there is no FIREWORKS_API_KEY — so
--      nothing is being taken away here. What is being recorded is that IF the key ever arrives,
--      the provider comes back without a data-use finding and stays off the confidential lane until
--      one is written down.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHERE THIS IS ENFORCED, AND WHERE IT IS DELIBERATELY NOT.
--
-- `src/worker/boss/router/policy.ts`, as the FIRST rule of the first stage, before any request is
-- formed. Not in a prompt, not in a wrapper a caller has to remember, not in a check something runs
-- on the way back. The router already reads the messages; it now reads them for this too.
--
-- AND IT IS NOT APPROVABLE. Restricted-to-cloud is approvable — that is what the sensitive-routing
-- card exists for, and it stays exactly as it was. This is a different refusal: a route that may
-- train on what it is shown cannot be made safe by a person clicking approve, because the risk is
-- not "this run" but "the material is now in somebody's corpus". So it carries `approvable = false`
-- and no card lifts it. The remedy is to route it somewhere that does not train, or not at all.
--
-- Canon: Sovereignty Addendum §3.1 (permission and data sensitivity FIRST), v20.1 §3 (the airlock).

ALTER TABLE models ADD COLUMN data_use TEXT NOT NULL DEFAULT 'UNKNOWN'
  CHECK (data_use IN ('NO_TRAINING_CONTRACTUAL','TRAINS_ON_PROMPTS','UNKNOWN'));

-- The citation. Same discipline as `price_source` from 0174: a URL and what it said, so the next
-- person re-checks in one click instead of repeating the search.
ALTER TABLE models ADD COLUMN data_use_source TEXT;

-- WHEN IT WAS LOOKED AT, which is a different fact from what was found. A route checked and not
-- established must be distinguishable from one nobody has opened, or "unconfirmed" decays into
-- "unexamined" and the check is done twice or never.
ALTER TABLE models ADD COLUMN data_use_checked_at INTEGER;

-- A LITERAL DATE, NOT unixepoch(). 2026-09-17T00:00:00Z is when a human-directed check read these
-- pages, not when this migration happened to be applied somewhere.

UPDATE models SET
  data_use            = 'NO_TRAINING_CONTRACTUAL',
  data_use_checked_at = 1789603200000,
  data_use_source     =
    'https://developers.cloudflare.com/workers-ai/platform/data-usage/ retrieved 2026-09-17, '
    || 'verbatim: "Cloudflare does not use your Customer Content to (1) train any AI models made '
    || 'available on Workers AI or (2) improve any Cloudflare or third-party services", and only '
    || 'with explicit consent otherwise. Retention: Customer Content "may be stored by Cloudflare '
    || 'if you specifically use a storage service (e.g., R2, KV, DO, Vectorize, etc.) in '
    || 'conjunction with Workers AI" — not by default. An unambiguous contractual statement on the '
    || 'exact question, so this route may hold LP names and deal terms. It is reached by a binding '
    || 'rather than a key, so there is also no credential on this path that could leak.'
WHERE provider_id = 'prv_workers_ai';

UPDATE models SET
  data_use            = 'TRAINS_ON_PROMPTS',
  data_use_checked_at = 1789603200000,
  data_use_source     =
    'https://openrouter.ai/docs/features/privacy-and-logging retrieved 2026-09-17, verbatim: "On '
    || 'your account settings page, you can set whether you would like to allow routing to '
    || 'providers that may train on your data (according to their own policies). There are '
    || 'separate settings for paid and free models." Whether a free route trains is therefore an '
    || 'account setting on a web page, and this Worker cannot read it. NOT ESTABLISHED, and '
    || 'not-established fails closed. This is not a claim that OpenRouter trains on her prompts; it '
    || 'is a statement that nothing here can prove it does not, and a confidential line resting on '
    || 'a checkbox somebody could flip is not a line. To move this route onto the confidential '
    || 'lane, read the setting and cite it in a migration.'
WHERE provider_id = 'prv_openrouter';

UPDATE models SET
  data_use            = 'UNKNOWN',
  data_use_checked_at = 1789603200000,
  data_use_source     =
    'CHECKED 2026-09-17 AND NOT ESTABLISHED. https://fireworks.ai/terms-of-service 308-redirects '
    || 'to a PDF on cdn.sanity.io whose text streams are font-subset glyph data; it could not be '
    || 'read programmatically and no statement about training on customer prompts was extracted. '
    || 'No other Fireworks page stating the position was found. The method is recorded because a '
    || 'claim of absence needs one. UNKNOWN is treated exactly as TRAINS_ON_PROMPTS by the router. '
    || 'Both models on this provider are disabled as of 0247 for want of a key, so nothing is lost '
    || 'here — but if the key arrives, the provider returns without a data-use finding and stays '
    || 'off the confidential lane until one is written down.'
WHERE provider_id = 'prv_fireworks';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0249_boss_a_route_that_trains_cannot_hold_lp_names');
