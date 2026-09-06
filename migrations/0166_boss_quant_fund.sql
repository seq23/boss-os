-- Boss OS v20 — Phase 22: the AI Quant Fund, Parts B–G.
--
-- Authority: `Boss_OS_AI_Quant_Fund_Master_Plan_v5.md` governs this phase. That
-- document is not in the authority set available to this build, so what is
-- implemented here follows the locked decision that derives from it — build
-- plan §1.7 D6 — together with the architecture notes' record of the ladder,
-- the envelope, the 90-day sequence and the risk constitution. Where the master
-- plan's own detail would be required, this build records the gap rather than
-- inventing the detail.
--
-- The governing sentence, kept verbatim because it decides every hard case:
--   "AI does the work. Risk engine checks the work. Sequoia approves the
--    authority envelope. The system operates inside the envelope. Anything
--    outside the envelope escalates."
--
-- Boss OS governs; it does not execute. Nothing in this migration holds a
-- credential, and nothing here can move money.

-- ─── trading_engines ───────────────────────────────────────────────────────────
-- The always-on machine that would run the bot. A row here is a record of
-- intent and, later, of connection — never a provisioning action.
CREATE TABLE trading_engines (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  host_kind         TEXT NOT NULL,          -- hetzner_cx22|other
  region            TEXT,
  environment       TEXT NOT NULL DEFAULT 'demo', -- demo|live
  venue             TEXT NOT NULL,
  control_url       TEXT,                   -- where a stop command is sent
  status            TEXT NOT NULL DEFAULT 'planned', -- planned|provisioned|connected|unreachable
  fingerprint       TEXT,
  last_heartbeat_at INTEGER,
  notes             TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

-- ─── kill_switch_probes ────────────────────────────────────────────────────────
-- §1.7: "A kill switch that only sets a local flag is not a kill switch."
-- Every probe records whether the engine acknowledged, and an unacknowledged
-- probe is a failure, not a silence.
CREATE TABLE kill_switch_probes (
  id                TEXT PRIMARY KEY,
  engine_id         TEXT NOT NULL REFERENCES trading_engines(id) ON DELETE CASCADE,
  ts                INTEGER NOT NULL,
  kind              TEXT NOT NULL DEFAULT 'reach', -- reach|stop
  sent_at           INTEGER NOT NULL,
  acknowledged_at   INTEGER,
  ack_reference     TEXT,
  latency_ms        INTEGER,
  outcome           TEXT NOT NULL,          -- acknowledged|no_ack|error|not_configured
  detail            TEXT,
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_probes_engine ON kill_switch_probes(engine_id, ts DESC);

-- ─── deployment_stages ─────────────────────────────────────────────────────────
-- The Capital Deployment Ladder. No skipping, and each stage carries its own
-- capital limit, pass and fail criteria, required logs and review.
CREATE TABLE deployment_stages (
  id                        TEXT PRIMARY KEY,
  stage_no                  INTEGER NOT NULL UNIQUE,
  key                       TEXT NOT NULL UNIQUE,
  name                      TEXT NOT NULL,
  capital_limit_micros      INTEGER NOT NULL DEFAULT 0,
  duration_days             INTEGER,
  pass_criteria             TEXT NOT NULL,  -- json
  fail_criteria             TEXT NOT NULL,  -- json
  required_logs             TEXT NOT NULL,  -- json
  required_review           TEXT NOT NULL,
  advance_requires_approval INTEGER NOT NULL DEFAULT 1,
  created_at                INTEGER NOT NULL
);

-- ─── strategy_desks ────────────────────────────────────────────────────────────
CREATE TABLE strategy_desks (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  mandate       TEXT NOT NULL,
  bot           TEXT NOT NULL,              -- hummingbot|artemis|none
  venue         TEXT NOT NULL,
  symbols       TEXT NOT NULL,              -- json
  owner_role    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  notes         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- ─── promotion_scorecards ──────────────────────────────────────────────────────
-- A strategy advances a stage only against a scored card with evidence.
CREATE TABLE promotion_scorecards (
  id            TEXT PRIMARY KEY,
  strategy_id   TEXT NOT NULL REFERENCES trading_strategies(id) ON DELETE CASCADE,
  desk_id       TEXT REFERENCES strategy_desks(id),
  ts            INTEGER NOT NULL,
  stage_from    TEXT NOT NULL,
  stage_to      TEXT NOT NULL,
  criteria      TEXT NOT NULL,              -- json: [{key, requirement, observed, met}]
  score         INTEGER NOT NULL DEFAULT 0,
  max_score     INTEGER NOT NULL DEFAULT 0,
  verdict       TEXT NOT NULL,              -- pass|fail
  evidence      TEXT NOT NULL,              -- json
  approval_id   TEXT REFERENCES approvals(id),
  status        TEXT NOT NULL DEFAULT 'proposed', -- proposed|approved|rejected|applied
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_scorecards_strategy ON promotion_scorecards(strategy_id, ts DESC);

-- ─── scale_rungs ───────────────────────────────────────────────────────────────
-- The ladder of capital. No autonomous capital increase: every rung is an
-- approval, and the target deployment rule is a rung like any other.
CREATE TABLE scale_rungs (
  id                TEXT PRIMARY KEY,
  rung_no           INTEGER NOT NULL UNIQUE,
  label             TEXT NOT NULL,
  capital_micros    INTEGER NOT NULL,
  requirements      TEXT NOT NULL,          -- json
  requires_approval INTEGER NOT NULL DEFAULT 1,
  reached_at        INTEGER,
  approval_id       TEXT REFERENCES approvals(id),
  created_at        INTEGER NOT NULL
);

-- ─── trading_sequence ──────────────────────────────────────────────────────────
-- The 90-day sequence, week by week, with the artifact, the gate and the
-- failure rule. The failure rule is the same everywhere: do not skip forward,
-- repair the failed gate.
CREATE TABLE trading_sequence (
  id            TEXT PRIMARY KEY,
  week_no       INTEGER NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  artifact      TEXT NOT NULL,
  gate          TEXT NOT NULL,
  failure_rule  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'not_started', -- not_started|in_progress|complete|blocked
  completed_at  INTEGER,
  note          TEXT,
  created_at    INTEGER NOT NULL
);

-- ─── trading_nevers ────────────────────────────────────────────────────────────
-- The Risk Constitution. Each never records what actually enforces it in this
-- build — code, or a procedure with nobody but the Boss behind it. Marking a
-- procedural rule as enforced would be the most dangerous lie in the system.
CREATE TABLE trading_nevers (
  id            TEXT PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  text          TEXT NOT NULL,
  enforced_by   TEXT NOT NULL,
  enforcement   TEXT NOT NULL,              -- code|procedural
  evidence      TEXT,
  created_at    INTEGER NOT NULL
);

-- ─── The engine that is planned and not provisioned ────────────────────────────
INSERT INTO trading_engines (id, name, host_kind, region, environment, venue, status, notes, created_at, updated_at) VALUES
  ('eng_primary', 'Quant engine (planned)', 'hetzner_cx22', 'us', 'demo', 'kraken_demo_futures', 'planned',
   'Build plan §1.7: Hetzner CX22 in a US region, Kraken demo futures. Provision nothing until this phase actually begins; this row records the decision, not a machine.',
   unixepoch() * 1000, unixepoch() * 1000);

-- ─── The Capital Deployment Ladder ─────────────────────────────────────────────
INSERT INTO deployment_stages
  (id, stage_no, key, name, capital_limit_micros, duration_days, pass_criteria, fail_criteria, required_logs, required_review, advance_requires_approval, created_at)
VALUES
  ('dst_0', 0, 'research', 'Research', 0, NULL,
   '["A written hypothesis with an edge statement","A named market inefficiency"]',
   '["No testable hypothesis","Edge indistinguishable from fees"]',
   '["Hypothesis document"]', 'Boss reads the hypothesis', 1, unixepoch() * 1000),
  ('dst_1', 1, 'backtest', 'Backtest', 0, 30,
   '["Backtest over a period containing a drawdown","Costs and slippage modelled","Parameters not fitted to the test window"]',
   '["Positive only with zero costs","Curve fitted to one regime"]',
   '["Backtest output","Parameter set","Data window"]', 'Risk officer review', 1, unixepoch() * 1000),
  ('dst_2', 2, 'paper', 'Paper / testnet', 0, 30,
   '["Runs unattended for the full window","Fills reconcile to the ledger","No unhandled error path"]',
   '["Manual intervention required to keep it running","Ledger and fills disagree"]',
   '["Order log","Fill log","Incident log"]', 'Boss reviews the paper ledger', 1, unixepoch() * 1000),
  ('dst_3', 3, 'micro_live', 'Micro-live forward test', 300000000, 14,
   '["All six micro-live gates recorded","Kill switch proven against the running engine","Drawdown inside the envelope"]',
   '["Any gate unmet","Kill switch unproven","Drawdown breach"]',
   '["Order log","Fill log","Incident log","Kill switch probe"]', 'Boss approves the envelope', 1, unixepoch() * 1000),
  ('dst_4', 4, 'breakeven', 'Breakeven capital test', 1000000000, 30,
   '["Covers its own costs over the window","No incident above low severity"]',
   '["Costs exceed returns with no explanation","Repeated incidents"]',
   '["P&L reconciliation","Cost ledger"]', 'Boss reviews the reconciliation', 1, unixepoch() * 1000),
  ('dst_5', 5, 'target', 'Target deployment', 0, NULL,
   '["Two consecutive stages passed without repair","Tax and ledger workflow in place"]',
   '["Any stage repeated","Ledger workflow missing"]',
   '["Full ledger","Tax workflow evidence"]', 'Boss approves the target rule', 1, unixepoch() * 1000),
  ('dst_6', 6, 'scale', 'Scale / multi-venue', 0, NULL,
   '["Every rung below reached and reviewed","Venue redundancy proven"]',
   '["Single venue dependency","Unreviewed rung"]',
   '["Per-venue logs","Incident drills"]', 'Boss approves each rung', 1, unixepoch() * 1000);

-- ─── The scale ladder ──────────────────────────────────────────────────────────
INSERT INTO scale_rungs (id, rung_no, label, capital_micros, requirements, created_at) VALUES
  ('rng_1', 1, 'Micro-live forward test ($300)', 300000000,
   '["Stage 3 passed","Kill switch proven against the running engine","Envelope approved for 14 days"]', unixepoch() * 1000),
  ('rng_2', 2, 'Second forward test ($500–1,000)', 1000000000,
   '["Rung 1 completed without a drawdown breach","Incident drill run","Envelope renewed"]', unixepoch() * 1000),
  ('rng_3', 3, 'Breakeven capital test', 5000000000,
   '["Stage 4 passed","Costs covered over a full window"]', unixepoch() * 1000),
  ('rng_4', 4, 'Target deployment', 25000000000,
   '["Stage 5 passed","Tax and ledger workflow in place","Boss approves the target rule"]', unixepoch() * 1000);

-- ─── The 90-day sequence ───────────────────────────────────────────────────────
INSERT INTO trading_sequence (id, week_no, title, artifact, gate, failure_rule, created_at) VALUES
  ('tsq_1', 1, 'Command centre and security', 'Key custody rules, no-withdrawal API policy, access list',
   'No credential exists in the Worker or in D1', 'Do not skip forward; repair the failed gate.', unixepoch() * 1000),
  ('tsq_2', 2, 'Cloud server', 'Provisioned host, hardened, access logged',
   'The engine is reachable and its fingerprint is recorded', 'Do not skip forward; repair the failed gate.', unixepoch() * 1000),
  ('tsq_3', 3, 'Bot on testnet', 'Hummingbot connected to Kraken demo futures',
   'A demo order round-trips and reconciles', 'Do not skip forward; repair the failed gate.', unixepoch() * 1000),
  ('tsq_4', 4, 'Strategy hypotheses', 'Twenty-five written hypotheses with edge statements',
   'Each has a testable edge and a failure condition', 'Do not skip forward; repair the failed gate.', unixepoch() * 1000),
  ('tsq_5', 5, 'Backtest harness', 'Reproducible harness with costs and slippage',
   'A known-bad strategy fails the harness', 'Do not skip forward; repair the failed gate.', unixepoch() * 1000),
  ('tsq_6', 6, 'Paper portfolio alpha', 'Paper run, unattended, reconciled',
   'Fills reconcile to the ledger for the whole window', 'Do not skip forward; repair the failed gate.', unixepoch() * 1000),
  ('tsq_7', 7, 'Paper portfolio beta', 'Second paper run under different conditions',
   'Both portfolios survive the same stress window', 'Do not skip forward; repair the failed gate.', unixepoch() * 1000),
  ('tsq_8', 8, 'Monitoring and incident drills', 'Alerting, incident ledger, rehearsed drill',
   'A drill produces a real incident record and a recovery', 'Do not skip forward; repair the failed gate.', unixepoch() * 1000),
  ('tsq_9', 9, 'Micro-live readiness gate', 'All six micro-live gates recorded, kill switch proven',
   'The kill switch is acknowledged by the running engine', 'Do not skip forward; repair the failed gate.', unixepoch() * 1000),
  ('tsq_10', 10, 'Forward test at $250–300', 'Live micro capital under an approved envelope',
   'Drawdown stays inside the envelope for the full term', 'Do not skip forward; repair the failed gate.', unixepoch() * 1000),
  ('tsq_11', 11, 'Forward test at $500–1,000', 'Second rung under a renewed envelope',
   'Rung 1 reviewed and approved before rung 2 opens', 'Do not skip forward; repair the failed gate.', unixepoch() * 1000),
  ('tsq_12', 12, 'Decision', 'Written decision with the evidence behind it',
   'Continue, pause or stop — recorded in the decision journal', 'Do not skip forward; repair the failed gate.', unixepoch() * 1000);

-- ─── The Risk Constitution ─────────────────────────────────────────────────────
-- `enforcement` is the honest half of this table: `code` means something in this
-- repository refuses it, `procedural` means only the Boss does.
INSERT INTO trading_nevers (id, key, text, enforced_by, enforcement, evidence, created_at) VALUES
  ('nvr_guarantee', 'no_guaranteed_returns', 'No guaranteed-return language anywhere in code, UI or comments.',
   'A test scans the quant surface for guarantee language and fails on a match.', 'code', 'test/quant.test.ts', unixepoch() * 1000),
  ('nvr_no_backtest', 'no_strategy_without_backtest', 'No strategy without a backtest.',
   'The ladder refuses to advance past stage 1 without a scored card citing the backtest.', 'code', 'src/server/trading/quant.ts', unixepoch() * 1000),
  ('nvr_no_live_without_paper', 'no_live_without_paper', 'No live without paper.',
   'Stage skipping is refused; micro-live requires the paper stage passed.', 'code', 'src/server/trading/quant.ts', unixepoch() * 1000),
  ('nvr_withdrawal', 'no_withdrawal_permission', 'No exchange API withdrawal permission, ever.',
   'Boss OS holds no exchange credential at all; the key lives on the engine.', 'code', 'No credential field exists in this schema.', unixepoch() * 1000),
  ('nvr_autonomous_capital', 'no_autonomous_capital_increase', 'No autonomous capital increase.',
   'Every scale rung requires an approval card before it opens.', 'code', 'src/server/routes/quant.ts', unixepoch() * 1000),
  ('nvr_unmonitored', 'no_bot_without_kill_switch', 'No bot unmonitored without a proven kill switch.',
   'Micro-live readiness is refused until a probe is acknowledged by the engine.', 'code', 'src/server/trading/quant.ts', unixepoch() * 1000),
  ('nvr_versioning', 'no_change_without_versioning', 'No strategy change without versioning.',
   'Scorecards record the stage transition and the evidence behind it.', 'code', 'promotion_scorecards', unixepoch() * 1000),
  ('nvr_emotional', 'no_override_under_stress', 'No discretionary override under emotional stress.',
   'Phase 19 holds trades and envelope changes while a high-risk state is in force.', 'code', 'src/server/governance/gate.ts', unixepoch() * 1000),
  ('nvr_revenge', 'no_revenge_trading', 'No revenge trading.',
   'Nothing in code can detect intent. The Boss holds this one.', 'procedural', NULL, unixepoch() * 1000),
  ('nvr_tax', 'no_live_without_tax_workflow', 'No live system without a tax and ledger workflow.',
   'Stage 5 lists it as a pass criterion; the workflow itself is outside this repository.', 'procedural', NULL, unixepoch() * 1000);


-- The chassis answers "what schema is applied" from this table, and /api/health and the
-- policy suite both read it. A migration that runs without recording itself leaves the
-- system reporting a version older than the one it is actually running, so every ported
-- Boss OS migration registers here exactly as the chassis's own do.
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0166_boss_quant_fund');
