/**
 * THE AI ANSWERS LOOP IN D1, END TO END (her ask 22 Nov 2026; the pure half is tests/aiAnswers.test.ts).
 * HOW IT BREAKS, each proven here:
 *   - data integrity: the same week twice changes nothing; a not-read week never overwrites a read one;
 *   - G16e: the week is stored whether or not Noelle runs, and nothing here opens a to-do, a card or a
 *     model call (a Noelle decision is never a fix attempt: she has no AI-answers lever yet);
 *   - lanes: after 2 fixes a miss moves to the next lane, and a rerun never counts a fix twice (the
 *     loop's strengthened pages for OWN, Noelle's decisions made before the answers for the rest);
 *   - abuse: GET ai-misses is 401 without the machine token, 404 for any host but the six (exact
 *     match), serves only OWN misses with a page on the host or null; POST ai-week needs a session;
 *   - aplayermode.com (no loop): read, its misses stored, none served to the loop (the note).
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { recordAiWeek, aiMisses } from "../../src/worker/boss/growth/aiAnswers";
import { ENGINES, RUN_DAY_UTC, RUN_HOUR_UTC, missId } from "../../src/shared/boss/growth/aiAnswers.mjs";
import { TOKEN_KEY, sha256 } from "../../src/worker/boss/routes/openLoops";
import { setSetting } from "../../src/worker/boss/lib/settings";
import { handleRequest } from "../../src/worker/index";
import type { Env } from "../../src/worker/env";

const DAY = 86_400_000;
const NOW = Date.now();
/** OpenSEO's newest scheduled run at or before NOW (Tuesday 04:00 UTC), as in real life: a run stamped
 * off-schedule put the read and the not-read rows in different weeks on Mondays before 04:00 UTC Tuesday. */
const RUN_AT = (() => {
  const d = new Date(NOW);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RUN_HOUR_UTC);
  while (new Date(t).getUTCDay() !== RUN_DAY_UTC || t > NOW) t -= DAY;
  return t;
})();
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
    const entry = kmp([P_CITED, P_OWN, P_EARN_A, P_EARN_B, P_CLAIM_NEW, P_CLAIM_HELD, P_CONTEST]);
    const [first] = await recordAiWeek(env, [entry], NOW);
    expect(first).toMatchObject({ status: "read", prompts: 7, cited: 1, misses: 6, unchanged: false });
    const snap = async () => JSON.stringify([
      await all(`SELECT site, week, status, cited, prompts FROM ai_answer_reads`),
      (await all(`SELECT COUNT(*) AS n FROM ai_answer_obs`))[0].n,
      await all(`SELECT id, lane, fix_attempts, todo_key FROM ai_misses ORDER BY id`),
      (await loops()).map((l) => l.source_key), (await cards()).map((c) => c.jtitle),
    ]);
    const before = await snap();
    expect((await all(`SELECT COUNT(*) AS n FROM ai_answer_obs`))[0].n).toBe(21);
    const [again] = await recordAiWeek(env, [entry], NOW + 60_000);
    expect(again).toMatchObject({ status: "read", unchanged: true });
    expect(await snap()).toBe(before);
  });

  it("G16e: the week is stored with Noelle absent, and nothing here opens a to-do, a card or a fix", async () => {
    const [r] = await recordAiWeek(env, [kmp([P_CITED, P_OWN, P_EARN_A, P_EARN_B, P_CLAIM_NEW, P_CLAIM_HELD, P_CONTEST])], NOW);
    expect(r).toMatchObject({ status: "read", misses: 6 });
    expect(r).not.toHaveProperty("actions");
    expect((await all(`SELECT COUNT(*) AS n FROM ai_misses`))[0].n).toBe(6);
    expect(await loops()).toEqual([]);
    expect(await cards()).toEqual([]);
    expect((await all(`SELECT COUNT(*) AS n FROM ai_misses WHERE todo_key IS NOT NULL`))[0].n).toBe(0);
  });

  it("a not-read week is stored as not read and never overwrites a read week", async () => {
    await recordAiWeek(env, [{ host: "approvalprep.com", stop: "OPENSEO_UNREACHABLE" }], NOW);
    expect(await all(`SELECT site, status, stop, cited FROM ai_answer_reads`)).toEqual([{ site: "approvalprep.com", status: "not_read", stop: "OPENSEO_UNREACHABLE", cited: null }]);
    await recordAiWeek(env, [kmp([P_CITED])], NOW);
    await recordAiWeek(env, [{ host: KMP, stop: "OPENSEO_UNREACHABLE" }], NOW + 60_000);
    expect(await all(`SELECT status, stop, cited, read_at FROM ai_answer_reads WHERE site = ?`, KMP)).toEqual([{ status: "read", stop: null, cited: 1, read_at: NOW }]);
  });

  it("a site that is not one of the six is refused; a summary that disagrees is not read", async () => {
    const bad = kmp([P_CITED]); (bad.block.summary_own as any).citations = 3;
    const out = await recordAiWeek(env, [{ host: "evil.com", stop: "OPENSEO_UNREACHABLE" }, bad], NOW);
    expect(out[0]).toMatchObject({ status: "refused" });
    expect(out[1]).toMatchObject({ status: "not_read", stop: "OPENSEO_SHORT_READ" });
    expect(await all(`SELECT site FROM ai_answer_reads WHERE status = 'read'`)).toEqual([]);
  });
});

describe("lanes move after two fixes", () => {
  it("OWN counts the loop's strengthened pages once each, then moves to CLAIM", async () => {
    const id = await missId(KMP, P_OWN.text);
    const w1 = RUN_AT - 14 * DAY, w2 = RUN_AT - 7 * DAY, w3 = RUN_AT;
    const s = (at: number) => ({ id, page_url: Q1, at: new Date(at).toISOString() });
    await recordAiWeek(env, [kmp([P_OWN], { runAt: w1, runId: "r1" })], w1 + 3_600_000);
    await recordAiWeek(env, [kmp([P_OWN], { runAt: w2, runId: "r2", strengthened: [s(w1 + DAY)] })], w2 + 3_600_000);
    const one = await all(`SELECT lane, fix_attempts FROM ai_misses WHERE id = ?`, id);
    expect(one).toEqual([{ lane: "own", fix_attempts: 1 }]);
    // The same strengthening again plus one made AFTER this run's answers: neither counts.
    await recordAiWeek(env, [kmp([P_OWN], { runAt: w2, runId: "r2", strengthened: [s(w1 + DAY), s(w2 + DAY)] })], w2 + 7_200_000);
    expect((await all(`SELECT fix_attempts FROM ai_misses WHERE id = ?`, id))[0].fix_attempts).toBe(1);
    await recordAiWeek(env, [kmp([P_OWN], { runAt: w3, runId: "r3", strengthened: [s(w1 + DAY), s(w2 + DAY)] })], NOW);
    const moved = (await all(`SELECT lane, fix_attempts, lanes_tried, page_url FROM ai_misses WHERE id = ?`, id))[0];
    expect(moved).toMatchObject({ lane: "claim", fix_attempts: 0, lanes_tried: '["own"]', page_url: null });
    // Moved off OWN: the search loop no longer gets it.
    expect((await aiMisses(env.DB, KMP, NOW)).misses).toEqual([]);
  });

  it("a Noelle decision is never a fix attempt: an old noelle: key leaves fix_attempts unchanged and the lane where it was", async () => {
    const id = await missId(KMP, P_EARN_A.text);
    const w1 = RUN_AT - 14 * DAY, w2 = RUN_AT - 7 * DAY;
    await env.DB.exec("DELETE FROM growth_decisions");
    await recordAiWeek(env, [kmp([P_EARN_A], { runAt: w1, runId: "r1" })], w1 + 3_600_000);
    // A decision made BEFORE the next answers, keyed on the miss: the old path counted this as one attempt.
    await env.DB.prepare(`INSERT INTO growth_decisions (id, cycle, business, label, state, decision, created_at) VALUES ('gdc_one', '2026-11-20', 'keepmyproof', 'KeepMyProof', 'decided', 'earn a mention', ?)`).bind(w1 + DAY).run();
    await env.DB.prepare(`UPDATE ai_misses SET todo_key = 'noelle:gdc_one' WHERE id = ?`).bind(id).run();
    const before = (await all(`SELECT lane FROM ai_misses WHERE id = ?`, id))[0].lane;
    for (const [at, run] of [[w2, "r2"], [RUN_AT, "r3"]] as const) await recordAiWeek(env, [kmp([P_EARN_A], { runAt: at, runId: run })], at + DAY);
    expect((await all(`SELECT lane, fix_attempts, todo_key FROM ai_misses WHERE id = ?`, id))[0]).toEqual({ lane: before, fix_attempts: 0, todo_key: null });
  });

  it("a deleted decision is no attempt", async () => {
    const id = await missId(KMP, P_EARN_A.text);
    await recordAiWeek(env, [kmp([P_EARN_A], { runAt: RUN_AT - 7 * DAY, runId: "r1" })], RUN_AT - 6 * DAY);
    await env.DB.prepare(`UPDATE ai_misses SET todo_key = 'noelle:gdc_gone' WHERE id = ?`).bind(id).run();
    await recordAiWeek(env, [kmp([P_EARN_A], { runId: "r2" })], NOW);
    expect((await all(`SELECT fix_attempts, todo_key FROM ai_misses WHERE id = ?`, id))[0]).toEqual({ fix_attempts: 0, todo_key: null });
  });

  it("a cited week marks the miss fixed", async () => {
    await recordAiWeek(env, [kmp([P_OWN], { runAt: NOW - 7 * DAY, runId: "r1" })], NOW - 7 * DAY + 3_600_000);
    await recordAiWeek(env, [kmp([{ ...P_OWN, cited: ["gemini"], lane: undefined }], { runId: "r2" })], NOW);
    expect((await all(`SELECT fixed_week FROM ai_misses`))[0].fixed_week).toMatch(/^\d{4}-W\d\d$/);
  });
});

describe("aplayermode.com has no search loop (A6)", () => {
  const apm = (prompts: P[]) => ({ host: APM, block: week(APM, prompts), prefix: "/questions/", strengthened: [] });
  it("its misses are stored, none served to a loop, never a page_url", async () => {
    await recordAiWeek(env, [apm([{ id: "q1", text: "how to perform under pressure", lane: { lane: "own", page_url: "https://aplayermode.com/a/" } }, { id: "q9", text: "how to stay calm on stage", lane: { lane: "own", page_url: null } }])], NOW);
    expect((await all(`SELECT COUNT(*) AS n FROM ai_misses WHERE site = ?`, APM))[0].n).toBe(2);
    expect((await all(`SELECT COUNT(*) AS n FROM ai_misses WHERE page_url IS NOT NULL`))[0].n).toBe(0);
    expect(await loops()).toEqual([]);
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
    for (const h of ["evil.com", "keepmyproof.com.evil.com", "www.keepmyproof.com", "KEEPMYPROOF.COM", "__proto__", "constructor", ""]) expect((await get(`host=${encodeURIComponent(h)}`, `Bearer ${TOKEN}`)).status).toBe(404);
  });

  it("serves OWN misses only, with an on-host engine page or null, in the contract's shape", async () => {
    const offHost: P = { id: "p8", text: "rent cash receipt template", lane: { lane: "own", page_url: "https://evil.com/questions/x/" } };
    await recordAiWeek(env, [kmp([P_CITED, P_OWN, P_EARN_A, offHost])], NOW);
    const res = await get(`host=${KMP}`, `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toMatchObject({ host: KMP, status: "read", week: expect.stringMatching(/^\d{4}-W\d\d$/), read_at: expect.any(String) });
    expect(body.misses.map((m: any) => [m.prompt, m.lane, m.page_url]).sort()).toEqual([[P_OWN.text, "own", Q1], [offHost.text, "own", null]].sort());
    expect(Object.keys(body.misses[0]).sort()).toEqual(["cited_sources", "engines_missed", "first_missed_week", "fix_attempts", "id", "lane", "page_url", "prompt", "rivals"]);
    expect(JSON.stringify(body)).not.toMatch(/evil\.com/);
  });

  it("a stored page off the host is never served, whatever wrote it", async () => {
    await recordAiWeek(env, [kmp([P_OWN])], NOW);
    await env.DB.prepare(`UPDATE ai_misses SET page_url = 'https://keepmyproof.com.evil.com/questions/x/'`).run();
    const body: any = await (await get(`host=${KMP}`, `Bearer ${TOKEN}`)).json();
    expect(body.misses.map((m: any) => m.page_url)).toEqual([null]);
  });

  it("a newest week over 8 days old, or not read, serves no misses", async () => {
    await recordAiWeek(env, [kmp([P_OWN])], NOW);
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
