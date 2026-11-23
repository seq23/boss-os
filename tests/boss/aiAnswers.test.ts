/**
 * THE AI ANSWERS LOOP IN D1, END TO END (her ask 22 Nov 2026; the pure half is tests/aiAnswers.test.ts).
 * HOW IT BREAKS, each proven here:
 *   - data integrity: the same week twice changes nothing (no second to-do or card); a not-read week
 *     never overwrites a read one; one to-do or card per cited source, its prompts listed;
 *   - lanes: after 2 fixes a miss moves to the next lane, and a rerun never counts a fix twice;
 *   - her yes: EARN and CONTEST are cards, a CLAIM on a listing she does not hold is a card (R-AI-02),
 *     and the claims check failing or not answering opens nothing;
 *   - the cap: at most MAX_OPEN_PER_BUSINESS Growth to-dos per business, the rest wait;
 *   - abuse: GET ai-misses is 401 without the machine token, 404 for any host but the six (exact
 *     match), serves only OWN misses with a page on the host or null; POST ai-week needs a session;
 *   - aplayermode.com (no loop): read, no misses, the note; its OWN misses are to-dos.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { recordAiWeek, aiMisses } from "../../src/worker/boss/growth/aiAnswers";
import type { Model } from "../../src/worker/boss/growth/run";
import { MAX_OPEN_PER_BUSINESS } from "../../src/shared/boss/growth/director.mjs";
import { ENGINES, missId } from "../../src/shared/boss/growth/aiAnswers.mjs";
import { TOKEN_KEY, sha256 } from "../../src/worker/boss/routes/openLoops";
import { setSetting } from "../../src/worker/boss/lib/settings";
import { handleRequest } from "../../src/worker/index";
import type { Env } from "../../src/worker/env";

const DAY = 86_400_000;
const NOW = Date.now();
const RUN_AT = NOW - 3_600_000;
const KMP = "keepmyproof.com";
const APM = "aplayermode.com";
const Q1 = "https://keepmyproof.com/questions/rent-receipts/";

const SPRY = `## Growth
### KeepMyProof
- key: keepmyproof
- buyer: renters who pay in cash
- offer: a proof app
- money number: subscriptions
- channels: search-pages [guide] · app-store [listing]
- languages: en
- limits: R-AI-02

### A Player Mode
- key: a-player-mode
- buyer: people who want to perform
- offer: the app
- money number: subscriptions
- channels: search-pages [guide]
- languages: en
- limits: R-AI-02
`;
const RISK = `| R-PRF-01 | No invented reviews, testimonials or ratings. | 16 CFR 465 |
| R-PRF-02 | No invented people. | 16 CFR 465 |
| R-END-01 | Affiliate links are labelled. | 16 CFR 255 |
| R-ADV-05 | No income promise. | 16 CFR 255 |
| R-ADV-06 | No health promise. | 16 CFR 255 |
| R-AI-02 | Agents never create an account. | judgment |`;

async function brain(slug: string, body: string) {
  await env.DB.prepare(`INSERT INTO brains (slug, title, body_md, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET body_md = excluded.body_md`).bind(slug, slug, body, NOW).run();
}
const all = async (sql: string, ...b: unknown[]) => ((await env.DB.prepare(sql).bind(...b).all<any>()).results ?? []);
const loops = () => all(`SELECT * FROM owner_open_loops WHERE source_key LIKE 'growth#%#ai-%' ORDER BY source_key`);
const cards = () => all(`SELECT a.*, j.title AS jtitle, j.question FROM approvals a JOIN judgement_calls j ON j.approval_id = a.id WHERE j.resume_kind = 'growth_proposal' AND a.status = 'pending' ORDER BY j.title`);

/** The claims check: passes unless the draft says BADCLAIM; `null` = no model answered. */
function fake(answer: "pass" | "fail" | null = "pass"): { model: Model; calls: number } {
  const st = { calls: 0, model: null as unknown as Model };
  st.model = async (_e, messages, job) => {
    st.calls++;
    if (job !== "growth-claims" || answer === null) return null;
    const text = messages.map((m) => m.content).join("\n");
    return JSON.stringify(answer === "fail" || /BADCLAIM/.test(text) ? { pass: false, broken: ["R-AI-02"], why: "breaks it" } : { pass: true, broken: [], why: "" });
  };
  return st;
}

type P = { id: string; text: string; cited?: string[]; sources?: string[]; lane?: Record<string, unknown> };
/** One whole OpenSEO week for a site, as the reading session prints it. */
function week(host: string, prompts: P[], runAt = RUN_AT, runId = "run-1") {
  const observations = prompts.flatMap((p) => ENGINES.map((e) => ({
    id: `${runId}-${p.id}-${e}`, prompt_id: p.id, engine: e, status: "answered",
    mentioned: Boolean(p.cited?.includes(e)), cited: Boolean(p.cited?.includes(e)), rivals: [], sources: p.sources ?? [],
  })));
  const n = observations.filter((o) => o.cited).length;
  return {
    site: host, tracker: { prompts: prompts.map(({ id, text }) => ({ id, text })), engines: [...ENGINES] },
    run: { id: runId, createdAt: new Date(runAt).toISOString(), expected: observations.length, completed: observations.length, failed: 0 },
    summary_own: { mentions: n, citations: n }, observations,
    lanes: prompts.filter((p) => p.lane).map((p) => ({ prompt_id: p.id, page_url: null, fit_url: null, source_domain: null, channel: null, why: "one plain sentence", ...p.lane })),
  };
}
const kmp = (prompts: P[], o: { runAt?: number; runId?: string; strengthened?: any[] } = {}) =>
  ({ host: KMP, block: week(KMP, prompts, o.runAt, o.runId), prefix: "/questions/", strengthened: o.strengthened ?? [] });

const P_CITED: P = { id: "p1", text: "best app to keep proof of rent payments", cited: ["chatgpt"] };
const P_OWN: P = { id: "p2", text: "how to prove I paid rent in cash", sources: ["review-site.com"], lane: { lane: "own", page_url: Q1 } };
const P_EARN_A: P = { id: "p3", text: "apps for rent receipts", sources: ["review-site.com"], lane: { lane: "earn", source_domain: "review-site.com" } };
const P_EARN_B: P = { id: "p4", text: "how do renters keep receipts", sources: ["review-site.com"], lane: { lane: "earn", source_domain: "review-site.com" } };
const P_CLAIM_NEW: P = { id: "p5", text: "rent proof app directory", sources: ["app-directory.com"], lane: { lane: "claim", source_domain: "app-directory.com", channel: null } };
const P_CLAIM_HELD: P = { id: "p6", text: "rent receipt app on the app store", sources: ["apps.apple.com"], lane: { lane: "claim", source_domain: "apps.apple.com", channel: "app-store" } };
const P_CONTEST: P = { id: "p7", text: "is keepmyproof legit", sources: ["wrong-facts.com"], lane: { lane: "contest", source_domain: "wrong-facts.com" } };

beforeEach(async () => {
  await env.DB.exec("DELETE FROM ai_answer_obs; DELETE FROM ai_answer_reads; DELETE FROM ai_misses; DELETE FROM owner_open_loops WHERE source_key LIKE 'growth%'; DELETE FROM approvals WHERE id IN (SELECT approval_id FROM judgement_calls WHERE resume_kind = 'growth_proposal'); DELETE FROM judgement_calls WHERE resume_kind = 'growth_proposal';");
  await brain("spry", SPRY); await brain("risk", RISK); await brain("porch-and-party", "## Growth\n");
});

describe("one week, stored", () => {
  it("stores the recount, and the same week twice changes nothing", async () => {
    const f = fake();
    const entry = kmp([P_CITED, P_OWN, P_EARN_A, P_EARN_B, P_CLAIM_NEW, P_CLAIM_HELD, P_CONTEST]);
    const [first] = await recordAiWeek(env, [entry], NOW, { model: f.model });
    expect(first).toMatchObject({ status: "read", prompts: 7, cited: 1, misses: 6, unchanged: false });
    const snap = async () => JSON.stringify([
      await all(`SELECT site, week, status, cited, prompts FROM ai_answer_reads`),
      (await all(`SELECT COUNT(*) AS n FROM ai_answer_obs`))[0].n,
      await all(`SELECT id, lane, fix_attempts, todo_key FROM ai_misses ORDER BY id`),
      (await loops()).map((l) => l.source_key), (await cards()).map((c) => c.jtitle),
    ]);
    const before = await snap();
    expect((await all(`SELECT COUNT(*) AS n FROM ai_answer_obs`))[0].n).toBe(21);
    const [again] = await recordAiWeek(env, [entry], NOW + 60_000, { model: f.model });
    expect(again).toMatchObject({ status: "read", unchanged: true });
    expect(again.actions.every((a: any) => a.kind === "working")).toBe(true);
    expect(await snap()).toBe(before);
  });

  it("one fix per cited source: EARN, CONTEST and a CLAIM she does not hold are cards; a CLAIM on her channel is a to-do", async () => {
    await recordAiWeek(env, [kmp([P_CITED, P_OWN, P_EARN_A, P_EARN_B, P_CLAIM_NEW, P_CLAIM_HELD, P_CONTEST])], NOW, { model: fake().model });
    const c = await cards();
    expect(c.map((x) => x.jtitle)).toEqual([
      "KeepMyProof: AI answers claim, claim app-directory.com?",
      "KeepMyProof: AI answers contest, correct wrong-facts.com?",
      "KeepMyProof: AI answers earn, earn a mention on review-site.com?",
    ]);
    // ONE earn card for review-site.com, listing both of its prompts.
    const earn = c.find((x) => /earn/.test(x.jtitle));
    expect(earn.question).toContain(P_EARN_A.text);
    expect(earn.question).toContain(P_EARN_B.text);
    expect(c.find((x) => /claim/.test(x.jtitle)).question).toMatch(/You open the account yourself/);
    // R-AI-02: the reason on the card is that agents never open accounts, not a channel the roster lacks.
    expect(c.find((x) => /claim/.test(x.jtitle)).question).toMatch(/agents never open accounts/);
    // The held listing is a to-do through the roster; OWN on a loop site is the loop's, never a to-do.
    expect((await loops()).map((l) => l.source_key)).toEqual(["growth#keepmyproof#ai-claim-apps-apple-com"]);
  });

  it("the claims check failing or not answering opens nothing", async () => {
    await recordAiWeek(env, [kmp([P_CLAIM_HELD])], NOW, { model: fake(null).model });
    expect(await loops()).toEqual([]);
    await env.DB.exec("DELETE FROM ai_answer_reads; DELETE FROM ai_answer_obs;");
    const [r] = await recordAiWeek(env, [kmp([P_CLAIM_HELD])], NOW, { model: fake("fail").model });
    expect(r.actions[0]).toMatchObject({ kind: "blocked" });
    expect(await loops()).toEqual([]);
    expect(await cards()).toEqual([]);
  });

  it("a not-read week is stored as not read and never overwrites a read week", async () => {
    await recordAiWeek(env, [{ host: "approvalprep.com", stop: "OPENSEO_UNREACHABLE" }], NOW, { model: fake().model });
    expect(await all(`SELECT site, status, stop, cited FROM ai_answer_reads`)).toEqual([{ site: "approvalprep.com", status: "not_read", stop: "OPENSEO_UNREACHABLE", cited: null }]);
    await recordAiWeek(env, [kmp([P_CITED])], NOW, { model: fake().model });
    await recordAiWeek(env, [{ host: KMP, stop: "OPENSEO_UNREACHABLE" }], NOW + 60_000, { model: fake().model });
    expect(await all(`SELECT status, stop, cited, read_at FROM ai_answer_reads WHERE site = ?`, KMP)).toEqual([{ status: "read", stop: null, cited: 1, read_at: NOW }]);
  });

  it("a site that is not one of the six is refused; a summary that disagrees is not read", async () => {
    const bad = kmp([P_CITED]); (bad.block.summary_own as any).citations = 3;
    const out = await recordAiWeek(env, [{ host: "evil.com", stop: "OPENSEO_UNREACHABLE" }, bad], NOW, { model: fake().model });
    expect(out[0]).toMatchObject({ status: "refused" });
    expect(out[1]).toMatchObject({ status: "not_read", stop: "OPENSEO_SHORT_READ" });
    expect(await all(`SELECT site FROM ai_answer_reads WHERE status = 'read'`)).toEqual([]);
  });
});

describe("asked once", () => {
  it("a new prompt citing the same source within 14 days of its card is never a second card", async () => {
    const w1 = NOW - 7 * DAY;
    await recordAiWeek(env, [kmp([P_EARN_A], { runAt: w1, runId: "r1" })], w1 + 3_600_000, { model: fake().model });
    expect((await cards()).length).toBe(1);
    // Week 2: the first prompt is cited now (fixed); a second prompt misses on the same domain.
    const [r] = await recordAiWeek(env, [kmp([{ ...P_EARN_A, cited: ["chatgpt"], lane: undefined }, P_EARN_B], { runId: "r2" })], NOW, { model: fake().model });
    expect(r.actions).toEqual([expect.objectContaining({ kind: "waiting", target: "review-site.com" })]);
    expect((await all(`SELECT COUNT(*) AS n FROM judgement_calls WHERE resume_kind = 'growth_proposal'`))[0].n).toBe(1);
  });
});

describe("lanes move after two fixes", () => {
  it("OWN counts the loop's strengthened pages once each, then moves to CLAIM", async () => {
    const id = await missId(KMP, P_OWN.text);
    const w1 = NOW - 14 * DAY, w2 = NOW - 7 * DAY, w3 = RUN_AT;
    const s = (at: number) => ({ id, page_url: Q1, at: new Date(at).toISOString() });
    await recordAiWeek(env, [kmp([P_OWN], { runAt: w1, runId: "r1" })], w1 + 3_600_000, { model: fake().model });
    await recordAiWeek(env, [kmp([P_OWN], { runAt: w2, runId: "r2", strengthened: [s(w1 + DAY)] })], w2 + 3_600_000, { model: fake().model });
    const one = await all(`SELECT lane, fix_attempts FROM ai_misses WHERE id = ?`, id);
    expect(one).toEqual([{ lane: "own", fix_attempts: 1 }]);
    // The same strengthening again plus one made AFTER this run's answers: neither counts.
    await recordAiWeek(env, [kmp([P_OWN], { runAt: w2, runId: "r2", strengthened: [s(w1 + DAY), s(w2 + DAY)] })], w2 + 7_200_000, { model: fake().model });
    expect((await all(`SELECT fix_attempts FROM ai_misses WHERE id = ?`, id))[0].fix_attempts).toBe(1);
    await recordAiWeek(env, [kmp([P_OWN], { runAt: w3, runId: "r3", strengthened: [s(w1 + DAY), s(w2 + DAY)] })], NOW, { model: fake().model });
    const moved = (await all(`SELECT lane, fix_attempts, lanes_tried, page_url FROM ai_misses WHERE id = ?`, id))[0];
    expect(moved).toMatchObject({ lane: "claim", fix_attempts: 0, lanes_tried: '["own"]', page_url: null });
    // Moved off OWN: the search loop no longer gets it.
    expect((await aiMisses(env.DB, KMP, NOW)).misses).toEqual([]);
  });

  it("a cited week marks the miss fixed", async () => {
    await recordAiWeek(env, [kmp([P_OWN], { runAt: NOW - 7 * DAY, runId: "r1" })], NOW - 7 * DAY + 3_600_000, { model: fake().model });
    await recordAiWeek(env, [kmp([{ ...P_OWN, cited: ["gemini"], lane: undefined }], { runId: "r2" })], NOW, { model: fake().model });
    expect((await all(`SELECT fixed_week FROM ai_misses`))[0].fixed_week).toMatch(/^\d{4}-W\d\d$/);
  });
});

describe("aplayermode.com has no search loop (A6)", () => {
  const apm = (prompts: P[]) => ({ host: APM, block: week(APM, prompts), prefix: "/questions/", strengthened: [] });
  it("its OWN misses are to-dos, at most MAX_OPEN_PER_BUSINESS open; the rest wait", async () => {
    const fits = ["a", "b", "c", "d"].map((x, i) => ({ id: `q${i}`, text: `how to perform under pressure ${x}`, lane: { lane: "own", page_url: `https://aplayermode.com/${x}/` } }));
    const nofit = { id: "q9", text: "how to stay calm on stage", lane: { lane: "own", page_url: null } };
    const [r] = await recordAiWeek(env, [apm([...fits, nofit])], NOW, { model: fake().model });
    expect(MAX_OPEN_PER_BUSINESS).toBe(3);
    expect((await loops()).length).toBe(3);
    expect(r.actions.filter((a: any) => a.kind === "waiting").length).toBe(2);
    // Never a page_url served for it: the loop-less site's fits are fit_url only.
    expect((await all(`SELECT COUNT(*) AS n FROM ai_misses WHERE page_url IS NOT NULL`))[0].n).toBe(0);
  });
  it("a miss with no page that fits becomes 'write one page'", async () => {
    await recordAiWeek(env, [apm([{ id: "q9", text: "how to stay calm on stage", lane: { lane: "own", page_url: null } }])], NOW, { model: fake().model });
    const [l] = await loops();
    expect(l.next_step).toMatch(/^own: write one page on aplayermode\.com/);
    expect(await aiMisses(env.DB, APM, NOW)).toMatchObject({ status: "read", misses: [], note: "no search loop on this host" });
  });
});

describe("GET /api/boss/growth/ai-misses and POST ai-week, through the production handler", () => {
  const outer = {
    WP_OS_DB: env.DB, WP_OS_DOCUMENTS: env.VAULT, WP_OS_KV: env.SESSIONS, WP_OS_ENV: "local",
    BOSS_PASSCODE: env.BOSS_PASSCODE, BOSS_SESSION_SECRET: env.SESSION_SECRET,
    ASSETS: { fetch: async () => new Response("<html>spa</html>", { headers: { "content-type": "text/html" } }) },
  } as unknown as Env;
  const TOKEN = `olt_${"a1".repeat(32)}`;
  const get = (q: string, auth?: string) => handleRequest(new Request(`https://boss.sequoiataylor.com/api/boss/growth/ai-misses?${q}`, { headers: auth ? { authorization: auth } : {} }), outer);
  beforeEach(async () => { await setSetting(env.DB, TOKEN_KEY, await sha256(TOKEN)); });

  it("401 without the token or with a wrong one; 404 for any host but the six", async () => {
    expect((await get(`host=${KMP}`)).status).toBe(401);
    expect((await get(`host=${KMP}`, `Bearer olt_${"b2".repeat(32)}`)).status).toBe(401);
    expect((await get(`host=${KMP}`, `Token ${TOKEN}`)).status).toBe(401);
    expect((await get(`host=${KMP}`, `Bearer ${TOKEN}x`)).status).toBe(401);
    for (const h of ["evil.com", "keepmyproof.com.evil.com", "www.keepmyproof.com", "KEEPMYPROOF.COM", ""]) expect((await get(`host=${encodeURIComponent(h)}`, `Bearer ${TOKEN}`)).status).toBe(404);
  });

  it("serves OWN misses only, with an on-host engine page or null, in the contract's shape", async () => {
    const offHost: P = { id: "p8", text: "rent cash receipt template", lane: { lane: "own", page_url: "https://evil.com/questions/x/" } };
    await recordAiWeek(env, [kmp([P_CITED, P_OWN, P_EARN_A, offHost])], NOW, { model: fake().model });
    const res = await get(`host=${KMP}`, `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toMatchObject({ host: KMP, status: "read", week: expect.stringMatching(/^\d{4}-W\d\d$/), read_at: expect.any(String) });
    expect(body.misses.map((m: any) => [m.prompt, m.lane, m.page_url]).sort()).toEqual([[P_OWN.text, "own", Q1], [offHost.text, "own", null]].sort());
    expect(Object.keys(body.misses[0]).sort()).toEqual(["cited_sources", "engines_missed", "first_missed_week", "fix_attempts", "id", "lane", "page_url", "prompt", "rivals"]);
    expect(JSON.stringify(body)).not.toMatch(/evil\.com/);
  });

  it("a stored page off the host is never served, whatever wrote it", async () => {
    await recordAiWeek(env, [kmp([P_OWN])], NOW, { model: fake().model });
    await env.DB.prepare(`UPDATE ai_misses SET page_url = 'https://keepmyproof.com.evil.com/questions/x/'`).run();
    const body: any = await (await get(`host=${KMP}`, `Bearer ${TOKEN}`)).json();
    expect(body.misses.map((m: any) => m.page_url)).toEqual([null]);
  });

  it("a newest week over 8 days old, or not read, serves no misses", async () => {
    await recordAiWeek(env, [kmp([P_OWN])], NOW, { model: fake().model });
    expect((await aiMisses(env.DB, KMP, RUN_AT + 9 * DAY)).status).toBe("not_read");
    expect((await aiMisses(env.DB, KMP, RUN_AT + 6 * DAY)).misses.length).toBe(1);
    await env.DB.prepare(`INSERT INTO ai_answer_reads (site, week, status, stop, engines, read_at) VALUES (?, '2099-W01', 'not_read', 'OPENSEO_UNREACHABLE', '{}', ?)`).bind(KMP, NOW).run();
    expect(await aiMisses(env.DB, KMP, NOW)).toMatchObject({ status: "not_read", misses: [] });
  });

  it("POST ai-week needs her session", async () => {
    const res = await handleRequest(new Request("https://boss.sequoiataylor.com/api/boss/growth/ai-week", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ sites: [{ host: KMP, stop: "OPENSEO_UNREACHABLE" }] }),
    }), outer);
    expect(res.status).toBe(401);
    expect(await all(`SELECT * FROM ai_answer_reads`)).toEqual([]);
  });
});
