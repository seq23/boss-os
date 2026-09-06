-- Boss OS v20 — Phase 21: the Firm OS bridge and separation.
-- Canon §48, §79.10. Roadmap MF-10, PW-8.
--
-- The firm and the person are separate systems: separate repositories,
-- permissions, memory, budgets, approvals, audit logs and deployment scopes.
-- This phase does not join them. It adds the one narrow, audited crossing
-- between them, and the list of what may never cross is hardcoded in the
-- application rather than stored here — a forbidden list that lives in a table
-- is a forbidden list somebody can edit at 2am.
--
-- What crosses is a *reference* and a summary, never the object itself. The
-- bridge cannot carry a body it never holds.

CREATE TABLE bridge_handoffs (
  id                TEXT PRIMARY KEY,
  direction         TEXT NOT NULL,          -- outbound (Boss → Firm) | inbound (Firm → Boss)
  category          TEXT NOT NULL,
  title             TEXT NOT NULL,
  summary           TEXT NOT NULL,          -- what it is, in words, not the thing itself
  payload_ref       TEXT NOT NULL,          -- a pointer: table:id, or an external reference
  payload_kind      TEXT NOT NULL,          -- memory|document_artifact|external|note
  counterparty      TEXT NOT NULL DEFAULT 'firm',
  status            TEXT NOT NULL DEFAULT 'proposed', -- proposed|approved|rejected|crossed|refused
  refusal_reason    TEXT,
  approval_id       TEXT REFERENCES approvals(id),
  requested_at      INTEGER NOT NULL,
  decided_at        INTEGER,
  crossed_at        INTEGER,
  evidence          TEXT,                   -- json: what was checked before it crossed
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_handoffs_status ON bridge_handoffs(status, requested_at DESC);
CREATE INDEX idx_handoffs_direction ON bridge_handoffs(direction, category);


-- The chassis answers "what schema is applied" from this table, and /api/health and the
-- policy suite both read it. A migration that runs without recording itself leaves the
-- system reporting a version older than the one it is actually running, so every ported
-- Boss OS migration registers here exactly as the chassis's own do.
INSERT OR IGNORE INTO schema_version (migration) VALUES ('0165_boss_firm_bridge');
