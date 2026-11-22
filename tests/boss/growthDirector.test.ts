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
| R-ADV-13 | ApprovalPrep is marketed as self-service, never as paid credit repair. | CROA |
| R-AI-02 | Agents never create an account. | judgment |`;

async function brain(slug: string, body: string) {
  await env.DB.prepare(`INSERT INTO brains (slug, title, body_md, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET body_md = excluded.body_md`).bind(slug, slug, body, NOW).run();
}
async function reading(measure: string, business: string, kind: string, channel: string, value: number | null) {
  await env.DB.prepare(`INSERT INTO growth_readings (day, measure, business, kind, channel, language, value, unread, at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(DAY, measure, business, kind, channel, "en", value, value === null ? "not read: test" : null, NOW).run();
}
const decisions = async () => ((await env.DB.prepare(`SELECT * FROM growth_decisions ORDER BY business`).all<any>()).results ?? []);
const loops = async () => ((await env.DB.prepare(`SELECT * FROM owner_open_loops WHERE owner = 'emp_growth'`).all<any>()).results ?? []);
const cards = async () => ((await env.DB.prepare(`SELECT * FROM approvals WHERE kind = 'growth_proposal'`).all<any>()).results ?? []);
const noTrends = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;

/** A model that answers by job: the decision (per business label) and the claims check. */
function fake(decide: Record<string, unknown> | null, claims: (draft: string) => unknown): { model: Model; seen: string[] } {
  const seen: string[] = [];
  const model: Model = async (_e, messages, job) => {
    const text = messages.map((m) => m.content).join("\n");
    seen.push(text);
    if (job === "growth-claims") { const draft = /DRAFT\n([\s\S]*)$/.exec(text)?.[1] ?? text; return JSON.stringify(claims(draft)); }
    return decide ? JSON.stringify(decide) : null;
  };
  return { model, seen };
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM growth_decisions; DELETE FROM growth_readings; DELETE FROM owner_open_loops WHERE owner = 'emp_growth'; DELETE FROM approvals WHERE kind = 'growth_proposal';");
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
    expect(l.some((x) => /done by 1 December/.test(x.next_step))).toBe(true);
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
