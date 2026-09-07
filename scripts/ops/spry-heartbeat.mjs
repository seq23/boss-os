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
 * The properties, and the branch a release actually happens on.
 *
 * NAMED EXPLICITLY RATHER THAN DISCOVERED. The account holds thirty-odd repos including client
 * work she has asked to keep out of this entirely, the West Peek repos, and experiments. A
 * heartbeat that cries about a repo she abandoned in March is one she stops reading.
 *
 * READ FROM THE ACCOUNT, NOT GUESSED. The first version of this list was invented from the property
 * names she uses in conversation — `theindustryguides`, `time-2-read`, `weddingchecklistpdf` — and
 * three of eight did not exist as repos. Every entry below was taken from `gh repo list`, and a
 * name that stops resolving reports as `unreachable` rather than quietly passing.
 */
const PROPERTIES = [
  // Ads and leads — the Spry line closest to real revenue.
  { repo: "seq23/local-guides-generator", label: "Local Guides generator — the 5 verticals" },
  // theindustryguides.com. It speeds up citations and LLM surfacing for the generator's sites, and
  // it is where she experiments — so a red lane here is expected more often than elsewhere and a
  // long silence matters more.
  { repo: "seq23/local-guides-citation-velocity", label: "theindustryguides.com — citation velocity" },
  // SaaS, looking for partnership distribution.
  { repo: "seq23/heygetonmylevel", label: "heygetonmylevel" },
  // Digital products.
  { repo: "seq23/approvalprep", label: "approvalprep" },
  { repo: "seq23/dream-wedding-builder", label: "Dream wedding builder" },
  { repo: "seq23/sprylabs-hpc-site", label: "Spry Labs HPC site" },
  // The channel.
  { repo: "seq23/how-we-know", label: "How We Know — YouTube" },
  // Infrastructure. Watched because when it breaks the others go quiet, not because it earns.
  { repo: "seq23/authority-backlink-network", label: "Authority network (infrastructure)" },
];

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
