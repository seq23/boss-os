/**
 * ARE THE SPRY PROPERTIES STILL SHIPPING? — weekly, and quiet unless they are not.
 *
 * Her account: the Spry repos are hands-off, they self-heal, they release on their own. Which is
 * true and is exactly why nothing watches them — and if `theindustryguides` stopped generating
 * leads on a Tuesday she would find out from revenue, not from the system.
 *
 * ─── Why this is not a CI report ────────────────────────────────────────────
 *
 * Her instinct was right: "im not sure i need to see every single CI failure from GH Actions daily.
 * maybe like a weekly recap of how many failures and what was fixed."
 *
 * And a failure count is still the wrong number, because a repo can be perfectly green and not have
 * shipped in three weeks. Green means the tests that ran passed; it says nothing about whether
 * anything reached the internet. The question she actually has is "is a property quietly
 * degrading in a way that costs me money", and the honest proxy for that is a SHIPPING HEARTBEAT:
 * when did this thing last successfully release, and how long ago was that.
 *
 * Failures are reported too, but as context underneath — and specifically as failures the sweep did
 * NOT fix, since her cron already repairs the ordinary ones twice a day and telling her about work
 * that already got done is noise wearing a hat.
 *
 * ─── Quiet by default, which is the whole design ────────────────────────────
 *
 * It prints one line per property only when something is wrong. A week where everything shipped
 * produces a single sentence saying so. A weekly report that always has content is a report that
 * gets skimmed and then ignored, and the one week it mattered would look like all the others.
 *
 * ─── It changes nothing ─────────────────────────────────────────────────────
 *
 * Read-only against the GitHub API. Her CI sweep owns fixing red lanes and runs twice a day; two
 * things repairing the same repos is the collision her own working rules name first. This observes.
 */

const DAYS_QUIET = Number(process.env.SPRY_QUIET_DAYS ?? 10);
const WINDOW_DAYS = Number(process.env.SPRY_WINDOW_DAYS ?? 7);
const JSON_OUT = process.argv.includes("--json");

/**
 * ─── THE PROPERTIES ARE THE GRID, AND THIS FILE NO LONGER KEEPS A LIST ─────
 *
 *   "the system should know all of my side hustles......all of the repos that i care about for
 *    making money. the grid repos are my side hustles"
 *
 * WHAT USED TO BE HERE, AND WHY IT HAD TO GO. Eight repos, hand-written, every entry taken from
 * `gh repo list` — which was the right instinct at the time, because the first version of the list
 * was invented from the names she uses in conversation and three of eight did not exist. But taking
 * them from the account solved the wrong half: the names resolved, and the SET was still somebody's
 * guess. It carried `heygetonmylevel` and `how-we-know`, which are not on her grid, and it was
 * missing `WPP-llm`, `p-n-p` and BOTH CLIENT REPOS, which are.
 *
 * Meanwhile `today/projects.ts` carried a different list again — five vague entries with no repos at
 * all — and a run that read it reported she had four side hustles. Two components each keeping their
 * own list with no link between them, about the one subject where being wrong costs revenue.
 *
 * So the list is `src/shared/boss/grid.mjs`, which is her own table keyed by canonical domain, and
 * this file reads it. Adding a property is one entry in one file, and the west-peek exclusions are
 * applied here as well rather than relied upon to be absent.
 */
import { GRID, GRID_OWNER, isExcluded } from "../../src/shared/boss/grid.mjs";

const PROPERTIES = GRID.flatMap((g) =>
  g.repos
    .filter((r) => !isExcluded(r))
    .map((r) => ({ repo: `${GRID_OWNER}/${r}`, label: g.repos.length > 1 ? `${g.label} — ${r}` : g.label })),
);

const days = (ts) => Math.floor((Date.now() - ts) / 86_400_000);

async function gh(path) {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    // `gh` carries her own auth. No token is read, stored or passed by this script.
    execFile("gh", ["api", path], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}

async function checkOne(p) {
  const runs = await gh(`repos/${p.repo}/actions/runs?per_page=60`);
  if (!runs) {
    /*
     * UNREACHABLE IS NOT HEALTHY. A repo that cannot be read — renamed, made private, `gh` not
     * authorised — must say so rather than silently counting as fine, which is how a property drops
     * off a watchlist without anyone deciding it should.
     */
    return { ...p, status: "unreachable", detail: "Could not read Actions for this repo." };
  }

  const all = runs.workflow_runs ?? [];
  if (all.length === 0) return { ...p, status: "no_runs", detail: "No workflow runs at all." };

  const success = all.filter((r) => r.conclusion === "success");
  const last = success[0];
  const lastDays = last ? days(Date.parse(last.updated_at)) : null;

  const since = Date.now() - WINDOW_DAYS * 86_400_000;
  const recent = all.filter((r) => Date.parse(r.updated_at) >= since);
  const failed = recent.filter((r) => r.conclusion === "failure");

  /*
   * A FAILURE THE SWEEP ALREADY FIXED IS NOT NEWS. If the same workflow succeeded after failing,
   * the lane recovered — which is her cron doing its job. What she needs is the failure that is
   * STILL red, because that is the one nobody has dealt with.
   */
  const stillRed = failed.filter((f) => !success.some((s) => s.name === f.name && Date.parse(s.updated_at) > Date.parse(f.updated_at)));

  const status =
    lastDays === null ? "never_shipped" :
    lastDays > DAYS_QUIET ? "quiet" :
    stillRed.length > 0 ? "red" : "ok";

  return {
    ...p, status,
    last_success_days: lastDays,
    last_success_at: last?.updated_at ?? null,
    failures_in_window: failed.length,
    still_red: stillRed.length,
    recovered: failed.length - stillRed.length,
    red_workflows: [...new Set(stillRed.map((r) => r.name))].slice(0, 3),
  };
}

async function main() {
  const results = [];
  for (const p of PROPERTIES) results.push(await checkOne(p));

  if (JSON_OUT) {
    console.log(JSON.stringify({ checked_at: new Date().toISOString(), window_days: WINDOW_DAYS, properties: results }, null, 2));
    return;
  }

  const problems = results.filter((r) => r.status !== "ok");
  const recovered = results.reduce((n, r) => n + (r.recovered ?? 0), 0);

  console.log(`Spry shipping heartbeat — last ${WINDOW_DAYS} days, ${results.length} properties\n`);

  if (problems.length === 0) {
    // The whole point of the design: a good week is one sentence.
    console.log(`All ${results.length} shipped within ${DAYS_QUIET} days and nothing is still red.` +
      (recovered ? ` ${recovered} failure(s) went red and recovered — your sweep's work, not yours.` : ""));
    return;
  }

  for (const r of problems) {
    if (r.status === "quiet") {
      console.log(`  ⏳ ${r.label}\n       Last successful release ${r.last_success_days} days ago. Green is not the same as shipping.`);
    } else if (r.status === "red") {
      console.log(`  ✗  ${r.label}\n       ${r.still_red} workflow(s) still red after the sweep: ${r.red_workflows.join(", ")}`);
    } else if (r.status === "never_shipped") {
      console.log(`  ?  ${r.label}\n       No successful run on record.`);
    } else {
      console.log(`  ?  ${r.label}\n       ${r.detail}`);
    }
  }

  const fine = results.length - problems.length;
  console.log(`\n${fine} of ${results.length} shipping normally.` +
    (recovered ? ` ${recovered} failure(s) recovered on their own this week.` : ""));
}

main().catch((err) => {
  console.error(`heartbeat failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
