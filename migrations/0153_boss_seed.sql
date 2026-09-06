-- Boss OS v20 — Phase 0 seed. Safe to re-run: every insert is OR IGNORE.
-- Prices are USD micros per 1k tokens. Verify against your provider's current
-- rate card before you trust the cost ledger — these are placeholders.

INSERT OR IGNORE INTO lanes (id, name, accent, isolated, created_at) VALUES
  ('ops',     'Operations', 'lane-ops',     0, unixepoch() * 1000),
  ('trading', 'Trading',    'lane-trading', 1, unixepoch() * 1000);

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('boss_name',            'Boss',      unixepoch() * 1000),
  ('default_lane',         'ops',       unixepoch() * 1000),
  ('approval_expiry_ms',   '604800000', unixepoch() * 1000),
  ('trading_live_enabled', 'false',     unixepoch() * 1000);

INSERT OR IGNORE INTO providers (id, name, base_url, api_key_var, enabled) VALUES
  ('prv_fireworks', 'Fireworks AI', 'https://api.fireworks.ai/inference/v1', 'FIREWORKS_API_KEY', 1),
  ('prv_anthropic', 'Anthropic',    'https://api.anthropic.com/v1',          'ANTHROPIC_API_KEY', 0);

INSERT OR IGNORE INTO models (id, provider_id, slug, display_name, in_micros_1k, out_micros_1k, context_tokens, enabled) VALUES
  ('mdl_kimi_k2',   'prv_fireworks', 'accounts/fireworks/models/kimi-k2-instruct',  'Kimi K2 Instruct',  600, 2500, 128000, 1),
  ('mdl_qwen_fast', 'prv_fireworks', 'accounts/fireworks/models/qwen2p5-72b-instruct', 'Qwen 2.5 72B',   900, 900,  32000,  1);

INSERT OR IGNORE INTO routes (id, name, lane, primary_model_id, fallback_model_id, max_output_tokens, temperature) VALUES
  ('rt_ops_default',     'Ops default',     'ops',     'mdl_kimi_k2',   'mdl_qwen_fast', 4096, 0.3),
  ('rt_trading_default', 'Trading default', 'trading', 'mdl_kimi_k2',   NULL,            2048, 0.1);

-- Budgets start deliberately small. Raise them once you trust the ledger.
INSERT OR IGNORE INTO budgets (id, lane, period, limit_micros, spent_micros, window_started_at, hard_stop) VALUES
  ('bdg_ops_day',     'ops',     'day',   2000000,  0, unixepoch() * 1000, 1),
  ('bdg_ops_month',   'ops',     'month', 25000000, 0, unixepoch() * 1000, 1),
  ('bdg_trd_day',     'trading', 'day',   1000000,  0, unixepoch() * 1000, 1),
  ('bdg_trd_month',   'trading', 'month', 10000000, 0, unixepoch() * 1000, 1);

INSERT OR IGNORE INTO employees (id, lane, name, role, charter, route_id, autonomy, status, created_at) VALUES
  ('emp_chief', 'ops', 'Chief of Staff', 'Triage and routing',
   'Read what comes in. Decide what the Boss actually needs to see. Draft the recommendation, never the decision.',
   'rt_ops_default', 'ask', 'active', unixepoch() * 1000);

INSERT OR IGNORE INTO promotion_rules (id, lane, name, from_tier, to_tier, condition, requires_approval, enabled) VALUES
  ('pr_capture_working', 'ops', 'Capture to working', 'capture', 'working',
   '{"min_hits":2,"min_confidence":0.6,"min_age_ms":86400000}', 0, 1),
  ('pr_working_canon',   'ops', 'Working to canon',   'working', 'canon',
   '{"min_hits":5,"min_confidence":0.8,"min_age_ms":604800000}', 1, 1);

INSERT OR IGNORE INTO trading_accounts (id, label, broker, mode, enabled, created_at) VALUES
  ('acct_paper', 'Paper book', 'manual', 'paper', 1, unixepoch() * 1000);


-- The chassis answers "what schema is applied" from this table, and /api/health and the
-- policy suite both read it. A migration that runs without recording itself leaves the
-- system reporting a version older than the one it is actually running, so every ported
-- Boss OS migration registers here exactly as the chassis's own do.
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0153_boss_seed');
