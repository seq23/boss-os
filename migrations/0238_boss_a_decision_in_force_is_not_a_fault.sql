-- A credential that nothing switched-on needs is not a gap, and the probe row says which backend.
--
-- ─── Her words, 13 September 2026 ───────────────────────────────────────────
--
-- "also fix all critical alerts now and you can mark all as resovled as they are fixed"
--
-- Two of the five, both HIGH and both at the top of her morning:
--
--   "Nothing has ever checked The Anthropic key ... It could be dead right now and the first sign
--    would be a job failing."
--   "Nothing has ever checked The OpenAI key ... It could be dead right now ..."
--
-- ─── Why they are false, measured against production ────────────────────────
--
--   credential_probes  cred_anthropic_key  state 'unknown'  checked_at NULL
--                      cred_openai_key     state 'unknown'  checked_at NULL
--   execution_backends bk_anthropic        status 'registered'  "Awaiting ANTHROPIC_API_KEY ..."
--                      bk_openai           status 'registered'  "Awaiting OPENAI_API_KEY ..."
--                      bk_workers_ai       status 'enabled'
--   settings           coaching_backend = 'bk_workers_ai'
--
-- Neither key is missing by accident. Coaching runs on the free Llama through Workers AI because
-- that is what she chose, and 0211 says so in its own comment. The system was shouting twice, at
-- HIGH, at the top of the screen she reads first, about a decision she made on purpose. An alert
-- that fires because a deliberate choice is in force is noise — and it is the most corrosive kind,
-- because it is indistinguishable from the real thing until you check.
--
-- ─── The fix is a LINK, not a list of two names ─────────────────────────────
--
-- Special-casing the two ids would fix this morning and leave the next deliberately-off backend to
-- make the same noise. `execution_backends.status` already records exactly the fact needed --
-- "registered - known, not usable yet. enabled - may take work. disabled - deliberately off." -- and
-- what was missing is that a probe had no way to point at the backend it exists to unlock.
--
-- So: `credential_probes.backend_id`, and `today/credentials.ts` stays quiet about a never-checked
-- or stale credential whose backend is not enabled. A probe with no backend_id behaves exactly as
-- before, which is every calendar feed, the Gmail connector, the service account and the delegation
-- -- those unlock things that ARE switched on, and they keep their voice.
--
-- A DEAD PROBE STILL SHOUTS EITHER WAY. The gate sits above the never-checked and stale branches
-- only. A credential proven broken by an actual call is evidence about the world, and a disabled
-- backend quietly hiding a revoked token that something else also uses is the failure this register
-- was built after.

ALTER TABLE credential_probes ADD COLUMN backend_id TEXT REFERENCES execution_backends(id);

UPDATE credential_probes SET backend_id = 'bk_anthropic', updated_at = unixepoch() * 1000
 WHERE id = 'cred_anthropic_key';
UPDATE credential_probes SET backend_id = 'bk_openai', updated_at = unixepoch() * 1000
 WHERE id = 'cred_openai_key';

-- ─── Three dismissal rows written while probing production ──────────────────
--
-- Two were written by a diagnostic pass proving the dismiss round-trip works end to end, and they
-- are not about anything: `probe-does-this-endpoint-exist` names no alert at all.
--
-- The third matters more than it looks. It dismissed the Anthropic-key alert with the reason "not a
-- real key gap, backend disabled on purpose" -- correct, and now enforced above rather than
-- snoozed. Left in place it would sit over that probe until it expires, so on the day she DOES
-- enable `bk_anthropic` and the key is genuinely missing, the real alert would be suppressed by a
-- dismissal written about a different situation. A snooze that outlives its reason is a mute.
DELETE FROM alert_dismissals WHERE alert_key = 'probe-does-this-endpoint-exist';
DELETE FROM alert_dismissals WHERE alert_key = 'tasks:del_westpeek_reply_path'
   AND reason LIKE '%verifying the dismiss round-trip%';
DELETE FROM alert_dismissals WHERE alert_key = 'tasks:cred_anthropic_key';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0238_boss_a_decision_in_force_is_not_a_fault');
