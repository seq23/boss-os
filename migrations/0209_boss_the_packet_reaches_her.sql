-- The packet was written every Wednesday and reached her exactly never.
--
-- ─── Her words ─────────────────────────────────────────────────────────────
--
--   "i also noticed i did not see anything in the meetings section of my today screen and today is
--    wednesday and there is always the meeting with scooter. also there is no packet to prepare me
--    for the meeting with scooter (even if its empty this time) it needs to show what ive
--    accomplished in the week prior"
--
--   "it should be in my inbox and my screen should either mirror it or say to check inbox"
--
-- ─── Three separate defects, and the third is the one that matters ─────────
--
-- 1. THE PACKET WAS PRODUCED AND CONSUMED BY NOTHING. `com.seq.boss-packet` fired correctly at
--    07:01 on 9 September and wrote a good document to `~/.boss-os/packets/`. `routes/today.ts`
--    computed the same packet and put it in the Meetings block. AND THE CLIENT NEVER RENDERED IT:
--    `Today.tsx` read `c.meetings`, `c.held_not_captured` and `c.touches_due`, and returned null
--    when all three were empty — which they always are, because there is no meetings row for a
--    standing partner meeting. A correct thing produced and nothing consuming it, on the one
--    morning of the week it mattered.
--
-- 2. THE ONLY RECURRING MEETING SHE HAS WAS NOT IN THE SYSTEM. Rather than invent calendar rows for
--    a fixture that never changes, the packet block itself now says it: Wednesday, Scooter, and
--    what she is walking in with. A section that is blank on the day the meeting happens actively
--    tells her there is nothing on.
--
-- 3. IT PREPARED HIM AND NOT HER. Every line was outward-facing. She asked for the other half —
--    what she got done — and told us in advance that a truthful empty answer is fine: "even if its
--    empty this time". That removes the only reason it would ever be padded.
--
-- ─── Where it is delivered, and why that shape ─────────────────────────────
--
-- TODAY MIRRORS IT AND THE INBOX HOLDS THE DECISION. Both, not one: the substance is short and
-- computable in the Worker, so making her click through to read it would be a worse screen; but
-- "did you raise these with him" is a real answer that changes what happens next, so it is a
-- judgement call with a resume behind it. Approving records that the items were raised, which is
-- what turns "ask him for the grant" from an item that appears identically for three weeks into one
-- that says "raised 9 Sep, not yet granted".

-- ─── The grant only Scooter can give ────────────────────────────────────────
--
-- CORRECTED HERE, TWICE, AND BOTH CORRECTIONS MATTER.
--
-- FIRST: SHE CANNOT DO THIS. "scooter has to grant permission in west peek so i need to be reminded
-- and given steps to give him at the meeting today". Domain-wide delegation is per-tenant, so her
-- spry.vc admin session does not cover westpeek.ventures and no amount of clicking on her side will
-- produce it. The item is therefore not a task; it is something she CARRIES INTO the meeting, in a
-- form she can read aloud or forward.
--
-- SECOND: THE CLAIM WAS OVERSTATED, AND IT WAS ALSO THE WRONG CLAIM. The old wording said opt-out
-- requests "land in that mailbox" and called it a live compliance defect on Boss OS. Two things
-- wrong with that. Nobody knows whether any opt-out has arrived — that is exactly what cannot be
-- known while the mailbox is unreadable, so it is SUSPECTED and unfalsifiable, and her rule is that
-- only CONFIRMED findings get acted on. And nothing in Boss OS sends to LPs at all: the 248 emails
-- are Twin's, and `lp-tracker-sync.mjs` only copies outreach rows from the sheet Twin writes into
-- the one her partner reads. Presenting it as Boss OS's compliance exposure was simply false.
--
-- The real value of the grant is larger than the slice that was led with. NOTHING CAN READ THAT
-- MAILBOX AT ALL. Interest, questions, requests for the deck and requests to be removed are equally
-- invisible, and during a raise an unread reply is a lost LP. That is the sentence, and it is
-- CONFIRMED without needing anything added to it.
UPDATE meeting_agenda_items
   SET title = 'Ask Scooter for the Google grant on the West Peek sending address',
       detail = 'HE HAS TO DO THIS, NOT YOU — delegation is per-domain and your spry.vc admin does not reach westpeek.ventures. Steps to hand him: (1) sign in to admin.google.com AS AN ADMIN OF westpeek.ventures, which is the step people get wrong; (2) Security, Access and data control, API controls, Domain-wide delegation, Manage Domain Wide Delegation, Add new; (3) Client ID 109529914046573753934; (4) Scope https://www.googleapis.com/auth/gmail.readonly; (5) Authorize. WHAT IT DOES, for him: it lets our tooling READ replies to that mailbox. Read-only, that one scope, that one address. WHY IT MATTERS, stated exactly: 248 emails have gone out from that address since 19 August and nothing can read what comes back — interest, questions, requests for the deck, requests to be removed, all of it invisible. During a raise, not seeing replies IS the loss. Confirmed: the replies cannot be read. Not claimed: that any particular reply is sitting there unanswered, which is unknowable until this is granted. The sending is Twin''s, not Boss OS''s. Boss OS tests the grant itself every morning and this item disappears on its own the day he does it.',
       updated_at = unixepoch() * 1000
 WHERE id = 'mai_wp_gmail_grant';

-- ─── The probe that lets the item clear itself ──────────────────────────────
--
-- AN ITEM SHE HAS TO TICK OFF BY HAND WILL SIT THERE WRONGLY FOR EVER, and one that never re-tests
-- will keep nagging after it has been fixed. Both are worse than useless, and this item has already
-- demonstrated the first: it has been on the packet every week since 19 August, unchanged, which is
-- precisely how three weeks passed without anyone noticing.
--
-- So the fourth probe attempts the impersonation the grant would authorise. It fails with
-- `unauthorized_client` today; the morning after Scooter authorises it, it succeeds, the agenda item
-- closes itself, and the alert stops. Nobody marks anything done.
INSERT OR IGNORE INTO credential_probes
  (id, label, what_depends, state, fix_steps, max_age_hours, created_at, updated_at) VALUES
  ('cred_westpeek_delegation', 'The Google grant on the West Peek sending address',
   'Reading any reply to West Peek LP outreach. 248 emails have gone out from that address since 19 August and nothing can read what comes back — interest, questions, requests for the deck, requests to be removed, all equally invisible. During a raise, not seeing replies is the loss. Confirmed: the replies are unreadable. Not claimed: that any particular reply is waiting.',
   'unknown',
   'SCOOTER has to do this — delegation is per-domain and your spry.vc admin does not reach westpeek.ventures. Hand him: sign in to admin.google.com as an admin of westpeek.ventures; Security, Access and data control, API controls, Domain-wide delegation, Manage Domain Wide Delegation, Add new; Client ID 109529914046573753934; Scope https://www.googleapis.com/auth/gmail.readonly; Authorize. It is on the Wednesday packet, and this clears itself the morning after he does it.',
   36, unixepoch() * 1000, unixepoch() * 1000);

-- ─── Toni owns the exposure, not the task ───────────────────────────────────
--
-- Chief Risk Officer, and this is risk work in the ordinary sense: an outbound list of 248 with no
-- readable return path. The deliverable is NOT "ask Scooter" — asking him is not the outcome and
-- three weeks of asking proved it. The terminal condition is the impersonation actually succeeding,
-- counted by the probe, so handing him the steps does not close it and him granting it does.
--
-- Column order puts every quoted value first: `scripts/validate/owned-deliverables.mjs` maps columns
-- onto string literals positionally, and a NULL in the middle shifts every following field.
INSERT OR IGNORE INTO owned_deliverables
  (id, name, employee_id, lane, terminal_condition, terminal_check, state,
   escalation_path, blocker, current_status, current_status_kind,
   duty_id, current_status_at, blocked_since, last_activity_at, stall_after_days,
   created_at, updated_at)
VALUES
  ('del_westpeek_reply_path', 'West Peek LP replies can be read', 'emp_risk', 'ops',
   'The service account can impersonate the West Peek sending address with a read-only Gmail scope. Proven by the credential prober actually authenticating as it, not by anyone reporting that the grant was added.',
   'westpeek_replies_readable', 'blocked',
   'Named on Today under Critical Alerts, and carried on the Wednesday packet with the exact steps to hand Scooter, until the prober can authenticate as that address or she kills it with a reason.',
   'Domain-wide delegation has never been granted on westpeek.ventures, so nothing can read replies to LP outreach from that address. 248 emails have been sent since 19 August — by Twin, not by Boss OS. During a raise, an unread reply is a lost LP. Only an admin of that domain can grant it, which is Scooter and not her, so nothing on her side can close it.',
   'On the Wednesday packet with the steps to hand him. Approving the packet in your Inbox records the date it was raised, so this stops looking identical every week and starts saying how long he has had it.',
   'determined',
   NULL, unixepoch() * 1000, 1786752000000, unixepoch() * 1000, 14,
   unixepoch() * 1000, unixepoch() * 1000);

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0209_boss_the_packet_reaches_her');
