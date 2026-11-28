import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { dayIdInZone } from "../../src/shared/boss/timezone";
import { claimSimone, fileSimoneMessage } from "../../src/worker/boss/agents/simone";
import { simoneTool } from "../../src/worker/boss/agents/simoneTools";
import { TOKEN_KEY } from "../../src/worker/boss/routes/openLoops";
import { sha256Hex } from "../../src/worker/boss/lib/id";
import { apiJson, row } from "./helpers";

it("keeps one fresh inventory, makes it available to Simone, and publishes a same-day warning and morning note", async () => {
  const day = dayIdInZone(Date.now());
  const token = "olt_" + "a".repeat(64);
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)")
    .bind(TOKEN_KEY, await sha256Hex(token), Date.now()).run();
  const headers = { authorization: `Bearer ${token}` };
  const issues = ["NOT WORKING: Office reply — the owner’s mailbox had no copy."];
  const body = { day, issues, proposal: null, rows: [{ id: "worker-check:pnp-corporate-outreach", name: "Office reply", kind: "schedule",
    aim: "Deliver the reply", state: "missing", coverage: "listed", evidence: "The owner’s mailbox had no copy." }] };
  expect((await apiJson("/api/simone/operations")).status).toBe(503);
  expect((await apiJson("/api/simone/operations/inputs")).status).toBe(401);
  const input = (await apiJson("/api/simone/operations/inputs", { headers })).body.data;
  expect(input.agents.length).toBeGreaterThan(1);
  expect(input.duties.length).toBeGreaterThan(1);
  expect(input.workerEvidence).toMatchObject({ duties: expect.any(Object), runs: expect.any(Object), workflows: expect.any(Object),
    worker: expect.any(Object), properties: expect.any(Object) });
  expect((await apiJson("/api/simone/operations/report", { method: "POST", headers, body: { ...body, rows: [] } })).status).toBe(400);
  expect((await apiJson("/api/simone/operations/report", { method: "POST", body })).status).toBe(401);
  const oversized = "x".repeat(850_001);
  expect((await apiJson("/api/simone/operations/report", { method: "POST", headers, body: oversized })).status).toBe(413);
  expect((await apiJson("/api/simone/stop", { method: "POST", body: { stopped: true } })).status).toBe(200);
  expect((await apiJson("/api/simone/operations/inputs", { headers })).body.data).toEqual({ day, stopped: true });
  expect((await apiJson("/api/simone/operations/report", { method: "POST", headers, body })).status).toBe(409);
  expect((await apiJson("/api/simone/operations")).status).toBe(503);
  expect((await apiJson("/api/simone/stop", { method: "POST", body: { stopped: false } })).status).toBe(200);
  const relay = () => apiJson("/api/simone/operations/report", { method: "POST", headers, body });
  expect((await relay()).body.data).toEqual({ saved: true, rows: 1 });
  expect((await relay()).body.data).toEqual({ saved: false, rows: 1 });
  expect((await apiJson("/api/simone/operations/inputs", { headers })).body.data).toEqual({ day, checked: true });
  expect((await apiJson("/api/system/settings/simone_operations", { method: "PUT", body: { value: "{}" } })).status).toBe(400);
  expect((await apiJson("/api/simone/operations")).body.data).toMatchObject(body);
  expect((await apiJson("/api/scorecard")).body.data.workerChecks).toEqual([
    { id: body.rows[0]!.id, name: body.rows[0]!.name, state: body.rows[0]!.state, evidence: body.rows[0]!.evidence },
  ]);
  expect(await row("SELECT count(*) AS n FROM boss_task_notices WHERE subject LIKE 'NOT WORKING:%'")).toEqual({ n: 1 });
  expect(await row("SELECT json_extract(body, '$.lines[0]') AS evidence FROM morning_sections WHERE section = 'operations'"))
    .toEqual({ evidence: issues[0] });
  // Her email holds the whole morning on an /api link: the note links a screen (28 Nov 2026).
  expect(await row("SELECT json_extract(body, '$.link.url') AS url FROM morning_sections WHERE section = 'operations'"))
    .toEqual({ url: expect.stringMatching(/^https:\/\/[^/]+\/\?tab=updates$/) });
  await fileSimoneMessage(env, { source: "simone_daily", subject: "Operating check", body: "Read the results." });
  const call = (await claimSimone(env))!;
  await expect(simoneTool(env, { id: call.id, lease: call.lease, tool: "operations" }))
    .resolves.toMatchObject({ ok: true, total: 1, rows: body.rows, issues });
});

it("hands the arrival check yesterday's agent mail and the reply cards each kept morning carried (28 Nov 2026)", async () => {
  const { startOfDay } = await import("../../src/shared/boss/schedule/clock.mjs");
  const { arrivalInputs } = await import("../../src/worker/boss/agents/simoneOperations");
  const now = Date.now();
  const today = startOfDay(now);
  const yesterday = startOfDay(today - 1);
  const ins = env.DB.prepare(`INSERT INTO boss_sent_mail (id, message_id, sent_at, delivery_state, from_addr, to_addr, subject, object_key, thread_id, layout)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  await env.DB.batch([
    ins.bind("aaaaaaaa-1111-4222-8333-444455556666", "<y1@example.test>", yesterday + 3_600_000, "sent", "simone@sequoiataylor.com", "owner@example.test", "Yesterday", "k1", "t1", "digest"),
    ins.bind("bbbbbbbb-1111-4222-8333-444455556666", "<y2@example.test>", yesterday + 7_200_000, "failed", "simone@sequoiataylor.com", "owner@example.test", "Refused", "k2", "t2", "note"),
    ins.bind("cccccccc-1111-4222-8333-444455556666", "<t1@example.test>", today + 60_000, "sent", "simone@sequoiataylor.com", "owner@example.test", "Today", "k3", "t3", "note"),
  ]);
  const payload = JSON.stringify({ decide: [{ key: "reply:pnp:<r1@example.test>" }, { key: "lp:1" }], still_yours: [{ key: "reply:pnp:<r0@example.test>" }] });
  await env.DB.prepare("INSERT INTO morning_digests (day, payload, sent_at, created_at, updated_at) VALUES (?,?,?,?,?)")
    .bind(dayIdInZone(yesterday + 3_600_000), payload, yesterday + 3_600_000 + 30_000, yesterday + 3_500_000, yesterday + 3_600_000).run();
  const got = await arrivalInputs(env.DB, now);
  // Only what was recorded as sent yesterday: never a refused send, never today's.
  expect((got.sent as { message_id: string }[]).map((r) => r.message_id)).toEqual(["<y1@example.test>"]);
  const kept = got.mornings.find((m: { day: string }) => m.day === dayIdInZone(yesterday + 3_600_000))!;
  expect(kept.keys).toEqual(["reply:pnp:<r1@example.test>", "reply:pnp:<r0@example.test>"]);
  expect(kept.mail).toMatchObject({ id: "aaaaaaaa-1111-4222-8333-444455556666", layout: "digest", from_addr: "simone@sequoiataylor.com" });
  expect(JSON.stringify(got)).not.toContain("Yesterday");
});
