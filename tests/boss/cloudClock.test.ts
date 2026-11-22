import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { runCloudClock, CLOCK_ALARM_KEY, DISPATCH_URL, rateLimited, retryUntil, slotCheck, watchedJobs, SLOT_NOTICE_KIND, SLOT_REPORTS_FROM } from "../../src/worker/boss/cron/dispatch";
import { api } from "./helpers";
import schedule from "../../src/shared/boss/schedule/manifest.json";
import { slotReport } from "../../scripts/ops/cloud-slot.mjs";
import { needsHer } from "../../src/shared/boss/mail/noticeGate.mjs";

vi.setConfig({ testTimeout: 60_000 });

/**
 * BOSS OS'S OWN CLOCK, OVER THE REAL MIGRATION (0370; 21 Nov 2026, Kendra's alarm mail:morning-email).
 * The how-it-breaks list: two ticks on one slot (double send), a dead or absent token, GitHub
 * refusing, and the alarm that the next accepted start closes. Each proven against its negative.
 */
const E = env as any;
const MORNING = Date.parse("2026-11-21T12:40:30Z"); // 06:40 Central
const KEY = "your-day:2026-11-21:06:40";
const row = (key: string) => E.DB.prepare(`SELECT * FROM cloud_job_dispatches WHERE key = ?`).bind(key).first();
const alarm = () => E.DB.prepare(`SELECT status, text FROM system_alarms WHERE alarm_key = ?`).bind(CLOCK_ALARM_KEY).first();
const calls: Array<{ url: string; body: any; auth: string }> = [];
const github = (status: number, text = "") => async (url: string, init?: RequestInit) => {
  calls.push({ url, body: JSON.parse(String(init?.body)), auth: String((init?.headers as any)?.authorization) });
  return new Response(text || null, { status });
};

describe("the Worker starts the boss-os GitHub jobs", () => {
  it("no token: a NAMED STOP and ONE alarm; then a token: retried, accepted, the alarm closes; a second tick: started once", async () => {
    calls.length = 0;
    const r = await runCloudClock({ ...E, GITHUB_SEQ23_PAT: undefined }, MORNING, github(204));
    expect(calls).toEqual([]);
    expect(r.stop).toMatch(/NAMED STOP \[CLOUD_CLOCK_NO_TOKEN\]/);
    expect(r.output).toMatch(/^OUTPUT 0 cloud_dispatches/);
    expect((await row(KEY))?.status).toBe("no_token");
    expect((await alarm())?.status).toBe("open");
    expect((await alarm())?.text).toMatch(/your-day/);

    // The next tick with a token retries the slot, GitHub accepts, and the alarm closes itself.
    calls.length = 0;
    const r2 = await runCloudClock({ ...E, GITHUB_SEQ23_PAT: "test-token" }, MORNING + 60_000, github(204));
    expect(r2.dispatched).toContain(KEY);
    const mine = calls.find((c) => c.body.event_type === "job-your-day");
    expect(mine?.url).toBe(DISPATCH_URL);
    expect(mine?.auth).toBe("Bearer test-token");
    expect(mine?.body.client_payload.key).toBe(KEY);
    expect(await row(KEY)).toMatchObject({ status: "accepted", attempts: 2 });
    expect((await alarm())?.status).toBe("closed");

    // Two ticks on one slot start it ONCE (no double send).
    calls.length = 0;
    const r3 = await runCloudClock({ ...E, GITHUB_SEQ23_PAT: "test-token" }, MORNING + 4 * 60_000, github(204));
    expect(calls.filter((c) => c.body.event_type === "job-your-day")).toEqual([]);
    expect(r3.already).toContain(KEY);
    expect(r3.output).toMatch(/^OUTPUT \d+ cloud_dispatches/);
  });

  it("GitHub refusing is a NAMED STOP with its status, retried next tick, never silent", async () => {
    calls.length = 0;
    const at = Date.parse("2026-11-21T13:10:10Z"); // 07:10 Central
    const r = await runCloudClock({ ...E, GITHUB_SEQ23_PAT: "dead" }, at, github(401, '{"message":"Bad credentials"}'));
    expect(r.stop).toMatch(/NAMED STOP \[CLOUD_CLOCK_REFUSED\] GitHub refused the dispatch with 401: .*Bad credentials/);
    expect((await row("your-day:2026-11-21:07:10"))?.status).toBe("refused");
    expect((await alarm())?.status).toBe("open");
    // NEGATIVE: a refused slot is not "already started"; the next tick takes it again.
    calls.length = 0;
    const again = await runCloudClock({ ...E, GITHUB_SEQ23_PAT: "good" }, at + 5 * 60_000, github(204));
    expect(again.dispatched).toContain("your-day:2026-11-21:07:10");
    expect((await alarm())?.status).toBe("closed");
  });

  it("a claim left by a tick that died is taken again after four minutes, not before", async () => {
    const at = Date.parse("2026-11-21T13:30:00Z"); // 07:30 Central
    const key = "your-day:2026-11-21:07:30";
    await E.DB.prepare(`INSERT INTO cloud_job_dispatches (key, job, event, due_at, claimed_at, status) VALUES (?, 'your-day', 'job-your-day', ?, ?, 'claimed')`).bind(key, at, at).run();
    calls.length = 0;
    expect((await runCloudClock({ ...E, GITHUB_SEQ23_PAT: "good" }, at + 60_000, github(204))).already).toContain(key);
    expect((await runCloudClock({ ...E, GITHUB_SEQ23_PAT: "good" }, at + 5 * 60_000, github(204))).dispatched).toContain(key);
  });

  // ── 21 Nov 2026, Kendra's alarm mail:cloud-clock: GitHub's shared hourly quota ran dry for ten
  // minutes and the clock woke a person for a wait that cleared itself. A wait is not a fault. ──
  const MIN = 60_000;
  const yourDayCalls = () => calls.filter((c) => c.body.event_type === "job-your-day");
  /** GitHub answering the morning job with `status` and `headers`; every other job is accepted. */
  const gh = (status: number, headers: Record<string, string> = {}, text = "") => async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url, body, auth: String((init?.headers as any)?.authorization) });
    if (body.event_type !== "job-your-day") return new Response(null, { status: 204 });
    return new Response(text || null, { status, headers });
  };

  it("rate limit: no alarm while retries remain; the slot outlives the catch-up window and starts once after the reset", async () => {
    calls.length = 0;
    const due = Date.parse("2026-11-23T18:30:00Z"); // 12:30 Central
    const key = "your-day:2026-11-23:12:30";
    const reset = Math.floor((due + 50 * MIN) / 1000); // the quota frees 50 minutes in, past the 30-minute window
    const limited = gh(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
      '{"message":"API rate limit exceeded for user ID 4986307."}');

    const r = await runCloudClock({ ...E, GITHUB_SEQ23_PAT: "good" }, due + 20_000, limited);
    expect(r.stop).toBeNull();
    expect(r.waiting).toContain(key);
    expect(r.output).toMatch(/waiting [1-9]/);
    const rec: any = await row(key);
    expect(rec).toMatchObject({ status: "refused", retry_after: reset * 1000 });
    expect(rec.retry_until).toBeGreaterThan(reset * 1000);
    expect(rec.retry_until).toBeLessThanOrEqual(due + 90 * MIN);
    expect((await alarm())?.status ?? "none").not.toBe("open");

    // The ticks before the reset do not spend a call on it: GitHub said when to come back.
    calls.length = 0;
    for (let t = due + 5 * MIN; t < reset * 1000; t += 5 * MIN) {
      const w = await runCloudClock({ ...E, GITHUB_SEQ23_PAT: "good" }, t + 20_000, limited);
      expect(w.waiting).toContain(key);
      expect(w.stop).toBeNull();
    }
    expect(yourDayCalls()).toEqual([]);
    expect((await alarm())?.status ?? "none").not.toBe("open");

    // After the reset (20 minutes past the catch-up window) it starts, exactly once.
    calls.length = 0;
    const after = await runCloudClock({ ...E, GITHUB_SEQ23_PAT: "good" }, reset * 1000 + 5 * MIN, gh(204));
    expect(after.dispatched).toContain(key);
    expect(yourDayCalls().map((c) => c.body.client_payload.key)).toEqual([key]);
    expect(await row(key)).toMatchObject({ status: "accepted", retry_after: null });
    calls.length = 0;
    await runCloudClock({ ...E, GITHUB_SEQ23_PAT: "good" }, reset * 1000 + 10 * MIN, gh(204));
    expect(yourDayCalls()).toEqual([]);
  });

  it("a GitHub that keeps refusing cannot spin: retries stop at 90 minutes, then ONE alarm names the job and its slot", async () => {
    calls.length = 0;
    const due = Date.parse("2026-11-24T18:30:00Z"); // 12:30 Central
    const key = "your-day:2026-11-24:12:30";
    const flapping = gh(429, { "retry-after": "60" }, '{"message":"You have exceeded a secondary rate limit"}');
    for (let t = due; t < due + 90 * MIN; t += 5 * MIN) {
      const w = await runCloudClock({ ...E, GITHUB_SEQ23_PAT: "good" }, t + 20_000, flapping);
      expect(w.stop).toBeNull();
    }
    expect((await alarm())?.status ?? "none").not.toBe("open");
    const tries = yourDayCalls().length;
    expect(tries).toBeGreaterThan(6); // it really retried past the 30-minute window
    expect(tries).toBeLessThanOrEqual(19); // and never more than one call a tick for 90 minutes

    // The slot ran out: dropped, alarmed with the job and its Central time — never silently forgotten.
    calls.length = 0;
    const end = await runCloudClock({ ...E, GITHUB_SEQ23_PAT: "good" }, due + 90 * MIN + 20_000, flapping);
    expect(end.stop).toMatch(/NAMED STOP \[CLOUD_CLOCK_REFUSED\] GitHub refused the dispatch with 429/);
    expect(yourDayCalls()).toEqual([]);
    const a: any = await alarm();
    expect(a?.status).toBe("open");
    expect(a?.text).toMatch(/your-day for 2026-11-24 at 12:30 Central/);
    expect(a?.text).toMatch(/retry window ended/);
    calls.length = 0;
    const later = await runCloudClock({ ...E, GITHUB_SEQ23_PAT: "good" }, due + 100 * MIN + 20_000, flapping);
    expect(yourDayCalls()).toEqual([]);
    expect(later.stop).toBeNull();
    // The next accepted start (the errand job's 20:10Z slot) closes it.
    expect((await alarm())?.status).toBe("closed");
  });

  it("a 5xx waits a tick without an alarm; a 404 is terminal and alarms at once", async () => {
    calls.length = 0;
    const due = Date.parse("2026-11-25T18:30:00Z");
    const key = "your-day:2026-11-25:12:30";
    const r = await runCloudClock({ ...E, GITHUB_SEQ23_PAT: "good" }, due + 20_000, gh(502, {}, "Bad gateway"));
    expect(r.stop).toBeNull();
    expect(r.waiting).toContain(key);
    expect((await alarm())?.status ?? "none").not.toBe("open");
    const ok = await runCloudClock({ ...E, GITHUB_SEQ23_PAT: "good" }, due + 5 * MIN + 20_000, gh(204));
    expect(ok.dispatched).toContain(key);

    const due2 = Date.parse("2026-11-26T18:30:00Z");
    const terminal = await runCloudClock({ ...E, GITHUB_SEQ23_PAT: "good" }, due2 + 20_000, gh(404, {}, '{"message":"Not Found"}'));
    expect(terminal.stop).toMatch(/NAMED STOP \[CLOUD_CLOCK_REFUSED\] GitHub refused the dispatch with 404/);
    expect(await row("your-day:2026-11-26:12:30")).toMatchObject({ status: "refused", retry_until: null, retry_after: null });
    expect((await alarm())?.status).toBe("open");
    await runCloudClock({ ...E, GITHUB_SEQ23_PAT: "good" }, due2 + 5 * MIN + 20_000, gh(204));
    expect((await alarm())?.status).toBe("closed");
  });

  it("rateLimited and retryUntil: the arithmetic that bounds every retry", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(rateLimited(403, h({ "x-ratelimit-remaining": "0" }), "")).toBe(true);
    expect(rateLimited(403, h({}), "API rate limit exceeded")).toBe(true);
    expect(rateLimited(429, h({}), "")).toBe(true);
    expect(rateLimited(403, h({ "x-ratelimit-remaining": "4000" }), "Resource not accessible by personal access token")).toBe(false);
    expect(rateLimited(401, h({ "x-ratelimit-remaining": "0" }), "rate limit")).toBe(false);
    const due = Date.parse("2026-11-23T18:30:00Z");
    expect(retryUntil(due, due + 5 * MIN)).toBe(due + 30 * MIN);
    expect(retryUntil(due, due + 55 * MIN)).toBe(due + 55 * MIN);
    expect(retryUntil(due, due + 5 * 60 * MIN)).toBe(due + 90 * MIN);
  });
});

/**
 * ACCEPTED IS NOT RAN (22 Nov 2026: the 06:40 morning email was accepted on time, waited 65 minutes in
 * GitHub's queue and sent at 07:46; the later starts were replaced; nobody was told).
 */
describe("a slot GitHub accepted but did not run on time", () => {
  const DAY = "2026-11-23";
  const AT = (hm: string) => Date.parse(`${DAY}T${hm}:00-06:00`);
  const key = (hm: string) => `your-day:${DAY}:${hm}`;
  const accept = async (hm: string, status = "accepted", dispatchedAt = AT(hm)) => E.DB.prepare(
    `INSERT INTO cloud_job_dispatches (key, job, event, due_at, claimed_at, dispatched_at, status, attempts) VALUES (?, 'your-day', 'job-your-day', ?, ?, ?, ?, 1)`,
  ).bind(key(hm), AT(hm), AT(hm), dispatchedAt, status).run();
  // Yesterday's run reported its start and end: the runner reports exist for this job.
  const PRIOR = "your-day:2026-11-22:06:40";
  const reportsExist = () => E.DB.prepare(
    `INSERT OR REPLACE INTO cloud_job_dispatches (key, job, event, due_at, claimed_at, dispatched_at, status, attempts, started_at, finished_at, outcome) VALUES (?, 'your-day', 'job-your-day', ?, ?, ?, 'accepted', 1, ?, ?, 'ok')`,
  ).bind(PRIOR, AT("06:40") - 86_400_000, AT("06:40") - 86_400_000, AT("06:40") - 86_400_000, AT("06:41") - 86_400_000, AT("06:43") - 86_400_000).run();
  const report = (body: Record<string, unknown>) => api("/api/duties/slot", { method: "POST", body });
  const notices = async () => ((await E.DB.prepare(`SELECT body, needs_her FROM boss_task_notices WHERE kind = ? AND task_id = ?`).bind(SLOT_NOTICE_KIND, `slot-your-day-${DAY}`).all()).results ?? []) as any[];
  const reset = () => E.DB.exec(`DELETE FROM cloud_job_dispatches WHERE key LIKE 'your-day:2026-11-2%'; DELETE FROM boss_task_notices WHERE kind = '${SLOT_NOTICE_KIND}';`);
  const subject = async () => (await E.DB.prepare(`SELECT subject FROM boss_task_notices WHERE kind = ? AND task_id = ?`).bind(SLOT_NOTICE_KIND, `slot-your-day-${DAY}`).first())?.subject;

  it("watches the fixed-time jobs (the morning email) and not the every-ten-minutes one", () => {
    const w = watchedJobs(schedule);
    expect(w).toContain("your-day");
    expect(w).not.toContain("errand-reminders");
  });

  it("accepted but never started: ONE notice, on the Updates page, and two ticks still make one", async () => {
    await reset();
    await reportsExist();
    await accept("06:40");
    expect(await slotCheck(E, AT("06:55"), ["your-day"])).toEqual([]);
    expect(await notices()).toHaveLength(0);
    expect(await slotCheck(E, AT("07:01"), ["your-day"])).toEqual(["your-day"]);
    await slotCheck(E, AT("07:06"), ["your-day"]);
    const n = await notices();
    expect(n).toHaveLength(1);
    expect(n[0].body).toMatch(/06:40 Central run of Your morning email was accepted by GitHub but had not started by 07:00/);
    expect(await subject()).toBe("Your morning email: the first run today did not go on time");
    expect(n[0].needs_her).toBe(0);
    expect(needsHer({ kind: SLOT_NOTICE_KIND })).toBe(false);
  });

  it("started and failed, then a later run ends ok: still ONE notice, and it says what the later run did", async () => {
    await reset();
    await accept("06:40");
    expect((await report({ key: key("06:40"), phase: "start" })).status).toBe(200);
    expect((await report({ key: key("06:40"), phase: "end", outcome: "failed" })).status).toBe(200);
    // The route stamps real time; place the run in the morning it belongs to.
    await E.DB.prepare(`UPDATE cloud_job_dispatches SET started_at = ?, finished_at = ? WHERE key = ?`).bind(AT("06:41"), AT("06:45"), key("06:40")).run();
    expect(await slotCheck(E, AT("06:50"), ["your-day"])).toEqual(["your-day"]);
    await accept("07:50");
    await E.DB.prepare(`UPDATE cloud_job_dispatches SET started_at = ?, finished_at = ?, outcome = 'ok' WHERE key = ?`).bind(AT("07:51"), AT("07:53"), key("07:50")).run();
    await slotCheck(E, AT("08:00"), ["your-day"]);
    const n = await notices();
    expect(n).toHaveLength(1);
    expect(n[0].body).toMatch(/ended failed/);
    expect(n[0].body).toMatch(/ended failed at 06:45\. Later runs today: 07:50 ran from 07:51 and ended ok at 07:53/);
  });

  it("NEGATIVE: the day it lands, a slot dispatched before any runner report existed is no notice", async () => {
    await reset();
    await accept("06:40"); // no row of this job has ever reported a start or an end
    expect(AT("06:40")).toBeLessThan(SLOT_REPORTS_FROM);
    expect(await slotCheck(E, AT("09:00"), ["your-day"])).toEqual([]);
    expect(await notices()).toHaveLength(0);
  });

  it("with no report ever, slots from SLOT_REPORTS_FROM on are still judged (a runner that never reports is told)", async () => {
    await reset();
    const due = SLOT_REPORTS_FROM + 13 * 3_600_000; // a morning after the gate
    await E.DB.prepare(`INSERT INTO cloud_job_dispatches (key, job, event, due_at, claimed_at, dispatched_at, status, attempts) VALUES (?, 'your-day', 'job-your-day', ?, ?, ?, 'accepted', 1)`)
      .bind("your-day:2026-11-25:07:00", due, due, due).run();
    expect(await slotCheck(E, due + 25 * 60_000, ["your-day"])).toEqual(["your-day"]);
    await E.DB.exec(`DELETE FROM cloud_job_dispatches WHERE key = 'your-day:2026-11-25:07:00'; DELETE FROM boss_task_notices WHERE kind = '${SLOT_NOTICE_KIND}';`);
  });

  it("started late (today's 65 minutes in GitHub's queue) and ended ok: ONE notice naming the start time", async () => {
    await reset();
    await accept("06:40");
    await E.DB.prepare(`UPDATE cloud_job_dispatches SET started_at = ?, finished_at = ?, outcome = 'ok' WHERE key = ?`).bind(AT("07:45"), AT("07:46"), key("06:40")).run();
    expect(await slotCheck(E, AT("08:00"), ["your-day"])).toEqual(["your-day"]);
    const n = await notices();
    expect(n).toHaveLength(1);
    expect(n[0].body).toMatch(/06:40 Central run of Your morning email waited in GitHub's queue and started late, at 07:45/);
  });

  it("a catch-up the clock itself sent late is told as the clock's lateness, not GitHub's queue", async () => {
    await reset();
    await accept("06:40", "accepted", AT("07:15"));
    await E.DB.prepare(`UPDATE cloud_job_dispatches SET started_at = ?, finished_at = ?, outcome = 'ok' WHERE key = ?`).bind(AT("07:16"), AT("07:18"), key("06:40")).run();
    await slotCheck(E, AT("08:00"), ["your-day"]);
    expect((await notices())[0]?.body).toMatch(/was started late by Boss OS's clock, at 07:15, and began at 07:16/);
  });

  it("the clock's own tick runs the check: a missed slot is told through runCloudClock", async () => {
    await reset();
    await reportsExist();
    await accept("06:40");
    await runCloudClock({ ...E, GITHUB_SEQ23_PAT: "good" }, AT("07:01"), github(204));
    expect(await notices()).toHaveLength(1);
  });

  it("NEGATIVE: an on-time run that ends ok is no notice", async () => {
    await reset();
    await accept("06:40");
    await E.DB.prepare(`UPDATE cloud_job_dispatches SET started_at = ?, finished_at = ?, outcome = 'ok' WHERE key = ?`).bind(AT("06:41"), AT("06:43"), key("06:40")).run();
    expect(await slotCheck(E, AT("09:00"), ["your-day"])).toEqual([]);
    expect(await notices()).toHaveLength(0);
  });

  it("OUTAGE: a start report that never reached Boss OS is judged by the end report alone", async () => {
    await reset();
    await accept("06:40");
    await E.DB.prepare(`UPDATE cloud_job_dispatches SET finished_at = ?, outcome = 'ok' WHERE key = ?`).bind(AT("06:44"), key("06:40")).run();
    expect(await slotCheck(E, AT("07:30"), ["your-day"])).toEqual([]);
  });

  it("ABUSE: a forged or unknown slot key marks nothing; the first start stands", async () => {
    await reset();
    await accept("06:40");
    expect((await report({ key: "your-day:2026-11-23:06:41", phase: "start" })).status).toBe(404);
    expect((await report({ key: "'; DROP TABLE x; --", phase: "start" })).status).toBe(400);
    expect((await report({ key: key("06:40"), phase: "end", outcome: "great" })).status).toBe(400);
    // A slot GitHub refused (not accepted) is never marked, even with its real key.
    await accept("07:10", "error");
    expect((await report({ key: key("07:10"), phase: "start" })).status).toBe(404);
    expect((await report({ key: key("07:10"), phase: "end", outcome: "ok" })).status).toBe(404);
    expect((await row(key("07:10")))?.started_at ?? null).toBeNull();
    expect((await row(key("07:10")))?.finished_at ?? null).toBeNull();
    await report({ key: key("06:40"), phase: "start" });
    const first = (await row(key("06:40")))?.started_at;
    await report({ key: key("06:40"), phase: "start" });
    expect((await row(key("06:40")))?.started_at).toBe(first);
  });

  it("the runner's report: nothing on a hand-started run; the job's status maps to an outcome", () => {
    expect(slotReport({ SLOT_KEY: "", PHASE: "start" }).skip).toMatch(/no slot key/);
    expect(slotReport({ SLOT_KEY: "your-day:2026-11-23:06:40", PHASE: "end", OUTCOME: "success" }).body).toEqual({ key: "your-day:2026-11-23:06:40", phase: "end", outcome: "ok" });
    expect(slotReport({ SLOT_KEY: "k", PHASE: "end", OUTCOME: "cancelled" }).body?.outcome).toBe("cancelled");
    expect(slotReport({ SLOT_KEY: "k", PHASE: "end", OUTCOME: "" }).body?.outcome).toBe("failed");
  });
});
