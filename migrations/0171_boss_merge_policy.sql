-- Batch 6 of Boss OS v20.1 — how each entity is allowed to merge.
--
-- A SINGLE VERSION CHECK IS NOT A MERGE POLICY. Version-conflict is right for a mutable record a
-- person edits, and wrong for almost everything else: an append-only event log has no conflicts to
-- have, immutable evidence must never be overwritten by a later copy of itself, a capital
-- allocation must never be resolved by a rule rather than a human, and a derived cache should be
-- regenerated rather than reconciled at all.
--
-- So the merge class lives beside residency, in the same registry, because it is the same kind of
-- fact about the same entity and splitting them would create two lists that must agree.
--
--   APPEND_ONLY      Rows are only ever added. Two devices adding different rows is not a
--                    disagreement, so a version mismatch merges rather than conflicts.
--   IMMUTABLE        Written once. A second write with different content is a conflict and BOTH
--                    are kept; an identical rewrite is a no-op rather than a new version.
--   VERSIONED        The ordinary case: edit from the version you read, or explain yourself.
--   NEVER_AUTOMATIC  Decisions, capital, governance, trading authority, the emotional-state gate.
--                    A machine may never pick a winner here, however confident the rule looks.
--   REGENERATE       Derived or machine-local. Not reconciled - rebuilt.
--
-- Every one of these was assigned deliberately; the default for anything unlisted is VERSIONED,
-- which conflicts rather than guesses.

ALTER TABLE data_policy ADD COLUMN merge_policy TEXT NOT NULL DEFAULT 'VERSIONED'
  CHECK (merge_policy IN ('APPEND_ONLY','IMMUTABLE','VERSIONED','NEVER_AUTOMATIC','REGENERATE'));

UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'policy_change_log';
UPDATE data_policy SET merge_policy = 'REGENERATE' WHERE entity = 'active_defaults';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'after_action_reviews';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'approval_events';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'approvals';
UPDATE data_policy SET merge_policy = 'REGENERATE' WHERE entity = 'astro_calendar';
UPDATE data_policy SET merge_policy = 'REGENERATE' WHERE entity = 'astro_days';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'audit_log';
UPDATE data_policy SET merge_policy = 'REGENERATE' WHERE entity = 'boss_task_queue';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'bridge_handoffs';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'calibrations';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'capability_patches';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'capital_allocations';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'compliance_flags';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'cron_runs';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'decision_rights';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'decisions';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'deployment_stages';
UPDATE data_policy SET merge_policy = 'IMMUTABLE' WHERE entity = 'document_artifacts';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'emotional_states';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'entities';
UPDATE data_policy SET merge_policy = 'IMMUTABLE' WHERE entity = 'evidence_packets';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'gate_entries';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'geo_probes';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'kill_switch_probes';
UPDATE data_policy SET merge_policy = 'IMMUTABLE' WHERE entity = 'knowledge_exports';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'knowledge_retirements';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'manifestation_evidence';
UPDATE data_policy SET merge_policy = 'IMMUTABLE' WHERE entity = 'manual_versions';
UPDATE data_policy SET merge_policy = 'IMMUTABLE' WHERE entity = 'meeting_captures';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'permission_envelopes';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'portfolio_vehicles';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'predictions';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'promotion_events';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'promotion_scorecards';
UPDATE data_policy SET merge_policy = 'IMMUTABLE' WHERE entity = 'prompt_packets';
UPDATE data_policy SET merge_policy = 'IMMUTABLE' WHERE entity = 'prompt_scores';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'prompt_traces';
UPDATE data_policy SET merge_policy = 'IMMUTABLE' WHERE entity = 'red_team_reviews';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'ritual_runs';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'routing_decisions';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'scale_rungs';
UPDATE data_policy SET merge_policy = 'IMMUTABLE' WHERE entity = 'seo_audits';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'sovereignty_drills';
UPDATE data_policy SET merge_policy = 'IMMUTABLE' WHERE entity = 'sovereignty_packages';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'strategy_desks';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'system_events';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'task_events';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'trading_accounts';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'trading_authority';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'trading_engines';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'trading_fills';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'trading_incidents';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'trading_nevers';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'trading_orders';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'trading_positions';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'trading_sequence';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'trading_signals';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'trading_strategies';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'usage_ledger';
UPDATE data_policy SET merge_policy = 'IMMUTABLE' WHERE entity = 'vault_restores';
UPDATE data_policy SET merge_policy = 'IMMUTABLE' WHERE entity = 'vault_snapshots';
UPDATE data_policy SET merge_policy = 'NEVER_AUTOMATIC' WHERE entity = 'wealth_tracks';
UPDATE data_policy SET merge_policy = 'REGENERATE' WHERE entity = 'record_version';
UPDATE data_policy SET merge_policy = 'APPEND_ONLY' WHERE entity = 'sync_ledger';
UPDATE data_policy SET merge_policy = 'REGENERATE' WHERE entity = 'sync_cursor';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0171_boss_merge_policy');
