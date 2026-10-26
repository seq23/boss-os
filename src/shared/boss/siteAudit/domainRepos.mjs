/**
 * WHICH REPOSITORY SERVES AN AUDITED DOMAIN — ONE LIST, READ BY THE FIXER, THE INGEST AND TODAY.
 *
 * ─── The defect this ends (26 Oct 2026) ──────────────────────────────────────
 *
 * Today said "Danielle found 118 errors on Porchandparty901 … and no repository claims that domain".
 * seq23/p-n-p serves porchandparty901.com, and `sites.json` (the grid repos) said so. But the weekly
 * Ahrefs pass mapped domains a second way, by grepping every checkout's REPO_IDENTITY.md, and most
 * repositories never declared their domains there: 13 of 17 `no_repo` rows on 26 Oct were domains
 * `sites.json` already mapped. Two components each keeping their own list — and the stale one won.
 *
 * So the grid manifest is the one list. `sites.json` → `grid_repos[].{domain, repo}` maps every grid
 * site; `AUDITED_ELSEWHERE` below names every other domain the Ahrefs account audits, each with the
 * repository that serves it or `repo: null` and the reason none does. `tests/domainRepos.test.ts`
 * fails if a domain any audit has reported is in neither list.
 *
 * A `.mjs` beside a `.d.mts` because the Worker route, the local reporter and the fixer's helper
 * must mean the same thing by "the repo for this domain".
 */

import SITES from "../searchReadiness/sites.json" with { type: "json" };

/**
 * Domains the Ahrefs account audits that are NOT grid sites. Each says which repository serves it,
 * or `repo: null` with the reason no repository can be fixed for it. Checked live 26 Oct 2026.
 */
export const AUDITED_ELSEWHERE = [
  { domain: "hicksconsulting.com", repo: null, why: "Not ours: an Apache host we do not run. The client's own site is hicksconsulting.org (hicks-consulting-canonical)." },
  { domain: "spry.vc", repo: null, why: "A redirect-only domain: it 301s to sequoiataylor.com at Cloudflare, so there is no page and no repository to fix." },
  { domain: "westpeekproductions.com", repo: null, why: "A West Peek property. Boss OS never changes West Peek work (the businesses stay separate); its own repository and owner handle it." },
  { domain: "thedentistryguides.com", repo: null, why: "A redirect-only domain: it 301s to dentistryguides.com (local-guides-generator), where the pages and their fixes live." },
];

const clean = (d) => String(d ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

/** Every domain → { repo, source, why? }. Grid sites first; a domain in both lists is a test failure. */
export const DOMAIN_REPOS = (() => {
  const m = new Map();
  for (const s of SITES.grid_repos ?? []) m.set(clean(s.domain), { repo: s.repo ?? null, source: "grid_manifest", why: s.repo ? null : "the grid manifest names no repository" });
  for (const s of AUDITED_ELSEWHERE) if (!m.has(clean(s.domain))) m.set(clean(s.domain), { repo: s.repo, source: "audited_elsewhere", why: s.why });
  return m;
})();

/**
 * The repository for a domain, from the one list. `null` means the list has never heard of it (the
 * test makes that impossible for any domain an audit has reported); `{ repo: null, why }` means the
 * list says on purpose that no repository serves it.
 */
export function repoForDomain(domain) {
  return DOMAIN_REPOS.get(clean(domain)) ?? null;
}

/**
 * An Ahrefs project name is the domain without its TLD, capitalised ("Porchandparty901"). Rows that
 * carry no domain are matched back through it, so a row that predates the domain column still maps.
 */
export function domainForProject(project) {
  const p = String(project ?? "").trim();
  const prefixed = /^[a-z]+:(.+)$/i.exec(p); // "checklist:<domain>", "crawl:<domain>"
  if (prefixed) return clean(prefixed[1]);
  const stem = p.toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!stem) return null;
  for (const d of DOMAIN_REPOS.keys()) if (d.split(".")[0] === stem) return d;
  return null;
}

/** The domain a finding row is about: its own `domain` when that is real, else its project's. */
export function domainOfRow(row) {
  const d = clean(row?.domain);
  if (d && d.includes(".") && d !== "unresolved") return d;
  return domainForProject(row?.project);
}
