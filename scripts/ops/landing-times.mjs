#!/usr/bin/env node
/**
 * HOW LONG A CHANGE REALLY TAKES, PR TO LIVE (owner, 22 Nov 2026: "landing shit takes fucking forever";
 * offered "measure real PR-to-live times for a week": "yes to all").
 *
 * For every PR merged in the last 7 days across her GitHub account, four moments, read from GitHub
 * itself (land keeps no timing log of its own; GitHub keeps all of it):
 *   opened   the PR's createdAt
 *   PASS     the first time a reviewer's `Ship-ready|Launch-ready|Engineering: PASS` line is on the PR
 *            (a comment, or the body: its edit history says when the line arrived); `Owner override`
 *            (her bypass) counts as the review; none = "not reviewed" for that PR, never 0 minutes
 *   merged   mergedAt
 *   live     the first production Deployment that went green after the merge (land records one per
 *            production deploy), else the merge commit's deploy run (a workflow or a Cloudflare build
 *            whose name says deploy, pages, publish, promote or release) finishing green; neither =
 *            "no deploy on record" for that PR (a script repo, docs), counted apart, never 0 minutes
 * and inside them, where the time went: each CI job's wait for a runner (queued: startedAt minus its
 * suite's createdAt) and its run (running), on the PR's last commit and on the merge commit, plus the
 * review rounds that ended in FAIL before the PASS.
 *
 * Read-only by construction: the only request this makes is a GraphQL query; `graphql()` refuses any
 * text that is a mutation, so nothing in any repository's history can be changed by this job.
 *
 *   node scripts/ops/landing-times.mjs                 # print the week's line and post the morning section
 *   node scripts/ops/landing-times.mjs --dry-run       # print the line and every PR's row; post nothing
 *   node scripts/ops/landing-times.mjs --days 7 --json # rows as JSON (for the readout)
 *
 * The morning email shows the lines on Sundays (section "landing", MORNING_SECTION_SPECS), written by
 * job-landing-times.yml (cloud, Sundays 05:40 Central, fired by the Worker clock), with that run's own
 * token so it never spends the account's hourly allowance.
 * RULE 0: zero PRs read is NAMED STOP [NO_PRS_READ] (exit 2); GitHub not answering is
 * NAMED STOP [GITHUB_UNREACHABLE] (exit 75); neither ever prints "0 minutes".
 */
import { execFileSync } from "node:child_process";
import { outputLine } from "../../src/shared/boss/alarms/rules.mjs";

const OWNER = process.env.LANDING_OWNER ?? "seq23";
const MIN = 60_000;

export const PASS_RE = /\b(?:Ship-ready|Launch-ready|Engineering)\s*:\s*PASS\b/i;
export const FAIL_RE = /\b(?:Ship-ready|Launch-ready|Engineering)\s*:\s*FAIL\b/i;
export const BYPASS_RE = /^\s*Owner override\s*:/im;
export const DEPLOY_RE = /deploy|pages|publish|promote|release|workers builds|cloudflare/i;

function stop(code, exit, words) {
  return Object.assign(new Error(`NAMED STOP [${code}] ${words}`), { code: exit });
}

// ─── Pure parts ──────────────────────────────────────────────────────────────────────────────────

const t = (iso) => (iso ? Date.parse(iso) : NaN);
const ok = (n) => Number.isFinite(n);

/** When the PASS (or her bypass) first stood on the PR, as ms; null when it never did. Pure. */
export function passAt(pr) {
  const created = t(pr.createdAt);
  const seen = [];
  for (const c of pr.comments ?? []) if (PASS_RE.test(c.body ?? "") || BYPASS_RE.test(c.body ?? "")) seen.push(t(c.createdAt));
  const edits = pr.edits ?? [];
  for (const e of edits) if (PASS_RE.test(e.diff ?? "") || BYPASS_RE.test(e.diff ?? "")) seen.push(t(e.editedAt));
  // A body that carries the line with no edit history had it from the start.
  if (!edits.length && (PASS_RE.test(pr.body ?? "") || BYPASS_RE.test(pr.body ?? ""))) seen.push(created);
  const first = seen.filter(ok).sort((a, b) => a - b)[0];
  return ok(first) ? Math.max(first, created) : null;
}

/** Review rounds that ended in FAIL (comments, and body versions that carried a FAIL line). Pure. */
export function failRounds(pr) {
  let n = (pr.comments ?? []).filter((c) => FAIL_RE.test(c.body ?? "")).length;
  const bodies = (pr.edits ?? []).map((e) => e.diff ?? "");
  if (!bodies.length && FAIL_RE.test(pr.body ?? "")) n += 1;
  // Each distinct FAIL line that appeared in the body's history is one round.
  const lines = new Set();
  for (const b of bodies) for (const l of b.split("\n")) if (FAIL_RE.test(l)) lines.add(l.trim());
  return n + lines.size;
}

/** Runner waits in a set of check suites: { queued, running } in ms (each the longest job's). Pure. */
export function ciWaits(suites) {
  let queued = 0, running = 0, jobs = 0, firstStart = Infinity, lastEnd = -Infinity;
  for (const s of suites ?? []) {
    if (s.app !== "github-actions") continue;
    for (const r of s.runs ?? []) {
      const st = t(r.startedAt), en = t(r.completedAt), cr = t(s.createdAt);
      if (!ok(st)) continue;
      jobs++;
      if (ok(cr)) queued = Math.max(queued, st - cr);
      firstStart = Math.min(firstStart, st);
      if (ok(en)) lastEnd = Math.max(lastEnd, en);
    }
  }
  if (jobs && ok(lastEnd) && ok(firstStart)) running = Math.max(0, lastEnd - firstStart);
  return { queued: Math.max(0, queued), running, jobs };
}

/** When the merge went live, ms; null with no deploy on record. Pure. */
export function liveAt(pr, deployments) {
  const merged = t(pr.mergedAt);
  const fromDeploy = (deployments ?? [])
    .flatMap((d) => (d.statuses ?? []).filter((s) => s.state === "SUCCESS").map((s) => t(s.createdAt)))
    .filter((x) => ok(x) && x >= merged)
    .sort((a, b) => a - b)[0];
  if (ok(fromDeploy)) return fromDeploy;
  const ends = [];
  for (const s of pr.mainSuites ?? []) {
    const named = DEPLOY_RE.test(`${s.workflow ?? ""} ${s.app ?? ""}`);
    for (const r of s.runs ?? []) {
      if ((named || DEPLOY_RE.test(r.name ?? "")) && r.conclusion === "SUCCESS" && ok(t(r.completedAt))) ends.push(t(r.completedAt));
    }
  }
  return ends.length ? Math.max(...ends) : null;
}

/** One PR's row: every moment and every wait, null where GitHub has no record. Pure. */
export function prRow(pr, deployments) {
  const opened = t(pr.createdAt), merged = t(pr.mergedAt);
  const pass = passAt(pr), live = liveAt(pr, deployments);
  const ci = ciWaits(pr.headSuites), main = ciWaits(pr.mainSuites);
  return {
    repo: pr.repo, number: pr.number,
    opened: pr.createdAt, pass: pass === null ? null : new Date(pass).toISOString(), merged: pr.mergedAt,
    live: live === null ? null : new Date(live).toISOString(),
    review_ms: pass === null ? null : pass - opened,
    to_merge_ms: merged - (pass ?? opened),
    to_live_ms: live === null ? null : live - merged,
    total_ms: live === null ? null : live - opened,
    open_to_merge_ms: merged - opened,
    fail_rounds: failRounds(pr),
    ci_queued_ms: ci.queued, ci_running_ms: ci.running,
    main_queued_ms: main.queued, main_running_ms: main.running,
  };
}

export function median(xs) {
  const v = xs.filter(ok).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function dur(ms) {
  if (!ok(ms)) return "not recorded";
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/**
 * The week's line. Never "0 minutes" for nothing: no rows is a named stop before this is called, and a
 * step with no record says "not recorded". Pure.
 */
export function weekLines(rows, { days = 7 } = {}) {
  if (!rows.length) throw stop("NO_PRS_READ", 2, "no merged PR was read, so there is no landing time to report");
  const live = rows.filter((r) => r.total_ms !== null);
  const slow = [...live].sort((a, b) => b.total_ms - a.total_ms)[0];
  const sum = (k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
  const fails = sum("fail_rounds");
  const reviewed = rows.filter((r) => r.review_ms !== null).length;
  const head = live.length
    ? `${rows.length} PRs merged in the last ${days} days; ${live.length} have a deploy on record. Opened to live: median ${dur(median(live.map((r) => r.total_ms)))}, slowest ${slow.repo} #${slow.number} at ${dur(slow.total_ms)}.`
    : `${rows.length} PRs merged in the last ${days} days; none has a deploy on record, so opened to merged: median ${dur(median(rows.map((r) => r.open_to_merge_ms)))}.`;
  const where = `Where the time went (median per PR): review ${dur(median(rows.map((r) => r.review_ms)))} (${reviewed} of ${rows.length} reviewed, ${fails} FAIL round${fails === 1 ? "" : "s"}), PASS to merge ${dur(median(rows.map((r) => r.to_merge_ms)))}, merge to live ${dur(median(live.map((r) => r.to_live_ms)))}.`;
  const runners = `Waiting for a GitHub runner, all PRs together: ${dur(sum("ci_queued_ms") + sum("main_queued_ms"))} (running: ${dur(sum("ci_running_ms") + sum("main_running_ms"))}).`;
  return [head, where, runners];
}

// ─── GitHub (read-only) ──────────────────────────────────────────────────────────────────────────

function token() {
  const env = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (env) return env;
  try { return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim(); } catch { return ""; }
}

/** One GraphQL query. Refuses a mutation, so this job can only read. */
export async function graphql(query, variables = {}, { fetchImpl = fetch, tok = token(), wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (/^\s*mutation\b/i.test(query) || /\bmutation\s*[({]/i.test(query)) throw stop("READ_ONLY", 9, "landing-times sends queries only; a mutation was refused");
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchImpl("https://api.github.com/graphql", {
        method: "POST",
        headers: { authorization: `bearer ${tok}`, "content-type": "application/json", "user-agent": "boss-os-landing-times" },
        body: JSON.stringify({ query, variables }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.data && !body.errors?.length) return body.data;
      // GitHub answered and refused the query itself (too big, bad field): asking again cannot help.
      if (res.ok && body?.errors?.length) throw stop("GITHUB_QUERY_REFUSED", 75, `GitHub refused the query (${JSON.stringify(body.errors).slice(0, 200)}); nothing was measured`);
      last = `HTTP ${res.status} ${JSON.stringify(body?.errors ?? body?.message ?? "").slice(0, 200)}`;
      if (res.status < 500 && res.status !== 403 && res.status !== 429) break;
    } catch (e) { if (e?.code === 75 || e?.code === 9) throw e; last = String(e?.message ?? e); }
    await wait(2000 * attempt);
  }
  throw stop("GITHUB_UNREACHABLE", 75, `GitHub did not answer (${last}); nothing was measured, the next run tries again`);
}

const SUITES = `checkSuites(first: 12) { nodes { createdAt app { slug } workflowRun { workflow { name } }
  checkRuns(first: 15) { nodes { name startedAt completedAt conclusion } } } }`;
const suitesOf = (c) => (c?.checkSuites?.nodes ?? []).map((s) => ({
  createdAt: s.createdAt, app: s.app?.slug ?? "", workflow: s.workflowRun?.workflow?.name ?? "",
  runs: (s.checkRuns?.nodes ?? []).map((r) => ({ name: r.name, startedAt: r.startedAt, completedAt: r.completedAt, conclusion: r.conclusion })),
}));

export async function readWeek({ days = 7, now = Date.now(), gql = graphql } = {}) {
  const since = now - days * 86_400_000;
  const repos = [];
  let after = null;
  do {
    const d = await gql(`query($o: String!, $a: String) { user(login: $o) { repositories(first: 100, after: $a, isFork: false, ownerAffiliations: OWNER) {
      pageInfo { hasNextPage endCursor } nodes { name isArchived pushedAt } } } }`, { o: OWNER, a: after });
    const c = d.user.repositories;
    repos.push(...c.nodes.filter((r) => !r.isArchived && t(r.pushedAt) >= since).map((r) => r.name));
    after = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
  } while (after);

  const prs = [], deploys = {};
  for (const name of repos) {
    let cur = null, more = true;
    while (more) {
      const d = await gql(`query($o: String!, $n: String!, $a: String) { repository(owner: $o, name: $n) {
        deployments(last: 40, environments: ["production"]) { nodes { createdAt statuses(first: 5) { nodes { state createdAt } } } }
        pullRequests(states: MERGED, first: 8, after: $a, orderBy: { field: UPDATED_AT, direction: DESC }) {
          pageInfo { hasNextPage endCursor }
          nodes { number createdAt mergedAt updatedAt body
            comments(last: 25) { nodes { createdAt body } }
            userContentEdits(first: 10) { nodes { editedAt diff } }
            commits(last: 1) { nodes { commit { ${SUITES} } } }
            mergeCommit { ${SUITES} } } } } }`, { o: OWNER, n: name, a: cur });
      const repo = d.repository;
      deploys[name] ??= (repo.deployments?.nodes ?? []).map((x) => ({ createdAt: x.createdAt, statuses: x.statuses?.nodes ?? [] }));
      const page = repo.pullRequests;
      for (const p of page.nodes) {
        if (t(p.mergedAt) < since) continue;
        prs.push({
          repo: name, number: p.number, createdAt: p.createdAt, mergedAt: p.mergedAt, body: p.body,
          comments: p.comments.nodes, edits: p.userContentEdits.nodes,
          headSuites: suitesOf(p.commits.nodes[0]?.commit), mainSuites: suitesOf(p.mergeCommit),
        });
      }
      const oldest = page.nodes.at(-1);
      more = page.pageInfo.hasNextPage && oldest && t(oldest.updatedAt) >= since;
      cur = page.pageInfo.endCursor;
    }
  }
  return { repos: repos.length, rows: prs.map((p) => prRow(p, deploys[p.repo])) };
}

// ─── Run ─────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  const days = Number(args[args.indexOf("--days") + 1]) || 7;
  const { repos, rows } = await readWeek({ days });
  if (!repos) throw stop("NO_REPOS_READ", 2, `no repository of ${OWNER} was pushed in the last ${days} days, or the list did not load`);
  const lines = weekLines(rows, { days });
  if (args.includes("--json")) console.log(JSON.stringify(rows, null, 1));
  else if (dry) for (const r of rows) console.log([r.repo, `#${r.number}`, `review ${dur(r.review_ms)}`, `to merge ${dur(r.to_merge_ms)}`, `to live ${dur(r.to_live_ms)}`, `queued ${dur(r.ci_queued_ms + r.main_queued_ms)}`, `fails ${r.fail_rounds}`].join("  "));
  for (const l of lines) console.log(l);
  if (!dry) {
    const { writeMorningSection } = await import("../../src/shared/boss/mail/morning.mjs");
    writeMorningSection("landing", { title: "Landing speed, PR to live", lines });
  }
  console.log(outputLine(rows.length, "PRs measured"));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => { console.error(e.message); process.exit(e.code ?? 1); });
}
