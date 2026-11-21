import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { runCloudClock, CLOCK_ALARM_KEY, DISPATCH_URL } from "../../src/worker/boss/cron/dispatch";

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
});
