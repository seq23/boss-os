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
import { dayIdInZone } from "../../src/shared/boss/timezone";

const NOW = Date.parse("2026-11-23T12:00:00Z"); // Mon 23 Nov 2026, 06:00 Central
const DAY = dayIdInZone(NOW);

const PNP = `## Growth
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
const SPRY = `## Growth
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
/** Her yes already given for a format: its pipeline row exists (finished), so drafts queue. */
async function started(business: string, channel: string, format: string) {
  await env.DB.prepare(`INSERT INTO owner_open_loops (id, title, finish_line, next_step, owner, next_date, business, section, status, source, source_key, created_at, updated_at)
    VALUES (?, ?, 'x', 'x', 'claude', '2026-11-20', 'porch-and-party', 'not_finished', 'done', 'agent_report', ?, 1, 1)`)
    .bind(`olp_${business}_${channel}_${format}`.replace(/[^a-z0-9_]/g, ""), `started ${channel} ${format}`, `growth#${business}#${channel}-${format}`).run();
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
    await started("porch-and-party", "instagram", "reel");
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
    for (const [c, f] of [["instagram", "reel"], ["instagram", "carousel"], ["facebook", "post"], ["instagram", "story"]]) await started("porch-and-party", c!, f!);
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

  it("the first post of an approved format is her card; her yes opens its pipeline; the next week it queues", async () => {
    const { apiJson } = await import("./helpers");
    await seed();
    const one = { ...DECISION, queue: [DECISION.queue[0]], proposals: [] };
    const { model } = fake(one, OK);
    await runGrowthDirector(env as any, NOW, { model, fetchImpl: noTrends });
    expect((await loops()).filter((l) => l.status === "open")).toHaveLength(0);
    const first = (await cards()).find((c) => /Porch & Party: start posting reel on instagram/.test(c.title))!;
    expect(first).toBeTruthy();
    await apiJson<any>(`/api/approvals/${first.id}/decide`, { method: "POST", body: { decision: "approved" } });
    const row = await env.DB.prepare(`SELECT * FROM owner_open_loops WHERE source_key = 'growth#porch-and-party#instagram-reel'`).first<any>();
    expect(row).toMatchObject({ status: "open", owner: "claude" });
    expect(row.next_step).toMatch(/first reel/);
    await env.DB.prepare(`UPDATE owner_open_loops SET status = 'done' WHERE id = ?`).bind(row.id).run();
    await seed(NOW + 7 * 86_400_000);
    await runGrowthDirector(env as any, NOW + 7 * 86_400_000, { model, fetchImpl: noTrends });
    expect((await loops()).filter((l) => l.status === "open" && l.source_key === "growth#porch-and-party#instagram-reel")).toHaveLength(1);
    expect((await cards()).some((c) => /start posting reel on instagram/.test(c.title))).toBe(false);
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
    await started("porch-and-party", "instagram", "reel");
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
