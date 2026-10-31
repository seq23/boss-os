/**
 * WHAT TODAY SAYS ABOUT THE FIXER'S UNFINISHED FINDINGS — ONE LINE PER KIND, AND ONLY WHAT IS TRUE NOW.
 *
 * Three alerts on 26 Oct 2026 were each wrong in a different way:
 *   · "118 errors on Porchandparty901 … no repository claims that domain" — a 17 Sep row; seq23/p-n-p
 *     serves it and the grid manifest said so. 13 of the 17 `no_repo` rows were domains the manifest
 *     maps, and 3 were domains with no repository on purpose (redirects, a host we do not run).
 *   · "13 errors on Theindustryguides in a repository on the fixer's off-limits list" — a 3 Oct row;
 *     local-guides-citation-velocity left that list on 16 Oct 2026.
 *   · "50 errors on Theaccidentguides (49 sites in all)" — 49 ROWS, not sites, most of them older
 *     passes' rows about the same thing.
 * So a row is checked against the lists that decide it, at render time, and the line counts sites.
 */

import { mayAutoFix, whyNoAutoFix } from "./repoPolicy.mjs";
import { repoForDomain, domainOfRow } from "./domainRepos.mjs";

const pretty = (row) => domainOfRow(row) ?? String(row?.project ?? "a site");

/** Rows `{ disposition, project, domain, repo, errors }` → `[{ severity, text }]`. Pure. */
export function auditFindingAlerts(rows) {
  const live = { no_repo: [], off_limits: [], surfaced: [] };
  for (const r of rows ?? []) {
    if (r.disposition === "no_repo") {
      // The one list maps it (stale row), or says on purpose that no repository serves it.
      if (repoForDomain(domainOfRow(r))) continue;
      live.no_repo.push(r);
    } else if (r.disposition === "off_limits") {
      if (r.repo && mayAutoFix(r.repo)) continue; // no longer on the list: a stale row, not a fault
      live.off_limits.push(r);
    } else if (r.disposition === "surfaced") {
      live.surfaced.push(r);
    }
  }
  const out = [];
  const summary = (list) => {
    const sites = new Set(list.map(pretty));
    const worst = [...list].sort((a, b) => (b.errors ?? 0) - (a.errors ?? 0))[0];
    const errs = (worst.errors ?? 0) > 0 ? `${worst.errors} errors` : "errors";
    const others = sites.size - 1;
    return { site: pretty(worst), errs, more: others > 0 ? ` (and ${others} other site${others === 1 ? "" : "s"})` : "", count: list.length, worst };
  };
  if (live.no_repo.length) {
    const s = summary(live.no_repo);
    out.push({ severity: "high", text: `Danielle found ${s.errs} on ${s.site}${s.more} and no repository is listed for that domain, so she could not fix it. Tell her which project owns the site, or say it is not one of ours.` });
  }
  if (live.off_limits.length) {
    const s = summary(live.off_limits);
    const why = whyNoAutoFix(s.worst.repo) ?? "It is on the fixer's off-limits list.";
    out.push({ severity: "medium", text: `Danielle found ${s.errs} on ${s.site}${s.more} in ${s.worst.repo ?? "a repository"}, which the fixer may not change, so she changed nothing. Why it is off limits: ${why}` });
  }
  if (live.surfaced.length) {
    const s = summary(live.surfaced);
    out.push({ severity: "medium", text: `Danielle has ${s.count} finding${s.count === 1 ? "" : "s"} on ${new Set(live.surfaced.map(pretty)).size} site${new Set(live.surfaced.map(pretty)).size === 1 ? "" : "s"} she has not fixed yet; the worst is ${s.errs} on ${s.site}. They are hers to decide and fix, never yours (31 Oct 2026); her next pass works them.` });
  }
  return out;
}
