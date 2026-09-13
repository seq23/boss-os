/**
 * THE GRID — the repos she cares about for making money, as data, in one place.
 *
 * ─── Her words ──────────────────────────────────────────────────────────────
 *
 *   "the system should know all of my side hustles......all of the repos that i care about for
 *    making money. the grid repos are my side hustles"
 *
 * ─── "The grid" is a DEFINED TERM, not a description ───────────────────────
 *
 * Agreed 29 August 2026. It means ONE EXACT SET — the properties in her Phase 6 Readiness grid —
 * and it is KEYED BY CANONICAL DOMAIN, not by repo name, which is why a directory listing does not
 * reproduce it. When she says "the grid", "the repos I care about", "my repos", "the portfolio" or
 * "portfolio-wide", she means this table and nothing else. It is never re-derived from `ls ~/GitHub`
 * and she is never asked which repos she meant.
 *
 * ─── What was here before, and why it was wrong ────────────────────────────
 *
 * `today/projects.ts` carried five `lane: "spry"` entries — Industry Guides, SaaS apps, Digital
 * products, How We Know, Authority backlink network — with NO REPO FIELD AND NO DOMAINS. An earlier
 * run read that and concluded she had "4 side hustles". `spry-heartbeat.mjs` kept a SECOND list,
 * eight repos, assembled from `gh repo list` — which included `heygetonmylevel` and `how-we-know`
 * and omitted `WPP-llm`, both client repos and `p-n-p`. Two components each keeping their own list
 * with no link between them, which is the defect this repository names most often, about the one
 * subject where being wrong costs revenue.
 *
 * So the list lives HERE, once, and everything reads it: the Worker's contract, the examination that
 * goes and looks at the repos, the shipping heartbeat, and the validator that checks it against her
 * own table.
 *
 * ─── A `.mjs` beside a `.d.mts`, for the same reason as `repoPolicy.mjs` ────
 *
 * The Worker is TypeScript, the examination is a node script on her Mac, and the validator is a
 * third process. All three have to mean the same thing by "the grid".
 */

/**
 * ─── THE GRID ───────────────────────────────────────────────────────────────
 *
 * `tier` decides what each property is allowed to put in front of her, and it is the field that
 * does the most work here:
 *
 *   primary        — a live money line. May produce an item for her contract.
 *   secondary      — "we really just include it in case something needs to be fixed but the content
 *                     generator and all the real work is in velocity." It is watched and its breaks
 *                     are fixed; it does not propose work to her in the ordinary course.
 *   infrastructure — plumbing. `today/projects.ts` already says it in terms: "A cost centre, not a
 *                     line — never a day's work." Watched, fixed, never suggested.
 *
 * `owner` carries the client distinction, which is not decoration: a client property's "needs her"
 * item is a client-facing act — a reply in her name, an approval on someone else's site — and it
 * has to read as one.
 */
export const GRID = [
  {
    key: "guides_generator",
    label: "Local Guides generator — the five verticals",
    domains: [
      "uscisexam.com",
      "dentistryguides.com",
      "theaccidentguides.com",
      "neuroevalguides.com",
      "hormonesivhair.com",
    ],
    repos: ["local-guides-generator"],
    owner: "hers",
    tier: "secondary",
    why_tier:
      "Her words: \"we really just include it in case something needs to be fixed but the content " +
      "generator and all the real work is in velocity.\" Effort goes to local-guides-citation-velocity. " +
      "This is watched so a break is caught, and it does not generate suggestions for her.",
  },
  {
    key: "citation_velocity",
    label: "theindustryguides.com — citation velocity",
    domains: ["theindustryguides.com"],
    repos: ["local-guides-citation-velocity"],
    owner: "hers",
    tier: "primary",
    why_tier:
      "The velocity feeder, and where the real work is. Note that `siteAudit/repoPolicy.mjs` bars " +
      "the automatic fixer from opening a PR here — under active heavy change — which is a rule " +
      "about FIXING, not about watching. It is examined like everything else.",
  },
  {
    key: "horse_legal",
    label: "horselegalguide.com",
    domains: ["horselegalguide.com"],
    repos: ["horse-legal-guide-velocity"],
    owner: "client",
    tier: "primary",
    why_tier: "A client property. In the grid, and anything needing her here is client-facing.",
  },
  {
    key: "hicks_consulting",
    label: "hicksconsulting.org",
    domains: ["hicksconsulting.org"],
    repos: ["hicks-consulting-canonical"],
    owner: "client",
    tier: "primary",
    why_tier: "A client property. In the grid, and anything needing her here is client-facing.",
  },
  {
    key: "virtual_agency",
    label: "virtualagency-os.com",
    domains: ["virtualagency-os.com"],
    repos: ["WPP-llm"],
    owner: "hers",
    tier: "primary",
  },
  {
    /*
     * ONE PROPERTY, TWO DOMAINS, ONE REPO. `hpc` is high performance coach.
     * bhpc and spryexecutiveos are the same property — they are not two lines and must never be
     * counted as two.
     */
    key: "hpc",
    label: "Spry Labs HPC — billionairehighperformancecoach.com and spryexecutiveos.com",
    domains: ["billionairehighperformancecoach.com", "spryexecutiveos.com"],
    repos: ["sprylabs-hpc-site"],
    owner: "hers",
    tier: "primary",
    why_tier: "ONE property on one repo, not two. hpc = high performance coach.",
  },
  {
    key: "approvalprep",
    label: "approvalprep.com",
    domains: ["approvalprep.com"],
    repos: ["approvalprep"],
    owner: "hers",
    tier: "primary",
  },
  {
    /*
     * FOUR DOMAINS, AND THIS FILE DOES NOT INVENT THEM. She gave the cluster by name and size —
     * "wedding cluster ×4" — and not the four canonical domains. Writing four plausible ones here
     * would put guesses into the thing that is supposed to be the authoritative list, which is
     * exactly how a grid stops being one. The count is recorded; the domains are recorded when she
     * gives them.
     */
    key: "wedding",
    label: "Wedding cluster ×4",
    domains: [],
    property_count: 4,
    repos: ["dream-wedding-builder"],
    owner: "hers",
    tier: "primary",
    why_tier: "Four properties on one repo. The four canonical domains are not recorded here because she has not named them, and inventing them would corrupt the list this file exists to be.",
  },
  {
    key: "authority_network",
    label: "Authority / backlink network",
    domains: [],
    repos: ["authority-backlink-network", "p-n-p"],
    owner: "hers",
    tier: "infrastructure",
    why_tier:
      "`today/projects.ts` settles this in terms: \"Plumbing for the properties above. A cost centre, " +
      "not a line — never a day's work.\" It is watched because when it breaks the others go quiet, " +
      "and it never proposes work to her.",
  },
];

/**
 * ─── OUT OF SCOPE, NAMED RATHER THAN OMITTED ───────────────────────────────
 *
 * WEST PEEK IS THE ONE THAT MATTERS AND IT IS WHY THIS LIST EXISTS AS DATA. On 29 August 2026 an
 * agent working "portfolio-wide" created a branch and merged a PR into `west-peek-network-os`. She
 * caught it: it does not pertain. An exclusion that is merely an absence cannot prevent that,
 * because the next scope that says "all her repos" will include it again by default and nothing
 * will object. So every portfolio-wide scope NAMES these as excluded, and the grid validator fails
 * the build if the naming disappears.
 *
 * `match` is a prefix where a family of repos shares one, so `west-peek-network-os`,
 * `west-peek-os` and anything else under that name are covered without a list that can fall behind.
 */
export const EXCLUDED = [
  {
    match: "west-peek",
    why:
      "A DIFFERENT BUSINESS, AND A HARD STOP. West Peek is the fund; Boss OS is personal. On 29 Aug " +
      "2026 an agent branched and merged into west-peek-network-os under a portfolio-wide scope and " +
      "she said plainly that it does not pertain. Never work in a west-peek repo from here.",
  },
  { match: "join-west-peek-main", why: "West Peek. A different business." },
  { match: "spry-vc", why: "A different business. Her broker-dealer mailbox domain, not a property." },
  { match: "secondaries", why: "A different business." },
  { match: "founder-dilution-dashboard", why: "A different business." },
  { match: "901johnsons-site", why: "An individual client micro-site, not a grid property." },
  { match: "cynthia-brown-dds-site", why: "An individual client micro-site, not a grid property." },
  { match: "sheila-bruce", why: "An individual client micro-site, not a grid property." },
  { match: "shannon-armstrong-bail-network", why: "An individual client micro-site, not a grid property." },
  { match: "dianne-place-recovery-services", why: "An individual client micro-site, not a grid property." },
  { match: "charm-nest", why: "An individual client micro-site, not a grid property." },
  { match: "courtscope", why: "Out of scope. Covers CourtScope_* as well — matched case-insensitively." },
  { match: "agency-event-os", why: "Out of scope." },
];

/** Her GitHub account. Every grid repo lives there. */
export const GRID_OWNER = "seq23";

/** Every repo in the grid, flat, `owner/name` form. */
export function gridRepos() {
  return GRID.flatMap((p) => p.repos.map((r) => `${GRID_OWNER}/${r}`));
}

/** The grid keys, in order. */
export const GRID_KEYS = GRID.map((p) => p.key);

/**
 * Is this repo out of scope? Accepts a bare name, `owner/name`, or a full path — because the local
 * job holds a path, the API holds `owner/name`, and a guard that only understands one of those is a
 * guard with a hole in it. The same lesson `mayAutoFix` learned.
 */
export function isExcluded(repo) {
  const name = String(repo ?? "").toLowerCase().replace(/\/+$/, "").split("/").pop() ?? "";
  if (!name) return true;
  return EXCLUDED.some((e) => name.startsWith(e.match.toLowerCase()));
}

/** Why this repo is out of scope, or null if it is not. */
export function whyExcluded(repo) {
  const name = String(repo ?? "").toLowerCase().replace(/\/+$/, "").split("/").pop() ?? "";
  return EXCLUDED.find((e) => name.startsWith(e.match.toLowerCase()))?.why ?? null;
}

/** The grid property a repo belongs to, or null. */
export function propertyForRepo(repo) {
  const name = String(repo ?? "").replace(/\/+$/, "").split("/").pop() ?? "";
  return GRID.find((p) => p.repos.some((r) => r.toLowerCase() === name.toLowerCase())) ?? null;
}

export function propertyFor(key) {
  return GRID.find((p) => p.key === key) ?? null;
}

/**
 * Properties allowed to put an item in front of her.
 *
 * A `secondary` property is fixed when it breaks and never suggests; `infrastructure` is a cost
 * centre and never a day's work. Both are still examined — the distinction is about what reaches
 * HER, not about what is watched.
 */
export function suggestingKeys() {
  return GRID.filter((p) => p.tier === "primary").map((p) => p.key);
}
