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
 * Owner, 10 Nov 2026 (spry brain, Settled decisions), replacing the 29 Aug 2026 table: the grid is
 * every site in `searchReadiness/sites.json` `grid_repos` (groups divine_9 / support / friends;
 * Porch & Party is a friends & clients site, owner 10 Nov 2026) PLUS Whisper Almanac, a YouTube channel with no website, recorded in that file's
 * `_groups.gaps` with its `repo` and `handle`. It is KEYED BY CANONICAL DOMAIN, not by repo name,
 * which is why a directory listing does not reproduce it. When she says "the grid", "the repos I care
 * about", "my repos", "the portfolio" or "portfolio-wide", she means this set and nothing else. It is
 * never re-derived from `ls ~/GitHub` and she is never asked which repos she meant.
 *
 * ─── ONE LIST ───────────────────────────────────────────────────────────────
 *
 * Until 10 Nov 2026 this file kept its own table and the grid validator kept a third copy as a
 * fixture; both had gone stale against sites.json (spryexecutiveos still in, keepmyproof, aplayermode,
 * memphisseniorcarehomes, the three libraries and two friends' sites missing). So the membership now
 * lives ONLY in sites.json and this file DERIVES `GRID` from it. The shape every reader uses (key,
 * label, tier, owner, repos, domains, domain_repos) is kept. `scripts/validate/the-grid-is-one-list.mjs`
 * fails the build if the two views ever disagree.
 *
 * ─── A `.mjs` beside a `.d.mts`, for the same reason as `repoPolicy.mjs` ────
 *
 * The Worker is TypeScript, the examination is a node script on her Mac, and the validator is a
 * third process. All three have to mean the same thing by "the grid".
 */

import SITES from "./searchReadiness/sites.json" with { type: "json" };

/**
 * ─── HOW A sites.json ROW BECOMES A GRID PROPERTY ──────────────────────────
 *
 * `tier` decides what each property is allowed to put in front of her:
 *
 *   primary        — a live money line (divine_9, friends). May produce an item for her.
 *   secondary      — a row whose `roles` include "generator" (local-guides-generator). Her words: "we
 *                     really just include it in case something needs to be fixed but the content
 *                     generator and all the real work is in velocity." Watched and fixed; never suggests.
 *   infrastructure — the `support` group (the authority backlink network). Plumbing: "A cost centre,
 *                     not a line — never a day's work." Watched, fixed, never suggested.
 *
 * `owner` is "client" for the `friends` group and "hers" for every other group: a client property's
 * "needs her" item is a client-facing act and has to read as one.
 *
 * `key` is the identifier stored rows and readers already use. Rows are grouped by it; KEYS only
 * keeps the old names stable for repos that had one (it decides no membership — a repo absent from
 * sites.json is absent from the grid whatever this map says). A repo with no entry is keyed by its
 * business name.
 */
const KEYS = Object.freeze({
  "local-guides-generator": "guides_generator",
  "local-guides-citation-velocity": "citation_velocity",
  "horse-legal-guide-velocity": "horse_legal",
  "hicks-consulting-canonical": "hicks_consulting",
  "WPP-llm": "virtual_agency",
  "sprylabs-hpc-site": "hpc",
  "approvalprep": "approvalprep",
  "dream-wedding-builder": "wedding",
  "how-we-know": "youtube",
  "heygetonmylevel": "saas_apps",
  "dailystory": "saas_apps",
  "authority-backlink-network": "authority_network",
});

const WHY_TIER = Object.freeze({
  guides_generator:
    "Her words: \"we really just include it in case something needs to be fixed but the content " +
    "generator and all the real work is in velocity.\" Effort goes to local-guides-citation-velocity. " +
    "This is watched so a break is caught, and it does not generate suggestions for her.",
  authority_network:
    "`today/projects.ts` settles this in terms: \"Plumbing for the properties above. A cost centre, " +
    "not a line — never a day's work.\" It is watched because when it breaks the others go quiet, " +
    "and it never proposes work to her.",
});

const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** The grid channels: every `_groups.gaps` entry that names a repo and a handle (no website). */
export function gridChannels(sites = SITES) {
  const gaps = sites?._groups?.gaps ?? {};
  const out = [];
  for (const [business, g] of Object.entries(gaps)) {
    if (!g || typeof g !== "object" || !g.repo || !g.handle) continue;
    const group = Object.entries(sites._groups).find(([k, v]) => Array.isArray(v) && v.includes(business))?.[0] ?? null;
    out.push({ business, repo: g.repo, handle: g.handle, group });
  }
  return out;
}

/** Derive the grid from sites.json. Pure, so the validator can feed it a mutated copy. */
export function deriveGrid(sites = SITES) {
  const byKey = new Map();
  const entry = (key, group, business) => {
    if (!byKey.has(key)) byKey.set(key, { key, group, businesses: [], repos: [], domains: [], handles: [], domain_repos: {}, generator: false });
    const p = byKey.get(key);
    if (!p.businesses.includes(business)) p.businesses.push(business);
    return p;
  };
  for (const r of sites?.grid_repos ?? []) {
    const key = (r.repo && KEYS[r.repo]) || slug(r.business ?? r.repo ?? r.domain);
    const p = entry(key, r.group, r.business);
    if (r.repo && !p.repos.includes(r.repo)) p.repos.push(r.repo);
    if (r.domain) {
      p.domains.push(r.domain);
      if (r.repo) p.domain_repos[r.domain] = r.repo;
      else (p.domains_without_repo ??= []).push(r.domain);
    }
    if ((r.roles ?? []).includes("generator")) p.generator = true;
  }
  for (const c of gridChannels(sites)) {
    const p = entry(slug(c.business), c.group, c.business);
    if (!p.repos.includes(c.repo)) p.repos.push(c.repo);
    p.handles.push(c.handle);
  }
  return [...byKey.values()].map(({ generator, businesses, handles, group, ...p }) => {
    const tier = group === "support" ? "infrastructure" : generator ? "secondary" : "primary";
    const where = p.domains.length === 0
      ? `YouTube ${handles.join(", ")}`
      : p.domains.length <= 2 ? p.domains.join(" and ") : `${p.domains.length} sites`;
    return {
      ...p,
      ...(handles.length ? { handles } : {}),
      label: `${businesses.join(" and ")} — ${where}`,
      group,
      businesses,
      owner: group === "friends" ? "client" : "hers",
      tier,
      ...(WHY_TIER[p.key] ? { why_tier: WHY_TIER[p.key] } : {}),
    };
  });
}

/** THE GRID, derived once from sites.json. */
export const GRID = Object.freeze(deriveGrid(SITES));

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
  {
    match: "westpeek",
    why:
      "West Peek, spelled without the hyphen: westpeek-live is the events app, a support system and not " +
      "a business (owner, 10 Nov 2026), and it gets no search work — the West Peek hard stop applies.",
  },
  { match: "spry-vc", why: "A different business. Her broker-dealer mailbox domain, not a property." },
  { match: "secondaries", why: "A different business." },
  { match: "founder-dilution-dashboard", why: "A different business." },
  { match: "901johnsons-site", why: "An individual client micro-site, not a grid property." },
  { match: "sheila-bruce", why: "An individual client micro-site, not a grid property." },
  { match: "shannon-armstrong-bail-network", why: "An individual client micro-site, not a grid property." },
  { match: "charm-nest", why: "An individual client micro-site, not a grid property." },
  { match: "creator-network", why: "Parked (owner, 10 Nov 2026): not in the grid, off every job." },
  { match: "courtscope", why: "Out of scope. Covers CourtScope_* as well — matched case-insensitively." },
  { match: "agency-event-os", why: "Out of scope." },
];

/** Her GitHub account. Every grid repo lives there. */
export const GRID_OWNER = "seq23";

/** Every repo in the grid, flat, `owner/name` form. */
export function gridRepos() {
  return [...new Set(GRID.flatMap((p) => p.repos))].map((r) => `${GRID_OWNER}/${r}`);
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
