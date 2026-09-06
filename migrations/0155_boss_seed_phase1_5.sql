-- Boss OS v20 — Phase 1–5 seed. Safe to re-run: every insert is OR IGNORE.
-- Nothing here fabricates a benchmark result or grants trading authority.

-- ─── Cost governor ───────────────────────────────────────────────────────────
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('cost_mode',                 'NORMAL',   unixepoch() * 1000),
  ('require_benchmark_high_risk','true',    unixepoch() * 1000),
  ('approval_expiry_default_ms','604800000',unixepoch() * 1000),
  ('retention_audit_days',      '365',      unixepoch() * 1000);

-- ─── Model runtime intelligence ──────────────────────────────────────────────
-- Classify the models Phase 0 seeded. Neither is benchmarked yet; that is a
-- statement of fact, not a placeholder, and the router treats it as one.
UPDATE models SET privacy_class = 'cloud', capability_tier = 'general', max_risk = 'medium'
  WHERE id = 'mdl_kimi_k2';
UPDATE models SET privacy_class = 'cloud', capability_tier = 'fast', max_risk = 'low'
  WHERE id = 'mdl_qwen_fast';

-- Workload Placement Matrix. Seven scored workloads; roadmap MR-2 asks for five.
INSERT OR IGNORE INTO workload_profiles
  (id, name, intake_kind, privacy_score, cost_score, latency_score, offline_score,
   capability_score, control_score, recommendation, note) VALUES
  ('wl_research',   'Research brief',        'research',        2, 4, 2, 1, 3, 2, 'frontier',
   'Public sources. Cost matters more than privacy.'),
  ('wl_drafting',   'Drafting',              'drafting',        3, 3, 3, 1, 3, 3, 'frontier',
   'Voice matters; the human edits before anything is sent.'),
  ('wl_coaching',   'Coaching',              'coaching',        5, 3, 2, 2, 4, 5, 'hybrid',
   'Personal context. Prefer local once a local model is benchmarked.'),
  ('wl_decision',   'Decision support',      'decision_support',5, 2, 2, 2, 5, 5, 'human_review',
   'High stakes. The system proposes, the Boss decides.'),
  ('wl_memory',     'Memory promotion',      'memory_promotion',5, 4, 1, 3, 2, 5, 'local',
   'Never leaves the private boundary once a local model exists.'),
  ('wl_repo',       'Repository task',       'repository',      4, 3, 3, 1, 5, 4, 'external_backend',
   'Runs in a coding backend with repo write held behind approval.'),
  ('wl_trading',    'Trading analysis',      'trading',         4, 3, 4, 1, 4, 5, 'human_review',
   'No model gets execution authority in the trading lane.');

-- ─── AI employee first slice (roadmap 103) ───────────────────────────────────
-- Phase 0 seeded the Chief of Staff. These complete the first slice. No employee
-- here holds external send, repo write, or financial authority by default.
INSERT OR IGNORE INTO employees
  (id, lane, name, role, charter, route_id, autonomy, status, created_at,
   department, lifecycle, risk_level, budget_micros_day) VALUES
  ('emp_relationship', 'ops', 'Relationship', 'Meetings, dossiers, follow-up',
   'Track who matters and what was promised. Prepare the Boss before the room and capture what was said after. Never send anything outward.',
   'rt_ops_default', 'ask', 'active', unixepoch() * 1000,
   'Relationship + Meeting', 'active', 'medium', 500000),
  ('emp_knowledge', 'ops', 'Knowledge', 'Capture, promotion candidates, retrieval',
   'Turn conversation into candidate memory. Never promote anything yourself. Propose, cite the source, and let the gate decide.',
   'rt_ops_default', 'ask', 'active', unixepoch() * 1000,
   'Knowledge + Memory', 'active', 'low', 500000),
  ('emp_repo', 'ops', 'Repository', 'Repo work, artifacts, validation',
   'Prepare repository work as artifacts and scoped changes. You do not commit, merge, or deploy. Every mutation is a proposal with evidence.',
   'rt_ops_default', 'ask', 'active', unixepoch() * 1000,
   'Build / Repo / Document', 'active', 'high', 800000),
  ('emp_intake', 'ops', 'Task Intake', 'Classify and route incoming work',
   'Classify what comes in, pick the existing employee, template, or duty that fits, and refuse to invent a new employee when one already covers the work.',
   'rt_ops_default', 'ask', 'active', unixepoch() * 1000,
   'Command + Operations', 'active', 'low', 300000),
  ('emp_router', 'ops', 'Model Router', 'Model placement, benchmarks, cost',
   'Decide where work runs. Respect privacy class, benchmark status, risk ceiling, and budget. Record every decision, including the refusals.',
   'rt_ops_default', 'ask', 'active', unixepoch() * 1000,
   'Continuity + Local Model', 'active', 'medium', 300000),
  ('emp_continuity', 'ops', 'Continuity', 'Snapshots, restore drills, resume',
   'Keep the system rebuildable. Verify snapshots, run restore drills, and make sure tomorrow resumes instead of starting over.',
   'rt_ops_default', 'ask', 'active', unixepoch() * 1000,
   'Continuity + Local Model', 'active', 'medium', 200000),
  ('emp_risk', 'trading', 'Risk Officer', 'Trading risk, gates, incidents',
   'Guard the trading lane. Check every order against the authority envelope. You have no execution authority and never will by default.',
   'rt_trading_default', 'ask', 'active', unixepoch() * 1000,
   'Trading Firm Agents', 'active', 'high', 200000);

UPDATE employees SET department = 'Command + Operations', lifecycle = 'active',
                     risk_level = 'medium', budget_micros_day = 800000
  WHERE id = 'emp_chief' AND department IS NULL;

-- ─── Task template library (roadmap TI-3) ────────────────────────────────────
INSERT OR IGNORE INTO task_templates
  (id, lane, name, intake_kind, owner_employee_id, inputs, output_contract,
   approval_rule, success_criteria, prompt, enabled, created_at) VALUES
  ('tpl_meeting_dossier', 'ops', 'Meeting Dossier', 'relationship', 'emp_relationship',
   '[{"key":"person","label":"Who you are meeting","required":true},{"key":"context","label":"Why","required":false}]',
   'Who they are, what they want, what you want, three questions, one ask, known landmines.',
   'always', 'The Boss walks in knowing the ask and the landmines.',
   'Build a meeting dossier for {{person}}. Context: {{context}}. Give: who they are, what they want, what we want, three questions worth asking, one clear ask, and any landmines. Be specific or say you do not know.',
   1, unixepoch() * 1000),
  ('tpl_after_meeting', 'ops', 'After-Meeting Capture', 'relationship', 'emp_relationship',
   '[{"key":"person","label":"Who","required":true},{"key":"notes","label":"Raw notes","required":true}]',
   'Commitments made, commitments received, follow-up dates, candidate memories.',
   'always', 'No commitment made in the room is lost.',
   'From these notes on a meeting with {{person}}, extract: commitments I made, commitments they made, dates, and any durable facts worth remembering. Notes: {{notes}}',
   1, unixepoch() * 1000),
  ('tpl_deal_red_team', 'ops', 'Deal Red Team', 'decision_support', 'emp_chief',
   '[{"key":"deal","label":"The deal","required":true}]',
   'The three ways this loses money, the disconfirming evidence, the walk-away line.',
   'always', 'The strongest case against the deal is on the table before the decision.',
   'Argue against this deal as hard as the evidence allows: {{deal}}. Give the three most likely ways it loses money, what evidence would disconfirm the thesis, and where the walk-away line sits.',
   1, unixepoch() * 1000),
  ('tpl_daily_agenda', 'ops', 'Daily Agenda Calculation', 'recurring_duty', 'emp_chief',
   '[{"key":"energy","label":"Energy today","required":false}]',
   'Three things that matter, what to drop, the first physical action.',
   'never', 'The day has a shape before it starts.',
   'Given open approvals, tasks in flight, and energy state {{energy}}, name the three things that actually matter today, what to drop, and the first physical action to take.',
   1, unixepoch() * 1000),
  ('tpl_model_benchmark', 'ops', 'Local Model Benchmark', 'model_benchmark', 'emp_router',
   '[{"key":"workload_id","label":"Workload","required":true},{"key":"model_id","label":"Model","required":true}]',
   'Quality score, edit burden, latency, cost, and a verdict.',
   'always', 'A model is only trusted for work it has been measured on.',
   'Run the benchmark prompt for workload {{workload_id}} and report the output verbatim for scoring.',
   1, unixepoch() * 1000),
  ('tpl_agent_review', 'ops', 'Agent Performance Review', 'recurring_duty', 'emp_chief',
   '[{"key":"employee_id","label":"Employee","required":true}]',
   'Tasks run, failure rate, cost, approval rate, and a keep/merge/retire call.',
   'always', 'Every active employee earns its place or is merged out.',
   'Review employee {{employee_id}} against its charter and duty load. Recommend keep, merge, retire, suspend, or watch, with the reason.',
   1, unixepoch() * 1000),
  ('tpl_fallback_review', 'ops', 'Cloud Fallback Review', 'recurring_duty', 'emp_router',
   '[{"key":"window_days","label":"Window in days","required":false}]',
   'Which fallbacks fired, why, cost delta, and whether the primary should change.',
   'always', 'Fallback is a signal, not a silent habit.',
   'Review routing decisions with outcome fallback over the last {{window_days}} days. Say which primaries are failing, what it cost, and whether a route should change.',
   1, unixepoch() * 1000);

-- ─── Trading authority envelope — everything denied until proven ─────────────
INSERT OR IGNORE INTO trading_authority
  (id, updated_at, live_enabled, max_order_notional_micros, max_daily_loss_micros,
   max_open_positions, allowed_symbols, kill_switch, human_approval_recorded,
   exchange_security_ok, withdrawals_disabled, monitoring_ok, incident_runbook_ok,
   ledger_export_tested, note) VALUES
  ('trd_authority', unixepoch() * 1000, 0, 0, 0, 0, NULL, 0, 0, 0, 0, 0, 0, 0,
   'Live authority is off and every micro-live gate is unmet. Paper trading needs none of them.');

-- Paper book starts with simulated capital so the paper lifecycle is exercisable.
UPDATE trading_accounts
   SET capital_micros = 10000000000, cash_micros = 10000000000, stage = 'paper'
 WHERE id = 'acct_paper' AND capital_micros = 0;

INSERT OR IGNORE INTO trading_strategies
  (id, name, thesis, market, timeframe, data_sources, risk_controls,
   intake_complete, backtest_note, stage, score, status, created_at) VALUES
  ('str_paper_baseline', 'Paper baseline',
   'A deliberately simple long/flat rule used to exercise the paper lifecycle end to end. It is not an alpha claim.',
   'crypto spot', 'daily', 'manual signal entry',
   'Max one open position. Paper mode only. No leverage. Kill switch honoured.',
   1, 'No backtest run. This strategy exists to prove the pipeline, not to be traded.',
   'paper', 0, 'active', unixepoch() * 1000);


-- The chassis answers "what schema is applied" from this table, and /api/health and the
-- policy suite both read it. A migration that runs without recording itself leaves the
-- system reporting a version older than the one it is actually running, so every ported
-- Boss OS migration registers here exactly as the chassis's own do.
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0155_boss_seed_phase1_5');
