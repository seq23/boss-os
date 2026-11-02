import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/worker/boss/index";
import { apiJson } from "./helpers";
import { runOpenLoopsDaily } from "../../src/worker/boss/routes/openLoops";

/**
 * OPEN LOOPS (owner ruling, 1 Nov 2026). Three behaviours, each where it lives:
 *   1. a repo's named stop upserts ONE row by source_key and a later "cleared" post closes it
 *      ("outcome reached"); only the machine token or a session gets through the intake's door;
 *   2. her row waiting on an open step is hidden from the main list (counted as waiting), and shows
 *      once that step is closed;
 *   3. an overdue row Danielle can do opens ONE silent repair (never a second on the next tick); one
 *      that needs her (her row, her account, a step only she holds, or nothing written) opens no job
 *      and sends ONE reminder email per slot (owner, 2 Nov 2026).
 */
const raw = async (path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://boss.test${path}`, {
    method: init.method ?? "GET", headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }), env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: res.status, body: (await res.json()) as any };
};
const create = async (b: Record<string, unknown>) => (await apiJson("/api/open-loops", { method: "POST", body: { business: "spry", finish_line: "Live and selling", owner: "claude", ...b } })).body.data.loop;
const list = async () => (await apiJson("/api/open-loops")).body.data;
// 2026-11-10 13:00 Central (19:00Z), a Tuesday.
const NOW = Date.parse("2026-11-10T19:00:00Z");

describe("Open Loops", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM owner_open_loops`).run();
    await env.DB.prepare(`DELETE FROM morning_sections`).run();
    await env.DB.prepare(`DELETE FROM tasks WHERE title LIKE 'Open loop overdue:%'`).run();
  });

  it("the intake upserts one row per repo + named stop, and a cleared post closes it with the outcome", async () => {
    const token = (await apiJson("/api/open-loops/intake-token", { method: "POST" })).body.data.token as string;
    const auth = { authorization: `Bearer ${token}` };
    const stop = { repo: "seq23/keepmyproof", stop: "STORE_ACCOUNTS_MISSING", finish_line: "Live in both stores, selling", business: "spry" };
    expect((await raw("/api/open-loops/intake", { method: "POST", body: stop })).status).toBe(401);
    expect((await raw("/api/open-loops/intake", { method: "POST", body: stop, headers: { authorization: `Bearer olt_${"0".repeat(64)}` } })).status).toBe(401);
    expect((await raw("/api/open-loops/intake", { method: "POST", body: stop, headers: auth })).body.data.action).toBe("opened");
    expect((await raw("/api/open-loops/intake", { method: "POST", body: stop, headers: auth })).body.data.action).toBe("kept");
    let rows = (await list()).loops;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "named_stop", source_key: "seq23/keepmyproof#STORE_ACCOUNTS_MISSING", status: "open", section: "not_finished" });
    expect((await raw("/api/open-loops/intake", { method: "POST", body: { ...stop, cleared: true }, headers: auth })).body.data.action).toBe("closed");
    rows = (await list()).loops;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "closed", closed_reason: "outcome reached" });
  });

  it("her row waiting on an open step is hidden and counted, then shows once the step is closed", async () => {
    const step = await create({ title: "Real-phone test", owner: "claude", next_date: "2026-11-20" });
    const hers = await create({ title: "Store accounts", owner: "sequoia", next_date: "2026-11-21", blocked_by: step.id });
    const team = await create({ title: "Store products", owner: "claude", next_date: "2026-11-22", blocked_by: hers.id });
    const { visibleLoops } = await import("../../src/shared/boss/openLoops/openLoops.mjs");
    let d = await list();
    expect(d.waiting).toBe(1);
    expect(visibleLoops(d.loops).shown.map((l: any) => l.id).sort()).toEqual([step.id, team.id].sort());
    expect((await apiJson(`/api/open-loops/${step.id}/close`, { method: "POST", body: { reason: "" } })).status).toBe(400);
    expect((await apiJson(`/api/open-loops/${step.id}/close`, { method: "POST", body: { reason: "Passed on a real phone" } })).status).toBe(200);
    d = await list();
    expect(d.waiting).toBe(0);
    expect(visibleLoops(d.loops).shown.map((l: any) => l.id)).toContain(hers.id);
  });

  it("an overdue row Danielle can do is one silent repair; one that needs her is a reminder email and no job (2 Nov 2026)", async () => {
    // Doable: a team row with a written step and nothing only she holds, four days late.
    const team = await create({ title: "Fix the sitemap build", next_step: "Fix the sitemap script and run it again.", owner: "claude", next_date: "2026-11-06" });
    // Needs her: a named-stop row about her Play account, one day late (team-owned, still hers).
    const play = await create({ title: "KeepMyProof on Google Play", next_step: "Finish the Google Play ID check.", owner: "codex", next_date: "2026-11-09" });
    // Her own row, one day late; and a team row with no step written (fail closed: hers).
    const mine = await create({ title: "Pay for the accounts", owner: "sequoia", next_date: "2026-11-09" });
    const blank = await create({ title: "Something unclear", owner: "claude", next_date: "2026-11-09" });
    await create({ title: "An idea", owner: "sequoia", section: "parked", next_date: "2026-01-01" });
    await env.DB.prepare(`DELETE FROM boss_task_notices WHERE kind = 'open_loop_reminder'`).run();

    const first = await runOpenLoopsDaily(env as any, NOW);
    expect(first).toMatchObject({ ran: true, repairs: [team.id] });
    expect([...(first.reminders ?? [])].sort()).toEqual([play.id, mine.id, blank.id].sort());
    const sec = await env.DB.prepare(`SELECT body FROM morning_sections WHERE section = 'open_loops'`).first<{ body: string }>();
    expect(JSON.parse(sec!.body).lines.map((l: any) => l.text).join("\n")).toContain("Pay for the accounts");

    // The reminder is three plain parts and reaches the notice drain; no job was opened for it.
    const notes = await env.DB.prepare(`SELECT task_id, subject, body FROM boss_task_notices WHERE kind = 'open_loop_reminder'`).all<any>();
    const playNote = notes.results.find((n: any) => n.task_id === play.id);
    expect(playNote.subject).toBe("Reminder: KeepMyProof on Google Play");
    expect(playNote.body).toMatch(/What is waiting: .*\nWhy it is yours: .*\nWhat clears it: Finish the Google Play ID check\./);
    expect(notes.results.map((n: any) => n.task_id)).not.toContain(team.id);
    const tasks = await env.DB.prepare(`SELECT title FROM tasks WHERE title LIKE 'Open loop overdue:%'`).all<{ title: string }>();
    expect(tasks.results.map((t) => t.title)).toEqual([`Open loop overdue: Fix the sitemap build [${team.id}]`]);

    // The next day: no second repair, no second reminder. Three days on: reminder 2.
    await env.DB.prepare(`DELETE FROM morning_sections`).run();
    expect(await runOpenLoopsDaily(env as any, NOW + 86_400_000)).toMatchObject({ repairs: [], reminders: [] });
    await env.DB.prepare(`DELETE FROM morning_sections`).run();
    expect((await runOpenLoopsDaily(env as any, NOW + 3 * 86_400_000)).reminders).toHaveLength(3);
    expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE title LIKE 'Open loop overdue:%'`).first<{ n: number }>())!.n).toBe(1);
  });
});
