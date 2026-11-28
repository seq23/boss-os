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
  await fileSimoneMessage(env, { source: "simone_daily", subject: "Operating check", body: "Read the results." });
  const call = (await claimSimone(env))!;
  await expect(simoneTool(env, { id: call.id, lease: call.lease, tool: "operations" }))
    .resolves.toMatchObject({ ok: true, total: 1, rows: body.rows, issues });
});
