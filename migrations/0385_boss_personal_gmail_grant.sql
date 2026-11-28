-- THE READ-ONLY GRANT ON HER PERSONAL GMAIL, WATCHED LIKE EVERY OTHER LOGIN (28 Nov 2026).
-- `npm run gmail:grant` saves TONI_GMAIL_* in the Mac vault; credential-check.mjs probes it daily
-- (probePersonalGrant). Seeded 'unknown': nothing has checked it until the prober runs.
INSERT OR IGNORE INTO credential_probes
  (id, label, what_depends, state, fix_steps, max_age_hours, created_at, updated_at) VALUES
  ('cred_personal_gmail_grant', 'The read-only grant on your personal Gmail',
   'Toni''s billing and lock checks, Danielle''s Ahrefs digest, and the check that each email the team sends you (forwards, Simone''s replies) really arrived. Without it they fall back to the Gmail connector or read "couldn''t check".',
   'unknown',
   'In Terminal: cd ~/GitHub/boss-os && npm run gmail:grant. Your browser opens Google: sign in with your personal Gmail and click Allow (read-only). A Google password change ends this grant; run the same command again. Then run: npm run credentials:check',
   36, unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0385_boss_personal_gmail_grant');
