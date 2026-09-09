-- The forwarding failover is dropped. She said no, and she is right.
--
-- ─── Her words ─────────────────────────────────────────────────────────────
--
--   "im not forwarding emails that is fucking stupid."
--
-- ─── What was proposed, and why it does not survive her objection ──────────
--
-- 0207 chose a Gmail filter forwarding Amazon mail from her personal inbox to the Workspace one, so
-- the service account could read the KDP correspondence when the claude.ai connector died. The
-- reasoning was sound as far as it went — it survives a password change, it grants access to Amazon
-- mail and nothing else, and it needs nothing from anyone but her. It is still a permanent piece of
-- mail plumbing added to route around a temporary problem, and she owns the mailbox.
--
-- ─── The honest position, which is smaller than the one it replaces ────────
--
-- THERE IS NO CLEVERER CREDENTIAL. Nothing that reaches a consumer Gmail account survives a password
-- change: not OAuth, not an app password, not IMAP. Google revokes all of them on the same event.
-- Every route considered this morning either fails for that reason or is a piece of plumbing she
-- does not want.
--
-- SO THE REAL FIX WAS NEVER A SECOND CREDENTIAL — IT WAS MAKING THE BREAKAGE VISIBLE, and that is
-- built and running. The connector died silently before 7 September and was found by a human running
-- a script by hand. It cannot do that again: the prober uses it every morning, a dead one is a
-- critical alert on Today with the reconnect steps, and every named stop in the watcher now files a
-- determination before it exits. The failure is now loud and two minutes from fixed, which is a
-- better outcome than a permanent forward that makes it invisible in a different way.
--
-- ─── And the durable answer, recorded so it is not rediscovered ────────────
--
-- Move the KDP account's contact address onto a Workspace domain — ONCE THE SEVEN BOOKS ARE LIVE and
-- the account is no longer mid-investigation. Doing it now would change the contact address of an
-- account under active support review for an account-level publishing block, which is the worst
-- possible moment to touch it, and would strand the existing case history in the old mailbox. It is
-- written into the kill reason rather than raised as a deliverable, because a commitment that cannot
-- be started for weeks would escalate every day for weeks about something nobody should act on yet.

-- ─── Killed, with her reason, which is the only way out that is not completion ─
--
-- The register keeps killed rows and their reasons exactly as it keeps merged employees. There is no
-- code path by which an employee, a run or a validator can kill one — only the owner, and this is
-- the owner, in her own words.
UPDATE owned_deliverables
   SET state = 'killed',
       killed_at = unixepoch() * 1000,
       killed_reason = 'She said no: "im not forwarding emails that is fucking stupid." Nothing that reaches a consumer Gmail survives a password change — not OAuth, not an app password, not IMAP — so there was no better credential to reach for and the forward was plumbing added to route around a temporary problem. The real fix was making the breakage visible, and the credential prober does that: a dead connector is a critical alert on Today with the reconnect steps, every morning, instead of days of silence. The durable answer is moving the KDP account contact address onto a Workspace domain once the seven books are Live and the account is out of support review.',
       current_status = 'Stopped by you on 9 September. The connector stays the only path to that mailbox, and it is now watched daily rather than trusted.',
       current_status_at = unixepoch() * 1000,
       current_status_kind = 'determined',
       updated_at = unixepoch() * 1000
 WHERE id = 'del_kdp_mail_failover' AND state != 'done';

-- ─── The probe goes with it ─────────────────────────────────────────────────
--
-- It tested whether Amazon mail was readable in the Workspace mailbox, which was only ever a
-- question about the forward. Left in place it would report `dead` every morning for ever about a
-- thing nobody intends to do — and an alert nobody can act on is how a screen teaches its reader to
-- scroll past alerts.
DELETE FROM credential_probes WHERE id = 'cred_kdp_mail_via_workspace';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0214_boss_no_forwarding_the_breakage_is_the_fix');
