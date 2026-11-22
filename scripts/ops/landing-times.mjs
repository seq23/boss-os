#!/usr/bin/env node
/**
 * HOW LONG A CHANGE REALLY TAKES, PR TO LIVE (owner, 22 Nov 2026: "landing shit takes fucking forever";
 * offered "measure real PR-to-live times for a week": "yes to all").
 *
 * For every PR merged in the last 7 days across her GitHub account, four moments, read from GitHub
 * itself (land keeps no timing log of its own; GitHub keeps all of it):
 *   opened   the PR's createdAt
 *   PASS     the first time a reviewer's `Ship-ready|Launch-ready: PASS` line is on the PR (a comment, or
 *            the body: its edit history says when the line arrived); `Owner override` (her bypass) counts
 *            as the review. A comment whose verdict is fail (first line `VERDICT: fail`, or a
 *            `Ship-ready: FAIL` line) is never the PASS, even if it also says `Engineering: PASS`. None =
 *            "no review" for that PR: no review time and no PASS-to-merge time, never measured from the
 *            opening. A PASS already there when the PR opened = "reviewed before the PR opened", counted
 *            apart and kept out of the review median (the time was spent, just not on the PR).
 *   merged   mergedAt
 *   live     the first production Deployment of THE MERGE COMMIT that went green (land records one per
 *            production deploy), else the merge commit's deploy run (a workflow or a Cloudflare build
 *            whose name says deploy, pages, publish, promote or release) finishing green; neither =
 *            "no deploy on record" for that PR (a script repo, docs), counted apart, never 0 minutes and
 *            never another commit's deploy
 * and inside them, where the time went: each CI job's wait for a runner (queued: startedAt minus its
 * suite's createdAt) and its run (running), on the PR's last commit and on the merge commit (earlier
 * pushes are not counted, and the line says "last commit"), plus the fail verdicts posted on it.
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
 * token, so it never spends the account's hourly allowance. The Mac catch-up (`npm run landing:times`)
 * uses her gh token instead: about 90 GraphQL points of her 5,000, a separate budget from the REST calls
 * land waits on.
 * RULE 0: zero PRs read is NAMED STOP [NO_PRS_READ] (exit 2); GitHub not answering is
 * NAMED STOP [GITHUB_UNREACHABLE] (exit 75); a bad or under-scoped token is NAMED STOP
 * [GITHUB_TOKEN_REFUSED] (exit 3); a wrong owner is NAMED STOP [OWNER_NOT_FOUND] (exit 3). A repo in the
 * Repos map that this token cannot see is named in the line: a PUBLIC one is NAMED STOP
 * [REPOS_NOT_READABLE] (exit 3) after the line is written; a private one (the job token reads public
 * repos only, and the job is never given her token, 22 Nov 2026) is "not measured: private or gone (<name>)" and a
 * NOTE, exit 0. None ever prints "0 minutes".
 */
import { execFileSync } from "node:child_process";
import { outputLine } from "../../src/shared/boss/alarms/rules.mjs";

const OWNER = process.env.LANDING_OWNER ?? "seq23";
const MIN = 60_000;

export const PASS_RE = /\b(?:Ship-ready|Launch-ready)\s*:\s*PASS\b/i;
export const FAIL_RE = /\b(?:Ship-ready|Launch-ready|Engineering)\s*:\s*FAIL\b/i;
export const VERDICT_RE = /^\s*VERDICT\s*:\s*(pass|fail)\b/i;
export const BYPASS_RE = /^\s*Owner override\s*:/im;
export const DEPLOY_RE = /deploy|pages|publish|promote|release|workers builds|cloudflare/i;

function stop(code, exit, words) {
  return Object.assign(new Error(`NAMED STOP [${code}] ${words}`), { code: exit });
}

// ─── Pure parts ──────────────────────────────────────────────────────────────────────────────────

const t = (iso) => (iso ? Date.parse(iso) : NaN);
const ok = (n) => Number.isFinite(n);

/**
 * A comment's verdict: its first line's `VERDICT: pass|fail` (the field every reviewer posts first), else
 * fail when it carries a FAIL line, else pass when it carries a PASS line or her bypass, else null. A
 * protocol field read as structure, never meaning. Pure.
 */
export function verdictOf(body = "") {
  const first = body.split("\n").find((l) => l.trim()) ?? "";
  const v = VERDICT_RE.exec(first);
  if (v) return v[1].toLowerCase();
  if (FAIL_RE.test(body)) return "fail";
  if (PASS_RE.test(body) || BYPASS_RE.test(body)) return "pass";
  return null;
}

/** When the PASS (or her bypass) first stood on the PR, as ms; null when it never did. Pure. */
export function passAt(pr) {
  const created = t(pr.createdAt);
  const seen = [];
  for (const c of pr.comments ?? []) if (verdictOf(c.body ?? "") === "pass") seen.push(t(c.createdAt));
  const edits = pr.edits ?? [];
  for (const e of edits) if (PASS_RE.test(e.diff ?? "") || BYPASS_RE.test(e.diff ?? "")) seen.push(t(e.editedAt));
  // A body that carries the line with no edit history had it from the start.
  if (!edits.length && (PASS_RE.test(pr.body ?? "") || BYPASS_RE.test(pr.body ?? ""))) seen.push(created);
  const first = seen.filter(ok).sort((a, b) => a - b)[0];
  return ok(first) ? Math.max(first, created) : null;
}

/** Fail verdicts posted on the PR (each fail comment is one round, plus FAIL lines in the body's history). Pure. */
export function failRounds(pr) {
  let n = (pr.comments ?? []).filter((c) => verdictOf(c.body ?? "") === "fail").length;
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

/**
 * When the merge went live, ms; null with no deploy on record. Only the merge commit's own deployments
 * count (pr.mergeDeploys): a repo's other deployments are never borrowed, so a merge older than what was
 * read is "not recorded", never the oldest deploy seen (review F1, 22 Nov 2026). Pure.
 */
export function liveAt(pr) {
  const merged = t(pr.mergedAt);
  const fromDeploy = (pr.mergeDeploys ?? [])
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
export function prRow(pr) {
  const opened = t(pr.createdAt), merged = t(pr.mergedAt);
  const pass = passAt(pr), live = liveAt(pr);
  // A PASS already on the PR within a minute of it opening was written before it: not a 0-minute review.
  const early = pass !== null && pass - opened < MIN;
  const ci = ciWaits(pr.headSuites), main = ciWaits(pr.mainSuites);
  return {
    repo: pr.repo, number: pr.number,
    opened: pr.createdAt, pass: pass === null ? null : new Date(pass).toISOString(), merged: pr.mergedAt,
    live: live === null ? null : new Date(live).toISOString(),
    reviewed: pass === null ? "no" : early ? "before opening" : "yes",
    review_ms: pass === null || early ? null : pass - opened,
    to_merge_ms: pass === null ? null : merged - pass,
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
  if (h >= 48) return `${Math.round(h / 24)} days`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/**
 * The week's two scorecard numbers, kept on the morning section (scorecard row "landing-speed" reads them from
 * D1): of the merged PRs with a deploy on record, the share live within an hour of merging, and the share live
 * within a day of opening. No PR with a deploy is null (not read), never 0 or 100. Pure.
 */
export function weekMeasures(rows) {
  const live = rows.filter((r) => ok(r.total_ms) && ok(r.to_live_ms));
  const pct = (f) => (live.length ? Math.round((1000 * live.filter(f).length) / live.length) / 10 : null);
  return {
    prs: rows.length, live: live.length,
    landed_in_hour_pct: pct((r) => r.to_live_ms <= 60 * MIN),
    live_in_day_pct: pct((r) => r.total_ms <= 24 * 60 * MIN),
  };
}

/** The morning section as written: the lines she reads, and the measures the scorecard reads. Pure. */
export function sectionBody(rows, opts = {}) {
  return { title: "Landing speed, PR to live", lines: weekLines(rows, opts), measures: weekMeasures(rows) };
}

/**
 * The week's line. Never "0 minutes" for nothing: no rows is a named stop before this is called, and a
 * step with no record says "not recorded". Pure.
 */
export function weekLines(rows, { days = 7, unreadable = [], privateRepos = [] } = {}) {
  if (!rows.length) throw stop("NO_PRS_READ", 2, "no merged PR was read, so there is no landing time to report");
  const live = rows.filter((r) => r.total_ms !== null);
  // Slowest LANDING (merge to live): opened-to-live is won by month-old PRs and says nothing about landing.
  const slow = [...live].sort((a, b) => b.to_live_ms - a.to_live_ms)[0];
  const sum = (k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
  const fails = sum("fail_rounds");
  const n = (v) => rows.filter((r) => r.reviewed === v).length;
  const unreviewed = rows.filter((r) => r.reviewed === "no");
  const head = live.length
    ? `${rows.length} PRs merged in the last ${days} days; ${live.length} have a deploy on record. Opened to live: median ${dur(median(live.map((r) => r.total_ms)))}; slowest merge to live ${slow.repo} #${slow.number} at ${dur(slow.to_live_ms)}.`
    : `${rows.length} PRs merged in the last ${days} days; none has a deploy on record, so opened to merged: median ${dur(median(rows.map((r) => r.open_to_merge_ms)))}.`;
  const where = `Where the time went (median per PR): review ${dur(median(rows.map((r) => r.review_ms)))} (${n("yes")} reviewed on the PR, ${n("before opening")} before it opened, ${n("no")} with no review; ${fails} fail verdict${fails === 1 ? "" : "s"}), PASS to merge ${dur(median(rows.map((r) => r.to_merge_ms)))}, merge to live ${dur(median(live.map((r) => r.to_live_ms)))}${unreviewed.length ? `; no-review PRs opened to merged ${dur(median(unreviewed.map((r) => r.open_to_merge_ms)))}` : ""}.`;
  const runners = `Waiting for a GitHub runner (each PR's last commit and its merge), all PRs together: ${dur(sum("ci_queued_ms") + sum("main_queued_ms"))} (running: ${dur(sum("ci_running_ms") + sum("main_running_ms"))}).`;
  const lines = [head, where, runners];
  if (unreadable.length) lines.push(`${unreadable.length} repo${unreadable.length === 1 ? "" : "s"} not readable with this token, so not measured: ${unreadable.join(", ")}.`);
  if (privateRepos.length) lines.push(`Not measured: private or gone (${privateRepos.join(", ")}).`);
  return lines;
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
  let last = "", pause = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    pause = 0;
    try {
      const res = await fetchImpl("https://api.github.com/graphql", {
        method: "POST",
        headers: { authorization: `bearer ${tok}`, "content-type": "application/json", "user-agent": "boss-os-landing-times" },
        body: JSON.stringify({ query, variables }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.data && !body.errors?.length) return body.data;
      const said = JSON.stringify(body?.errors ?? body?.message ?? "").slice(0, 200);
      const types = (body?.errors ?? []).map((e) => e?.type);
      // GitHub answered and said no to this token: a retry cannot fix it.
      // ...unless the "no" is a rate limit (primary or secondary): that one passes, so it is waited out.
      const limited = res.status === 429 || res.headers?.get?.("x-ratelimit-remaining") === "0"
        || res.headers?.get?.("retry-after") != null || /rate limit/i.test(said);
      if (limited) pause = Math.min(Math.max(Number(res.headers?.get?.("retry-after")) || 0, 60) * 1000, 180_000);
      if (res.status === 401 || (res.status === 403 && !limited) || types.includes("FORBIDDEN")) {
        throw stop("GITHUB_TOKEN_REFUSED", 3, `GitHub refused this token (HTTP ${res.status} ${said}); the token is missing, expired or not valid for GitHub's API (the cloud run's job token is read-only and reads public repos; a scope cannot be added to it); nothing was measured`);
      }
      if (types.includes("NOT_FOUND")) throw Object.assign(stop("GITHUB_NOT_FOUND", 3, `GitHub has no such owner or repository (${said}); nothing was measured`), { notFound: true });
      // GitHub answered and refused the query itself (too big, bad field): asking again cannot help, and
      // partial data with errors is never used.
      if (res.ok && body?.errors?.length) throw stop("GITHUB_QUERY_REFUSED", 75, `GitHub refused the query (${said}); nothing was measured`);
      last = `HTTP ${res.status} ${said}`;
      if (res.status < 500 && !limited) break;
    } catch (e) { if ([75, 9, 3].includes(e?.code) && /NAMED STOP/.test(e?.message ?? "")) throw e; last = String(e?.message ?? e); }
    await wait(pause || 2000 * attempt);
  }
  throw stop("GITHUB_UNREACHABLE", 75, `GitHub did not answer (${last}); nothing was measured, the next run tries again`);
}

const SUITES = `checkSuites(first: 12) { nodes { createdAt app { slug } workflowRun { workflow { name } }
  checkRuns(first: 15) { nodes { name startedAt completedAt conclusion } } } }`;
const suitesOf = (c) => (c?.checkSuites?.nodes ?? []).map((s) => ({
  createdAt: s.createdAt, app: s.app?.slug ?? "", workflow: s.workflowRun?.workflow?.name ?? "",
  runs: (s.checkRuns?.nodes ?? []).map((r) => ({ name: r.name, startedAt: r.startedAt, completedAt: r.completedAt, conclusion: r.conclusion })),
}));

const DEPLOYS = `deployments(first: 5, environments: ["production"]) { nodes { createdAt statuses(first: 5) { nodes { state createdAt } } } }`;

/** The Repos map's live repos (not retired): every one must be visible to the token, or the line says so. */
export function expectedRepos(map) {
  return (map?.rows ?? []).filter((r) => r.repo && r.category !== "retired").map((r) => r.repo);
}

/** Is github.com/<owner>/<name> public? Asked logged out, so the answer is GitHub's, never the token's.
 * A 404 is private or gone (deleted, renamed); anything else (5xx, 429, a thrown error) counts as public,
 * so a probe that fails keeps the run red. */
export async function isPublicRepo(owner, name, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`https://github.com/${owner}/${name}`, { method: "HEAD", redirect: "follow" });
    return res.status !== 404;
  } catch { return true; }
}

export async function readWeek({ days = 7, now = Date.now(), gql = graphql, owner = OWNER, expected = [], isPublic = isPublicRepo } = {}) {
  const since = now - days * 86_400_000;
  const repos = [], seen = new Set();
  let after = null;
  do {
    let d;
    try {
      d = await gql(`query($o: String!, $a: String) { user(login: $o) { repositories(first: 100, after: $a, ownerAffiliations: OWNER) {
        pageInfo { hasNextPage endCursor } nodes { name isArchived pushedAt } } } }`, { o: owner, a: after });
    } catch (e) {
      if (e?.notFound) throw stop("OWNER_NOT_FOUND", 3, `GitHub has no user "${owner}" (LANDING_OWNER); nothing was measured`);
      throw e;
    }
    if (!d?.user) throw stop("OWNER_NOT_FOUND", 3, `GitHub has no user "${owner}" (LANDING_OWNER); nothing was measured`);
    const c = d.user.repositories;
    for (const r of c.nodes) seen.add(r.name);
    repos.push(...c.nodes.filter((r) => !r.isArchived && t(r.pushedAt) >= since).map((r) => r.name));
    after = c.pageInfo.hasNextPage ? c.pageInfo.endCursor : null;
  } while (after);
  const unseen = expected.filter((r) => !seen.has(r));
  const pub = await Promise.all(unseen.map((r) => isPublic(owner, r)));
  const unreadable = unseen.filter((_, k) => pub[k]), privateRepos = unseen.filter((_, k) => !pub[k]);

  const prs = [];
  for (const name of repos) {
    let cur = null, more = true;
    while (more) {
      const d = await gql(`query($o: String!, $n: String!, $a: String) { repository(owner: $o, name: $n) {
        pullRequests(states: MERGED, first: 8, after: $a, orderBy: { field: UPDATED_AT, direction: DESC }) {
          pageInfo { hasNextPage endCursor }
          nodes { number createdAt mergedAt updatedAt body
            comments(last: 25) { nodes { createdAt body } }
            userContentEdits(first: 10) { nodes { editedAt diff } }
            commits(last: 1) { nodes { commit { ${SUITES} } } }
            mergeCommit { ${SUITES} ${DEPLOYS} } } } } }`, { o: owner, n: name, a: cur });
      const page = d.repository.pullRequests;
      for (const p of page.nodes) {
        if (t(p.mergedAt) < since) continue;
        prs.push({
          repo: name, number: p.number, createdAt: p.createdAt, mergedAt: p.mergedAt, body: p.body,
          comments: p.comments.nodes, edits: p.userContentEdits.nodes,
          headSuites: suitesOf(p.commits.nodes[0]?.commit), mainSuites: suitesOf(p.mergeCommit),
          mergeDeploys: (p.mergeCommit?.deployments?.nodes ?? []).map((x) => ({ createdAt: x.createdAt, statuses: x.statuses?.nodes ?? [] })),
        });
      }
      const oldest = page.nodes.at(-1);
      more = page.pageInfo.hasNextPage && oldest && t(oldest.updatedAt) >= since;
      cur = page.pageInfo.endCursor;
    }
  }
  return { repos: repos.length, unreadable, privateRepos, rows: prs.map((p) => prRow(p)) };
}

// ─── Run ─────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  const i = args.indexOf("--days");
  const days = i >= 0 ? Number(args[i + 1]) : 7;
  if (!(days > 0)) throw stop("BAD_ARGS", 64, "--days needs a positive number of days");
  const { readFileSync } = await import("node:fs");
  const map = JSON.parse(readFileSync(new URL("../../src/shared/boss/maps/repos.json", import.meta.url), "utf8"));
  const { repos, rows, unreadable, privateRepos } = await readWeek({ days, expected: expectedRepos(map) });
  if (!repos) throw stop("NO_REPOS_READ", 2, `no repository of ${OWNER} was pushed in the last ${days} days, or the list did not load`);
  const body = sectionBody(rows, { days, unreadable, privateRepos });
  const { lines } = body;
  if (args.includes("--json")) console.log(JSON.stringify(rows, null, 1));
  else if (dry) for (const r of rows) console.log([r.repo, `#${r.number}`, `review ${dur(r.review_ms)}`, `reviewed ${r.reviewed}`, `to merge ${dur(r.to_merge_ms)}`, `to live ${dur(r.to_live_ms)}`, `queued ${dur(r.ci_queued_ms + r.main_queued_ms)}`, `fails ${r.fail_rounds}`].join("  "));
  for (const l of lines) console.log(l);
  if (!dry) {
    const { writeMorningSection } = await import("../../src/shared/boss/mail/morning.mjs");
    writeMorningSection("landing", body);
  }
  console.log(outputLine(rows.length, "PRs measured"));
  const note = endOfRun({ unreadable, privateRepos });
  if (note) console.log(note);
}

/** Red only when a PUBLIC repo was unreadable (the token should see it); private ones are a note. */
export function endOfRun({ unreadable = [], privateRepos = [] }) {
  if (unreadable.length) throw stop("REPOS_NOT_READABLE", 3, `${unreadable.length} public repo(s) in the Repos map are not visible to this token (${unreadable.join(", ")}); the line says so, and this run is red until it can read them`);
  return privateRepos.length ? `NOTE [REPOS_NOT_READABLE] not measured: private or gone (${privateRepos.join(", ")}); the job token reads public repos only` : null;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => { console.error(e.message); process.exit(e.code ?? 1); });
}
