/**
 * The Spry Labs weekly (owner, 1 Nov 2026): ONE email on Wednesday at 08:15 Central with a short section per side business.
 * Each repo below computes its own weekly report on Wednesday morning, sends no email, and uploads spry-weekly-summary.json (schema spry-weekly-summary-v1) as the GitHub Actions artifact named in `artifact`.
 * scripts/ops/spry-weekly.mjs reads the newest one and words it.
 * A business whose summary did not arrive gets a plain line, never silence (rule 0).
 * A source computed earlier in the week than Wednesday says how old it may be (`max_age_hours`; default 36).
 */
export const SPRY_WEEKLY_SOURCES = {
  "artifact": "spry-weekly-summary",
  "schema": "spry-weekly-summary-v1",
  "owner": "seq23",
  "parked_hosts": [
    "heygetonmylevel.com"
  ],
  /*
   * THE SEARCH LOOP LINE (owner, 1 Nov 2026: the search growth loop on every selling site). One plain
   * line per site of hers in a "Search loop" section, from each repo's newest `search-loop-week`
   * artifact (src/shared/boss/searchLoop/week.mjs). heygetonmylevel is in search work since 1 Nov
   * 2026 (its business stays parked, so it stays in parked_hosts for the business summaries).
   * Porch & Party is not a Spry Labs business, so it is not in this email; client sites never are.
   */
  "search_loop": {
    "sites": [
      { "key": "industry-guides", "label": "Industry Guides", "repos": ["local-guides-citation-velocity", "local-guides-generator"], "action_word": "form fills" },
      { "key": "approvalprep", "label": "ApprovalPrep", "repos": ["approvalprep"], "action_word": "sales" },
      { "key": "dream-wedding", "label": "Dream Wedding", "repos": ["dream-wedding-builder"], "action_word": "sales" },
      { "key": "sprylabs-site", "label": "A Player Mode and the Spry HPC sites", "repos": ["sprylabs-hpc-site"], "action_word": "sign-ups" },
      { "key": "time-2-read", "label": "Time-2-Read", "repos": ["dailystory"], "action_word": "free-week starts" },
      { "key": "heygetonmylevel", "label": "heygetonmylevel", "repos": ["heygetonmylevel"], "action_word": "free-week starts" }
    ]
  },
  "sources": [
    {
      "key": "aplayer-mode",
      "label": "A Player Mode",
      "repo": "aplayer-mode",
      "workflow": ".github/workflows/weekly-outcome-report.yml",
      "ready_by_ct": "07:13"
    },
    {
      "key": "creator-network",
      "label": "Creator Network",
      "repo": "creator-network",
      "workflow": ".github/workflows/weekly-owner-report.yml",
      "ready_by_ct": "07:23"
    },
    {
      "key": "citation-velocity",
      "label": "Search across the portfolio",
      "repo": "local-guides-citation-velocity",
      "workflow": ".github/workflows/search-outcomes-weekly.yml",
      "ready_by_ct": "07:03"
    },
    {
      "key": "sprylabs-site",
      "label": "The Spry Labs site",
      "repo": "sprylabs-hpc-site",
      "workflow": ".github/workflows/weekly-outcome-report.yml",
      "ready_by_ct": "07:33"
    },
    {
      "key": "local-guides",
      "label": "Local guides",
      "repo": "local-guides-generator",
      "workflow": ".github/workflows/weekly_outcome_report.yml",
      "ready_by_ct": "07:43"
    },
    {
      "key": "approvalprep",
      "label": "ApprovalPrep",
      "repo": "approvalprep",
      "workflow": ".github/workflows/spry-weekly-summary.yml",
      "ready_by_ct": "07:48"
    },
    {
      "key": "dream-wedding",
      "label": "Dream Wedding",
      "repo": "dream-wedding-builder",
      "workflow": ".github/workflows/spry-weekly-summary.yml",
      "ready_by_ct": "07:53"
    },
    {
      "key": "how-we-know",
      "label": "How We Know",
      "repo": "how-we-know",
      "workflow": ".github/workflows/loop-sun-digest.yml",
      "ready_by_ct": "sun 11:00",
      "max_age_hours": 100
    }
  ]
};
