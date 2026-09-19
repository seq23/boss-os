#!/usr/bin/env node
/**
 * GO AND LOOK AT THE GRID, AND SPLIT WHAT YOU FIND INTO "DISPATCH THIS" AND "ONLY SHE CAN DO THIS".
 *
 * ─── Her instruction ────────────────────────────────────────────────────────
 *
 *   "the system should know all of my side hustles......all of the repos that i care about for
 *    making money. the grid repos are my side hustles"
 *
 *   "the agent needs to examine what is going on with those businesses and give me stuff to do
 *    for those"
 *
 * ─── What was there before ─────────────────────────────────────────────────
 *
 * The side-hustle slot read `owned_deliverables.needs_owner`, a flag set by hand, and nothing had
 * ever set it — so the slot had been silent since it shipped. Meanwhile `spry-heartbeat.mjs` was
 * already reading the GitHub API every week and printing to a log nothing reads. Real observation,
 * going nowhere; a real slot, with nothing to show.
 *
 * ─── THE SPLIT IS THE FEATURE, NOT A FILTER ON THE FEATURE ─────────────────
 *
 *   "A slot that lists five red builds is a dashboard she will scroll past; a slot that says
 *    'hicksconsulting has been waiting nine days on your copy approval' is the one thing she could
 *    not delegate."
 *
 * So every observation gets a `disposition`, and the bar for `needs_her` is deliberately almost
 * impossible to clear:
 *
 *   · A PULL REQUEST WHERE SHE IS A REQUESTED REVIEWER and has been for days. That is her
 *     signature; nobody else's approval is the same event.
 *   · A PULL REQUEST ON A CLIENT PROPERTY, OPENED BY SOMEBODY ELSE, sitting. That is a client
 *     waiting on her, and a reply in her name is her voice.
 *
 * Everything else — a red workflow, a lane that stopped shipping, a bot PR, a repo that will not
 * read — is DISPATCHED. It is real work and it is somebody's; it is not hers.
 *
 * And a `secondary` or `infrastructure` property may not produce a `needs_her` item at all. Her
 * words on the generator: "we really just include it in case something needs to be fixed but the
 * content generator and all the real work is in velocity." It is watched and it is fixed. It does
 * not propose work to her.
 *
 * ─── IT IS READ-ONLY, AND THAT IS A RULE RATHER THAN A HABIT ───────────────
 *
 * It opens no branch, no pull request and no commit in any grid repository. Her standing rule is one
 * agent per repo, learned the expensive way; a job that reached into a dozen repositories and edited
 * them would break it a dozen times in one run. Every `gh` call below is `gh api` with no method,
 * which is a GET, and `validate:grid-examined` fails the build if a write verb ever appears here.
 *
 * ─── WEST PEEK IS NAMED AS EXCLUDED, NOT MERELY ABSENT ─────────────────────
 *
 * On 29 August 2026 an agent working "portfolio-wide" branched and merged into
 * `west-peek-network-os` and she said it does not pertain. An exclusion that is only an absence
 * cannot prevent the next portfolio-wide scope from picking it up again. The list is in
 * `src/shared/boss/grid.mjs` and this run prints what it refused and why.
 *
 * RULE 0: EXAMINING ZERO PROPERTIES IS A FAILURE, LOUDLY. "Nothing needs you today" and "nothing
 * looked" must never render the same, so the run records `properties_expected` beside
 * `properties_examined` and exits non-zero when it reached none.
 *
 *   npm run grid:watch                 # look, and print
 *   npm run grid:watch -- --post       # ...and file it in Boss OS
 *   npm run grid:watch -- --json
 */

import { GRID, EXCLUDED, GRID_OWNER, isExcluded, whyExcluded } from "../../src/shared/boss/grid.mjs";

const ARGS = process.argv.slice(2);
const POST = ARGS.includes("--post");
const JSON_OUT = ARGS.includes("--json");

/** How long a pull request may sit before it is worth saying anything about. */
const PR_STALE_DAYS = Number(process.env.GRID_PR_STALE_DAYS ?? 3);
/** How long she may be a requested reviewer before it is HER work rather than a notification. */
const HER_REVIEW_DAYS = Number(process.env.GRID_HER_REVIEW_DAYS ?? 2);
/** Green is not shipping. How long a property may go without a successful run. */
const QUIET_DAYS = Number(process.env.GRID_QUIET_DAYS ?? 14);

const DAY = 86_400_000;
const days = (ts) => Math.floor((Date.now() - ts) / DAY);

/**
 * A READ. `gh api` with no `--method` is a GET, `gh` carries her own auth, and no token is read,
 * stored or passed by this script.
 */
async function gh(path) {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    execFile("gh", ["api", path], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}

/**
 * Everything observable about one repository.
 *
 * UNREACHABLE IS AN OBSERVATION, NOT A SKIP. A repo that cannot be read — renamed, made private,
 * `gh` not authorised — must produce a row rather than silently count as fine, which is how a
 * property drops off a watchlist without anybody deciding it should. `spry-heartbeat.mjs` already
 * learned this and the lesson is carried here.
 */
async function examineRepo(property, repo) {
  const full = `${GRID_OWNER}/${repo}`;
  const out = { property, repo: full, reached: false, observations: [], reading: null };

  const runs = await gh(`repos/${full}/actions/runs?per_page=60`);
  if (!runs) {
    out.reading = {
      property_key: property.key, reader: "github", target: full, state: "blocked",
      summary: `${full} could not be read through gh.`, numbers: {},
      evidence_url: `https://github.com/${full}`, error: "gh api returned nothing — renamed, private, or gh not authorised",
    };
    out.observations.push({
      kind: "unreachable",
      disposition: "dispatch",
      headline: `${full} could not be read.`,
      evidence: `https://github.com/${full}`,
    });
    return out;
  }
  out.reached = true;

  const all = runs.workflow_runs ?? [];

  /*
   * ─── THE READING, NOT ONLY THE EXCEPTIONS (19 Sep 2026) ───────────────────
   *
   * Everything below files OBSERVATIONS — what is wrong. A green, shipping repository left no row
   * anywhere, so on the property card "healthy" and "never looked" were the same absence. This is
   * the plain fact per repo, every run: the last run on `main`, how many pull requests are open,
   * the latest release. It is posted to `/api/grid/health/readings` as the `github` reader.
   */
  const onMain = all.filter((r) => r.head_branch === "main");
  const last = onMain[0] ?? all[0] ?? null;
  const openPrs = await gh(`repos/${full}/pulls?state=open&per_page=30`);
  const release = await gh(`repos/${full}/releases/latest`);
  out.reading = {
    property_key: property.key,
    reader: "github",
    target: full,
    state: last ? (last.conclusion === "success" || last.conclusion === null ? "ok" : "warn") : "warn",
    summary: last
      ? `${full}: last run on ${last.head_branch ?? "?"} "${last.name}" ${last.conclusion ?? last.status} (${days(Date.parse(last.updated_at))}d ago), ${(openPrs ?? []).length} open PR(s)${release?.tag_name ? `, latest release ${release.tag_name}` : ", no release"}.`
      : `${full}: no workflow run on record, ${(openPrs ?? []).length} open PR(s).`,
    numbers: {
      last_run: last ? { name: last.name, branch: last.head_branch, conclusion: last.conclusion, status: last.status, url: last.html_url, at: Date.parse(last.updated_at) } : null,
      open_prs: (openPrs ?? []).length,
      latest_release: release?.tag_name ? { tag: release.tag_name, at: Date.parse(release.published_at ?? release.created_at), url: release.html_url } : null,
    },
    evidence_url: last?.html_url ?? `https://github.com/${full}/actions`,
    error: last && last.conclusion && last.conclusion !== "success" ? `last run ${last.conclusion}` : null,
  };
  const success = all.filter((r) => r.conclusion === "success");
  const failed = all.filter((r) => r.conclusion === "failure");

  /*
   * A FAILURE THAT RECOVERED IS NOT NEWS. If the same workflow succeeded after failing, the lane
   * repaired itself — which is her sweep doing its job, and telling her about work that already got
   * done is noise wearing a hat. What matters is what is STILL red.
   */
  const stillRed = failed.filter(
    (f) => !success.some((s) => s.name === f.name && Date.parse(s.updated_at) > Date.parse(f.updated_at)),
  );
  if (stillRed.length > 0) {
    const names = [...new Set(stillRed.map((r) => r.name))];
    out.observations.push({
      kind: "ci_red",
      // A RED BUILD IS NEVER HERS. It is the clearest case in the whole file: somebody fixes it.
      disposition: "dispatch",
      headline: `${names.length} workflow(s) still red in ${full}: ${names.slice(0, 3).join(", ")}.`,
      evidence: stillRed[0].html_url ?? `https://github.com/${full}/actions`,
    });
  }

  const lastGreen = success[0] ? days(Date.parse(success[0].updated_at)) : null;
  if (lastGreen === null) {
    out.observations.push({
      kind: "no_release",
      disposition: "dispatch",
      headline: `${full} has no successful workflow run on record.`,
      evidence: `https://github.com/${full}/actions`,
    });
  } else if (lastGreen > QUIET_DAYS) {
    out.observations.push({
      kind: "no_release",
      disposition: "dispatch",
      headline: `${full} has not shipped for ${lastGreen} days. Green is not the same as shipping.`,
      evidence: `https://github.com/${full}/actions`,
    });
  }

  /*
   * A SCHEDULED LANE THAT STOPPED FIRING. The content and release loops are how these properties
   * earn without attention; one that quietly stopped is revenue leaving with nothing on fire.
   * Compared against its own cadence rather than a fixed number: the gap between the last two
   * scheduled runs IS the cadence, and twice that is late. A lane that has only ever run once
   * cannot have a cadence and is left alone rather than guessed at.
   */
  const scheduled = all.filter((r) => r.event === "schedule");
  const byWorkflow = new Map();
  for (const r of scheduled) {
    if (!byWorkflow.has(r.name)) byWorkflow.set(r.name, []);
    byWorkflow.get(r.name).push(Date.parse(r.created_at));
  }
  for (const [name, stamps] of byWorkflow) {
    if (stamps.length < 3) continue;
    stamps.sort((a, b) => b - a);
    const cadence = stamps[0] - stamps[1];
    if (cadence <= 0) continue;
    const silence = Date.now() - stamps[0];
    if (silence > cadence * 2 && silence > DAY) {
      out.observations.push({
        kind: "schedule_stopped",
        disposition: "dispatch",
        headline:
          `"${name}" in ${full} runs about every ${Math.max(1, Math.round(cadence / DAY))} day(s) and last ` +
          `fired ${days(stamps[0])} days ago.`,
        evidence: `https://github.com/${full}/actions`,
      });
    }
  }

  // ─── Pull requests: the only place a `needs_her` can come from ────────────
  const prs = await gh(`repos/${full}/pulls?state=open&per_page=30`);
  for (const pr of prs ?? []) {
    const age = days(Date.parse(pr.created_at));
    const reviewerIsHer = (pr.requested_reviewers ?? []).some(
      (u) => String(u?.login ?? "").toLowerCase() === GRID_OWNER.toLowerCase(),
    );
    const author = String(pr.user?.login ?? "").toLowerCase();
    const someoneElse = author && author !== GRID_OWNER.toLowerCase();

    /*
     * HER REVIEW IS HER SIGNATURE. A requested review is not "somebody should look at this" — it is
     * a named request for her approval, recorded by GitHub, on a pull request she can open. No
     * employee and no script can give it.
     */
    if (reviewerIsHer && age >= HER_REVIEW_DAYS && property.tier === "primary") {
      out.observations.push({
        kind: "pr_stale",
        disposition: "needs_her",
        needs_her_why:
          `Review and approve (or reject) "${pr.title}" — you are the requested reviewer and have been ` +
          `for ${age} day${age === 1 ? "" : "s"}.`,
        headline: `${property.label}: PR #${pr.number} is waiting on your review.`,
        evidence: pr.html_url,
      });
      continue;
    }

    /*
     * A CLIENT WAITING. On a client property, a pull request opened by somebody else and left
     * sitting is a person waiting on her — the reply comes from her or it does not come. On her own
     * properties the same shape is just work, and work gets dispatched.
     */
    if (property.owner === "client" && someoneElse && age >= PR_STALE_DAYS && property.tier === "primary") {
      out.observations.push({
        kind: "pr_stale",
        disposition: "needs_her",
        needs_her_why:
          `Answer ${pr.user.login} on "${pr.title}" — this is a client property and the reply has to come ` +
          `from you. It has been open ${age} day${age === 1 ? "" : "s"}.`,
        headline: `${property.label} (client): PR #${pr.number} from ${pr.user.login} has been open ${age} days.`,
        evidence: pr.html_url,
      });
      continue;
    }

    if (age >= PR_STALE_DAYS) {
      out.observations.push({
        kind: "pr_stale",
        disposition: "dispatch",
        headline: `PR #${pr.number} "${pr.title}" has been open ${age} days in ${full}.`,
        evidence: pr.html_url,
      });
    }
  }

  return out;
}

/**
 * One Cloudflare reading per grid property that has a canonical domain: the Pages project or
 * Worker custom domain serving it, and the age of its latest deployment.
 *
 * READ-ONLY: three GETs against the account, no writes. Every reason it cannot read is a `blocked`
 * row with the sentence, so the card never shows a blank for this reader.
 */
async function cloudflareReadings() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "8d147e242033699dd37c6f5a451f48d2";
  const withDomains = GRID.filter((p) => p.domains.length > 0);
  const blockedAll = (why) => withDomains.map((p) => ({
    property_key: p.key, reader: "cloudflare", target: p.domains[0], state: "blocked", summary: why, numbers: {}, evidence_url: null, error: why,
  }));
  if (!token) return blockedAll("The Mac's vault run carried no CLOUDFLARE_API_TOKEN, so the deployment state could not be read. Run grid:post through the vault.");

  const cf = async (path) => {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/${path}`, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
    if (!res) return null;
    const json = await res.json().catch(() => null);
    return json?.success ? json.result : null;
  };
  /*
   * THE PAGES LISTING PAGES AT TEN AND REFUSES `per_page` (error 8000024, probed 19 Sep 2026: 34
   * projects over four pages). Walk `page=` until `total_pages`; a listing that stopped at ten
   * would have declared approvalprep, theindustryguides and virtualagency-os "on another account".
   */
  const projects = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects?page=${page}`, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
    const json = res ? await res.json().catch(() => null) : null;
    if (!json?.success) { if (page === 1) { projects.length = 0; } break; }
    projects.push(...(json.result ?? []));
    if (page >= (json.result_info?.total_pages ?? 1)) break;
  }
  const workerDomains = await cf("workers/domains");
  if (projects.length === 0 && !workerDomains) return blockedAll("Cloudflare's API refused the token for both Pages projects and Worker domains (read-only GETs). Check the token's permissions.");

  const out = [];
  for (const p of withDomains) {
    // ONE READING PER DOMAIN. The guides generator is five Pages projects on five domains; a single
    // row per property would report whichever matched first and say nothing about the other four.
    for (const domain of p.domains) {
      const project = projects.find((pr) => (pr.domains ?? []).some((d) => d === domain || d === `www.${domain}`));
      if (project) {
        const dep = project.latest_deployment ?? project.canonical_deployment ?? null;
        const at = dep?.modified_on ? Date.parse(dep.modified_on) : null;
        const stage = dep?.latest_stage ?? null;
        const okStage = !stage || stage.status === "success";
        out.push({
          property_key: p.key, reader: "cloudflare", target: domain,
          state: okStage ? "ok" : "warn",
          summary: `${domain}: Pages project ${project.name}, latest deployment ${stage ? `${stage.name} ${stage.status}` : "recorded"}${at ? ` ${days(at)}d ago` : ""}${dep?.deployment_trigger?.metadata?.branch ? ` from ${dep.deployment_trigger.metadata.branch}` : ""}.`,
          numbers: { kind: "pages", project: project.name, deployment_id: dep?.id ?? null, deployed_at: at, stage: stage?.status ?? null, branch: dep?.deployment_trigger?.metadata?.branch ?? null, domains: project.domains ?? [] },
          evidence_url: `https://dash.cloudflare.com/${accountId}/pages/view/${project.name}`,
          error: okStage ? null : `latest deployment ${stage?.status}`,
        });
        continue;
      }
      const wd = (workerDomains ?? []).find((d) => d.hostname === domain || d.hostname === `www.${domain}`);
      if (wd) {
        out.push({
          property_key: p.key, reader: "cloudflare", target: domain,
          state: "ok",
          summary: `${domain}: served by Worker ${wd.service} (custom domain, zone ${wd.zone_name ?? "?"}).`,
          numbers: { kind: "worker", service: wd.service, hostname: wd.hostname, environment: wd.environment ?? null },
          evidence_url: `https://dash.cloudflare.com/${accountId}/workers/services/view/${wd.service}`,
          error: null,
        });
        continue;
      }
      const why = `No Pages project or Worker custom domain on this account serves ${domain}. Either it is hosted elsewhere or the project is on another account.`;
      out.push({ property_key: p.key, reader: "cloudflare", target: domain, state: "blocked", summary: why, numbers: {}, evidence_url: null, error: why });
    }
  }
  return out;
}

async function main() {
  const startedAt = Date.now();

  /*
   * THE SCOPE IS THE GRID, AND WHAT IS OUT OF IT IS NAMED. Not left out — named, because an
   * exclusion that is merely an absence is picked up again by the next scope that says "all her
   * repos", which is precisely what happened to west-peek.
   */
  const scope = [];
  const refused = [];
  for (const property of GRID) {
    for (const repo of property.repos) {
      if (isExcluded(repo)) { refused.push({ repo, why: whyExcluded(repo) }); continue; }
      scope.push({ property, repo });
    }
  }

  if (scope.length === 0) {
    console.error("NAMED STOP [EMPTY_GRID] the grid is empty, so this examined nothing.");
    console.error("  Zero properties examined and zero problems found are the same screen, and they");
    console.error("  are opposite facts. src/shared/boss/grid.mjs is the list.");
    process.exit(4);
  }

  const results = [];
  for (const s of scope) results.push(await examineRepo(s.property, s.repo));

  const reached = results.filter((r) => r.reached).length;
  const observations = results.flatMap((r) =>
    r.observations.map((o) => ({ ...o, property_key: r.property.key, repo: r.repo, observed_at: Date.now() })),
  );

  /*
   * ONE `needs_her` A DAY, AND THE CUT IS MADE HERE AS WELL AS IN THE CONTRACT.
   *
   * The contract's cap is structural — `human_touch_days` has the day as its primary key — so this
   * is not what enforces it. What this prevents is a BACKLOG: posting nine needs-her rows on a
   * Monday means eight of them sit open and trickle out over the next eight mornings, long after
   * the pull request they were about has been merged. Oldest first, because a person who has been
   * waiting longest is the one who has been waiting longest.
   */
  const her = observations
    .filter((o) => o.disposition === "needs_her")
    .sort((a, b) => String(a.evidence).localeCompare(String(b.evidence)));
  const kept = new Set(her.slice(0, 1));
  const final = observations.filter((o) => o.disposition !== "needs_her" || kept.has(o));

  const payload = {
    started_at: startedAt,
    finished_at: Date.now(),
    properties_expected: scope.length,
    properties_examined: reached,
    excluded: refused,
    observations: final,
  };

  if (JSON_OUT) { console.log(JSON.stringify(payload, null, 2)); return; }

  console.log(`Grid examination — ${reached} of ${scope.length} repositories read, ${refused.length} refused by name.\n`);
  for (const { repo, why } of refused) console.log(`  — ${repo} NOT examined: ${why}`);
  if (refused.length) console.log("");

  const dispatch = final.filter((o) => o.disposition === "dispatch");
  const mine = final.filter((o) => o.disposition === "needs_her");

  if (mine.length === 0) {
    console.log("NOTHING NEEDS YOU. That is the answer on most days and it is a real one.");
  } else {
    for (const o of mine) {
      console.log(`NEEDS YOU — ${o.headline}\n    ${o.needs_her_why}\n    ${o.evidence}`);
    }
  }
  console.log("");
  if (dispatch.length === 0) {
    console.log("Nothing to dispatch either: every lane is green, shipping and unblocked.");
  } else {
    console.log(`${dispatch.length} item(s) for somebody else. These never reach your contract:`);
    for (const o of dispatch) console.log(`  · ${o.headline}`);
  }

  if (reached < scope.length) {
    console.log(`\n${scope.length - reached} repository(ies) could not be read. That is not a clean run.`);
  }

  if (!POST) { console.log("\nRe-run with --post to file this in Boss OS."); return; }

  const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
  if (!process.env.BOSS_PASSCODE) {
    console.error("\nNAMED STOP [NO_PASSCODE] --post files this in Boss OS, which needs the vault:");
    console.error("  npm run vault:run -- node scripts/ops/grid-watch.mjs --post");
    process.exit(5);
  }
  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  }).catch(() => null);
  if (!unlock?.ok) {
    console.error(`\nNAMED STOP [UNLOCK_FAILED] Boss OS refused the passcode (${unlock?.status ?? "no response"}).`);
    process.exit(6);
  }
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];
  const res = await fetch(`${ORIGIN}/api/boss/grid/examination`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(payload),
  }).catch(() => null);
  if (!res?.ok) {
    console.error(`\nNAMED STOP [NOT_FILED] ${res?.status ?? "no response"} — the examination ran and Boss OS was not told.`);
    process.exit(7);
  }
  const filed = await res.json().catch(() => ({}));
  console.log(`\nFiled: ${filed?.data?.observations ?? "?"} observation(s), ${filed?.data?.dispatched ?? 0} dispatched.`);

  /*
   * ─── THE TWO MAC-SIDE HEALTH READERS, POSTED TOGETHER (19 Sep 2026) ───────
   *
   * GitHub: the reading each `examineRepo` recorded above. Cloudflare: read HERE because
   * `CLOUDFLARE_API_TOKEN` is deliberately never synced to the Worker (it is the credential the
   * sync authenticates WITH); `npm run grid:post` runs through the vault, so it is in this
   * process's environment and nowhere else. Both land in `property_health_readings` through
   * `/api/grid/health/readings`, which refuses a property the grid does not declare.
   *
   * A Cloudflare reading that cannot be taken is a BLOCKED row that says why — no token, no
   * account id, no project matching the property's domains — never a missing card.
   */
  const readings = results.filter((r) => r.reading).map((r) => r.reading);
  readings.push(...(await cloudflareReadings()));
  const posted = await fetch(`${ORIGIN}/api/boss/grid/health/readings`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ readings }),
  }).catch(() => null);
  if (!posted?.ok) {
    console.error(`\nNAMED STOP [READINGS_NOT_FILED] ${posted?.status ?? "no response"} — ${readings.length} health reading(s) were taken and Boss OS was not told: ${await posted?.text().catch(() => "")}`);
    process.exit(9);
  }
  console.log(`Health readings filed: ${readings.length} (${readings.filter((r) => r.reader === "github").length} GitHub, ${readings.filter((r) => r.reader === "cloudflare").length} Cloudflare).`);

  /*
   * RULE 0, AT THE EXIT CODE. A run that reached nothing must go RED on the duty row, because the
   * contract's silence and the examination's blindness look identical on her screen and are
   * opposite facts.
   */
  if (reached === 0) {
    console.error("NAMED STOP [EXAMINED_NOTHING] no grid repository could be read. This is not a quiet day.");
    process.exit(8);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`GRID WATCH FAILED: ${err?.stack ?? err}`); process.exit(1); });
}
