import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { claimSimone, fileSimoneMessage, releaseSimone, replySimone, SIMONE_LEASE_MS } from "../../src/worker/boss/agents/simone";
import { apiJson, row } from "./helpers";

const request = { source: "boss_page", subject: "What can move?", body: "Check the team’s work." } as const;

describe("Simone's existing task queue", () => {
  it("keeps one task and one result across duplicate admission, claim and reply", async () => {
    const now = 100000;
    const id = await fileSimoneMessage(env, request, "one", now);
    expect(await fileSimoneMessage(env, request, "one", now)).toBe(id);
    const leases = await Promise.all([claimSimone(env, now), claimSimone(env, now)]);
    expect(leases.filter(Boolean)).toHaveLength(1);
    const call = leases.find(Boolean)!;
    expect(call).toMatchObject({ id, lease: 1, message: request });
    expect(await replySimone(env, { id, lease: 1, text: "Done.", work: [] })).toBe(false);
    expect(await replySimone(env, { id, lease: 1, text: "The review has an owner.", work: ["task_read"] })).toBe(true);
    expect(await replySimone(env, { id, lease: 1, text: "Different reply.", work: ["task_read"] })).toBe(false);
    expect((await apiJson(`/api/simone/message/${id}`)).body.data).toEqual({ status: "done", reply: "The review has an owner." });
    expect(await row("SELECT count(*) AS n FROM task_events WHERE task_id = ? AND event = 'completed'", id)).toEqual({ n: 1 });
    expect(await row("SELECT count(*) AS n FROM boss_task_notices WHERE task_id = ?", id)).toEqual({ n: 0 });
  });

  it("recovers an abandoned lease and fences a stale reply", async () => {
    const now = 100000;
    const id = await fileSimoneMessage(env, request, "recover", now);
    expect(await claimSimone(env, now)).toMatchObject({ id, lease: 1 });
    expect(await claimSimone(env, now + SIMONE_LEASE_MS - 1)).toBeNull();
    expect(await claimSimone(env, now + SIMONE_LEASE_MS)).toMatchObject({ id, lease: 2 });
    expect(await replySimone(env, { id, lease: 1, text: "Old result", work: ["task_read"] })).toBe(false);
    expect(await releaseSimone(env, id, 2, "MODEL_UNAVAILABLE")).toBe(true);
    expect(await row("SELECT status, output FROM tasks WHERE id = ?", id)).toEqual({ status: "queued", output: null });
    expect(await claimSimone(env, now + SIMONE_LEASE_MS)).toMatchObject({ id, lease: 3, message: request });
  });

  it("records an email notice in the same transaction as the result", async () => {
    const id = await fileSimoneMessage(env, {
      ...request, source: "boss_inbound_mail", from: "owner@example.test", message_id: "<1@example.test>",
    }, "mail");
    const call = (await claimSimone(env))!;
    expect(await replySimone(env, { id, lease: call.lease, text: "I checked the team’s work.", work: ["task_read"] })).toBe(true);
    expect(await row("SELECT kind, body FROM boss_task_notices WHERE task_id = ?", id)).toEqual({
      kind: "simone_result", body: "I checked the team’s work.",
    });
  });

  it("accepts both boxes through the session and checks decoded byte size", async () => {
    for (const [path, source] of [["/api/intake/simone", "tell_simone"], ["/api/simone/message", "boss_page"]]) {
      expect((await apiJson(path!, { method: "POST", body: { text: "" } })).status).toBe(400);
      expect((await apiJson(path!, { method: "POST", body: { text: "😀".repeat(15001) } })).status).toBe(400);
      const result = await apiJson(path!, { method: "POST", body: { text: request.body } });
      expect(result.status).toBe(201);
      expect(await row("SELECT json_extract(input, '$.source') AS source, status FROM tasks WHERE id = ?", result.body.data.taskId)).toEqual({ source, status: "queued" });
    }
  });
});
