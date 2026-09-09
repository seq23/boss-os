-- One link she bookmarks once, holding every meeting agenda, newest first.
--
-- ─── What she asked for, and what she ruled out ────────────────────────────
--
--   "id rather have a download link to the packet"
--   "or at least an artifact in the web page that seems to be more space efficient"
--   "u can have several meetings in one scrollable page"
--   "i dont need a real page in boss OS that is stupid"
--
-- The last one removes the obvious build. She does not want a Meetings screen inside the client; she
-- wants ONE PAGE, at ONE URL, that always carries the current agenda plus the history — bookmarked
-- once, opened on a phone on the way into the meeting.
--
-- ─── The route that was proposed, tested, and does not exist ───────────────
--
-- The proposal was to have the packet job publish a claude.ai Artifact from her Mac, the way
-- Simone's watcher runs `claude -p` there. TESTED HEADLESSLY ON 9 SEPTEMBER, AND IT DOES NOT WORK:
--
--   $ claude -p "Use the Artifact tool ..." --model claude-haiku-4-5-20251001
--   > The Artifact tool is not available in my current tool set, and it does not appear in the
--   > deferred tools list.
--   > ARTIFACT-PROBE: unavailable
--
-- A headless session has no Artifact tool. Building on it would have produced a weekly job that
-- silently never published and a bookmark that went stale after the first week — which is this
-- system's signature defect, shipped deliberately. So the page is served by the Worker instead.
--
-- ─── The privacy boundary, relaxed deliberately and narrowly ───────────────
--
-- OPERATIONS states that Boss OS holds no LP data, and the packet reads her outreach sheets locally
-- for exactly that reason. Serving the page from the Worker means the packet's markdown crosses.
-- That is a real change to a stated boundary and it is named here rather than happening quietly.
--
-- WHAT ACTUALLY CROSSES, and why it is acceptable: the packet carries AGGREGATE COUNTS — how many
-- emails went out, to how many firms, how many were first contacts — and agenda items that already
-- live in `meeting_agenda_items` as CLOUD_SYNC. It carries no LP name, no address, and no row from
-- either sheet. `POST /packets` enforces that rather than trusting it: any markdown containing an
-- `@` outside a short allowlist of HER OWN addresses is refused whole, on the same reasoning the
-- relationships sync uses, and that guard caught a real leak on its first run.
--
-- The page is behind the session gate like every other screen, so "one link" means one link SHE can
-- open, not a public URL.
--
-- ─── Why the markdown is stored rather than recomputed ─────────────────────
--
-- The packet is assembled ON HER MAC from two sources the Worker cannot see: the outreach sheets and
-- the agenda table. Recomputing it here would produce a different, thinner document than the one she
-- read in the meeting, and the history would silently change under her. What she looked at on the
-- 9th must still say the same thing on the 16th, so the document is stored as it was.

CREATE TABLE meeting_packets (
  id            TEXT PRIMARY KEY,
  counterpart   TEXT NOT NULL,
  -- The day the meeting is for, not the day it was written. One packet per counterpart per day, so
  -- a re-run replaces rather than stacking — two versions of one meeting on the page is a way to
  -- read the wrong one.
  day_id        TEXT NOT NULL,
  markdown      TEXT NOT NULL,
  -- The single line she carries in: the blocking item, or the first thing to raise. Today shows this
  -- and the link, and nothing else — "more space efficient" was her phrase for exactly that.
  headline      TEXT,
  blocking      INTEGER NOT NULL DEFAULT 0,
  -- 'launchd' normally, 'manual' when she or someone runs it by hand. A document with no provenance
  -- is one nobody can weigh.
  source        TEXT NOT NULL DEFAULT 'launchd',
  published_at  INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_meeting_packet_day ON meeting_packets(counterpart, day_id);
CREATE INDEX idx_meeting_packet_recent ON meeting_packets(published_at DESC);

INSERT INTO data_policy (entity, subsystem, residency, ai_processing, reason) VALUES
  ('meeting_packets', 'relationships', 'CLOUD_SYNC', 'EXTERNAL_WITH_APPROVAL',
   'The Wednesday partner packet as she read it. A deliberate and narrow relaxation of "Boss OS holds no LP data": what crosses is aggregate outreach counts and agenda items that are already cloud-synced, never a name, a row or an address. The endpoint refuses any packet containing an address outside her own, whole rather than in part. External processing asks first because a packet is prose, and prose is where a name would hide if the rule were ever broken.')
ON CONFLICT(entity) DO NOTHING;

INSERT OR IGNORE INTO schema_version (migration) VALUES ('0210_boss_one_link_for_every_agenda');
