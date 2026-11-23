/**
 * THE GROWTH DIRECTOR'S CYCLE, END TO END IN D1 (HOW IT BREAKS, each proven):
 *   - abuse: a draft that breaks a brand's risk rule is blocked before anything is queued;
 *   - spend: a spend or account proposal is refused by code, never a card;
 *   - nothing new goes public without her yes: an unapproved channel or format is a Decide card, never
 *     an Open Loops row for a pipeline;
 *   - outage: no readings → "held: no data"; no model answer → "held: no model"; all held → HELD_ALL;
 *   - paused → nothing; a business missing from the roster → nothing acts for it;
 *   - private data: a Growth section holding a confidential span is refused before any model call.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { runGrowthDirector, type Model } from "../../src/worker/boss/growth/run";
import { PROMPT_BUDGET_CHARS } from "../../src/shared/boss/growth/director.mjs";
import { dayIdInZone } from "../../src/shared/boss/timezone";

const NOW = Date.parse("2026-11-23T12:00:00Z"); // Mon 23 Nov 2026, 06:00 Central
const DAY = dayIdInZone(NOW);

const PNP = `## Settled decisions
### Growth
- 2026-11-21 — Porch reels lead in December.

## Growth
### Porch & Party
- key: porch-and-party
- buyer: families hosting parties
- offer: Christmas porches from $450
- money number: booked requests
- channels: instagram [reel, carousel] · facebook [post]
- languages: en
- limits: R-PRF-01
- season: Christmas porches until about 15 Dec
`;
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
- channels: pinterest [pin]
- languages: en
- limits: R-ADV-13
- paused: no

### How We Know
- key: how-we-know
- buyer: listeners
- offer: free videos
- money number: none yet
- channels: youtube [long-video]
- languages: en
- limits: R-AI-02
- paused: YouTube is paused
`;
const RISK = `| R-PRF-01 | No invented reviews, testimonials or ratings. | 16 CFR 465 |
| R-PRF-02 | No invented people. | 16 CFR 465 |
| R-END-01 | Affiliate links are labelled. | 16 CFR 255 |
| R-END-03 | AI-made clips carry "Made with AI". | platforms |
| R-ADV-13 | ApprovalPrep is marketed as self-service, never as paid credit repair. | CROA |
| R-AI-02 | Agents never create an account. | judgment |`;

async function brain(slug: string, body: string) {
  await env.DB.prepare(`INSERT INTO brains (slug, title, body_md, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET body_md = excluded.body_md`).bind(slug, slug, body, NOW).run();
}
async function reading(measure: string, business: string, kind: string, channel: string, value: number | null, day = DAY) {
  await env.DB.prepare(`INSERT OR REPLACE INTO growth_readings (day, measure, business, kind, channel, language, value, unread, at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(day, measure, business, kind, channel, "en", value, value === null ? "not read: test" : null, NOW).run();
}
const decisions = async () => ((await env.DB.prepare(`SELECT * FROM growth_decisions ORDER BY business`).all<any>()).results ?? []);
const loops = async () => ((await env.DB.prepare(`SELECT * FROM owner_open_loops WHERE source_key LIKE 'growth#%'`).all<any>()).results ?? []);
const cards = async () => ((await env.DB.prepare(`SELECT a.* FROM approvals a JOIN judgement_calls j ON j.approval_id = a.id WHERE j.resume_kind = 'growth_proposal' AND a.status = 'pending'`).all<any>()).results ?? []);
const noTrends = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;

/** A model that answers by job: the decision (per business label) and the claims check. */
const SPEND = (t: string) => ({ costs_money: /\$20|Boost/.test(t), creates_account: /Nextdoor account/.test(t) });
function fake(decide: Record<string, unknown> | null, claims: (draft: string) => unknown, spend: (t: string) => unknown = SPEND): { model: Model; seen: string[] } {
  const seen: string[] = [];
  const model: Model = async (_e, messages, job) => {
    const text = messages.map((m) => m.content).join("\n");
    seen.push(text);
    if (job === "growth-claims") { const draft = /DRAFT\n([\s\S]*)$/.exec(text)?.[1] ?? text; return JSON.stringify(claims(draft)); }
    if (job === "growth-spend") return JSON.stringify(spend(text));
    return decide ? JSON.stringify(decide) : null;
  };
  return { model, seen };
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM growth_decisions; DELETE FROM growth_readings; DELETE FROM owner_open_loops WHERE source_key LIKE 'growth%' OR owner = 'emp_growth'; DELETE FROM approvals WHERE id IN (SELECT approval_id FROM judgement_calls WHERE resume_kind = 'growth_proposal'); DELETE FROM judgement_calls WHERE resume_kind = 'growth_proposal';");
  await brain("porch-and-party", PNP); await brain("spry", SPRY); await brain("risk", RISK);
});

const DECISION = {
  decision: "More Instagram reels on Christmas porches; requests come from Instagram.",
  evidence: ["P&P requests from Instagram: 2 in 28 days"],
  test: null,
  queue: [
    { channel: "instagram", format: "reel", draft: "Your porch, done by 1 December.", why: "season" },
    { channel: "instagram", format: "reel", draft: "★★★★★ 'Best porch in Memphis!' — a happy customer", why: "proof" },
    { channel: "tiktok", format: "reel", draft: "Porch reveal", why: "reach" },
  ],
  proposals: [
    { what: "Boost the best reel for $20", why: "reach", evidence: "x" },
    { what: "Open a new Nextdoor account for the business", why: "local", evidence: "x" },
    { what: "Add a $50 porch refresh add-on", why: "upsell", evidence: "x" },
  ],
  next_check: "2026-11-30",
};

describe("one real cycle", () => {
  it("queues only approved, clean drafts; blocks a claims break; cards the new; refuses spend and accounts; pauses the paused", async () => {
    await reading("pnp-requests", "porch-and-party", "requests", "all", 2);
    await reading("pnp-requests-instagram", "porch-and-party", "requests", "instagram", 2);
    await reading("ap-sales", "approvalprep", "sales", "site", 1);
    const { model, seen } = fake(DECISION, (draft) => /★|happy customer/.test(draft) ? { pass: false, broken: ["R-PRF-01"], why: "an invented testimonial" } : { pass: true, broken: [], why: "" });
    const r = await runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends });
    expect(r.line).toMatch(/^OUTPUT 2 decisions/);

    const rows = await decisions();
    expect(rows.map((x) => [x.business, x.state])).toEqual([["approvalprep", "decided"], ["how-we-know", "paused"], ["porch-and-party", "decided"]]);
    const pnp = rows.find((x) => x.business === "porch-and-party");
    const acts = JSON.parse(pnp.actions);
    expect(acts.filter((a: any) => a.kind === "queued")).toHaveLength(1);
    expect(acts.find((a: any) => a.kind === "blocked").why).toMatch(/R-PRF-01/);
    expect(acts.filter((a: any) => a.kind === "refused").map((a: any) => a.stop).sort()).toEqual(["NEVER_SPEND", "NO_NEW_ACCOUNTS"]);

    // Only the clean, approved draft became a to-do for a pipeline; the testimonial never did.
    const l = await loops();
    expect(l).toHaveLength(1); // ApprovalPrep's drafts are all on unapproved channels: cards, not rows
    expect(l.some((x) => /done by 1 December/.test(x.next_step) && x.owner === "claude" && /approved instagram pipeline only/.test(x.next_step))).toBe(true);
    expect(l.some((x) => /happy customer/.test(x.next_step + x.title))).toBe(false);
    // TikTok is not approved for P&P: her card, never a pipeline row. Spend and accounts: no card.
    const c = await cards();
    expect(c.some((x) => /tiktok/i.test(x.title))).toBe(true);
    expect(c.some((x) => /Boost|\$20|Nextdoor/.test(x.title))).toBe(false);
    expect(c.length).toBeLessThanOrEqual(3);
    // The paused business was never asked about.
    expect(seen.some((t) => /How We Know/.test(t))).toBe(false);
    // P&P's first decision is asked about its season.
    expect(seen.find((t) => /Business: Porch & Party/.test(t))).toMatch(/FIRST decision.*Christmas porches/);
    // Counts only: no reading row carries a name or an address into the prompt.
    expect(seen.every((t) => !/@/.test(t))).toBe(true);
  });

  it("the claims check never passes on silence: no answer holds the draft", async () => {
    await reading("pnp-requests", "porch-and-party", "requests", "all", 2);
    const { model } = fake({ ...DECISION, queue: [DECISION.queue[0]], proposals: [] }, () => null);
    await runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends });
    const acts = JSON.parse((await decisions()).find((x) => x.business === "porch-and-party").actions);
    expect(acts.map((a: any) => a.kind)).toEqual(["held"]);
    expect(await loops()).toHaveLength(0);
  });
});

describe("outages and holds", () => {
  it("nothing read → held: no data for each business and the named stop HELD_ALL; no model call", async () => {
    await reading("pnp-requests", "porch-and-party", "requests", "all", null);
    const { model, seen } = fake(DECISION, () => ({ pass: true, broken: [], why: "" }));
    await expect(runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends })).rejects.toThrow(/NAMED STOP \[HELD_ALL\]/);
    expect((await decisions()).filter((x) => x.state === "held: no data").map((x) => x.business).sort()).toEqual(["approvalprep", "porch-and-party"]);
    expect(seen).toHaveLength(0);
    expect(await loops()).toHaveLength(0);
  });

  it("no model answers → held: no model, HELD_ALL, nothing queued", async () => {
    await reading("pnp-requests", "porch-and-party", "requests", "all", 2);
    await reading("ap-sales", "approvalprep", "sales", "site", 1);
    const { model } = fake(null, () => null);
    await expect(runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends })).rejects.toThrow(/HELD_ALL.*held: no model/);
    expect(await loops()).toHaveLength(0);
    expect(await cards()).toHaveLength(0);
  });

  it("a business missing from the roster is not approved: nothing is decided or queued for it", async () => {
    await brain("spry", "## Growth\n### How We Know\n- key: how-we-know\n- buyer: b\n- offer: o\n- money number: m\n- channels: youtube [long-video]\n- languages: en\n- limits: R-AI-02\n- paused: yes\n");
    await reading("ap-sales", "approvalprep", "sales", "site", 9);
    await reading("pnp-requests", "porch-and-party", "requests", "all", 2);
    const { model, seen } = fake(DECISION, () => ({ pass: true, broken: [], why: "" }));
    await runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends });
    expect((await decisions()).some((x) => x.business === "approvalprep")).toBe(false);
    expect(seen.some((t) => /ApprovalPrep/.test(t))).toBe(false);
  });

  it("a Growth section holding a private span is refused before any model sees it", async () => {
    await brain("porch-and-party", PNP + "- buyer: <!-- confidential -->a named client<!-- /confidential -->\n");
    await reading("pnp-requests", "porch-and-party", "requests", "all", 2);
    await reading("ap-sales", "approvalprep", "sales", "site", 1);
    const { model, seen } = fake({ ...DECISION, queue: [], proposals: [] }, () => ({ pass: true, broken: [], why: "" }));
    const r = await runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends });
    expect(r.problems.join(" ")).toMatch(/PRIVATE_IN_GROWTH/);
    expect(seen.some((t) => /named client|confidential/.test(t))).toBe(false);
    expect((await decisions()).some((x) => x.business === "porch-and-party")).toBe(false);
  });
});

describe("review round (21 Nov): her answer, no piling up, a lost record, a broken entry", () => {
  const OK = (draft: string) => /★/.test(draft) ? { pass: false, broken: ["R-PRF-01"], why: "x" } : { pass: true, broken: [], why: "" };
  const seed = async (t = NOW) => {
    await reading("pnp-requests", "porch-and-party", "requests", "all", 2, dayIdInZone(t));
    await reading("ap-sales", "approvalprep", "sales", "site", 1, dayIdInZone(t));
  };

  it("her yes on a card opens the follow-on to-do; her no is not asked again for four weeks", async () => {
    const { apiJson } = await import("./helpers");
    await seed();
    const { model } = fake(DECISION, OK);
    await runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends });
    const c = await cards();
    const tiktok = c.find((x) => /tiktok/i.test(x.title))!;
    const addOn = c.find((x) => /refresh add-on/.test(x.title))!;
    const yes = await apiJson<any>(`/api/approvals/${tiktok.id}/decide`, { method: "POST", body: { decision: "approved" } });
    expect(yes.status).toBeLessThan(300);
    const follow = await env.DB.prepare(`SELECT * FROM owner_open_loops WHERE source_key = 'growth#porch-and-party#tiktok-reel'`).first<any>();
    expect(follow.owner).toBe("claude");
    expect(follow.next_step).toMatch(/She approved: add reel on tiktok to Porch & Party's Growth roster entry/);
    await apiJson<any>(`/api/approvals/${addOn.id}/decide`, { method: "POST", body: { decision: "rejected", note: "not now" } });
    // Next week, the same ideas come back from the model: neither is asked again.
    await seed(NOW + 7 * 86_400_000);
    await runGrowthDirector(env as any, NOW + 7 * 86_400_000, { model, fetchImpl: noTrends });
    const again = (await cards()).map((x) => x.title);
    expect(again.some((t) => /^Porch & Party: (try reel on tiktok|Add a \$50 porch refresh)/.test(t))).toBe(false);
    expect(again.length).toBeGreaterThan(0); // other ideas still come through
  }, 60_000);

  it("two cycles: one pipeline row per business × channel × format, a cap on open rows, last week's waiting cards replaced", async () => {
    await seed();
    const many = { ...DECISION, queue: [{ channel: "instagram", format: "reel", draft: "Porch reel", why: "x" }, { channel: "instagram", format: "carousel", draft: "Porch carousel", why: "x" }, { channel: "facebook", format: "post", draft: "Porch post", why: "x" }], proposals: [] };
    const { model } = fake(many, OK);
    await runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends });
    const first = (await loops()).filter((l) => l.status === "open" && /porch-and-party/.test(l.source_key));
    expect(first).toHaveLength(3); // instagram-reel, instagram-carousel, facebook-post: one each
    await seed(NOW + 7 * 86_400_000);
    await runGrowthDirector(env as any, NOW + 7 * 86_400_000, { model, fetchImpl: noTrends });
    const second = (await loops()).filter((l) => l.status === "open" && /porch-and-party/.test(l.source_key));
    expect(second).toHaveLength(3);
    // A fourth kind of item waits: the cap holds.
    await seed(NOW + 14 * 86_400_000);
    const { model: m2 } = fake({ ...many, queue: [{ channel: "instagram", format: "story", draft: "x", why: "x" }] }, OK);
    await brain("porch-and-party", PNP.replace("instagram [reel, carousel]", "instagram [reel, carousel, story]"));
    await runGrowthDirector(env as any, NOW + 14 * 86_400_000, { model: m2, fetchImpl: noTrends });
    expect((await loops()).filter((l) => l.status === "open" && /porch-and-party/.test(l.source_key))).toHaveLength(3);
    const acts = JSON.parse((await decisions()).filter((d) => d.business === "porch-and-party").sort((a, b) => b.created_at - a.created_at)[0].actions);
    expect(acts.find((a: any) => a.kind === "held").why).toMatch(/already has 3 growth to-dos open/);
  }, 60_000);

  it("an approved format queues from its first post: no card (her ruling, 22 Nov 2026)", async () => {
    await seed();
    const one = { ...DECISION, queue: [DECISION.queue[0]], proposals: [] };
    const { model } = fake(one, OK);
    await runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends });
    expect((await loops()).filter((l) => l.status === "open" && l.source_key === "growth#porch-and-party#instagram-reel")).toHaveLength(1);
    // Only a format NOT on a roster still asks (ApprovalPrep has no Instagram reels): a new channel or format.
    expect((await cards()).map((c) => c.title)).toEqual(["ApprovalPrep: try reel on instagram?"]);
  }, 60_000);

  it("her yes to a new format: once it is on the roster, the next week queues without asking again", async () => {
    const { apiJson } = await import("./helpers");
    await seed();
    const tiktok = { ...DECISION, queue: [DECISION.queue[2]], proposals: [] };
    const { model } = fake(tiktok, OK);
    await runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends });
    const c = (await cards()).find((x) => /Porch & Party: try reel on tiktok/.test(x.title))!;
    await apiJson<any>(`/api/approvals/${c.id}/decide`, { method: "POST", body: { decision: "approved" } });
    const row = await env.DB.prepare(`SELECT * FROM owner_open_loops WHERE source_key = 'growth#porch-and-party#tiktok-reel'`).first<any>();
    expect(row.next_step).toMatch(/add reel on tiktok to Porch & Party's Growth roster entry/);
    await env.DB.prepare(`UPDATE owner_open_loops SET status = 'done' WHERE id = ?`).bind(row.id).run();
    await brain("porch-and-party", PNP.replace("facebook [post]", "facebook [post] · tiktok [reel]"));
    await seed(NOW + 7 * 86_400_000);
    await runGrowthDirector(env as any, NOW + 7 * 86_400_000, { model, fetchImpl: noTrends });
    expect((await loops()).filter((l) => l.status === "open" && l.source_key === "growth#porch-and-party#tiktok-reel")).toHaveLength(1);
    expect((await cards()).some((x) => /tiktok/.test(x.title) && /^Porch/.test(x.title))).toBe(false);
  }, 60_000);

  it("an error on one business keeps the others' record and writes its own as held: error", async () => {
    await seed();
    const { model } = fake(DECISION, OK);
    let n = 0;
    const flaky: Model = async (e, m, job) => { if (job === "growth-decide" && ++n === 2) throw new Error("D1 hiccup"); return model(e, m, job); };
    await runGrowthDirector(env as any, NOW, { model: flaky, fetchImpl: noTrends });
    const rows = await decisions();
    expect(rows.find((r) => r.business === "porch-and-party").state).toBe("decided");
    expect(rows.find((r) => r.business === "approvalprep")).toMatchObject({ state: "held: error" });
  }, 30_000);

  it("a broken roster entry is held, never a decision, and cannot make a green exit", async () => {
    await brain("porch-and-party", PNP.replace("- money number: booked requests\n", ""));
    await brain("spry", SPRY.replace("- money number: sales\n", ""));
    await seed();
    const { model, seen } = fake(DECISION, OK);
    await expect(runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends })).rejects.toThrow(/HELD_ALL/);
    expect((await decisions()).filter((d) => d.state === "held: roster").map((d) => d.business).sort()).toEqual(["approvalprep", "porch-and-party"]);
    expect(seen).toHaveLength(0);
  }, 30_000);

  it("no Open Loops title ever reaches a model; each business sees only its own earlier work", async () => {
    await env.DB.prepare(`INSERT INTO owner_open_loops (id, title, finish_line, next_step, owner, next_date, business, section, status, source, created_at, updated_at)
      VALUES ('olp_secretish', 'Call Valerie about the Hendersons', 'x', 'x', 'emp_growth', '2026-11-30', 'porch-and-party', 'not_finished', 'open', 'agent_report', 1, 1)`).run();
    await seed();
    const { model, seen } = fake(DECISION, OK);
    await runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends });
    expect(seen.some((t) => /Hendersons/.test(t))).toBe(false);
    await seed(NOW + 7 * 86_400_000);
    const { model: m2, seen: s2 } = fake(DECISION, OK);
    await runGrowthDirector(env as any, NOW + 7 * 86_400_000, { model: m2, fetchImpl: noTrends });
    const ap = s2.find((t) => /Business: ApprovalPrep/.test(t))!;
    expect(ap).not.toMatch(/instagram reel \(queued\)/); // P&P's queued reel is not ApprovalPrep's
    expect(s2.find((t) => /Business: Porch & Party/.test(t))).toMatch(/instagram reel \(queued\)/);
  }, 60_000);
});

describe("the Growth page", () => {
  it("per business: upcoming to-dos and cards, this week's decision, linked rows marked elsewhere; paused said; nothing read is not zero", async () => {
    const { apiJson } = await import("./helpers");
    await reading("pnp-requests", "porch-and-party", "requests", "all", 2);
    await reading("ap-sales", "approvalprep", "sales", "site", 1);
    await env.DB.prepare(`INSERT INTO owner_open_loops (id, title, finish_line, next_step, owner, next_date, business, section, status, source, created_at, updated_at)
      VALUES ('olp_elsewhere1', 'Search-loop pages for P&P', 'Live', 'In flight', 'claude', '2026-11-30', 'porch-and-party', 'not_finished', 'open', 'agent_report', 1, 1),
             ('olp_general01', 'Growth Director: service mix', 'Decided', 'Read the bookings', 'emp_growth', '2026-11-30', 'spry', 'not_finished', 'open', 'agent_report', 1, 1)`).run();
    await brain("porch-and-party", PNP + "- linked to-dos: olp_elsewhere1\n");
    const { model } = fake(DECISION, (draft) => /★/.test(draft) ? { pass: false, broken: ["R-PRF-01"], why: "x" } : { pass: true, broken: [], why: "" });
    await runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends });
    const page = (await apiJson("/api/growth/page")).body.data;
    const pnp = page.businesses.find((b: any) => b.key === "porch-and-party");
    expect(pnp.happening.decision.decision).toMatch(/Christmas porches/);
    expect(pnp.upcoming.todos.find((t: any) => t.id === "olp_elsewhere1")).toMatchObject({ elsewhere: true });
    expect(pnp.upcoming.todos.some((t: any) => /done by 1 December/.test(t.next) && !t.elsewhere)).toBe(true);
    expect(pnp.upcoming.cards.some((c: any) => /tiktok/i.test(c.title))).toBe(true);
    expect(page.general.map((t: any) => t.id)).toContain("olp_general01");
    expect(page.week).toEqual({ decided: 2, held: 0 });
    expect(page.problems.join(" ")).not.toMatch(/porch-and-party|spry brain/);
    // Her yes on a proposal lands under its business, not "across the businesses".
    const card = (await cards()).find((c: any) => /refresh add-on/.test(c.title));
    await apiJson(`/api/approvals/${card.id}/decide`, { method: "POST", body: { decision: "approved" } });
    const again = (await apiJson("/api/growth/page")).body.data;
    expect(again.businesses.find((b: any) => b.key === "porch-and-party").upcoming.todos.some((t: any) => /she said yes/.test(t.title))).toBe(true);
    expect(again.general.some((t: any) => /she said yes/.test(t.title))).toBe(false);
    // An old decision is history, never "this week"; a to-do closed 60 days ago is gone from the page.
    await env.DB.prepare(`UPDATE growth_decisions SET cycle = '2026-11-02' WHERE business = 'approvalprep'`).run();
    await env.DB.prepare(`INSERT INTO owner_open_loops (id, title, finish_line, next_step, owner, next_date, business, section, status, source, source_key, created_at, updated_at)
      VALUES ('olp_old_done', 'Growth Director: Porch & Party — instagram story', 'x', 'x', 'claude', '2026-09-01', 'porch-and-party', 'not_finished', 'done', 'agent_report', 'growth#porch-and-party#instagram-story', ?, ?)`).bind(Date.now() - 60 * 86_400_000, Date.now() - 60 * 86_400_000).run();
    const later = (await apiJson("/api/growth/page")).body.data;
    const ap = later.businesses.find((b: any) => b.key === "approvalprep");
    expect(ap.happening.decision).toBeNull();
    expect(ap.happening.last).toBe("2026-11-02");
    expect(ap.happened.decisions.map((d: any) => d.cycle)).toContain("2026-11-02");
    const pnp2 = later.businesses.find((b: any) => b.key === "porch-and-party");
    expect(pnp2.happened.done.some((t: any) => t.id === "olp_old_done")).toBe(false);
    expect(page.businesses.find((b: any) => b.key === "how-we-know").paused).toBeTruthy();
    const dw = page.businesses.find((b: any) => b.key === "dream-wedding");
    expect(dw.happening.board.channels.every((c: any) => c.value === null && /^not read/.test(c.unread))).toBe(true);
  }, 30_000);
});

describe("the page shows the newest decision of the day (22 Nov 2026)", () => {
  it("a second cycle on the same day replaces the first on the page", async () => {
    const { apiJson } = await import("./helpers");
    const ins = (id: string, decision: string, at: number) => env.DB.prepare(`INSERT INTO growth_decisions (id, cycle, business, label, state, decision, created_at) VALUES (?, ?, 'porch-and-party', 'Porch & Party', 'decided', ?, ?)`).bind(id, dayIdInZone(NOW), decision, at).run();
    await ins("gdc_first", "The morning cycle.", NOW - 3_600_000);
    await ins("gdc_second", "The evening re-run.", NOW - 60_000);
    const page = (await apiJson<any>("/api/growth/page")).body.data;
    const pnp = page.businesses.find((b: any) => b.key === "porch-and-party");
    expect(pnp.happening.decision.decision).toBe("The evening re-run.");
    expect(pnp.happened.decisions.map((d: any) => d.decision)).toEqual(["The morning cycle."]);
    expect(page.week).toEqual({ decided: 1, held: 0 });
  }, 30_000);
});

describe("the Director owns the older work on its roster (22 Nov 2026)", () => {
  it("keeps, changes or drops each linked row, on its evidence; a row it was not shown is untouched", async () => {
    await reading("pnp-requests", "porch-and-party", "requests", "all", 2, dayIdInZone(NOW));
    const row = (id: string, title: string) => env.DB.prepare(`INSERT INTO owner_open_loops (id, title, finish_line, next_step, owner, next_date, business, section, status, source, created_at, updated_at)
      VALUES (?, ?, 'x', 'Render the pictures after 6 PM.', 'claude', '2026-11-22', 'porch-and-party', 'not_finished', 'open', 'agent_report', 1, 1)`).bind(id, title).run();
    await row("olp_keep1", "Engine pieces waiting for pictures"); await row("olp_change1", "Three short December weeks"); await row("olp_drop1", "Office party posts"); await row("olp_other1", "Not on the roster");
    await brain("porch-and-party", PNP + "- linked to-dos: olp_keep1 (Engine pieces waiting for pictures), olp_change1 (three short December weeks), olp_drop1\n");
    const answer = { ...DECISION, queue: [], proposals: [], linked: [
      { id: "olp_keep1", verdict: "keep", why: "Christmas porch pieces match the season and Instagram brings the requests." },
      { id: "olp_change1", verdict: "change", why: "Only porch weeks sell before 15 Dec.", next_step: "Fill the December weeks with porch pieces only." },
      { id: "olp_drop1", verdict: "drop", why: "No office requests in 28 days." },
      { id: "olp_other1", verdict: "drop", why: "not shown" },
    ] };
    const { model, seen } = fake(answer, () => ({ pass: true, broken: [], why: "" }));
    await runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends });
    const get = (id: string) => env.DB.prepare(`SELECT status, next_step, closed_reason FROM owner_open_loops WHERE id = ?`).bind(id).first<any>();
    const prompt = seen.find((t) => /OLDER WORK/.test(t))!;
    expect(prompt).toMatch(/olp_keep1: Engine pieces waiting for pictures/);
    expect(prompt).toMatch(/olp_drop1: no description on the roster/);
    // Open Loops is LOCAL_ONLY: the row's own words never reach the model, only the roster's.
    expect(prompt).not.toMatch(/Render the pictures after 6 PM|Office party posts/);
    expect((await get("olp_keep1")).next_step).toMatch(/^Growth Director, \d{4}-\d\d-\d\d: keep\. Christmas porch pieces [^\n]*\nRender the pictures after 6 PM\.$/);
    expect((await get("olp_change1")).next_step).toMatch(/: change\. Only porch weeks sell before 15 Dec\.\nFill the December weeks with porch pieces only\.$/);
    expect(await get("olp_drop1")).toMatchObject({ status: "closed" });
    expect((await get("olp_drop1")).closed_reason).toMatch(/drop\. No office requests/);
    expect(await get("olp_other1")).toMatchObject({ status: "open", next_step: "Render the pictures after 6 PM." });
    const acts = JSON.parse((await decisions()).find((d) => d.business === "porch-and-party").actions);
    expect(acts.filter((a: any) => a.kind === "linked").map((a: any) => a.verdict)).toEqual(["keep", "change", "drop"]);
    await env.DB.exec("DELETE FROM owner_open_loops WHERE id IN ('olp_keep1','olp_change1','olp_drop1','olp_other1')");
  }, 60_000);

  const seedRow = (id: string, business = "porch-and-party", owner = "claude", title = "Engine pieces") => env.DB.prepare(`INSERT INTO owner_open_loops (id, title, finish_line, next_step, owner, next_date, business, section, status, source, created_at, updated_at)
    VALUES (?, ?, 'x', 'Render the pictures after 6 PM.', ?, '2026-11-22', ?, 'not_finished', 'open', 'agent_report', 1, 1)`).bind(id, title, owner, business).run();
  const getRow = (id: string) => env.DB.prepare(`SELECT status, next_step FROM owner_open_loops WHERE id = ?`).bind(id).first<any>();
  const week = async (answer: any, t: number) => {
    await reading("pnp-requests", "porch-and-party", "requests", "all", 2, dayIdInZone(t));
    const f = fake(answer, () => ({ pass: true, broken: [], why: "" }));
    await runGrowthDirector(env as any, t, { model: f.model, fetchImpl: noTrends }).catch(() => null);
    expect(f.seen.length).toBeGreaterThan(0); // the run reached the model: a "not shown" is never a crash
    return f.seen;
  };

  it("a keep with no full stop, or with two sentences, keeps her step intact week after week; a repeated id acts once", async () => {
    await seedRow("olp_k1"); await seedRow("olp_k2");
    await brain("porch-and-party", PNP + "- linked to-dos: olp_k1, olp_k2\n");
    const ans = { ...DECISION, queue: [], proposals: [], linked: [
      { id: "olp_k1", verdict: "keep", why: "No office requests in 28 days" },
      { id: "olp_k2", verdict: "keep", why: "Porches sell. Instagram brings the requests." },
      { id: "olp_k2", verdict: "drop", why: "a second verdict for the same row" },
    ] };
    await week(ans, NOW);
    const w1 = [(await getRow("olp_k1")).next_step, (await getRow("olp_k2")).next_step];
    await week(ans, NOW + 7 * 86_400_000);
    const w2 = [(await getRow("olp_k1")).next_step, (await getRow("olp_k2")).next_step];
    for (const s2 of w2) expect(s2).toMatch(/\nRender the pictures after 6 PM\.$/);
    expect(w2.map((x) => x.replace(/^Growth Director, [^:]*/, ""))).toEqual(w1.map((x) => x.replace(/^Growth Director, [^:]*/, "")));
    expect((await getRow("olp_k2")).status).toBe("open");
    await env.DB.exec("DELETE FROM owner_open_loops WHERE id IN ('olp_k1','olp_k2')");
  }, 60_000);

  it("another business's row, or her own row, is never judged or changed; no row's own words reach the model", async () => {
    await seedRow("olp_lp1", "west-peek-ventures", "claude", "An LP named in a to-do"); await seedRow("olp_hers1", "porch-and-party", "sequoia", "Invoice a customer");
    await seedRow("olp_cust1", "porch-and-party", "claude", "Invoice the Smith wedding");
    await brain("porch-and-party", PNP + "- linked to-dos: olp_lp1, olp_hers1, olp_cust1\n");
    const seen = await week({ ...DECISION, queue: [], proposals: [], linked: [{ id: "olp_lp1", verdict: "drop", why: "x" }, { id: "olp_hers1", verdict: "drop", why: "x" }] }, NOW);
    expect(seen.join("\n")).not.toMatch(/An LP named|Invoice a customer|Smith wedding/);
    expect(seen.join("\n")).toMatch(/olp_cust1: no description on the roster/);
    expect(seen.join("\n")).not.toMatch(/olp_lp1|olp_hers1/);
    expect(await getRow("olp_lp1")).toEqual({ status: "open", next_step: "Render the pictures after 6 PM." });
    expect(await getRow("olp_hers1")).toEqual({ status: "open", next_step: "Render the pictures after 6 PM." });
    await env.DB.exec("DELETE FROM owner_open_loops WHERE id IN ('olp_lp1','olp_hers1','olp_cust1')");
  }, 60_000);

  it("a Spry Labs company judges its own rows, which are filed under the spry brain; another entry's list never reaches it", async () => {
    await seedRow("olp_s1", "spry", "claude", "Carousels: start posting");
    await reading("ap-sales", "approvalprep", "sales", "site", 1, dayIdInZone(NOW)); // read, so it reaches the model
    await brain("spry", SPRY.replace("- limits: R-ADV-13\n", "- limits: R-ADV-13\n- linked to-dos: olp_s1 (screenshot carousels, start posting)\n"));
    const seen = await week({ ...DECISION, queue: [], proposals: [], linked: [{ id: "olp_s1", verdict: "keep", why: "Carousels go out twice a week" }] }, NOW);
    expect(seen.filter((t) => /olp_s1: screenshot carousels, start posting/.test(t))).toHaveLength(1); // ApprovalPrep's prompt only
    expect(await getRow("olp_s1")).toEqual({ status: "open", next_step: `Growth Director, ${dayIdInZone(NOW)}: keep. Carousels go out twice a week\nRender the pictures after 6 PM.` });
    const acts = (await decisions()).filter((d) => JSON.parse(d.actions).some((a: any) => a.kind === "linked" && a.id === "olp_s1")).map((d) => d.business);
    expect(acts).toEqual(["approvalprep"]);
    await env.DB.exec("DELETE FROM owner_open_loops WHERE id = 'olp_s1'");
    await brain("spry", SPRY);
  }, 60_000);

  it("no answer, or an answer with no verdicts, leaves the rows untouched", async () => {
    await seedRow("olp_q1");
    await brain("porch-and-party", PNP + "- linked to-dos: olp_q1\n");
    await week(null, NOW);
    await week({ ...DECISION, queue: [], proposals: [] }, NOW + 7 * 86_400_000);
    expect(await getRow("olp_q1")).toEqual({ status: "open", next_step: "Render the pictures after 6 PM." });
    await env.DB.exec("DELETE FROM owner_open_loops WHERE id = 'olp_q1'");
  }, 60_000);
});

describe("her report every two weeks (a section of Simone's morning email)", () => {
  it("written on the first cycle, not again within the fortnight, plain words with the Growth page link", async () => {
    await env.DB.exec("DELETE FROM morning_sections WHERE section = 'growth'; DELETE FROM settings WHERE key = 'growth_report_last_day';");
    await reading("pnp-requests", "porch-and-party", "requests", "all", 2);
    await reading("ap-sales", "approvalprep", "sales", "site", 1);
    const { model } = fake(DECISION, (draft) => /★/.test(draft) ? { pass: false, broken: ["R-PRF-01"], why: "x" } : { pass: true, broken: [], why: "" });
    const out = await runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends });
    const row = await env.DB.prepare(`SELECT body, day FROM morning_sections WHERE section = 'growth'`).first<any>();
    const body = JSON.parse(row.body);
    expect(body.title).toMatch(/Growth/);
    expect(out.cards).toBeGreaterThan(0);
    expect(body.lines[0]).toBe(`${out.cards === 1 ? "One growth idea waits" : `${out.cards} growth ideas wait`} for your yes in Decide. Nothing else to do.`);
    expect(body.lines.some((l: string) => /^Porch & Party: 2 requests in 28 days; 1 queued, \d asked in Decide\. More Instagram reels/.test(l))).toBe(true);
    expect(body.lines.some((l: string) => /^Against the floors: Porch & Party requests in the last 28 days: 2 of 4 by/.test(l))).toBe(true);
    expect(body.link.url).toMatch(/\?tab=growth$/);
    expect(JSON.stringify(body)).not.toMatch(/NAMED STOP|olp_|apr_|gdc_|R-PRF/);
    // A week later: no new report.
    await env.DB.exec("UPDATE morning_sections SET body = '{}' WHERE section = 'growth'");
    const later = async (days: number) => {
      const t = NOW + days * 86_400_000;
      await reading("pnp-requests", "porch-and-party", "requests", "all", 3, dayIdInZone(t));
      await runGrowthDirector(env as any, t, { model, fetchImpl: noTrends });
    };
    await later(7);
    expect((await env.DB.prepare(`SELECT body FROM morning_sections WHERE section = 'growth'`).first<any>()).body).toBe("{}");
    // Two weeks later: a new one.
    await later(14);
    expect(JSON.parse((await env.DB.prepare(`SELECT body FROM morning_sections WHERE section = 'growth'`).first<any>()).body).title).toMatch(/Growth/);
  }, 30_000);

  it("a held cycle still reports; a refused write leaves the day unset so next Monday retries", async () => {
    await env.DB.exec("DELETE FROM morning_sections WHERE section = 'growth'; DELETE FROM settings WHERE key = 'growth_report_last_day';");
    await reading("pnp-requests", "porch-and-party", "requests", "all", 2);
    const silent = async () => null;
    await expect(runGrowthDirector(env as any, NOW, { model: silent as any, fetchImpl: noTrends })).rejects.toThrow();
    const body = JSON.parse((await env.DB.prepare(`SELECT body FROM morning_sections WHERE section = 'growth'`).first<any>()).body);
    expect(body.lines[0]).toBe("Nothing to do: nothing new was queued this fortnight. Why, below.");
    expect(body.lines.join(" ")).toMatch(/Held, not guessed: .*no free writer answered/);
    // A failed write (the table gone for a moment): the day is not set, so the next run writes it.
    await env.DB.exec("DELETE FROM morning_sections WHERE section = 'growth'; DELETE FROM settings WHERE key = 'growth_report_last_day'; ALTER TABLE morning_sections RENAME TO morning_sections_away;");
    try {
      await expect(runGrowthDirector(env as any, NOW, { model: silent as any, fetchImpl: noTrends })).rejects.toThrow();
    } finally { await env.DB.exec("ALTER TABLE morning_sections_away RENAME TO morning_sections;"); }
    expect(await env.DB.prepare(`SELECT 1 FROM settings WHERE key = 'growth_report_last_day'`).first()).toBeNull();
    await expect(runGrowthDirector(env as any, NOW + 3_600_000, { model: silent as any, fetchImpl: noTrends })).rejects.toThrow();
    expect(await env.DB.prepare(`SELECT 1 FROM morning_sections WHERE section = 'growth'`).first()).not.toBeNull();
  }, 30_000);
});

describe("her rulings reach the Director (her yes, 22 Nov 2026: \"yea let it read the settled decisions\")", () => {
  const entry = (label: string, key: string) => `### ${label}\n- key: ${key}\n- buyer: b\n- offer: o\n- money number: sales\n- channels: app-store [listing] · backlinks [guide]\n- languages: en\n- limits: R-PRF-01\n\n`;
  const TWO = `## Settled decisions
### Umbrella, scope and money
- 2026-11-01 — UMBRELLA-RULING
### Growth (Shoestring Growth Plan, 21 Nov 2026)
- 2026-11-22 — The backlink network is an outside publisher with its own Cloudflare account; the Director sends it link REQUESTS, never commands.
### Search, sites and freshness
- 2026-11-02 — SEARCH-RULING
### Brand and social
- 2026-11-03 — BRAND-RULING
### All apps
- 2026-11-04 — APPS-RULING
### KeepMyProof
- 2026-11-05 — KMP-RULING: receipts first. <!-- confidential -->A-PRIVATE-CLIENT<!-- /confidential -->
### Dream Wedding
- 2026-11-06 — DW-RULING: checklists first.

## Growth
${entry("KeepMyProof", "keepmyproof")}${entry("Dream Wedding", "dream-wedding")}`;
  const ANSWER = { decision: "Hold steady.", evidence: ["sales: 1"], test: null, queue: [], proposals: [], next_check: "2026-11-30" };
  const read = async () => { await reading("kmp-subscriptions", "keepmyproof", "sales", "store", 1); await reading("dw-sales", "dream-wedding", "sales", "site", 1); await reading("pnp-requests", "porch-and-party", "requests", "all", 1); };
  const promptFor = (seen: string[], label: string) => seen.filter((t) => t.includes(`Business: ${label}\n`) && t.includes("HER RULINGS"));

  it("a KeepMyProof ruling reaches the KeepMyProof prompt and never Dream Wedding's; the backlink ruling reaches both; a private span reaches neither", async () => {
    await brain("spry", TWO); await read();
    const { model, seen } = fake(ANSWER, () => ({ pass: true, broken: [], why: "" }));
    const r = await runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends });
    const [kmp] = promptFor(seen, "KeepMyProof"); const [dw] = promptFor(seen, "Dream Wedding");
    expect(kmp).toContain("KMP-RULING: receipts first.");
    expect(kmp).not.toContain("DW-RULING");
    expect(dw).toContain("DW-RULING: checklists first.");
    expect(dw).not.toContain("KMP-RULING");
    for (const p of [kmp, dw]) { expect(p).toMatch(/backlink network is an outside publisher with its own Cloudflare account/); expect(p).toContain("APPS-RULING"); }
    expect(seen.every((t) => !t.includes("A-PRIVATE-CLIENT") && !/<!--\s*\/?confidential/i.test(t))).toBe(true);
    // The size of her rulings per business is on the run and its audit row.
    expect(r.rulings.map((x) => x.business).sort()).toEqual(["dream-wedding", "keepmyproof", "porch-and-party"]);
    expect(r.rulings.every((x) => x.chars > 0 && x.left.length === 0)).toBe(true);
    const row = await env.DB.prepare(`SELECT detail FROM audit_log WHERE entity_type = 'growth_cycle' AND entity_id = ? ORDER BY ts DESC LIMIT 1`).bind(DAY).first<{ detail: string }>();
    expect(JSON.parse(row!.detail).rulings).toEqual(r.rulings);
    expect(r.problems.filter((p) => /ruling|Settled/.test(p))).toEqual([]);
  });

  it("a renamed heading is a named problem on the run; that business is still decided with the shared rulings", async () => {
    await brain("spry", TWO.replace("### KeepMyProof\n- 2026-11-05", "### Keep My Proof\n- 2026-11-05")); await read();
    const { model, seen } = fake(ANSWER, () => ({ pass: true, broken: [], why: "" }));
    const r = await runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends });
    expect(r.problems).toContain(`KeepMyProof has no "### KeepMyProof" group in the Spry Labs brain's Settled decisions; it reads the shared rulings only`);
    expect((await decisions()).find((x) => x.business === "keepmyproof")?.state).toBe("decided");
    expect(promptFor(seen, "KeepMyProof")[0]).toMatch(/backlink network is an outside publisher/);
  });

  it("no Settled decisions section: each of its businesses is held \"rulings not read\", named on the run, no model call for it", async () => {
    await brain("spry", TWO.slice(TWO.indexOf("## Growth"))); await read();
    const { model, seen } = fake(ANSWER, () => ({ pass: true, broken: [], why: "" }));
    const r = await runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends });
    const rows = await decisions();
    for (const k of ["keepmyproof", "dream-wedding"]) {
      const row = rows.find((x) => x.business === k)!;
      expect(row.state).toBe("held: roster");
      expect(row.decision).toMatch(/her rulings were not read \(the Spry Labs brain has no Settled decisions section\)/);
    }
    expect(r.problems).toContain("KeepMyProof: rulings not read (the Spry Labs brain has no Settled decisions section)");
    expect(r.problems).toContain("Dream Wedding: rulings not read (the Spry Labs brain has no Settled decisions section)");
    expect(seen.some((t) => /Business: (KeepMyProof|Dream Wedding)\n/.test(t))).toBe(false);
    expect(rows.find((x) => x.business === "porch-and-party")?.state).toBe("decided");
  });

  it("a brain that fails to read: its businesses are named \"rulings not read\", never decided as if she had none; the other brain's cycle carries on", async () => {
    await brain("spry", TWO); await read();
    const db = env.DB;
    const flaky = new Proxy(db, { get(t, k) {
      if (k === "prepare") return (sql: string) => {
        const st = t.prepare(sql);
        if (!/FROM brains WHERE slug/.test(sql)) return st;
        return { bind: (...a: unknown[]) => a[0] === "spry" ? { first: async () => { throw new Error("D1 timed out"); } } : st.bind(...a) };
      };
      const v = (t as any)[k]; return typeof v === "function" ? v.bind(t) : v;
    } });
    const { model, seen } = fake(ANSWER, () => ({ pass: true, broken: [], why: "" }));
    const r = await runGrowthDirector({ ...env, DB: flaky } as any, NOW, { model, fetchImpl: noTrends });
    expect(r.problems).toContain("Spry Labs's brain could not be read (D1 timed out): its roster and rulings not read");
    const rows = await decisions();
    expect(rows.some((x) => ["keepmyproof", "dream-wedding"].includes(x.business))).toBe(false);
    expect(seen.some((t) => /Business: (KeepMyProof|Dream Wedding)\n/.test(t))).toBe(false);
    expect(rows.find((x) => x.business === "porch-and-party")?.state).toBe("decided");
  });

  it("over the prompt budget, the shared rulings are left out and the run says so; her own ruling stays", async () => {
    await brain("spry", TWO.replace("- 2026-11-02 — SEARCH-RULING", `- 2026-11-02 — SEARCH-RULING ${"x".repeat(70_000)}`)); await read();
    const { model, seen } = fake(ANSWER, () => ({ pass: true, broken: [], why: "" }));
    const r = await runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends });
    const [kmp] = promptFor(seen, "KeepMyProof");
    expect(kmp).toContain("KMP-RULING");
    expect(kmp).not.toContain("SEARCH-RULING");
    expect(kmp).not.toContain("APPS-RULING"); // left out from the end of the list first
    expect(kmp).toContain("UMBRELLA-RULING");
    expect(kmp!.length).toBeLessThanOrEqual(PROMPT_BUDGET_CHARS);
    expect(r.problems).toContain(`KeepMyProof: the prompt was over ${PROMPT_BUDGET_CHARS} characters, so the shared rulings "Search, sites and freshness", "All apps" were left out this cycle`);
    expect(r.rulings.find((x) => x.business === "keepmyproof")!.left).toEqual(["Search, sites and freshness", "All apps"]);
  });
});
