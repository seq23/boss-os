/**
 * A #noelle EMAIL IS ONE RUN OF NOELLE AND ONE REPLY (24 Nov 2026; brief noelle-v2 item 7).
 * Her words: "she has a schedule yes but she should be able to work when called too".
 * HOW IT BREAKS, each proven here:
 *   - a cloud rung answers for her: the queue parks her emailed task for her Mac, never routes it;
 *   - replay: two ticks claim once; a reply sent twice is one done card and one email notice;
 *   - collision: the call's run is the slot `call:<task>`, so a call never hides a missed daily run;
 *   - outage: a usage stop costs no try and waits 2 hours; the third real stop answers with the stop;
 *   - abuse: the three call routes are the machine token's only.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { TOKEN_KEY, sha256 } from "../../src/worker/boss/routes/openLoops";
import { setSetting } from "../../src/worker/boss/lib/settings";
import { handleRequest } from "../../src/worker/index";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { CALL_LIMIT_WAIT_MS, CALL_STALE_MS, CALL_TRIES, claimCall, releaseCall, replyCall } from "../../src/worker/boss/growth/noelle";
import { didNotRunLine, escalations, slotOf } from "../../src/shared/boss/growth/noelle.mjs";
import { insertTask } from "./helpers";
import type { Env } from "../../src/worker/env";

const TOKEN = `olt_${"c7".repeat(32)}`;
const outer = {
  WP_OS_DB: env.DB, WP_OS_DOCUMENTS: env.VAULT, WP_OS_KV: env.SESSIONS, WP_OS_ENV: "local",
  BOSS_PASSCODE: env.BOSS_PASSCODE, BOSS_SESSION_SECRET: env.SESSION_SECRET,
  ASSETS: { fetch: async () => new Response("<html>spa</html>", { headers: { "content-type": "text/html" } }) },
} as unknown as Env;
const route = (path: string, body: unknown, auth: string | null = `Bearer ${TOKEN}`) => handleRequest(new Request(`https://boss.sequoiataylor.com/api/boss/growth${path}`, {
  method: "POST", headers: { ...(auth ? { authorization: auth } : {}), "content-type": "application/json" }, body: JSON.stringify(body),
}), outer);
const rows = async (sql: string, ...b: unknown[]) => ((await env.DB.prepare(sql).bind(...b).all<any>()).results ?? []);
const mailed = (over: Record<string, unknown> = {}) => insertTask({
  status: "queued", employee_id: "emp_growth", lane: "ops", title: "Fill the porch reels", intake_kind: "one_off",
  input: JSON.stringify({ source: "boss_inbound_mail", from: "owner@example.test", subject: "#noelle porch reels", tag: "#noelle", body: "Queue three porch reels for next week." }), ...over,
});

beforeEach(async () => {
  await env.DB.exec(`DELETE FROM task_events WHERE task_id IN (SELECT id FROM tasks WHERE employee_id = 'emp_growth'); DELETE FROM boss_task_notices WHERE task_id IN (SELECT id FROM tasks WHERE employee_id = 'emp_growth'); DELETE FROM tasks WHERE employee_id = 'emp_growth';`);
  await setSetting(env.DB, TOKEN_KEY, await sha256(TOKEN));
});

describe("a #noelle email waits for her own run, never a cloud rung", () => {
  it("the queue parks it (one parked event, even when delivered twice) and leaves it queued", async () => {
    const id = await mailed();
    await handleTask(env as any, { taskId: id, lane: "ops" });
    await handleTask(env as any, { taskId: id, lane: "ops" });
    expect((await rows(`SELECT status FROM tasks WHERE id = ?`, id))[0].status).toBe("queued");
    expect((await rows(`SELECT event FROM task_events WHERE task_id = ?`, id)).map((r) => r.event)).toEqual(["parked_for_mac"]);
    expect(await rows(`SELECT id FROM backend_runs WHERE task_id = ?`, id)).toEqual([]);
  });

  it("a task on her seat that is not an email is not parked as a call, and is never claimed as one", async () => {
    const id = await insertTask({ status: "queued", employee_id: "emp_growth", input: JSON.stringify({ source: "duty" }) });
    expect(await claimCall(env as any, "mac")).toBeNull();
    expect((await rows(`SELECT status FROM tasks WHERE id = ?`, id))[0].status).toBe("queued");
  });
});

describe("one email, one run, one reply", () => {
  it("two ticks: the first claims it (slot call:<task>), the second finds nothing", async () => {
    const id = await mailed();
    const first = await claimCall(env as any, "mac");
    expect(first).toMatchObject({ task_id: id, slot: `call:${id}`, try: 1, body: "Queue three porch reels for next week." });
    expect(await claimCall(env as any, "mac")).toBeNull();
    expect((await rows(`SELECT status FROM tasks WHERE id = ?`, id))[0].status).toBe("running");
  });

  it("the reply is the card's output and ONE email notice signed Noelle; a second reply is refused and sends nothing", async () => {
    const id = await mailed();
    await claimCall(env as any, "mac");
    const r1 = await replyCall(env as any, { task_id: id, text: "Queued 3 porch reels.\n\nNoelle" });
    expect(r1).toMatchObject({ replied: true, emailed: true });
    const r2 = await replyCall(env as any, { task_id: id, text: "again" });
    expect(r2.replied).toBe(false);
    const t = (await rows(`SELECT status, output FROM tasks WHERE id = ?`, id))[0];
    expect(t.status).toBe("done");
    expect(JSON.parse(t.output).text).toContain("Queued 3 porch reels.");
    const notes = await rows(`SELECT from_name, body FROM boss_task_notices WHERE task_id = ?`, id);
    expect(notes.length).toBe(1);
    expect(notes[0].from_name).toBe("Noelle");
  });

  it("a reply to a task that is not hers, or not running, changes nothing", async () => {
    const other = await insertTask({ status: "running", employee_id: "emp_chief" });
    expect((await replyCall(env as any, { task_id: other, text: "x" })).replied).toBe(false);
    const queued = await mailed();
    expect((await replyCall(env as any, { task_id: queued, text: "x" })).replied).toBe(false);
    expect((await rows(`SELECT status FROM tasks WHERE id = ?`, queued))[0].status).toBe("queued");
  });
});

describe("a stopped call comes back, and never waits forever unseen", () => {
  it("a usage stop costs no try and is skipped for 2 hours; a plain stop is retried at once as a new run", async () => {
    const id = await mailed();
    const now = Date.now();
    await claimCall(env as any, "mac", now);
    expect((await releaseCall(env as any, { task_id: id, stop: "NAMED STOP [CLAUDE_LIMIT] out of credits" }, now)).waits).toBe(true);
    expect((await rows(`SELECT attempts, status FROM tasks WHERE id = ?`, id))[0]).toMatchObject({ attempts: 0, status: "queued" });
    expect(await claimCall(env as any, "mac", now + 60_000)).toBeNull();
    const again = await claimCall(env as any, "mac", now + CALL_LIMIT_WAIT_MS + 60_000);
    expect(again?.try).toBe(1);
    expect((await releaseCall(env as any, { task_id: id, stop: "NAMED STOP [NO_PLAN] x" }, now + CALL_LIMIT_WAIT_MS + 120_000)).released).toBe(true);
    expect((await claimCall(env as any, "mac", now + CALL_LIMIT_WAIT_MS + 180_000))?.try).toBe(2);
  });

  it(`the ${CALL_TRIES}rd real stop answers her with the stop, once, and the task is done`, async () => {
    const id = await mailed();
    for (let i = 1; i <= CALL_TRIES; i++) {
      await claimCall(env as any, "mac");
      const r = await releaseCall(env as any, { task_id: id, stop: "NAMED STOP [PLAN_REFUSED] rc=4" });
      if (i < CALL_TRIES) expect(r.released).toBe(true); else expect(r).toMatchObject({ gave_up: true, replied: true });
    }
    const t = (await rows(`SELECT status, output FROM tasks WHERE id = ?`, id))[0];
    expect(t.status).toBe("done");
    expect(JSON.parse(t.output).text).toContain("PLAN_REFUSED");
    expect((await rows(`SELECT id FROM boss_task_notices WHERE task_id = ?`, id)).length).toBe(1);
  });
});

describe("a call whose run died is never left running unseen", () => {
  it("a claim left 3 hours with no reply or stop is returned (a try spent); on its last try it answers her", async () => {
    const id = await mailed();
    const t0 = Date.now();
    await claimCall(env as any, "mac", t0);
    expect(await claimCall(env as any, "mac", t0 + CALL_STALE_MS - 60_000)).toBeNull();
    expect((await claimCall(env as any, "mac", t0 + CALL_STALE_MS + 60_000))?.try).toBe(2);
    expect((await claimCall(env as any, "mac", t0 + 2 * CALL_STALE_MS + 120_000))?.try).toBe(3);
    expect(await claimCall(env as any, "mac", t0 + 3 * CALL_STALE_MS + 180_000)).toBeNull();
    const t = (await rows(`SELECT status, output FROM tasks WHERE id = ?`, id))[0];
    expect(t.status).toBe("done");
    expect(JSON.parse(t.output).text).toContain("CALL_RUN_LOST");
  });
});

describe("a call never stands in for her schedule", () => {
  it("slots: HH:MM or call:<task>, nothing else", () => {
    expect(slotOf("14:37")).toBe("14:37");
    expect(slotOf("call:tsk_abc123")).toBe("call:tsk_abc123");
    expect(slotOf("call:../x")).toBeNull();
    expect(slotOf("14:37:00")).toBeNull();
  });
  it("a day with only a call run is still 'Noelle did not run'; calls never count toward 3-days-running", () => {
    expect(didNotRunLine([{ day: "2026-11-28", slot: "call:tsk_abcd" }], "2026-11-28")).toMatch(/did not run/);
    expect(didNotRunLine([{ day: "2026-11-28", slot: "14:37" }], "2026-11-28")).toBeNull();
    const days = ["2026-11-28", "2026-11-29", "2026-11-30"];
    expect(escalations(days.map((day) => ({ day, slot: `call:tsk_${day.slice(-2)}xx`, stops: ["NO_PLAN"] })))).toEqual([]);
  });
});

describe("the call routes are the machine token's only", () => {
  it("401 without the token on claim, reply and release; with it, claim answers", async () => {
    for (const p of ["/noelle/call/claim", "/noelle/call/reply", "/noelle/call/release"]) {
      expect((await route(p, {}, null)).status).toBe(401);
      expect((await route(p, {}, `Bearer olt_${"d8".repeat(32)}`)).status).toBe(401);
    }
    const id = await mailed();
    const r = await route("/noelle/call/claim", { device_id: "mac" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).data.call.task_id).toBe(id);
  });
});
