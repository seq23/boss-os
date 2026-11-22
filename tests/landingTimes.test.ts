import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dur, endOfRun, expectedRepos, failRounds, isPublicRepo, graphql, liveAt, passAt, prRow, readWeek, sectionBody, weekLines, weekMeasures } from "../scripts/ops/landing-times.mjs";

/*
 * PR-to-live, measured (owner, 22 Nov 2026: "landing shit takes fucking forever"). The ways it breaks:
 * zero PRs read or GitHub not answering must be a named stop, never "0 minutes"; a PR with no review
 * or no deploy on record is "not recorded", never counted as instant; the job can only read.
 */
const H = 3_600_000;
const at = (h: number) => new Date(Date.UTC(2026, 10, 20, 12) + h * H).toISOString();
const pr = (o: Record<string, unknown> = {}) => ({
  repo: "r", number: 1, createdAt: at(0), mergedAt: at(3), body: "x", comments: [], edits: [],
  headSuites: [], mainSuites: [], ...o,
});

describe("landing-times: the moments of a PR", () => {
  it("PASS is the first reviewer line, from a comment or a body edit; none is null, never instant", () => {
    expect(passAt(pr({ comments: [{ createdAt: at(2), body: "Ship-ready: PASS — r looked; Engineering: PASS" }] }))).toBe(Date.parse(at(2)));
    expect(passAt(pr({ edits: [{ editedAt: at(1), diff: "Ship-ready: PASS — r; Engineering: PASS" }] }))).toBe(Date.parse(at(1)));
    expect(passAt(pr({ body: 'Owner override: "ship it" (22 Nov)' }))).toBe(Date.parse(at(0)));
    expect(passAt(pr({ comments: [{ createdAt: at(1), body: "Ship-ready: FAIL" }] }))).toBeNull();
  });
  it("live is the merge commit's first green production deploy, else a green deploy run; none is null", () => {
    const dep = [{ statuses: [{ state: "SUCCESS", createdAt: at(2) }, { state: "SUCCESS", createdAt: at(4) }] }];
    expect(liveAt(pr({ mergeDeploys: dep }))).toBe(Date.parse(at(4)));
    const run = { app: "github-actions", workflow: "Deploy", runs: [{ name: "deploy", conclusion: "SUCCESS", completedAt: at(5) }] };
    expect(liveAt(pr({ mainSuites: [run] }))).toBe(Date.parse(at(5)));
    expect(liveAt(pr({ mainSuites: [{ ...run, workflow: "CI", runs: [{ ...run.runs[0], name: "test" }] }] }))).toBeNull();
  });
  it("F1: a merge with no deploy of its own is 'not recorded', never another commit's (the repo's oldest) deploy", async () => {
    // #418's shape: merged 3 days before the oldest deploy the repo list reaches; the repo-wide list must not be used.
    const now = Date.parse(at(24 * 7));
    const repoDeploys = { nodes: [{ createdAt: at(80), statuses: { nodes: [{ state: "SUCCESS", createdAt: at(80) }] } }] };
    const node = { number: 418, createdAt: at(6), mergedAt: at(8), updatedAt: at(8), body: "", comments: { nodes: [] }, userContentEdits: { nodes: [] }, commits: { nodes: [] },
      mergeCommit: { checkSuites: { nodes: [] }, deployments: { nodes: [] } } };
    const gql = async (q: string) => q.includes("repositories(")
      ? { user: { repositories: { pageInfo: { hasNextPage: false }, nodes: [{ name: "r", isArchived: false, pushedAt: at(160) }] } } }
      : { repository: { deployments: repoDeploys, pullRequests: { pageInfo: { hasNextPage: false }, nodes: [node] } } };
    const { rows } = await readWeek({ now, gql });
    expect(rows[0]?.live).toBeNull();
    expect(rows[0]?.to_live_ms).toBeNull();
    // and its own deploy, when there is one, is the one used
    node.mergeCommit.deployments.nodes = [{ createdAt: at(8.3), statuses: { nodes: [{ state: "SUCCESS", createdAt: at(8.35) }] } }] as never;
    const again = await readWeek({ now, gql });
    expect(again.rows[0]?.to_live_ms).toBe(0.35 * H);
  });
  it("F2: an unreviewed PR has no PASS-to-merge time; it is never measured from the opening", () => {
    const row = prRow(pr());
    expect(row.reviewed).toBe("no");
    expect(row.to_merge_ms).toBeNull();
    const lines = weekLines([row, prRow(pr({ number: 2, comments: [{ createdAt: at(1), body: "VERDICT: pass\nShip-ready: PASS — r" }] }))]).join(" ");
    expect(lines).toMatch(/PASS to merge 2 h 0 min|PASS to merge 2 h,/);
    expect(lines).toMatch(/no-review PRs opened to merged 3 h/);
  });
  it("F3: a `VERDICT: fail` comment is one fail round, and a fail verdict is never the PASS", () => {
    const failed = pr({ comments: [
      { createdAt: at(1), body: "VERDICT: fail\n\n## Fails\n- F1 the page is blank" },
      { createdAt: at(1.5), body: "Ship-ready: FAIL — r; Engineering: PASS" },
      { createdAt: at(2), body: "VERDICT: pass\nShip-ready: PASS — r; Engineering: PASS" },
    ] });
    expect(failRounds(failed)).toBe(2);
    expect(passAt(failed)).toBe(Date.parse(at(2)));
    expect(passAt(pr({ comments: [{ createdAt: at(1), body: "VERDICT: fail\nShip-ready: PASS on looks; Engineering: FAIL" }] }))).toBeNull();
    expect(passAt(pr({ comments: [{ createdAt: at(1), body: "Ship-ready: FAIL; Engineering: PASS" }] }))).toBeNull();
  });
  it("F4: a PASS already there when the PR opened is 'reviewed before the PR opened', never a 0-minute review", () => {
    const row = prRow(pr({ body: "Ship-ready: PASS — r looked; Engineering: PASS" }));
    expect(row.reviewed).toBe("before opening");
    expect(row.review_ms).toBeNull();
    const onPr = prRow(pr({ number: 2, comments: [{ createdAt: at(1), body: "Ship-ready: PASS — r" }] }));
    expect(weekLines([row, onPr]).join(" ")).toMatch(/review 1 h 0 min|review 1 h \(/);
    expect(weekLines([row, onPr]).join(" ")).toMatch(/1 reviewed on the PR, 1 before it opened, 0 with no review/);
  });
  it("a row with no review and no deploy says so, and the line says 'not recorded'", () => {
    const row = prRow(pr());
    expect(row.review_ms).toBeNull();
    expect(row.total_ms).toBeNull();
    expect(weekLines([row]).join(" ")).toMatch(/none has a deploy on record.*review not recorded/s);
    expect(dur(null)).toBe("not recorded");
  });
  it("runner waits come from each job's start minus its suite's creation", () => {
    const suite = { app: "github-actions", createdAt: at(0), runs: [{ startedAt: at(0.5), completedAt: at(1) }] };
    const row = prRow(pr({ headSuites: [suite] }));
    expect(row.ci_queued_ms).toBe(0.5 * H);
    expect(row.ci_running_ms).toBe(0.5 * H);
  });
});

describe("landing-times: rule 0 and outages", () => {
  it("zero PRs read is NAMED STOP [NO_PRS_READ], exit 2, never a line of zeros", () => {
    expect(() => weekLines([])).toThrow(/NAMED STOP \[NO_PRS_READ\]/);
    try { weekLines([]); } catch (e) { expect((e as { code: number }).code).toBe(2); }
  });
  it("GitHub not answering is NAMED STOP [GITHUB_UNREACHABLE], exit 75, after three tries", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; throw new Error("ECONNRESET"); };
    await expect(graphql("query { viewer { login } }", {}, { fetchImpl, tok: "t", wait: async () => {} }))
      .rejects.toMatchObject({ code: 75, message: expect.stringMatching(/NAMED STOP \[GITHUB_UNREACHABLE\]/) });
    expect(calls).toBe(3);
  });
  it("a query GitHub refuses is a named stop at once, not three retries and not 'unreachable'", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return new Response(JSON.stringify({ data: null, errors: [{ type: "RESOURCE_LIMITS_EXCEEDED" }] }), { status: 200 }); };
    await expect(graphql("query { a }", {}, { fetchImpl, tok: "t", wait: async () => {} })).rejects.toThrow(/GITHUB_QUERY_REFUSED/);
    expect(calls).toBe(1);
  });
  it("F5: 401 and FORBIDDEN are NAMED STOP [GITHUB_TOKEN_REFUSED], exit 3, at once; never 'unreachable'", async () => {
    for (const res of [
      () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 }),
      () => new Response(JSON.stringify({ message: "Resource not accessible by integration" }), { status: 403 }),
      () => new Response(JSON.stringify({ data: { repository: null }, errors: [{ type: "FORBIDDEN", message: "Resource not accessible by integration" }] }), { status: 200 }),
    ]) {
      let calls = 0;
      const fetchImpl = async () => { calls++; return res(); };
      await expect(graphql("query { a }", {}, { fetchImpl, tok: "t", wait: async () => {} }))
        .rejects.toMatchObject({ code: 3, message: expect.stringMatching(/NAMED STOP \[GITHUB_TOKEN_REFUSED\].*missing, expired or not valid/) });
      expect(calls).toBe(1);
    }
  });
  it("F5: a 403 that is the rate limit is still asked again (transient), not a token stop", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }); };
    await expect(graphql("query { a }", {}, { fetchImpl, tok: "t", wait: async () => {} })).rejects.toThrow(/GITHUB_UNREACHABLE/);
    expect(calls).toBe(3);
  });
  it("F5: a secondary rate limit (403 'rate limit' text) is waited out, at least a minute, never a token stop", async () => {
    let calls = 0; const waits: number[] = [];
    const fetchImpl = async () => { calls++; return new Response(JSON.stringify({ message: "You have exceeded a secondary rate limit." }), { status: 403 }); };
    await expect(graphql("query { a }", {}, { fetchImpl, tok: "t", wait: async (ms: number) => { waits.push(ms); } })).rejects.toThrow(/GITHUB_UNREACHABLE/);
    expect(calls).toBe(3);
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(60_000);
  });
  it("F5: partial data with errors is refused, never used", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ data: { user: { repositories: { nodes: [] } } }, errors: [{ type: "RESOURCE_LIMITS_EXCEEDED" }] }), { status: 200 });
    await expect(graphql("query { a }", {}, { fetchImpl, tok: "t", wait: async () => {} })).rejects.toThrow(/GITHUB_QUERY_REFUSED/);
  });
  it("F5: a wrong owner is NAMED STOP [OWNER_NOT_FOUND], exit 3, never a TypeError", async () => {
    await expect(readWeek({ owner: "nobody", gql: async () => ({ user: null }) })).rejects.toMatchObject({ code: 3, message: expect.stringMatching(/OWNER_NOT_FOUND.*nobody/) });
    const fetchImpl = async () => new Response(JSON.stringify({ data: { user: null }, errors: [{ type: "NOT_FOUND", path: ["user"] }] }), { status: 200 });
    const gql = (q: string, v?: Record<string, unknown>) => graphql(q, v, { fetchImpl, tok: "t", wait: async () => {} });
    await expect(readWeek({ owner: "nobody", gql })).rejects.toThrow(/OWNER_NOT_FOUND/);
  });
  it("F6: a PUBLIC Repos-map repo the token cannot see is named in the line and the run is red", async () => {
    const gql = async (q: string) => q.includes("repositories(")
      ? { user: { repositories: { pageInfo: { hasNextPage: false }, nodes: [{ name: "r", isArchived: false, pushedAt: at(0) }] } } }
      : { repository: { pullRequests: { pageInfo: { hasNextPage: false }, nodes: [] } } };
    const expected = expectedRepos({ rows: [{ repo: "r", category: "mine" }, { repo: "hidden", category: "mine" }, { repo: "old", category: "retired" }] });
    const { unreadable, privateRepos } = await readWeek({ now: Date.parse(at(1)), gql, expected, isPublic: async () => true });
    expect(unreadable).toEqual(["hidden"]);
    expect(privateRepos).toEqual([]);
    expect(weekLines([prRow(pr())], { unreadable }).at(-1)).toMatch(/^1 repo not readable with this token, so not measured: hidden\.$/);
    expect(() => endOfRun({ unreadable, privateRepos })).toThrow(expect.objectContaining({ code: 3, message: expect.stringMatching(/NAMED STOP \[REPOS_NOT_READABLE\].*hidden/) }));
  });
  it("F6: only a PRIVATE repo unseen (authority-backlink-network, 22 Nov) is a note, exit 0, and the line says so", async () => {
    const gql = async (q: string) => q.includes("repositories(")
      ? { user: { repositories: { pageInfo: { hasNextPage: false }, nodes: [{ name: "r", isArchived: false, pushedAt: at(0) }] } } }
      : { repository: { pullRequests: { pageInfo: { hasNextPage: false }, nodes: [] } } };
    const asked: string[] = [];
    const isPublic = async (_o: string, n: string) => { asked.push(n); return false; };
    const { unreadable, privateRepos } = await readWeek({ now: Date.parse(at(1)), gql, expected: ["r", "secret"], isPublic });
    expect(asked).toEqual(["secret"]);
    expect({ unreadable, privateRepos }).toEqual({ unreadable: [], privateRepos: ["secret"] });
    expect(weekLines([prRow(pr())], { unreadable, privateRepos }).at(-1)).toBe("Not measured: private or gone (secret).");
    expect(endOfRun({ unreadable, privateRepos })).toMatch(/^NOTE \[REPOS_NOT_READABLE\] not measured: private or gone \(secret\)/);
    expect(endOfRun({})).toBeNull();
  });
  it("F6: the visibility probe: only a 404 is private or gone; 5xx, 429 or a thrown error count as public (red)", async () => {
    const urls: string[] = [];
    const answer = (status: number) => async (url: string) => { urls.push(url); return { status }; };
    expect(await isPublicRepo("seq23", "secret", answer(404))).toBe(false);
    expect(urls).toEqual(["https://github.com/seq23/secret"]);
    expect(await isPublicRepo("seq23", "r", answer(200))).toBe(true);
    expect(await isPublicRepo("seq23", "r", answer(503))).toBe(true);
    expect(await isPublicRepo("seq23", "r", answer(429))).toBe(true);
    expect(await isPublicRepo("seq23", "r", async () => { throw new Error("ENOTFOUND"); })).toBe(true);
  });
  it("F6: a public and a private repo both unseen is still red, naming the public one", () => {
    expect(() => endOfRun({ unreadable: ["pub"], privateRepos: ["priv"] })).toThrow(/REPOS_NOT_READABLE.*\(pub\)/);
  });
  it("F6: zero PRs read stays red even when the only gap is a private repo", () => {
    expect(() => weekLines([], { privateRepos: ["secret"] })).toThrow(expect.objectContaining({ code: 2, message: expect.stringMatching(/NO_PRS_READ/) }));
  });
  it("F6: a fork she owns (Deep-seek-infra-vault, 22 Nov) is read, not reported unreadable", async () => {
    // GitHub semantics: isFork: false hides forks from the listing.
    const gql = async (q: string) => q.includes("repositories(")
      ? { user: { repositories: { pageInfo: { hasNextPage: false }, nodes: [{ name: "r", isArchived: false, pushedAt: at(0) }, { name: "fork", isFork: true, isArchived: false, pushedAt: at(0) }].filter((n) => !(n.isFork && /isFork:\s*false/.test(q))) } } }
      : { repository: { pullRequests: { pageInfo: { hasNextPage: false }, nodes: [] } } };
    const { unreadable, repos } = await readWeek({ now: Date.parse(at(1)), gql, expected: ["r", "fork"], isPublic: async () => true });
    expect(unreadable).toEqual([]);
    expect(repos).toBe(2);
  });
  it("slowest is the slowest LANDING (merge to live) among the window's PRs, in plain days", () => {
    const dep = (h: number) => [{ statuses: [{ state: "SUCCESS", createdAt: at(h) }] }];
    const oldOpen = prRow(pr({ number: 7, createdAt: at(-900), mergeDeploys: dep(3.2) }));
    const slowLand = prRow(pr({ number: 8, mergeDeploys: dep(60) }));
    const head = weekLines([oldOpen, slowLand])[0];
    expect(head).toMatch(/slowest merge to live r #8 at 2 days/);
  });
  it("it can only read: a mutation is refused before anything is sent", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return new Response("{}"); };
    await expect(graphql("mutation { mergePullRequest(input: {}) { clientMutationId } }", {}, { fetchImpl, tok: "t" })).rejects.toThrow(/READ_ONLY/);
    expect(calls).toBe(0);
  });
  it("readWeek keeps only PRs merged inside the window", async () => {
    const now = Date.parse(at(24 * 7));
    const gql = async (q: string) => q.includes("repositories(")
      ? { user: { repositories: { pageInfo: { hasNextPage: false }, nodes: [{ name: "r", isArchived: false, pushedAt: at(160) }] } } }
      : { repository: { deployments: { nodes: [] }, pullRequests: { pageInfo: { hasNextPage: false }, nodes: [
          { number: 2, createdAt: at(100), mergedAt: at(101), updatedAt: at(101), body: "", comments: { nodes: [] }, userContentEdits: { nodes: [] }, commits: { nodes: [] }, mergeCommit: null },
          { number: 1, createdAt: at(-20), mergedAt: at(-10), updatedAt: at(-10), body: "", comments: { nodes: [] }, userContentEdits: { nodes: [] }, commits: { nodes: [] }, mergeCommit: null },
        ] } } };
    const { repos, rows } = await readWeek({ now, gql });
    expect(repos).toBe(1);
    expect(rows.map((r: { number: number }) => r.number)).toEqual([2]);
  });
});

describe("landing-times: the scorecard's numbers", () => {
  const row = (to_live_h: number | null, total_h: number | null) =>
    ({ total_ms: total_h === null ? null : total_h * H, to_live_ms: to_live_h === null ? null : to_live_h * H });

  it("shares are of PRs with a deploy on record; a PR with none is left out, never counted live or slow", () => {
    const m = weekMeasures([row(0.5, 3), row(2, 30), row(1, 24), row(null, null)] as never);
    expect(m).toEqual({ prs: 4, live: 3, landed_in_hour_pct: 66.7, live_in_day_pct: 66.7 });
  });

  it("no PR with a deploy is null (not read), never 0% or 100%", () => {
    expect(weekMeasures([row(null, null)] as never)).toMatchObject({ landed_in_hour_pct: null, live_in_day_pct: null });
  });

  it("the section the job writes carries the measures, and the scorecard row reads keys that exist", () => {
    const body = sectionBody([prRow(pr())]);
    const sc = JSON.parse(readFileSync(new URL("../src/shared/boss/scorecard/manifest.json", import.meta.url), "utf8"));
    const r = sc.rows.find((x: { jobs: string[] }) => x.jobs.includes("landing-times"));
    expect(r, "landing-times has a scorecard row").toBeTruthy();
    for (const m of [r.first, r.real]) {
      const key = String(m.params.sql).match(/\$\.measures\.(\w+)/)?.[1];
      expect(key, `${m.label} reads a measure`).toBeTruthy();
      expect(Object.keys(body.measures)).toContain(key);
      expect(m.params.sql).toMatch(/section = 'landing'/);
    }
  });
});
