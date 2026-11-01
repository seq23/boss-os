-- THE RISK BRAIN (owner, 1 Nov 2026: "don''t get sued"). Additive: one new plain-document row.
-- Numbered rules R-AREA-NN that keep every site and project she touches out of legal trouble; each
-- says where it is enforced (a file or validator) or that it is judgment. No confidential data, so
-- any model may read it. The repo is public: the row is the bare seed (validate:brains checks it is
-- exactly seedFor(slug, title)); the rules are written in Boss OS after deploy, never here.
INSERT OR IGNORE INTO brains (slug, title, body_md, updated_at, updated_by) VALUES
  ('risk', 'Risk — don''t get sued', '# Risk — don''t get sued

Write the risk rules here in Boss OS: one numbered rule per line (R-AREA-NN), why, where it applies, and where it is enforced or "judgment". No confidential data.
', CAST(unixepoch() AS INTEGER) * 1000, 'seed');

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0329_boss_risk_brain');
