/**
 * NOELLE'S RECORD IN D1 (23 Nov 2026; plan artifact 8LfYgMaHj7XLVB1fJ1vYxM, gap review G1-G21).
 * The Mac's plan is re-checked HERE (growth/noelle.ts recordPlan); only the accepted acts go back.
 * HOW IT BREAKS, each proven:
 *   - abuse: the three routes are the machine token's only; a forged plan's spend, account, owned-channel
 *     post, cap raise, client page edit or off-roster business is refused by the Worker, never acted (A6);
 *   - outage: a stale source is a NAMED STOP on the run; the week's Claude budget spent → the run is
 *     stopped whole (G16f); no run by 22:05 → NOELLE_DID_NOT_RUN and the morning line (G16a); the same
 *     stop three days running → ONE line to Sequoia (G16b); a stopped run must name its stop;
 *   - data: a decided backlink is on GET /backlink-orders (G6); a linked verdict changes only her
 *     roster's open rows, never Sequoia's own; Notices are one per NEW thing, https links only;
 *   - private data: a client owner's name in the friends brain never reaches the context (G8);
 *   - the page: a failed queue read says "not read", never "nothing queued".
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { TOKEN_KEY, sha256 } from "../../src/worker/boss/routes/openLoops";
import { setSetting } from "../../src/worker/boss/lib/settings";
import { handleRequest } from "../../src/worker/index";
import { dayIdInZone } from "../../src/shared/boss/timezone";
import { READ_SOURCES, WEEK_CALLS } from "../../src/shared/boss/growth/noelle.mjs";
import { cleanItems, noelleWatch, recordDone, recordPlan } from "../../src/worker/boss/growth/noelle";
import { RESUME_HANDLERS } from "../../src/worker/boss/approvals/resume";
import type { Env } from "../../src/worker/env";

const NOW = Date.parse("2026-11-23T20:00:00Z"); // Mon 23 Nov 2026, 14:00 Central
const DAY = dayIdInZone(NOW);
const DAY_MS = 86_400_000;

const PNP = `## Settled decisions
### Growth
- 2026-11-21 — Porch reels lead in December. <!-- confidential -->Customer Brindlewood.<!-- /confidential -->

## Growth
### Porch & Party
- key: porch-and-party
- buyer: families hosting parties
- offer: Christmas porches from $450
- money number: booked requests
- channels: instagram [reel, carousel] · tiktok [reel] · facebook-page [post]
- languages: en
- limits: R-PRF-01
- linked to-dos: olp_linked1, olp_herown1
`;
const SPRY = `## Settled decisions
### Umbrella, scope and money
- 2026-11-01 — Spry Labs spends nothing without her yes.
### Growth (Shoestring Growth Plan, 21 Nov 2026)
- 2026-11-22 — The backlink network is an outside publisher; the Director sends it link requests.
### Search, sites and freshness
- 2026-11-02 — Every site keeps a fresh sitemap.
### Brand and social
- 2026-11-03 — Calm, plain voice everywhere.
### All apps
- 2026-11-04 — Every app has a privacy page.
### ApprovalPrep
- 2026-11-05 — ApprovalPrep is self-service.

## Growth
### ApprovalPrep
- key: approvalprep
- buyer: people fixing their credit themselves
- offer: self-help letters
- money number: sales
- channels: pinterest [pin] · backlinks [guide]
- languages: en
- limits: R-ADV-13
`;
const FRIENDS = `## Settled decisions
### Hicks
- 2026-11-09 — Hicks changes only with the owner's yes. <!-- confidential -->Owner Zebulon Quarrington.<!-- /confidential -->

## Growth
### Hicks
- key: hicks
- channels: search-pages [question]
- languages: en
- linked to-dos: none
`;
const RISK = `| R-PRF-01 | No invented reviews. | x |
| R-ADV-13 | ApprovalPrep is self-service, never paid credit repair. | CROA |`;

const brain = (slug: string, body: string) => env.DB.prepare(`INSERT INTO brains (slug, title, body_md, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET body_md = excluded.body_md`).bind(slug, slug, body, NOW).run();
const TOKEN = `olt_${"e5".repeat(32)}`;
const outer = {
  WP_OS_DB: env.DB, WP_OS_DOCUMENTS: env.VAULT, WP_OS_KV: env.SESSIONS, WP_OS_ENV: "local",
  BOSS_PASSCODE: env.BOSS_PASSCODE, BOSS_SESSION_SECRET: env.SESSION_SECRET,
  ASSETS: { fetch: async () => new Response("<html>spa</html>", { headers: { "content-type": "text/html" } }) },
} as unknown as Env;
const call = (path: string, body?: unknown, auth: string | null = `Bearer ${TOKEN}`) => handleRequest(new Request(`https://boss.sequoiataylor.com/api/boss/growth${path}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { ...(auth ? { authorization: auth } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}), outer);
const json = async (r: Response) => { const b: any = await r.json(); return b?.data ?? b; };

/** Every source of the weekly read, fresh and non-empty, unless overridden. */
const reads = (over: Record<string, unknown> = {}) => ({ ...Object.fromEntries(READ_SOURCES.map((s: { id: string }) => [s.id, { at: new Date(NOW - DAY_MS).toISOString(), sha: "abc123def456", rows: 3 }])), ...over });
const plan = (actions: unknown[], extra: Record<string, unknown> = {}) => ({ day: DAY, slot: "14:37", kind: "daily", calls: 6, plan: { actions }, reads: reads(), facts: { articles: { approvalprep: 4 }, caps: { approvalprep: 40 } }, ...extra });
const SEASON = { kind: "decision", business: "porch-and-party", source: "pnp-season-bookings", decision: "3 porches booked this season; sell rentals and events from 15 Dec." };
const rows = async (sql: string, ...b: unknown[]) => ((await env.DB.prepare(sql).bind(...b).all<any>()).results ?? []);
const cards = () => rows(`SELECT a.title FROM approvals a JOIN judgement_calls j ON j.approval_id = a.id WHERE j.resume_kind = 'growth_proposal'`);

beforeEach(async () => {
  await env.DB.exec(`DELETE FROM noelle_runs; DELETE FROM noelle_actions; DELETE FROM growth_decisions; DELETE FROM growth_readings; DELETE FROM boss_task_notices WHERE from_name = 'Noelle';
    DELETE FROM owner_open_loops WHERE id LIKE 'olp_linked%' OR id LIKE 'olp_herown%';
    DELETE FROM approvals WHERE id IN (SELECT approval_id FROM judgement_calls WHERE resume_kind = 'growth_proposal'); DELETE FROM judgement_calls WHERE resume_kind = 'growth_proposal';
    DELETE FROM morning_sections WHERE section = 'growth'; DELETE FROM settings WHERE key = 'growth_report_last_day';`);
  await brain("porch-and-party", PNP); await brain("spry", SPRY); await brain("friends", FRIENDS); await brain("risk", RISK);
  await brain("west-peek", "## Settled decisions\n### Growth\n- 2026-11-20 — WPP-llm is watched.\n\n## Growth\n[MISSING]\n");
  await setSetting(env.DB, TOKEN_KEY, await sha256(TOKEN));
});

describe("the routes are the machine token's only", () => {
  it("401 without the token or with a wrong one on context, plan and done; a bad plan is a 400, never recorded", async () => {
    for (const [p, b] of [["/noelle/context", undefined], ["/noelle/plan", plan([SEASON])], ["/noelle/done", { stop: "NAMED STOP [CLAUDE_LIMIT] x" }]] as const) {
      expect((await call(p, b, null)).status).toBe(401);
      expect((await call(p, b, `Bearer olt_${"f6".repeat(32)}`)).status).toBe(401);
    }
    expect((await call("/noelle/plan", { day: DAY, kind: "hourly", calls: -1, plan: {}, reads: null })).status).toBe(400);
    expect((await call("/noelle/plan", plan(Array.from({ length: 121 }, () => SEASON)))).status).toBe(400);
    expect(await rows(`SELECT id FROM noelle_runs`)).toEqual([]);
  });
});

describe("the Worker re-checks the plan; only accepted acts go back (A6, G1, G3, G4, G6, G9)", () => {
  it("a forged plan: spend, account, owned-channel post, cap raise, Hicks page edit and an off-roster business are refused; a backlink is ordered", async () => {
    const r = await call("/noelle/plan", plan([
      SEASON,
      { kind: "spend", business: "porch-and-party", what: "Upgrade Buffer to the paid plan" },
      { kind: "proposal", business: "porch-and-party", action: "subscription", what: "Upgrade Buffer to Essentials" },
      { kind: "proposal", business: "porch-and-party", action: "create-account", what: "Open a Nextdoor account" },
      { kind: "post", business: "porch-and-party", channel: "instagram", format: "reel", draft: "Your porch, done." },
      { kind: "search-loop", business: "approvalprep", change: "cap", value: 80, why: "impressions rose" },
      { kind: "search-loop", business: "approvalprep", change: "cap", value: 30, why: "pages are thin" },
      { kind: "backlink", business: "approvalprep", topic: "Dispute letters by mail", why: "visits rose" },
      { kind: "job-target", business: "approvalprep", channel: "pinterest", field: "posts_per_week", value: 7, why: "pins sell" },
      { kind: "page-edit", business: "hicks", url: "https://example.com/services", field: "title", value: "New title", why: "CTR" },
      { kind: "decision", business: "detox-denver", source: "grid", decision: "x" },
    ]));
    expect(r.status).toBe(201);
    const out = await json(r);
    // The Mac acts on the lower cap only. Never the post, spend or account; and AP's Pinterest job keeps its
    // posts per week in code, not a file, so that job target is NO_KNOB (a builder PR), never a guess.
    expect(out.accepted.map((a: any) => [a.kind, a.business, a.change ?? a.field])).toEqual([["search-loop", "approvalprep", "cap"]]);
    expect(out.refused.find((x: any) => x.action.kind === "job-target")?.stop).toBe("NO_KNOB");
    expect(out.accepted[0].value).toBe(30);
    const stops = out.refused.map((x: any) => x.stop);
    for (const s of ["UNKNOWN_KIND", "NEVER_SPEND", "NO_NEW_ACCOUNTS", "OWNED_BY_JOB", "CAP_RAISE_IS_HERS", "CLIENT_APPROVAL", "NOT_ON_ROSTER"]) expect(stops).toContain(s);
    // Her calls are cards: the cap raise (G4) and the Hicks edit (G9). The spend and account never are.
    const titles = (await cards()).map((c: any) => c.title).join(" | ");
    expect(titles).toMatch(/ApprovalPrep: raise the search-loop cap from 40 to 80\?/);
    expect(titles).toMatch(/Hicks: title on https:\/\/example\.com\/services/);
    expect(titles).not.toMatch(/Buffer|Nextdoor/);
    // No record of any kind for a business that is not hers.
    expect(await rows(`SELECT id FROM growth_decisions WHERE business = 'detox-denver'`)).toEqual([]);
    // G6: the decided backlink is on the backlink network's read.
    const bl = await json(await call("/backlink-orders"));
    expect(bl.orders).toEqual([{ business: "approvalprep", topic: "Dispute letters by mail", draft: "visits rose", why: "visits rose" }]);
    const run = (await rows(`SELECT * FROM noelle_runs`))[0];
    expect(run).toMatchObject({ day: DAY, slot: "14:37", kind: "daily", state: "planned", calls: 6 });
  });

  it("the first P&P decision each run is bookings this season (Beyond-the-list)", async () => {
    const out = await json(await call("/noelle/plan", plan([{ kind: "decision", business: "porch-and-party", source: "grid", decision: "Leads are flat." }, SEASON])));
    expect(out.refused.map((x: any) => x.stop)).toContain("SEASON_FIRST");
  });

  it("the same slot posted twice is ONE run: the replay gets the first run's id and nothing to act, no second decision", async () => {
    const body = plan([SEASON, { kind: "test", business: "approvalprep", what: "a second pin title", number: "pin saves", stop: "after 14 days" }]);
    const first = await json(await call("/noelle/plan", body));
    expect(first.accepted.length).toBeGreaterThan(0);
    const decisions = (await rows(`SELECT id FROM growth_decisions`)).length;
    const again = await json(await call("/noelle/plan", body));
    expect(again).toMatchObject({ run: first.run, replay: true, accepted: [], notices: [] });
    expect(await rows(`SELECT id FROM noelle_runs WHERE day = ? AND slot = '14:37' AND kind = 'daily'`, DAY)).toHaveLength(1);
    expect(await rows(`SELECT id FROM growth_decisions`)).toHaveLength(decisions);
    // A run still 'planned' when its slot is posted again died mid-run: closed [ACT_LOST], never a quiet "done".
    await env.DB.prepare(`UPDATE noelle_runs SET state = 'planned' WHERE id = ?`).bind(first.run).run();
    const lost = await json(await call("/noelle/plan", body));
    expect(lost).toMatchObject({ run: first.run, replay: true, lost: true, accepted: [] });
    expect(await rows(`SELECT state, stops FROM noelle_runs WHERE id = ?`, first.run)).toEqual([{ state: "stopped", stops: '["ACT_LOST"]' }]);
    // A different slot the same day is its own run.
    expect((await json(await call("/noelle/plan", plan([SEASON], { slot: "18:02" })))).run).not.toBe(first.run);
  });

  it("a throw after the slot is claimed marks the row stopped [PLAN_FAILED], so a retry of that slot is a new run, not a replay of nothing", async () => {
    const real = env.DB;
    const broken = { prepare: (sql: string) => { if (/INSERT INTO growth_decisions/.test(sql)) throw new Error("D1 went away"); return real.prepare(sql); } };
    await expect(recordPlan({ DB: broken } as unknown as Parameters<typeof recordPlan>[0], plan([SEASON]), NOW)).rejects.toThrow(/D1 went away/);
    const [row] = await rows(`SELECT state, stops, line FROM noelle_runs WHERE day = ? AND slot = '14:37'`, DAY);
    expect(row).toMatchObject({ state: "stopped", stops: '["PLAN_FAILED"]' });
    expect(row.line).toMatch(/^NAMED STOP \[PLAN_FAILED\] D1 went away/);
    const retry = await json(await call("/noelle/plan", plan([SEASON])));
    expect(retry.replay).toBeUndefined();
    expect(retry.decisions).toBe(1);
    // The retry is a new row naming the stopped run it follows, and its /done is recorded (never "No planned run").
    expect((await rows(`SELECT retry_of FROM noelle_runs WHERE id = ?`, retry.run))[0].retry_of).toBe((await rows(`SELECT id FROM noelle_runs WHERE state = 'stopped' AND day = ?`, DAY))[0].id);
    await recordDone(env as unknown as Parameters<typeof recordDone>[0], { run: retry.run, published: [] }, NOW + 60_000);
    expect((await rows(`SELECT state FROM noelle_runs WHERE id = ?`, retry.run))[0].state).toBe("done");
    // A first run of the day retries nothing.
    expect((await rows(`SELECT retry_of FROM noelle_runs WHERE id = ?`, (await json(await call("/noelle/plan", plan([SEASON], { day: "2026-12-01" })))).run))[0]?.retry_of ?? null).toBeNull();
  });

  it("a second backlink inside 4 articles is refused (≤1 per 4 articles, counted over 28 days)", async () => {
    await call("/noelle/plan", plan([{ kind: "backlink", business: "approvalprep", topic: "One", why: "w" }]));
    const out = await json(await call("/noelle/plan", plan([{ kind: "backlink", business: "approvalprep", topic: "Two", why: "w" }], { slot: "16:12" })));
    expect(out.refused.map((x: any) => x.stop)).toEqual(["ONE_IN_FOUR"]);
  });
});

describe("outages end in named stops, never a quiet green", () => {
  it("a stale, failed or empty source is a NAMED STOP on the run; the daily run owes no full read, the weekly one does", async () => {
    const bad = reads({ grid: { at: new Date(NOW - 9 * DAY_MS).toISOString(), rows: 4 }, kdp: { error: "403" }, calendar: { at: new Date(NOW).toISOString(), rows: 0 } });
    const daily = await json(await call("/noelle/plan", plan([SEASON], { reads: bad })));
    expect(daily.stops.join(" ")).toMatch(/\[SOURCE_STALE\].*grid/);
    expect(daily.stops.join(" ")).toMatch(/\[SOURCE_NOT_READ\].*KDP.*403/);
    expect(daily.stops.join(" ")).toMatch(/\[SOURCE_EMPTY\].*calendar/);
    expect(daily.stops.join(" ")).not.toMatch(/NO_DECISION/);
    const weekly = await json(await call("/noelle/plan", plan([SEASON], { kind: "weekly" })));
    expect(weekly.stops.join(" ")).toMatch(/NAMED STOP \[NO_DECISION\] approvalprep: no decision on grid/);
    const ap = (await rows(`SELECT state, evidence FROM growth_decisions WHERE business = 'approvalprep'`))[0];
    expect(ap.state).toBe("held: no data");
    expect(ap.evidence).toMatch(/NO_DECISION/);
  });

  it("G16f: the week's Claude calls spent → the run is stopped whole, nothing recorded or handed back", async () => {
    await env.DB.prepare(`INSERT INTO noelle_runs (id, day, slot, kind, state, stops, calls, line, created_at, updated_at) VALUES ('nrn_spent', ?, '11:11', 'daily', 'done', '[]', ?, 'x', ?, ?)`).bind(DAY, WEEK_CALLS - 2, NOW - 3600_000, NOW - 3600_000).run();
    const out = await json(await call("/noelle/plan", plan([SEASON, { kind: "job-target", business: "approvalprep", channel: "pinterest", field: "bank", value: "x" }])));
    expect(out.accepted).toEqual([]);
    expect(out.stops.join(" ")).toMatch(/WEEK_CALL_BUDGET/);
    expect(await rows(`SELECT id FROM growth_decisions`)).toEqual([]);
    expect((await rows(`SELECT state, stops FROM noelle_runs WHERE id <> 'nrn_spent'`))[0]).toEqual({ state: "stopped", stops: '["WEEK_CALL_BUDGET"]' });
  });

  it("exit 76 (out of credits): a stopped run names its stop or is refused", async () => {
    expect((await call("/noelle/done", { day: DAY, kind: "daily", stop: "out of credits" })).status).toBe(400);
    const r = await call("/noelle/done", { day: DAY, slot: "14:37", kind: "daily", stop: "NAMED STOP [CLAUDE_LIMIT] ai-run exit 76; her place is kept, the next slot resumes" });
    expect(r.status).toBe(201);
    expect((await rows(`SELECT state, stops FROM noelle_runs`))[0]).toEqual({ state: "stopped", stops: '["CLAUDE_LIMIT"]' });
  });

  it("G16a: no run by 22:05 → NOELLE_DID_NOT_RUN and a line in the morning email; a run row today → quiet", async () => {
    await expect(noelleWatch(env as any, NOW)).rejects.toThrow(/NAMED STOP \[NOELLE_DID_NOT_RUN\]/);
    const body = JSON.parse((await rows(`SELECT body FROM morning_sections WHERE section = 'growth'`))[0].body);
    expect(body.lines.join(" ")).toMatch(new RegExp(`Noelle did not run on ${DAY}`));
    await call("/noelle/done", { day: DAY, kind: "daily", stop: "NAMED STOP [CLAUDE_LIMIT] x" });
    expect((await noelleWatch(env as any, NOW)).line).toBe("OUTPUT 1 runs today");
  });

  it("G16b: the same stop three days running is ONE needs-her line, once a day", async () => {
    for (const d of [2, 1, 0]) {
      const t = NOW - d * DAY_MS;
      await env.DB.prepare(`INSERT INTO noelle_runs (id, day, slot, kind, state, stops, calls, line, created_at, updated_at) VALUES (?, ?, '12:12', 'daily', 'stopped', '["SOURCE_STALE"]', 1, 'x', ?, ?)`).bind(`nrn_d${d}`, dayIdInZone(t), t, t).run();
    }
    expect((await noelleWatch(env as any, NOW)).escalated).toBe(1);
    expect((await noelleWatch(env as any, NOW)).escalated).toBe(0);
    const n = await rows(`SELECT body, needs_her FROM boss_task_notices WHERE from_name = 'Noelle'`);
    expect(n).toEqual([{ body: expect.stringMatching(/SOURCE_STALE three days running/), needs_her: 1 }]);
  });
});

describe("what she changes and tells", () => {
  it("a linked verdict changes only her roster's open rows; Sequoia's own row and an unlisted row are untouched", async () => {
    await env.DB.prepare(`INSERT INTO owner_open_loops (id, title, finish_line, next_step, owner, next_date, business, section, status, source, created_at, updated_at) VALUES
      ('olp_linked1', 'P&P search pages', 'Live', 'Ship the hub', 'claude', '2026-11-30', 'porch-and-party', 'not_finished', 'open', 'agent_report', 1, 1),
      ('olp_herown1', 'Her own P&P row', 'Done', 'Her step', 'sequoia', '2026-11-30', 'porch-and-party', 'not_finished', 'open', 'agent_report', 1, 1),
      ('olp_linked9', 'Not on the roster', 'Done', 'Its step', 'claude', '2026-11-30', 'porch-and-party', 'not_finished', 'open', 'agent_report', 1, 1)`).run();
    const out = await json(await call("/noelle/plan", plan([SEASON,
      { kind: "linked", business: "porch-and-party", id: "olp_linked1", verdict: "keep", why: "Two requests came from the hub." },
      { kind: "linked", business: "porch-and-party", id: "olp_herown1", verdict: "change", next_step: "Hijacked", why: "x" },
      { kind: "linked", business: "porch-and-party", id: "olp_linked9", verdict: "change", next_step: "Hijacked", why: "x" },
      { kind: "linked", business: "porch-and-party", id: "olp_linked1", verdict: "close", why: "x" },
    ])));
    expect(out.refused.map((x: any) => x.stop).sort()).toEqual(["NOT_LINKED", "NOT_LINKED", "VERDICT"]);
    const step = async (id: string) => (await rows(`SELECT next_step, status FROM owner_open_loops WHERE id = ?`, id))[0];
    expect(await step("olp_linked1")).toEqual({ next_step: `Growth Director, ${DAY}: keep. Two requests came from the hub.\nShip the hub`, status: "open" });
    expect(await step("olp_herown1")).toEqual({ next_step: "Her step", status: "open" });
    expect(await step("olp_linked9")).toEqual({ next_step: "Its step", status: "open" });
  });

  it("done: one Notices line per NEW thing, her wording, https links only, a repeat is not told twice; a done run cannot be re-done", async () => {
    // Two new formats the gate passed (each with its scorecard row, G10): only their keys may be told.
    const sc = { number: "saves", floor30: 5, floor60: 10, versionB: "a single photo" };
    const piece = (id: string, platform: string) => ({ id, at: "2026-12-02 11:15", post: "photo-set", format: "carousel", platforms: [platform], theme: "christmas-porch", hook: "Porch ready for the holidays", scorecard: sc });
    const planned = await json(await call("/noelle/plan", plan([SEASON, { kind: "studio-plan", business: "porch-and-party", pieces: [piece("p1", "instagram"), piece("p2", "tiktok")] }])));
    const { run } = planned;
    expect(planned.notices.map((x: any) => x.key).sort()).toEqual(["noelle:porch-and-party:format:instagram:photo-set", "noelle:porch-and-party:format:tiktok:photo-set"]);
    const pub = [
      { business: "porch-and-party", key: "noelle:porch-and-party:format:instagram:photo-set", what: "new format photo-set", where: "on Instagram", link: "https://www.instagram.com/p/abc" },
      { business: "porch-and-party", key: "noelle:porch-and-party:format:instagram:photo-set", what: "again", where: "on Instagram", link: "https://www.instagram.com/p/abc" },
      { business: "porch-and-party", key: "noelle:porch-and-party:format:tiktok:photo-set", what: "new format photo-set", where: "on TikTok", link: "javascript:alert(1)" },
      { business: "porch-and-party", key: "noelle:porch-and-party:format:facebook-page:reel", what: "a key the gate never passed", where: "on Facebook", link: "https://x.test" },
      { business: "approvalprep", key: "noelle:approvalprep:x", what: "a pin board", where: "on Pinterest", link: "https://x.test" },
      { business: "approvalprep", key: "not-noelle", what: "forged", where: "x", link: "https://x.test" },
      { business: "detox-denver", key: "noelle:dd", what: "not hers", where: "x", link: "https://x.test" },
    ];
    const r = await json(await call("/noelle/done", { run, calls: 19, published: pub, failed: [{ kind: "job-target", why: "PR refused" }, { kind: "published-check", why: "NAMED STOP [POST_NOT_PUBLISHED] porch-and-party:tiktok 2026-11-22 post b is failed" }] }));
    expect(r.notices).toBe(2);
    const n = (await rows(`SELECT body, needs_her FROM boss_task_notices WHERE from_name = 'Noelle' ORDER BY body`)).map((x: any) => x.body);
    expect(n).toEqual(["Noelle published: Porch & Party new format photo-set on Instagram https://www.instagram.com/p/abc", "Noelle published: Porch & Party new format photo-set on TikTok"]);
    // The Mac's review calls count against the week: done raises the run's calls, never lowers them.
    expect((await rows(`SELECT calls FROM noelle_runs WHERE id = ?`, run))[0].calls).toBe(19);
    const done = (await rows(`SELECT state, stops, line FROM noelle_runs WHERE id = ?`, run))[0];
    expect(done.state).toBe("done");
    // A failure that names its stop keeps its code, so three days of it reach her as one line (G16b, G16c).
    expect(JSON.parse(done.stops).sort()).toEqual(["ACT_FAILED", "POST_NOT_PUBLISHED"]);
    expect((await call("/noelle/done", { run, published: pub })).status).toBe(400);
  });

  it("done: each job PR she opened and each red stop (nothing acted, under 3 days) is one Notices line, never twice", async () => {
    const { run } = await json(await call("/noelle/plan", plan([SEASON])));
    const jobs = [
      { tag: "approvalprep threads ap-threads.bank", pr: "seq23/approvalprep#77", what: "add 3 reviewed posts to the bank (t61, t62, t63)" },
      { tag: "approvalprep threads ap-threads.bank", pr: "seq23/approvalprep#77", what: "the same PR again" },
      { tag: "detox-denver x y.z", pr: "seq23/x#1", what: "not hers" },
      { tag: "approvalprep threads ap-threads.target", pr: "evil/repo#2", what: "a forged repo" },
    ];
    const failed = [
      { kind: "alarm", why: "NAMED STOP [UNDER_3_DAYS] dream-wedding:tiktok: 1 day ahead (alarm under 3); nothing this run fixed it" },
      { kind: "run", why: "NAMED STOP [NOTHING_ACTED] her run queued nothing and changed no job (Rule 0: a run that does nothing is red)" },
      { kind: "job-target", why: "a plain failure, no stop code" },
    ];
    const r = await json(await call("/noelle/done", { run, published: [], jobs, failed }));
    expect(r.notices).toBe(1);
    const n = (await rows(`SELECT body FROM boss_task_notices WHERE from_name = 'Noelle' ORDER BY body`)).map((x: any) => x.body);
    expect(n).toEqual([
      "Noelle changed ApprovalPrep threads: add 3 reviewed posts to the bank (t61, t62, t63) (lands on green checks) https://github.com/seq23/approvalprep/pull/77",
      "Noelle: dream-wedding:tiktok: 1 day ahead (alarm under 3); nothing this run fixed it",
      "Noelle: her run queued nothing and changed no job (Rule 0: a run that does nothing is red)",
    ]);
    const done = (await rows(`SELECT stops FROM noelle_runs WHERE id = ?`, run))[0];
    expect(JSON.parse(done.stops).sort()).toEqual(["ACT_FAILED", "NOTHING_ACTED", "UNDER_3_DAYS"]);
  });

  it("the 14-day report is written on the first done run, then not again inside the fortnight (G5)", async () => {
    const { run } = await json(await call("/noelle/plan", plan([SEASON])));
    await call("/noelle/done", { run, published: [] });
    const body = JSON.parse((await rows(`SELECT body FROM morning_sections WHERE section = 'growth'`))[0].body);
    expect(body.title).toMatch(/Growth/);
    expect(JSON.stringify(body)).not.toMatch(/NAMED STOP|nrn_|gdc_|Brindlewood/);
    await env.DB.exec(`UPDATE morning_sections SET body = '{}' WHERE section = 'growth'`);
    const again = await json(await call("/noelle/plan", plan([SEASON])));
    await call("/noelle/done", { run: again.run, published: [] });
    expect((await rows(`SELECT body FROM morning_sections WHERE section = 'growth'`))[0].body).toBe("{}");
  });

  it("a run that ends after midnight still reports under the day it was planned", async () => {
    const { run } = await json(await call("/noelle/plan", plan([SEASON])));
    await recordDone(env as unknown as Parameters<typeof recordDone>[0], { run, published: [] }, NOW + DAY_MS);
    expect((await rows(`SELECT body FROM morning_sections WHERE section = 'growth'`))[0]?.body).toMatch(/Growth/);
  });
});

describe("her yes to a Decide card opens one follow-on, never a retired growth# pipeline row", () => {
  it("a yes to a new format writes growth-yes#<business>#<judgement id>; no growth# row is written", async () => {
    const jid = "jc_noelle_yes1";
    await env.DB.prepare(`INSERT INTO judgement_calls (id, approval_id, employee_id, title, question, resume_kind, state, attempt, resume_detail, created_at, updated_at) VALUES (?, 'apv_noelle_yes1', 'emp_growth', 'Porch & Party: add photo-set on Instagram?', 'q', 'growth_proposal', 'awaiting', 1, ?, ?, ?)`)
      .bind(jid, JSON.stringify({ business: "porch-and-party", brain: "porch-and-party", label: "Porch & Party", item: { channel: "instagram", format: "photo-set", draft: "Porch ready" } }), NOW, NOW).run();
    const j = { id: jid, approval_id: "apv_noelle_yes1", employee_id: "emp_growth", deliverable_id: null, title: "Porch & Party: add photo-set on Instagram?", question: "q", resume_kind: "growth_proposal", state: "awaiting", attempt: 1 };
    await RESUME_HANDLERS.growth_proposal!(env as unknown as Parameters<NonNullable<typeof RESUME_HANDLERS.growth_proposal>>[0], j, "approved", null, NOW);
    expect((await rows(`SELECT source_key FROM owner_open_loops WHERE source_key LIKE 'growth%' AND source_key LIKE ?`, `%${jid}`)).map((x: any) => x.source_key)).toEqual([`growth-yes#porch-and-party#${jid}`]);
    expect(await rows(`SELECT id FROM owner_open_loops WHERE source_key LIKE 'growth#porch-and-party#instagram%'`)).toEqual([]);
    await env.DB.prepare(`DELETE FROM owner_open_loops WHERE source_key = ?`).bind(`growth-yes#porch-and-party#${jid}`).run();
    await env.DB.prepare(`DELETE FROM judgement_calls WHERE id = ?`).bind(jid).run();
  });
});

describe("privacy before any prompt (G8)", () => {
  it("all four growth brains load; a friends owner's name and a P&P customer never reach the context", async () => {
    const ctx = await json(await call("/noelle/context"));
    expect(ctx.businesses.map((b: any) => b.key).sort()).toEqual(["approvalprep", "hicks", "porch-and-party"]);
    expect(ctx.businesses.find((b: any) => b.key === "hicks").tier).toBe("search-watch");
    expect(JSON.stringify(ctx)).not.toMatch(/Zebulon|Quarrington|Brindlewood/);
    expect(ctx.businesses.every((b: any) => b.held === null)).toBe(true);
  });

  it("no private word known anywhere → every business held PRIVACY_UNREAD, its rulings never sent", async () => {
    await brain("porch-and-party", PNP.replace(/ ?<!--\s*confidential\s*-->[^<]*<!--\s*\/confidential\s*-->/, ""));
    await brain("friends", FRIENDS.replace(/ ?<!--\s*confidential\s*-->[^<]*<!--\s*\/confidential\s*-->/, ""));
    const ctx = await json(await call("/noelle/context"));
    expect(ctx.businesses.every((b: any) => /PRIVACY_UNREAD/.test(b.held) && b.rulings === "")).toBe(true);
  });
});

describe("the Growth page says 'not read' on a failed queue read (Beyond-the-list)", () => {
  it("no run in two days → every queue 'not read'; a run's failed read is 'not read: why', a read zero is 0", async () => {
    const { apiJson } = await import("./helpers");
    const before = (await apiJson<any>("/api/growth/page")).body.data;
    expect(before.businesses.find((b: any) => b.key === "porch-and-party").queue).toEqual({ unread: "not read: Noelle has not run in two days", channels: [] });
    await call("/noelle/plan", plan([SEASON], { facts: { queues: { "porch-and-party:instagram": 0, "porch-and-party:tiktok": 5 }, unread: { "porch-and-party:tiktok": "the Studio calendar did not answer" } } }));
    const page = (await apiJson<any>("/api/growth/page")).body.data;
    const q = page.businesses.find((b: any) => b.key === "porch-and-party").queue;
    expect(q.unread).toBeNull();
    expect(q.channels).toEqual([{ channel: "instagram", value: 0, unread: null, items: [] }, { channel: "tiktok", value: null, unread: "not read: the Studio calendar did not answer", items: [] }]);
    expect(page.noelle).toMatchObject({ day: DAY, state: "planned" });
  });
});

// Items 8 and 9 (24 Nov 2026): what is queued, post by post, and the week ahead in Monday's email.
// Her choice: "Monday (Recommended)". HOW IT BREAKS: a failed read shown as an empty week; queue text
// carried raw into her email; a Sunday-evening post (Monday in UTC) shown in the wrong week.
describe("the queued posts and Monday's schedule", () => {
  const SUN = Date.parse("2026-11-30T03:05:00Z"); // Sun 29 Nov 2026, 21:05 Central (the heartbeat is 22:05)
  const SUN_DAY = dayIdInZone(SUN);
  const growth = async () => JSON.parse((await rows(`SELECT body FROM morning_sections WHERE section = 'growth'`))[0]?.body ?? "null");
  const run = (reads: unknown, at = SUN - 3_600_000) => env.DB.prepare(`INSERT INTO noelle_runs (id, day, slot, kind, state, stops, calls, line, reads, created_at, updated_at) VALUES ('nrn_sched', ?, '12:12', 'daily', 'done', '[]', 1, 'x', ?, ?, ?)`).bind(dayIdInZone(at), JSON.stringify(reads), at, at).run();

  it("the Worker keeps at most 14 posts a channel, each one line of at most 80 characters, and drops what is not a post", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ at: `2026-12-${String(i + 1).padStart(2, "0")}`, text: `post ${i}` }));
    const c = cleanItems({ "porch-and-party:instagram": many, "bad key": [{ at: "2026-12-01", text: "x" }], "approvalprep:linkedin": [{ at: "soon", text: "x" }, { at: "2026-12-01T15:00:00Z", text: `line one\u0007\n${"y".repeat(200)}` }] });
    expect(c["porch-and-party:instagram"]).toHaveLength(14);
    expect(Object.keys(c)).toEqual(["porch-and-party:instagram", "approvalprep:linkedin"]);
    expect(c["approvalprep:linkedin"]).toHaveLength(1);
    expect(c["approvalprep:linkedin"]![0]!.text).not.toMatch(/[\u0000-\u001f]/);
    expect(c["approvalprep:linkedin"]![0]!.text.length).toBeLessThanOrEqual(80);
  });

  it("a run's queued posts reach the Growth page per channel", async () => {
    const { apiJson } = await import("./helpers");
    await call("/noelle/plan", plan([SEASON], { facts: { queues: { "porch-and-party:instagram": 2 }, unread: {}, items: { "porch-and-party:instagram": [{ at: "2026-11-24T23:00:00Z", text: "Porch reel" }] } } }));
    const q = (await apiJson<any>("/api/growth/page")).body.data.businesses.find((b: any) => b.key === "porch-and-party").queue;
    expect(q.channels).toEqual([{ channel: "instagram", value: 2, unread: null, items: [{ at: "2026-11-24T23:00:00Z", text: "Porch reel" }] }]);
  });

  it("Sunday's heartbeat writes the week ahead into Monday's growth section: each post in Central, a failed read as not read", async () => {
    await run({
      queues: { "porch-and-party:instagram": 3, "porch-and-party:tiktok": 0 },
      unread: { "approvalprep:linkedin": "LinkedIn has not granted the page API yet: 4 posts written, none can post" },
      items: { "porch-and-party:instagram": [
        { at: "2026-11-30T02:00:00Z", text: "Sunday evening in Memphis, Monday in UTC" },
        { at: "2026-12-01T00:30:00Z", text: "Monday evening porch reel" },
        { at: "2026-12-08T15:00:00Z", text: "next week" },
      ] },
    });
    await noelleWatch(env as any, SUN);
    const lines: string[] = (await growth()).lines.map((l: any) => (typeof l === "string" ? l : l.text));
    const all = lines.join("\n");
    expect(all).toMatch(/This week's schedule, as Noelle read each queue on Sun, Nov 29:/);
    expect(lines).toContain("Porch & Party · Instagram: 1 this week");
    expect(lines).toContain("— Mon, Nov 30, 6:30 PM · Porch & Party · Instagram: “Monday evening porch reel”");
    expect(all).not.toMatch(/Sunday evening in Memphis|next week/);
    expect(all).toMatch(/Porch & Party · TikTok: nothing queued this week/);
    expect(all).toMatch(/ApprovalPrep · LinkedIn: not read \(LinkedIn has not granted/);
    expect(SUN_DAY).toBe("2026-11-29");
  });

  it("no run in two days: Sunday's schedule says NOT READ, never an empty week; a Monday heartbeat writes no schedule", async () => {
    await expect(noelleWatch(env as any, SUN)).rejects.toThrow(/NOELLE_DID_NOT_RUN/);
    expect((await growth()).lines.join(" ")).toMatch(/This week's schedule: NOT READ\. Noelle has not run in two days/);
    await env.DB.exec(`DELETE FROM morning_sections`);
    await run({ queues: { "porch-and-party:instagram": 1 }, unread: {}, items: {} }, SUN + 86_400_000 - 3_600_000);
    await noelleWatch(env as any, SUN + 86_400_000);
    expect(await growth()).toBeNull();
  });
});

describe("item 11: every acted thing is on the ledger with its measure and floors", () => {
  const reading = (day: string, measure: string, business: string, channel: string, value: number | null, unread: string | null = null) =>
    env.DB.prepare(`INSERT INTO growth_readings (day, measure, business, kind, channel, language, value, unread, at) VALUES (?,?,?,?,?,'en',?,?,?)`).bind(day, measure, business, "requests", channel, value, unread, NOW).run();

  it("done writes one row per acted thing: the channel's measure, the reading that day as the floor; forged rows dropped; a replayed done writes nothing", async () => {
    await reading(DAY, "pnp-requests-instagram", "porch-and-party", "instagram", 4);
    await reading(DAY, "ap-sales", "approvalprep", "site", null, "not read: Stripe key");
    await reading("2026-12-20", "pnp-requests-instagram", "porch-and-party", "instagram", 40);
    const { run } = await json(await call("/noelle/plan", plan([SEASON])));
    const body = { run, published: [], acted: [
      { kind: "studio-plan", business: "porch-and-party", channel: "instagram", item: "pnp-1", at: "2026-11-25T00:00:00Z" },
      { kind: "studio-plan", business: "porch-and-party", channel: "tiktok", item: "pnp-2", at: "2026-11-25T00:00:00Z", scorecard: { floor30: 2, floor60: 3 } },
      { kind: "job-target", business: "approvalprep", channel: "threads", item: "seq23/approvalprep#9" },
      { kind: "studio-plan", business: "brindlewood", channel: "instagram", item: "x" },
      { kind: "spend", business: "porch-and-party", channel: "instagram", item: "y" },
      { kind: "studio-plan", business: "porch-and-party", channel: "instagram", item: "pnp-1", at: "2026-11-25T00:00:00Z" },
    ] };
    const res = await json(await call("/noelle/done", body));
    expect(res.ledgered).toBe(3);
    const got = await rows(`SELECT kind, business, channel, item, measure, floor30, floor60, floor_source, day FROM noelle_actions ORDER BY item`);
    expect(got).toEqual([
      { kind: "studio-plan", business: "porch-and-party", channel: "instagram", item: "pnp-1", measure: "pnp-requests-instagram", floor30: 4, floor60: 4, floor_source: "baseline", day: DAY },
      { kind: "studio-plan", business: "porch-and-party", channel: "tiktok", item: "pnp-2", measure: "pnp-requests-tiktok", floor30: 2, floor60: 3, floor_source: "scorecard", day: DAY },
      { kind: "job-target", business: "approvalprep", channel: "threads", item: "seq23/approvalprep#9", measure: "ap-sales", floor30: null, floor60: null, floor_source: "not read", day: DAY },
    ]);
    expect((await call("/noelle/done", body)).status).toBe(400);
    expect((await rows(`SELECT id FROM noelle_actions`)).length).toBe(3);
  });

  it("her context carries the results against floors; with an empty ledger it says so, never an empty block", async () => {
    const ctx = await json(await call("/noelle/context"));
    expect(ctx.results).toEqual(["Results against floors: the ledger has no action yet."]);
  });

  it("Sunday's heartbeat puts results against floors under the week's schedule", async () => {
    const SUN = Date.parse("2026-11-30T03:05:00Z");
    await env.DB.prepare(`INSERT INTO noelle_runs (id, day, slot, kind, state, stops, calls, line, reads, created_at, updated_at) VALUES ('nrn_led', '2026-11-29', '12:12', 'daily', 'done', '[]', 1, 'x', '{"queues":{"porch-and-party:instagram":0},"unread":{},"items":{}}', ?, ?)`).bind(SUN - 3_600_000, SUN - 3_600_000).run();
    for (const [id, floor] of [["a", 3], ["b", 9]] as const)
      await env.DB.prepare(`INSERT INTO noelle_actions (id, run_id, day, kind, business, channel, item, measure, floor30, floor60, floor_source, created_at) VALUES (?, 'nrn_x', '2026-10-20', 'studio-plan', 'porch-and-party', 'instagram', ?, 'pnp-requests-instagram', ?, ?, 'baseline', 0)`).bind(`nac_${id}`, id, floor, floor).run();
    await reading("2026-11-19", "pnp-requests-instagram", "porch-and-party", "instagram", 5);
    await noelleWatch(env as any, SUN);
    const lines: string[] = JSON.parse((await rows(`SELECT body FROM morning_sections WHERE section = 'growth'`))[0].body).lines.map((l: any) => (typeof l === "string" ? l : l.text));
    expect(lines).toContain("Porch & Party · Instagram · studio-plan: 2 past day 30: 1 met, 1 missed");
  });
});

describe("item 6: her charter says what her rulings say (migration 0380)", () => {
  it("she publishes new things on roster channels, owns LinkedIn for the apps, and still never spends, opens accounts or deletes", async () => {
    const charter: string = (await env.DB.prepare(`SELECT charter FROM employees WHERE id = 'emp_growth'`).first<any>())!.charter;
    expect(charter).toMatch(/A new format or page on a channel already on the roster is yours to publish/);
    expect(charter).toMatch(/LinkedIn for the apps with a page/);
    expect(charter).toMatch(/You never spend, open an account or delete\./);
    expect(charter).not.toMatch(/anything new goes to her as a decision/i);
    expect(charter).not.toMatch(/never spend, create an account, post/);
  });
});
