-- OpenAI first (owner, 24 Oct 2026, in chat with the main session; she is tight on Claude usage).
--
-- 1. The daily briefing walks OpenAI's seat first, Claude's second, and NEVER a paid cloud rung:
--    `cloud_fallback` is false, so when both seats refuse the task stops by name and the morning
--    email says so. The code stamps the same on every fire (briefingLadder.ts, materialise.ts);
--    the row says it too, so `node scripts/ops/briefing-ladder.mjs` reads the truth.
UPDATE standing_duties
   SET task_input = json_set(task_input, '$.backend_ladder', json('["bk_codex","bk_claude_code"]'), '$.cloud_fallback', json('false'))
 WHERE id = 'duty_exec_intel';

-- 2. Her switch, "Use OpenAI first for everything (saves Claude usage)". Seeded OFF so every
--    duty keeps its own order until it is switched on from Settings (she asked for it on, 24 Oct
--    2026; that flip is made through the screen's own route, which writes the audit row).
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('seat_order_openai_first', 'off', 0);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0298_boss_openai_first');
