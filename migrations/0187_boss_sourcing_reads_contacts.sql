-- The email half of the sourcing mandate, now that it can actually run.
--
-- HER ASK WAS THREE THINGS: search the web for buyers of private tech secondaries; find contacts in
-- her brokerage inbox she has not spoken to in a while; and spot clients who might want to buy
-- something she has recently discussed. 0185 shipped the first and forbade the other two by name,
-- because the inbox was offered and not connected.
--
-- ─── Why it is connected now, and not through Claude ────────────────────────
--
-- Claude's Google connector holds ONE account at a time — connecting a second replaces the first —
-- and hers is her personal Gmail. The published ways around that are to disconnect and reconnect
-- every time, or to pay a third party to hold both. The first is a chore she would stop doing; the
-- second routes her most confidential mail through a vendor.
--
-- The deciding objection is neither of those. A connector would pull live mandates, counterparties
-- and terms INTO A CLOUD CONVERSATION. `scripts/ops/gmail-metadata.mjs` reads the mailbox on her own
-- machine, using a service account she already owns, and writes CONTACTS.json: correspondents and
-- dates. `format=metadata` with an explicit header allowlist means Gmail never returns a subject, a
-- snippet or a body — the privacy claim is what the request asks for, not something applied after.
--
-- ─── The third item still does not run, and says so ─────────────────────────
--
-- "Clients who might want to buy something she has discussed recently" needs subject lines at
-- minimum, which is a materially bigger step than metadata and one she has not agreed to. It stays
-- forbidden by name. Two of three, honestly, beats three of three where one was quietly invented.
--
-- ─── Contacts are read, never written ───────────────────────────────────────
--
-- The run may not add anyone to her network from this file. Who she actually trusts is a judgement
-- only she holds, and a mailbox is full of people who emailed her once. The sweep reports who has
-- gone quiet; promoting any of them stays hers.

UPDATE standing_duties
   SET task_input = json_set(
         COALESCE(task_input, '{}'),
         '$.prompt',
         'Two jobs this morning: find new buyers, and tell her who has gone quiet.' || char(10) || char(10) ||
         '── 1. NEW BUYERS ──' || char(10) || char(10) ||
         'The mandate: institutions that buy private tech secondaries at $5M+ per position, and $20M+ is strongly preferred. Family offices, secondaries funds, crossover funds, sovereign and pension allocators with a direct-secondaries programme. Skip anyone whose stated minimum is below $5M.' || char(10) || char(10) ||
         'Use WebSearch and WebFetch and OPEN the pages you cite. For each candidate you must be able to point at a source that actually says they buy secondaries — a fund page, a mandate, a filing, a named transaction, an interview. A plausible-sounding firm with no source is worse than nothing, because it costs her a phone call to find out.' || char(10) || char(10) ||
         '── 2. WHO HAS GONE QUIET ──' || char(10) || char(10) ||
         'CONTACTS.json in your working directory holds her brokerage correspondents and the dates she last exchanged mail with them — addresses and dates only, no subjects and no message contents. If the file is absent, say so in gaps and skip this half; do not go looking for a mailbox.' || char(10) || char(10) ||
         'Her business runs on referrals, and a referral business decays silently: nobody says they stopped thinking of you, the calls just stop, and it feels like the market. Read `days_since_she_wrote` — the conversations SHE keeps up are the ones that decay. Surface people with real history who have gone quiet, and prefer a long relationship gone cold over someone who mailed twice last year.' || char(10) || char(10) ||
         'Report them in `dormant`, sorted by how much is at stake rather than by how long it has been. DO NOT infer what any relationship was about; you have dates and addresses, nothing more. Say what the record shows and stop.' || char(10) || char(10) ||
         '── WHAT YOU MAY NOT DO ──' || char(10) || char(10) ||
         'Do not read any mailbox yourself. Do not add anyone to her network — who she actually trusts is her judgement, and an inbox is full of people who emailed once.' || char(10) ||
         'She also asked for a third thing: spotting clients who might want to buy something she has recently discussed. That needs the contents of her mail, which you do not have and must not seek. Record it in gaps as not run.' || char(10) || char(10) ||
         '── OUTPUT ──' || char(10) || char(10) ||
         'WRITE delivers.json AFTER EVERY CANDIDATE YOU VERIFY — not at the end. Rewrite the whole file each time with everything you have so far. You are on a hard timeout and will be killed without warning; whatever is in the file is what she gets. A run that verified nine names and wrote nothing delivered nothing. Do not batch the write.' || char(10) || char(10) ||
         'delivers.json is a single JSON object:' || char(10) ||
         '  candidates  [{ name, kind, ticket_floor_usd, thesis, source_url, source_name, read_at }]' || char(10) ||
         '              thesis is one sentence on why they plausibly buy what she sells. read_at is an ISO timestamp of when YOU opened the source.' || char(10) ||
         '  dormant     [{ email, name, days_since_last, days_since_she_wrote, exchanges, why_it_matters }]' || char(10) ||
         '              why_it_matters cites only what the record shows — volume and dates.' || char(10) ||
         '  gaps        [{ wanted, why }] — anything you could not verify or could not do. Never drop something silently.' || char(10) ||
         '  notes       Anything she should know about how it went.' || char(10) || char(10) ||
         'Ten well-sourced names beat fifty guesses. If you can only verify three, deliver three and say so in gaps.'
       )
 WHERE id = 'duty_brokerage_sourcing';

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0187_boss_sourcing_reads_contacts');
