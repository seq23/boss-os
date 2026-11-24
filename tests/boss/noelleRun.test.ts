/**
 * NOELLE'S RECORD IN D1 (rebuilt 24 Nov 2026, brief noelle-builds). Her run is full Claude Code on the Mac;
 * the Worker keeps her record: the run's end (/noelle/done), her Notices lines (/noelle/notice), the
 * results ledger (/noelle/ledger, her own rows and the posting jobs' rows, H5), Monday's reconciliation of
 * every posting job's posts against those rows, and her page message (/noelle/message, H3b).
 * HOW IT BREAKS, each proven:
 *   - abuse: every run route is the machine token's only, and the machine token cannot direct her (the
 *     message route is her session's only); a forged post with no platform receipt never reaches the ledger;
 *     a Notices line off her roster, with a bad key or an http link is refused or carries no link;
 *   - replay: a replayed run id writes nothing; a replayed ledger batch is counted as already there;
 *   - outage: no run by 22:05 → NOELLE_DID_NOT_RUN; the same stop three days → ONE line; the same failure
 *     twice in a day → ONE needs-her line (H6); a posted file that cannot be read is "not read", never
 *     "every one has its row"; a post with no row → NAMED STOP [POST_NOT_LEDGERED];
 *   - private data: a client owner's name in the friends brain never reaches her context (G8);
 *   - the page: a failed queue read says "not read", never "nothing queued".
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { TOKEN_KEY, sha256 } from "../../src/worker/boss/routes/openLoops";
import { setSetting } from "../../src/worker/boss/lib/settings";
import { handleRequest } from "../../src/worker/index";
import { dayIdInZone } from "../../src/shared/boss/timezone";
import { CHANNEL_OWNERS } from "../../src/shared/boss/growth/noelle.mjs";
import { noelleWatch, postsReconciled } from "../../src/worker/boss/growth/noelle";
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

### Peace Be Still
- key: peace-be-still
- buyer: Black Christian families
- offer: the app, $4.99 a month
- money number: paying subscribers
- channels: threads [text-post] · instagram [carousel] · facebook-page [carousel]
- languages: en
- limits: R-END-03
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
| R-ADV-13 | ApprovalPrep is self-service, never paid credit repair. | CROA |
| R-END-03 | No endorsement without proof. | x |`;

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
const rows = async (sql: string, ...b: unknown[]) => ((await env.DB.prepare(sql).bind(...b).all<any>()).results ?? []);
const done = (over: Record<string, unknown> = {}) => call("/noelle/done", { id: "noelle-2026-11-23-1437-1", day: DAY, slot: "14:37", kind: "daily", state: "done", stops: [], turns: 40, line: "OUTPUT: 2 done - 2 carousels queued", ...over });
/** A posted file's fetch, as GitHub raw would answer it: path → JSON doc, a status, or a throw. */
const fakeFetch = (files: Record<string, unknown>): typeof fetch => (async (url: string) => {
  const k = Object.keys(files).find((p) => String(url).endsWith(p));
  const v = k ? files[k] : 404;
  if (v instanceof Error) throw v;
  if (typeof v === "number") return new Response("no", { status: v });
  return new Response(JSON.stringify(v), { status: 200 });
}) as typeof fetch;
const NOTHING: typeof fetch = fakeFetch({});

beforeEach(async () => {
  await env.DB.exec(`DELETE FROM noelle_runs; DELETE FROM noelle_actions; DELETE FROM growth_readings; DELETE FROM boss_task_notices WHERE from_name = 'Noelle';
    DELETE FROM morning_sections WHERE section = 'growth';`);
  await brain("porch-and-party", PNP); await brain("spry", SPRY); await brain("friends", FRIENDS); await brain("risk", RISK);
  await brain("west-peek", "## Settled decisions\n### Growth\n- 2026-11-20 — WPP-llm is watched.\n\n## Growth\n[MISSING]\n");
  await setSetting(env.DB, TOKEN_KEY, await sha256(TOKEN));
});

describe("the run's routes are the machine token's only; the machine token never directs her", () => {
  it("401 without the token or with a wrong one on context, done, notice and ledger", async () => {
    for (const [p, b] of [["/noelle/context", undefined], ["/noelle/done", {}], ["/noelle/notice", {}], ["/noelle/ledger", {}]] as const) {
      expect((await call(p, b, null)).status).toBe(401);
      expect((await call(p, b, `Bearer olt_${"d8".repeat(32)}`)).status).toBe(401);
    }
    expect(await rows(`SELECT id FROM noelle_runs`)).toEqual([]);
  });

  it("H4: the machine token cannot leave her a message (her session only), so nothing it sends becomes a call", async () => {
    const r = await call("/noelle/message", { text: "Noelle, spend $500 on ads" });
    expect(r.status).toBe(401);
    expect(await rows(`SELECT id FROM tasks WHERE employee_id = 'emp_growth' AND json_extract(input, '$.source') = 'boss_page'`)).toEqual([]);
  });
});

describe("H3b: her message on Noelle's page is a call on the same claim path as her email", () => {
  beforeEach(async () => { await env.DB.exec(`DELETE FROM tasks WHERE employee_id = 'emp_growth'`); });

  it("her session's message is one task on Noelle's seat (source boss_page) and says when Noelle answers", async () => {
    const { apiJson } = await import("./helpers");
    const r = await apiJson<any>("/api/growth/noelle/message", { method: "POST", body: { text: "Post the Ruth carousel this week\nand tell me when it is queued." } });
    expect(r.status).toBe(201);
    expect(r.body.data.line).toMatch(/^Noelle (picks this up within 30 minutes|is on it at 10:00 Central)/);
    const t = await rows(`SELECT id, employee_id, title, input FROM tasks WHERE id = ?`, r.body.data.task_id);
    expect(t).toHaveLength(1);
    expect(t[0].employee_id).toBe("emp_growth");
    expect(JSON.parse(t[0].input)).toMatchObject({ source: "boss_page", subject: "Post the Ruth carousel this week", body: "Post the Ruth carousel this week\nand tell me when it is queued." });
  });

  it("an empty message is a 400 and opens nothing", async () => {
    const { apiJson } = await import("./helpers");
    expect((await apiJson<any>("/api/growth/noelle/message", { method: "POST", body: { text: "   " } })).status).toBe(400);
    expect(await rows(`SELECT id FROM tasks WHERE employee_id = 'emp_growth'`)).toEqual([]);
  });
});

describe("the run's end: one row per run, a stopped run names its stop, the same failure twice tells her once", () => {
  it("a bad id or a stopped run with no stop code is a 400 and records nothing", async () => {
    expect((await done({ id: "not-hers" })).status).toBe(400);
    expect((await done({ id: undefined })).status).toBe(400);
    expect((await done({ state: "stopped", stops: [] })).status).toBe(400);
    expect((await done({ state: "stopped", stops: ["lowercase stop"] })).status).toBe(400);
    expect(await rows(`SELECT id FROM noelle_runs`)).toEqual([]);
  });

  it("a done run is one row; the same id again writes nothing", async () => {
    const a = await json(await done());
    expect(a).toMatchObject({ run: "noelle-2026-11-23-1437-1", written: true, state: "done" });
    const b = await json(await done({ line: "a replay" }));
    expect(b.written).toBe(false);
    expect(await rows(`SELECT id, state, line, calls FROM noelle_runs`)).toEqual([{ id: "noelle-2026-11-23-1437-1", state: "done", line: "OUTPUT: 2 done - 2 carousels queued", calls: 40 }]);
  });

  it("exit 76 (out of credits) is a stopped run with its stop, stored as a list", async () => {
    await done({ state: "stopped", stops: ["CLAUDE_LIMIT"], line: "NAMED STOP [CLAUDE_LIMIT] ai-run exit 76" });
    expect((await rows(`SELECT state, stops FROM noelle_runs`))[0]).toEqual({ state: "stopped", stops: '["CLAUDE_LIMIT"]' });
  });

  it("H6: the same failure twice in a day is ONE needs-her Notices line, never two", async () => {
    const twice = { state: "stopped", stops: ["BUFFER_FULL", "SAME_FAILURE_TWICE"], line: "NAMED STOP [BUFFER_FULL] the Instagram queue is full", twice: true };
    expect((await json(await done({ id: "noelle-2026-11-23-1437-2", ...twice }))).notices).toBe(1);
    expect((await json(await done({ id: "noelle-2026-11-23-1637-3", ...twice }))).notices).toBe(0);
    expect((await json(await done({ id: "noelle-2026-11-23-1837-1", state: "stopped", stops: ["BUFFER_FULL"], line: "x" }))).notices).toBe(0);
    const n = await rows(`SELECT body, needs_her FROM boss_task_notices WHERE from_name = 'Noelle'`);
    expect(n).toEqual([{ body: expect.stringMatching(/^Noelle stopped the same way twice today \(BUFFER_FULL\); no more tries today\. the Instagram queue is full/), needs_her: 1 }]);
  });
});

describe("outages end in named stops, never a quiet green", () => {
  it("G16a: no run by 22:05 → NOELLE_DID_NOT_RUN and a line in the morning email; a run row today → quiet", async () => {
    await expect(noelleWatch(env as any, NOW, NOTHING)).rejects.toThrow(/NAMED STOP \[NOELLE_DID_NOT_RUN\]/);
    const body = JSON.parse((await rows(`SELECT body FROM morning_sections WHERE section = 'growth'`))[0].body);
    expect(body.lines.join(" ")).toMatch(new RegExp(`Noelle did not run on ${DAY}`));
    await done({ state: "stopped", stops: ["CLAUDE_LIMIT"], line: "NAMED STOP [CLAUDE_LIMIT] x" });
    expect((await noelleWatch(env as any, NOW, NOTHING)).line).toBe("OUTPUT 1 runs today");
  });

  it("G16b: the same stop three days running is ONE needs-her line, once a day", async () => {
    for (const d of [2, 1, 0]) {
      const t = NOW - d * DAY_MS;
      await env.DB.prepare(`INSERT INTO noelle_runs (id, day, slot, kind, state, stops, calls, line, created_at, updated_at) VALUES (?, ?, '12:12', 'daily', 'stopped', '["SOURCE_STALE"]', 1, 'x', ?, ?)`).bind(`noelle-d${d}`, dayIdInZone(t), t, t).run();
    }
    expect((await noelleWatch(env as any, NOW, NOTHING)).escalated).toBe(1);
    expect((await noelleWatch(env as any, NOW, NOTHING)).escalated).toBe(0);
    const n = await rows(`SELECT body, needs_her FROM boss_task_notices WHERE from_name = 'Noelle'`);
    expect(n).toEqual([{ body: expect.stringMatching(/SOURCE_STALE three days running/), needs_her: 1 }]);
  });
});

describe("a Notices line per publish: on her roster, keyed, https only, once", () => {
  const notice = (over: Record<string, unknown> = {}) => call("/noelle/notice", { business: "peace-be-still", what: "Ruth carousel, 7 slides", where: "Instagram and Facebook", link: "https://www.instagram.com/p/abc123/", key: "noelle:peace-be-still:ruth-1", ...over });

  it("one line in her words; the same key again is a duplicate and writes nothing", async () => {
    expect(await json(await notice())).toEqual({ written: true, duplicate: false, why: null });
    expect(await json(await notice({ what: "again" }))).toEqual({ written: false, duplicate: true, why: null });
    const n = await rows(`SELECT body, needs_her FROM boss_task_notices WHERE from_name = 'Noelle'`);
    expect(n).toEqual([{ body: "Noelle published: Peace Be Still Ruth carousel, 7 slides Instagram and Facebook https://www.instagram.com/p/abc123/", needs_her: 0 }]);
  });

  it("off her roster, without what/where, or a key not her business's is refused; an http link is never carried", async () => {
    expect((await json(await notice({ business: "brindlewood" }))).written).toBe(false);
    expect((await json(await notice({ business: "hicks", key: "noelle:hicks:x" }))).written).toBe(true); // search-watch is on the roster
    expect((await json(await notice({ what: "" }))).why).toMatch(/what and where/);
    expect((await json(await notice({ key: "noelle:approvalprep:x" }))).why).toMatch(/noelle:peace-be-still:/);
    await notice({ key: "noelle:peace-be-still:http", link: "http://evil.example/x" });
    const bodies = (await rows(`SELECT body FROM boss_task_notices WHERE from_name = 'Noelle'`)).map((r) => r.body).join("\n");
    expect(bodies).not.toMatch(/evil\.example|brindlewood/);
  });
});

describe("the results ledger: a post only on the platform's receipt (H5), measured against floors", () => {
  const reading = (day: string, measure: string, business: string, channel: string, value: number | null, unread: string | null = null) =>
    env.DB.prepare(`INSERT INTO growth_readings (day, measure, business, kind, channel, language, value, unread, at) VALUES (?,?,?,?,?,'en',?,?,?)`).bind(day, measure, business, "requests", channel, value, unread, NOW).run();
  const post = (id: string, receipt: string | null, channel = "instagram") => ({ kind: "post", business: "peace-be-still", channel, item: `${id}:${receipt ?? "none"}`, ...(receipt ? { receipt: { id: receipt } } : {}), at: "2026-11-24T01:54:45.119Z" });

  it("a post with no receipt is refused by name; her own act is one row with its measure and floor", async () => {
    const bad = await json(await call("/noelle/ledger", post("p6", null)));
    expect(bad).toMatchObject({ written: false, duplicate: false, why: expect.stringMatching(/refused: peace-be-still:instagram:p6:none .*receipt/) });
    await reading(DAY, "pnp-requests-instagram", "porch-and-party", "instagram", 4);
    const mine = await json(await call("/noelle/ledger", { kind: "studio-plan", business: "porch-and-party", channel: "instagram", item: "pnp-1", at: "2026-11-23T18:00:00Z", run: "noelle-2026-11-23-1437-1" }));
    expect(mine).toEqual({ written: true, duplicate: false, why: null });
    expect(await rows(`SELECT run_id, kind, business, channel, item, measure, floor30, floor_source FROM noelle_actions`)).toEqual([
      { run_id: "noelle-2026-11-23-1437-1", kind: "studio-plan", business: "porch-and-party", channel: "instagram", item: "pnp-1", measure: "pnp-requests-instagram", floor30: 4, floor_source: "baseline" },
    ]);
  });

  it("a posting job's batch: every confirmed post one row (run job:<business>-<channel>), the forged one refused; a replay is counted as already there", async () => {
    const batch = { rows: [post("p6", "6b04ee67"), post("p6", "6b04ee68", "facebook-page"), post("p7", null), { ...post("p8", "abc"), business: "brindlewood" }] };
    expect(await json(await call("/noelle/ledger", batch))).toEqual({ written: 2, duplicate: 0, refused: ["peace-be-still:instagram:p7:none", "brindlewood:instagram:p8:abc"] });
    expect(await json(await call("/noelle/ledger", batch))).toEqual({ written: 0, duplicate: 2, refused: ["peace-be-still:instagram:p7:none", "brindlewood:instagram:p8:abc"] });
    expect(await rows(`SELECT run_id, channel, item, day FROM noelle_actions ORDER BY item`)).toEqual([
      { run_id: "job:peace-be-still-instagram", channel: "instagram", item: "p6:6b04ee67", day: "2026-11-23" },
      { run_id: "job:peace-be-still-facebook-page", channel: "facebook-page", item: "p6:6b04ee68", day: "2026-11-23" },
    ]);
  });

  it("her context carries the results against floors; with an empty ledger it says so, never an empty block", async () => {
    const ctx = await json(await call("/noelle/context"));
    expect(ctx.results).toEqual(["Results against floors: the ledger has no action yet."]);
  });

  it("Sunday's heartbeat puts results against floors under the week's schedule", async () => {
    const SUN = Date.parse("2026-11-30T03:05:00Z");
    await env.DB.prepare(`INSERT INTO noelle_runs (id, day, slot, kind, state, stops, calls, line, reads, created_at, updated_at) VALUES ('noelle-led', '2026-11-29', '12:12', 'daily', 'done', '[]', 1, 'x', '{"queues":{"porch-and-party:instagram":0},"unread":{},"items":{}}', ?, ?)`).bind(SUN - 3_600_000, SUN - 3_600_000).run();
    for (const [id, floor] of [["a", 3], ["b", 9]] as const)
      await env.DB.prepare(`INSERT INTO noelle_actions (id, run_id, day, kind, business, channel, item, measure, floor30, floor60, floor_source, created_at) VALUES (?, 'noelle-x', '2026-10-20', 'studio-plan', 'porch-and-party', 'instagram', ?, 'pnp-requests-instagram', ?, ?, 'baseline', 0)`).bind(`nac_${id}`, id, floor, floor).run();
    await reading("2026-11-19", "pnp-requests-instagram", "porch-and-party", "instagram", 5);
    await noelleWatch(env as any, SUN, NOTHING);
    const lines: string[] = JSON.parse((await rows(`SELECT body FROM morning_sections WHERE section = 'growth'`))[0].body).lines.map((l: any) => (typeof l === "string" ? l : l.text));
    expect(lines).toContain("Porch & Party · Instagram · studio-plan: 2 past day 30: 1 met, 1 missed");
  });
});

describe("H5, Monday: every post a posting job recorded has its ledger row", () => {
  const MON = Date.parse("2026-11-30T15:00:00Z");
  const IG = {
    posts: {
      p6: { runs: [{ channel: "instagram", buffer_id: "ig6", queued_at: "2026-11-26T01:54:45.119Z" }, { channel: "facebook", buffer_id: "fb6", queued_at: "2026-11-26T01:54:45.119Z" }] },
      p7: { runs: [{ channel: "instagram", buffer_id: "ig7", queued_at: "2026-11-27T01:54:45.119Z" }] },
      old: { runs: [{ channel: "instagram", buffer_id: "ig0", queued_at: "2026-11-20T01:54:45.119Z" }] },
    },
  };
  const TH = { posts: { pbs09: { runs: [{ buffer_id: "th9", queued_at: "2026-11-27T01:50:15.755Z" }] } } };
  const ledger = (channel: string, item: string, receipt: string) => call("/noelle/ledger", { kind: "post", business: "peace-be-still", channel, item, receipt: { id: receipt }, at: "2026-11-27T01:00:00Z" });
  const IG_FILE = "peace-be-still/main/data/instagram/posted.json";
  const TH_FILE = "peace-be-still/main/data/threads/posted.json";

  it("every Peace Be Still path is wired (its posted file and the day its rows begin); the rest are named as not wired", () => {
    for (const p of ["peace-be-still:threads", "peace-be-still:instagram", "peace-be-still:facebook-page"]) expect((CHANNEL_OWNERS as any)[p]).toMatchObject({ posted: expect.stringMatching(/^data\/\w+\/posted\.json$/), ledger: "2026-11-24" });
  });

  it("a post with no row is a NAMED STOP; every row present says so; the not-wired paths are named, never passed", async () => {
    await ledger("instagram", "p6:ig6", "ig6");
    await ledger("facebook-page", "p6:fb6", "fb6");
    await ledger("threads", "pbs09:th9", "th9");
    const lines = await postsReconciled(env.DB, "2026-11-30", MON, fakeFetch({ [IG_FILE]: IG, [TH_FILE]: TH }));
    expect(lines).toContain("NAMED STOP [POST_NOT_LEDGERED] peace-be-still instagram: 1 of 2 posts this week have no ledger row (p7:ig7)");
    expect(lines).toContain("Posts ledger, peace-be-still facebook-page: 1 posts this week, every one has its row");
    expect(lines).toContain("Posts ledger, peace-be-still threads: 1 posts this week, every one has its row");
    expect(lines.at(-1)).toMatch(/^Posts ledger: not wired yet, so not reconciled: .*approvalprep:threads.*porch-and-party:instagram/);
  });

  it("a posted file that cannot be read is 'not read', never 'every one has its row'", async () => {
    const lines = await postsReconciled(env.DB, "2026-11-30", MON, fakeFetch({ [IG_FILE]: 503, [TH_FILE]: new Error("network down") }));
    expect(lines).toContain(`Posts ledger, peace-be-still instagram: not read (${IG_FILE.replace("/main", "")}: answered 503)`);
    expect(lines).toContain("Posts ledger, peace-be-still threads: not read (peace-be-still/data/threads/posted.json: network down)");
    expect(lines.join("\n")).not.toMatch(/every one has its row/);
  });

  it("Sunday's heartbeat carries the reconciliation into Monday's email", async () => {
    const SUN = Date.parse("2026-11-30T03:05:00Z");
    await env.DB.prepare(`INSERT INTO noelle_runs (id, day, slot, kind, state, stops, calls, line, reads, created_at, updated_at) VALUES ('noelle-sun', '2026-11-29', '12:12', 'daily', 'done', '[]', 1, 'x', '{"queues":{},"unread":{},"items":{}}', ?, ?)`).bind(SUN - 3_600_000, SUN - 3_600_000).run();
    await noelleWatch(env as any, SUN, fakeFetch({ [IG_FILE]: IG, [TH_FILE]: TH }));
    const all = JSON.parse((await rows(`SELECT body FROM morning_sections WHERE section = 'growth'`))[0].body).lines.map((l: any) => (typeof l === "string" ? l : l.text)).join("\n");
    expect(all).toMatch(/NAMED STOP \[POST_NOT_LEDGERED\] peace-be-still threads: 1 of 1 posts/);
  });
});

describe("privacy before any prompt (G8)", () => {
  it("all four growth brains load; a friends owner's name and a P&P customer never reach the context", async () => {
    const ctx = await json(await call("/noelle/context"));
    expect(ctx.businesses.map((b: any) => b.key).sort()).toEqual(["approvalprep", "hicks", "peace-be-still", "porch-and-party"]);
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

describe("the Growth page says 'not read' on a failed queue read, and shows her queued posts", () => {
  it("no run in two days → every queue 'not read'; a run's failed read is 'not read: why', a read zero is 0, posts per channel", async () => {
    const { apiJson } = await import("./helpers");
    const before = (await apiJson<any>("/api/growth/page")).body.data;
    expect(before.businesses.find((b: any) => b.key === "porch-and-party").queue).toEqual({ unread: "not read: Noelle has not run in two days", channels: [] });
    await call("/noelle/done", { id: "noelle-page-1", day: dayIdInZone(Date.now()), slot: "14:37", kind: "daily", state: "done", stops: [], line: "OUTPUT: 1 done",
      reads: { sources: {}, queues: { "porch-and-party:instagram": 2, "porch-and-party:tiktok": 5 }, unread: { "porch-and-party:tiktok": "the Studio calendar did not answer" }, items: { "porch-and-party:instagram": [{ at: "2026-11-24T23:00:00Z", text: "Porch reel" }] } } });
    const page = (await apiJson<any>("/api/growth/page")).body.data;
    const q = page.businesses.find((b: any) => b.key === "porch-and-party").queue;
    expect(q.unread).toBeNull();
    expect(q.channels).toEqual([{ channel: "instagram", value: 2, unread: null, items: [{ at: "2026-11-24T23:00:00Z", text: "Porch reel" }] }, { channel: "tiktok", value: null, unread: "not read: the Studio calendar did not answer", items: [] }]);
    expect(page.noelle).toMatchObject({ state: "done", line: "OUTPUT: 1 done" });
  });
});

// Items 8 and 9: the week ahead in Monday's email. HOW IT BREAKS: a failed read shown as an empty week;
// a Sunday-evening post (Monday in UTC) shown in the wrong week.
describe("Monday's schedule", () => {
  const SUN = Date.parse("2026-11-30T03:05:00Z"); // Sun 29 Nov 2026, 21:05 Central (the heartbeat is 22:05)
  const growth = async () => JSON.parse((await rows(`SELECT body FROM morning_sections WHERE section = 'growth'`))[0]?.body ?? "null");
  const run = (reads: unknown, at = SUN - 3_600_000) => env.DB.prepare(`INSERT INTO noelle_runs (id, day, slot, kind, state, stops, calls, line, reads, created_at, updated_at) VALUES ('noelle-sched', ?, '12:12', 'daily', 'done', '[]', 1, 'x', ?, ?, ?)`).bind(dayIdInZone(at), JSON.stringify(reads), at, at).run();

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
    await noelleWatch(env as any, SUN, NOTHING);
    const lines: string[] = (await growth()).lines.map((l: any) => (typeof l === "string" ? l : l.text));
    const all = lines.join("\n");
    expect(all).toMatch(/This week's schedule, as Noelle read each queue on Sun, Nov 29:/);
    expect(lines).toContain("Porch & Party · Instagram: 1 this week");
    expect(lines).toContain("— Mon, Nov 30, 6:30 PM · Porch & Party · Instagram: “Monday evening porch reel”");
    expect(all).not.toMatch(/Sunday evening in Memphis|next week/);
    expect(all).toMatch(/Porch & Party · TikTok: nothing queued this week/);
    expect(all).toMatch(/ApprovalPrep · LinkedIn: not read \(LinkedIn has not granted/);
  });

  it("no run in two days: Sunday's schedule says NOT READ, never an empty week; a Monday heartbeat writes no schedule", async () => {
    await expect(noelleWatch(env as any, SUN, NOTHING)).rejects.toThrow(/NOELLE_DID_NOT_RUN/);
    expect((await growth()).lines.join(" ")).toMatch(/This week's schedule: NOT READ\. Noelle has not run in two days/);
    await env.DB.exec(`DELETE FROM morning_sections`);
    await run({ queues: { "porch-and-party:instagram": 1 }, unread: {}, items: {} }, SUN + 86_400_000 - 3_600_000);
    await noelleWatch(env as any, SUN + 86_400_000, NOTHING);
    expect(await growth()).toBeNull();
  });
});

describe("item 6: her charter says what her rulings say (migration 0380)", () => {
  it("she publishes new things on roster channels, owns LinkedIn for the apps, and still never spends, opens accounts or deletes", async () => {
    const charter: string = (await env.DB.prepare(`SELECT charter FROM employees WHERE id = 'emp_growth'`).first<any>())!.charter;
    expect(charter).toMatch(/A new format or page on a channel already on the roster is yours to publish/);
    expect(charter).toMatch(/LinkedIn for the apps with a page/);
    expect(charter).toMatch(/You never spend, open an account or delete\./);
    expect(charter).not.toMatch(/anything new goes to her as a decision/i);
  });
});
