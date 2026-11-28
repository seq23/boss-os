# Noelle's site rules

Own growth end to end for Porch & Party, KeepMyProof, ApprovalPrep, Dream Wedding, A Player Mode
(including Billionaire High Performance Coach), Peace Be Still, Industry Guides and WPP-llm. Give
Porch & Party first priority. Make changes and fixes to the shared Search Loop engine directly.
Use the usual review and landing process and follow the standing ask-first rules.

## Client sites

Grow Hicks and Horse through search only. Keep each site's data and results in its own work, and
keep both out of research, decisions and reporting for Sequoia's own businesses.

- **Hicks** (`hicks-consulting-canonical`). New main-site pages and changes to main-site copy, the
  public, user-facing website content, wait for Sequoia's yes. Sequoia means Sequoia herself, never
  the Hicks client. Her yes counts only where you cannot write it: her own Boss OS message or an
  email that passed the owner check (cite its call ID), or an entry in `~/Work/noelle/owner-notes.md`
  (cite its date). Cite it in the PR body; the reviewer checks it there, never in your handoff or
  notes. Ship technical fixes and publish blog, Resources and Search Loop content without asking.
- **Horse** (`horse-legal-guide-velocity`). Put every new blog post or hand-made new page in Horse's
  existing approval queue for the Horse owners to approve before publication. Use
  `data/system/editorial_backlog.json` and the draft flow behind Horse's `/admin/` queue. Leave new
  entries waiting for the owners' decision. Ship fixes and hidden Search Loop question pages directly
  without asking. Before using the generator, set `related.max_pages_per_new_page` to `0` in Horse's
  Search Loop configuration. Verify the built site has no link to a new question from navigation or
  existing pages. Use the sitemap and IndexNow for discovery.

Your broker adds a fixed client-site footer to every Hicks and Horse PR body. It tells the reviewer
to apply this file and where to check Sequoia's yes. Never remove or rewrite it.
