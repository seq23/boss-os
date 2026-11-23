/**
 * THE BACKLINK NETWORK READS THE GROWTH DIRECTOR'S ORDERS (her words, 22 Nov 2026: "i thought the
 * backlink network was going to defer to the growth director"). HOW IT BREAKS, each proven:
 *   - auth: no token or a wrong one → 401; the token opens this route and ai-misses only, never
 *     another /api/growth route;
 *   - outage/empty: no cycle → 200 with orders []; a malformed actions row is skipped, never a 500;
 *   - data: channel backlinks only, the newest cycle only, four fields, no evidence/decision text,
 *     owner email or another channel's draft;
 *   - inbox: a cycle with backlinks items opens no to-do and no card for them; a bad or missing topic
 *     from the model drops that item and the cycle carries on.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { runGrowthDirector, type Model } from "../../src/worker/boss/growth/run";
import { TOKEN_KEY, sha256 } from "../../src/worker/boss/routes/openLoops";
import { setSetting } from "../../src/worker/boss/lib/settings";
import worker, { handleRequest } from "../../src/worker/index";
import { dayIdInZone } from "../../src/shared/boss/timezone";
import { MAX_BACKLINKS_PER_CYCLE, TOPIC_MAX } from "../../src/shared/boss/growth/director.mjs";
import type { Env } from "../../src/worker/env";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const DAY = dayIdInZone(NOW);
const SPRY = `## Settled decisions
### Umbrella, scope and money
- 2026-11-01 — Spry Labs spends nothing without her yes.
### Growth (Shoestring Growth Plan, 21 Nov 2026)
- 2026-11-22 — The backlink network is an outside publisher with its own Cloudflare account; the Director sends it link requests, never commands.
### Search, sites and freshness
- 2026-11-02 — Every site keeps a fresh sitemap.
### Brand and social
- 2026-11-03 — Calm, plain voice everywhere.
### All apps
- 2026-11-04 — Every app has a privacy page.
### ApprovalPrep
- 2026-11-05 — ApprovalPrep is self-service, in her words.

## Growth
### ApprovalPrep
- key: approvalprep
- buyer: people fixing their credit themselves
- offer: self-help letters
- money number: sales
- channels: backlinks [guide] · pinterest [pin]
- languages: en
- limits: R-ADV-13
`;
const PNP = `## Settled decisions
### Growth
- 2026-11-21 — Porch reels lead in December. <!-- confidential -->Customer Brindlewood.<!-- /confidential -->

## Growth
### Porch & Party
- key: porch-and-party
- buyer: families
- offer: porches
- money number: requests
- channels: instagram [reel]
- languages: en
- limits: R-PRF-01
`;
const RISK = `| R-PRF-01 | No invented reviews. | x |
| R-PRF-02 | No invented people. | x |
| R-END-01 | Affiliate links are labelled. | x |
| R-END-03 | AI clips are labelled. | x |
| R-ADV-13 | ApprovalPrep is self-service, never paid credit repair. | CROA |`;
const brain = (slug: string, body: string) => env.DB.prepare(`INSERT INTO brains (slug, title, body_md, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET body_md = excluded.body_md`).bind(slug, slug, body, NOW).run();
const reading = (measure: string, business: string, value: number, day = DAY) => env.DB.prepare(`INSERT OR REPLACE INTO growth_readings (day, measure, business, kind, channel, language, value, unread, at) VALUES (?,?,?,?,?,?,?,?,?)`)
  .bind(day, measure, business, "sales", "site", "en", value, null, NOW).run();
const loops = async () => ((await env.DB.prepare(`SELECT * FROM owner_open_loops WHERE source_key LIKE 'growth%'`).all<any>()).results ?? []);
const cards = async () => ((await env.DB.prepare(`SELECT a.* FROM approvals a JOIN judgement_calls j ON j.approval_id = a.id WHERE j.resume_kind = 'growth_proposal'`).all<any>()).results ?? []);
const noTrends = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
const passAll: Model = async (_e, messages, job) => {
  if (job === "growth-claims") return JSON.stringify({ pass: !/★/.test(messages.map((m) => m.content).join("\n")), broken: [], why: "" });
  if (job === "growth-spend") return JSON.stringify({ costs_money: false, creates_account: false });
  return null;
};
const decider = (queue: unknown[]): Model => async (e, m, job) => job === "growth-decide"
  ? JSON.stringify({ decision: "More guides on dispute letters.", evidence: ["sales: 1 (owner sequoia@example.com)"], test: null, queue, proposals: [], next_check: "2026-11-30" })
  : passAll(e, m, job);

const outer = {
  WP_OS_DB: env.DB, WP_OS_DOCUMENTS: env.VAULT, WP_OS_KV: env.SESSIONS, WP_OS_ENV: "local",
  BOSS_PASSCODE: env.BOSS_PASSCODE, BOSS_SESSION_SECRET: env.SESSION_SECRET,
  ASSETS: { fetch: async () => new Response("<html>spa</html>", { headers: { "content-type": "text/html" } }) },
} as unknown as Env;
const TOKEN = `olt_${"c3".repeat(32)}`;
const call = (path: string, auth?: string, method = "GET") => handleRequest(new Request(`https://boss.sequoiataylor.com${path}`, { method, headers: { ...(auth ? { authorization: auth } : {}), ...(method === "POST" ? { "content-type": "application/json" } : {}) }, ...(method === "POST" ? { body: "{}" } : {}) }), outer);
const orders = (auth = `Bearer ${TOKEN}`) => call("/api/boss/growth/backlink-orders", auth);

beforeEach(async () => {
  await env.DB.exec("DELETE FROM growth_decisions; DELETE FROM growth_readings; DELETE FROM owner_open_loops WHERE source_key LIKE 'growth%'; DELETE FROM approvals WHERE id IN (SELECT approval_id FROM judgement_calls WHERE resume_kind = 'growth_proposal'); DELETE FROM judgement_calls WHERE resume_kind = 'growth_proposal';");
  await brain("spry", SPRY); await brain("porch-and-party", PNP); await brain("risk", RISK);
  await setSetting(env.DB, TOKEN_KEY, await sha256(TOKEN));
});

describe("the Director's cycle writes backlink orders, never to-dos or cards", () => {
  it("an approved backlinks item is ordered; no topic / too long is dropped and written down; unapproved is refused; the cycle carries on", async () => {
    await reading("ap-sales", "approvalprep", 1);
    const model = decider([
      { channel: "backlinks", format: "guide", draft: "How to write a dispute letter yourself", why: "search visits rose", topic: "Writing a credit dispute letter yourself" },
      { channel: "backlinks", format: "guide", draft: "No topic given", why: "w" },
      { channel: "backlinks", format: "listicle", draft: "Ten letters", why: "w", topic: "Ten dispute letters" },
    ]);
    const r = await runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends });
    expect(r.line).toMatch(/^OUTPUT 1 decisions/);
    const row = await env.DB.prepare(`SELECT state, actions FROM growth_decisions WHERE business = 'approvalprep'`).first<any>();
    expect(row.state).toBe("decided");
    const acts = JSON.parse(row.actions);
    expect(acts.filter((a: any) => a.kind === "ordered").map((a: any) => a.item.topic)).toEqual(["Writing a credit dispute letter yourself"]);
    expect(acts.find((a: any) => a.kind === "held").why).toMatch(new RegExp(`1 backlink request had no topic of up to ${TOPIC_MAX} characters`));
    expect(acts.find((a: any) => a.kind === "refused")).toMatchObject({ stop: "NOT_APPROVED" });
    // Nothing for her and nothing for an agent session: the network acts on the order.
    expect(await loops()).toEqual([]);
    expect(await cards()).toEqual([]);
  }, 30_000);

  it("at most MAX_BACKLINKS_PER_CYCLE requests per business a cycle: the rest are held with their item, never requested; a blocked one does not use the place", async () => {
    await reading("ap-sales", "approvalprep", 1);
    const q = (topic: string, draft = `A guide on ${topic}`) => ({ channel: "backlinks", format: "guide", draft, why: "w", topic });
    await runGrowthDirector(env as any, NOW, { model: decider([q("Blocked one", "★★★★★ guaranteed"), q("First that passes"), q("Second that passes"), q("Third that passes")]), fetchImpl: noTrends });
    const acts = JSON.parse((await env.DB.prepare(`SELECT actions FROM growth_decisions WHERE business = 'approvalprep'`).first<any>()).actions);
    expect(MAX_BACKLINKS_PER_CYCLE).toBe(1);
    expect(acts.filter((a: any) => a.kind === "ordered").map((a: any) => a.item.topic)).toEqual(["First that passes"]);
    expect(acts.filter((a: any) => a.kind === "blocked").map((a: any) => a.item.topic)).toEqual(["Blocked one"]);
    const held = acts.filter((a: any) => a.kind === "held" && a.item);
    expect(held.map((a: any) => a.item.topic)).toEqual(["Second that passes"]);
    expect(held[0].why).toMatch(/at most 1 backlink request a week per business/);
    const body = await (await orders()).json() as any;
    expect(body.orders.map((o: any) => o.topic)).toEqual(["First that passes"]);
    expect(await loops()).toEqual([]);
    expect(await cards()).toEqual([]);
  }, 30_000);

  it("a backlinks draft that breaks a rule is blocked, never ordered", async () => {
    await reading("ap-sales", "approvalprep", 1);
    await runGrowthDirector(env as any, NOW, { model: decider([{ channel: "backlinks", format: "guide", draft: "★★★★★ guaranteed approval", why: "w", topic: "Reviews" }]), fetchImpl: noTrends });
    expect((await (await orders()).json() as any).orders).toEqual([]);
  }, 30_000);

  it("the topics already ordered reach next week's prompt, for the scale/stop rule", async () => {
    await reading("ap-sales", "approvalprep", 1);
    await runGrowthDirector(env as any, NOW, { model: decider([{ channel: "backlinks", format: "guide", draft: "d", why: "w", topic: "Dispute letters by mail" }]), fetchImpl: noTrends });
    const seen: string[] = [];
    const later = NOW + 7 * 86_400_000;
    await reading("ap-sales", "approvalprep", 1, dayIdInZone(later));
    await runGrowthDirector(env as any, later, { model: async (e, m, job) => { seen.push(m.map((x) => x.content).join("\n")); return decider([])(e, m, job); }, fetchImpl: noTrends });
    expect(seen.find((t) => /Business: ApprovalPrep/.test(t))).toContain(`- ${DAY}: Dispute letters by mail`);
  }, 30_000);
});

describe("GET /api/boss/growth/backlink-orders", () => {
  const ins = (id: string, cycle: string, business: string, actions: string, at: number, state = "decided", evidence = "[]") =>
    env.DB.prepare(`INSERT INTO growth_decisions (id, cycle, business, label, state, decision, evidence, actions, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(id, cycle, business, business, state, "Brain text: the LP Jane Investor and sequoia@example.com", evidence, actions, at).run();
  const ordered = (topic: string, draft = "lead") => ({ kind: "ordered", item: { channel: "backlinks", format: "guide", draft, why: "visits rose", topic } });

  it("401 without the token, with a wrong one, or a bad shape; the token opens no other growth route", async () => {
    expect((await orders("")).status).toBe(401);
    expect((await orders(`Bearer olt_${"d4".repeat(32)}`)).status).toBe(401);
    expect((await orders(`Token ${TOKEN}`)).status).toBe(401);
    expect((await orders(`Bearer ${TOKEN}x`)).status).toBe(401);
    for (const p of ["/api/boss/growth", "/api/boss/growth/page", "/api/boss/growth/ai-lanes", "/api/boss/open-loops"]) expect((await call(p, `Bearer ${TOKEN}`)).status).toBe(401);
    expect((await call("/api/boss/growth/readings", `Bearer ${TOKEN}`, "POST")).status).toBe(401);
    expect((await call("/api/boss/growth/ai-week", `Bearer ${TOKEN}`, "POST")).status).toBe(401);
    // The same token still opens ai-misses (one token, one check).
    expect((await call("/api/boss/growth/ai-misses?host=keepmyproof.com", `Bearer ${TOKEN}`)).status).toBe(200);
  });

  it("no cycle yet → 200 with orders [] and cycle null, never invented orders", async () => {
    const res = await orders();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cycle: null, read_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), orders: [] });
  });

  it("the newest cycle only, backlinks only, the four fields; a malformed row is skipped, never a 500", async () => {
    await ins("gdc_old", "2026-11-16", "keepmyproof", JSON.stringify([ordered("Last week's topic")]), NOW - 7 * 86_400_000);
    await ins("gdc_ap", "2026-11-23", "approvalprep", JSON.stringify([
      ordered("Dispute letters by mail"),
      { kind: "queued", loop: "olp_x", item: { channel: "pinterest", format: "pin", draft: "PINTEREST DRAFT", why: "w" } },
    ]), NOW, "decided", JSON.stringify(["owner sequoia@example.com said so"]));
    await ins("gdc_broken", "2026-11-23", "dream-wedding", "{not json", NOW);
    await ins("gdc_held", "2026-11-23", "a-player-mode", JSON.stringify([ordered("Held row topic")]), NOW, "held: no model");
    const res = await orders();
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(Object.keys(body).sort()).toEqual(["cycle", "orders", "read_at"]);
    expect(body.cycle).toBe("2026-11-23");
    expect(body.orders).toEqual([{ business: "approvalprep", topic: "Dispute letters by mail", draft: "lead", why: "visits rose" }]);
    expect(JSON.stringify(body)).not.toMatch(/PINTEREST DRAFT|Last week|Held row|@example\.com|Jane Investor|Brain text/);
  });

  it("never reads the to-do rows: an Open Loops row for backlinks is not an order", async () => {
    await env.DB.prepare(`INSERT INTO owner_open_loops (id, title, finish_line, next_step, owner, next_date, business, section, status, source, source_key, created_at, updated_at)
      VALUES ('olp_bl', 'Growth Director: ApprovalPrep — backlinks guide', 'x', 'A to-do topic', 'claude', '2026-11-30', 'spry', 'not_finished', 'open', 'agent_report', 'growth#approvalprep#backlinks-guide', 1, 1)`).run();
    const body: any = await (await orders()).json();
    expect(body.orders).toEqual([]);
  });
});

/**
 * THE ADDRESS CALLERS USE (22 Nov 2026: the backlink network was handed /api/growth/backlink-orders, the
 * path inside the Boss app, and got the retired fund API's 410). Through the Worker's own fetch entry,
 * the public addresses answer with the token; the inner paths are the 410, never the orders.
 */
describe("the machine reads' public addresses, through the Worker's fetch entry", () => {
  const viaEntry = (path: string, auth?: string) => worker.fetch(new Request(`https://boss.sequoiataylor.com${path}`, { headers: auth ? { authorization: auth } : {} }), outer, { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext);
  it("/api/boss/growth/backlink-orders and /api/boss/growth/ai-misses answer with the token, 401 without; the inner paths are 410", async () => {
    const bl = await viaEntry("/api/boss/growth/backlink-orders", `Bearer ${TOKEN}`);
    expect(bl.status).toBe(200);
    expect(await bl.json()).toEqual({ cycle: null, read_at: expect.any(String), orders: [] });
    const am = await viaEntry("/api/boss/growth/ai-misses?host=keepmyproof.com", `Bearer ${TOKEN}`);
    expect(am.status).toBe(200);
    expect((await am.json() as any).host).toBe("keepmyproof.com");
    expect((await viaEntry("/api/boss/growth/backlink-orders")).status).toBe(401);
    expect((await viaEntry("/api/boss/growth/ai-misses?host=keepmyproof.com")).status).toBe(401);
    for (const inner of ["/api/growth/backlink-orders", "/api/growth/ai-misses?host=keepmyproof.com"]) {
      const r = await viaEntry(inner, `Bearer ${TOKEN}`);
      expect(r.status).toBe(410);
      expect(await r.json()).not.toHaveProperty("orders");
    }
  });
});
