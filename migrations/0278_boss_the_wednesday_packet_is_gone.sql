-- 0278 — The Wednesday meeting-prep packet is removed; the West Peek reply-path item stops pointing at it.
--
-- THE OWNER, 30 Sep 2026: "take away the wednesday meeting prep packet — it was a stupid ask."
--
-- Migration 0209 gave `del_westpeek_reply_path` an escalation path and a status line that say the item is
-- "carried on the Wednesday packet" and that approving the packet in the Inbox records the date it was
-- raised. There is no packet now. The item itself — domain-wide delegation that only Scooter can grant —
-- is unchanged and still blocked; only the sentences that name a thing that no longer exists are
-- replaced. The `meeting_packets` table is deliberately kept: past packets stay on record.

UPDATE owned_deliverables SET
  escalation_path = 'Named on Today under Critical Alerts until the prober can authenticate as that address or she kills it with a reason. Only an admin of westpeek.ventures (Scooter) can grant it.',
  current_status  = 'Blocked on Scooter granting domain-wide delegation on westpeek.ventures. Shown under Critical Alerts on Today.'
WHERE id = 'del_westpeek_reply_path';

-- A packet decision still waiting in the Inbox can no longer be acted on (its resume kind,
-- `meeting_packet_raised`, is gone), so it is retired rather than left to fail when she presses it.
-- BOTH ROWS MOVE TOGETHER. The docket (`approvals`) is expired, and the judgement call that owns it is
-- marked `superseded` — left `awaiting`, Today's deliverable alerts would keep raising a "nothing left
-- to click" alert about a docket that can never be decided. The docket is found through the judgement
-- call's own `approval_id` and, for any docket raised some other way, through its payload.
UPDATE approvals SET status = 'expired', decided_at = unixepoch() * 1000,
  decision_note = 'The Wednesday packet was removed at the owner''s instruction (30 Sep 2026).'
WHERE status = 'pending'
  AND (id IN (SELECT approval_id FROM judgement_calls WHERE resume_kind = 'meeting_packet_raised' AND state = 'awaiting')
       OR payload LIKE '%meeting_packet_raised%');

UPDATE judgement_calls SET state = 'superseded', updated_at = unixepoch() * 1000
WHERE resume_kind = 'meeting_packet_raised' AND state = 'awaiting';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0278_boss_the_wednesday_packet_is_gone');
