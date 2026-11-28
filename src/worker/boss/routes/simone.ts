import { dayIdInZone } from "../../../shared/boss/timezone";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Env, Vars } from "../env";
import { claimSimone, fileSimoneMessage, releaseSimone, replySimone, simoneMessageStatus, finishSimoneHandoff } from "../agents/simone";
import { AppError, badRequest, notFound, ok } from "../lib/http";
import { machineTokenOk } from "./openLoops";
import { connectSimoneGoogle, disconnectSimoneGoogle, simoneAccountGate, simoneAccounts, startSimoneGoogle, switchSimoneAccount } from "../agents/simoneAccounts";
import { simoneTool } from "../agents/simoneTools";
import { operatingStopped, setOperatingStop } from "../lib/operatingStop";
import { operatingInputs, operatingReport, storeOperatingReport } from "../agents/simoneOperations";
import { containsCredential } from "../../../shared/boss/service/secretLines.mjs";

export const simone = new Hono<{ Bindings: Env; Variables: Vars }>();
export const SIMONE_MACHINE_PATHS: ReadonlySet<string> = new Set([
  "/api/simone/operations/inputs", "/api/simone/operations/report",
  "/api/simone/tool", "/api/simone/handoff", "/api/simone/claim", "/api/simone/release", "/api/simone/reply", "/api/simone/wake",
]);

export function readSimoneText(body: { text?: unknown } | null) {
  if (typeof body?.text !== "string" || !body.text.trim()) throw badRequest("Type a message for Simone first.");
  if (new TextEncoder().encode(body.text).length > 60_000) throw badRequest("This message is longer than Simone's message box can hold.");
  return body.text.trim();
}

simone.get("/accounts", async (c) => {
  c.header("Cache-Control", "no-store");
  return ok(c, { accounts: await simoneAccounts(c.env) });
});

simone.post("/accounts/connect", async (c) => {
  c.header("Cache-Control", "no-store");
  return ok(c, { url: await startSimoneGoogle(c.env, c.get("session").id) });
});

simone.get("/accounts/callback", async (c) => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  const employee = "/?employee=emp_chief&google=";
  try {
    await connectSimoneGoogle(c.env, c.get("session").id, c.req.query("state") ?? "", c.req.query("code") ?? "");
    return c.redirect(employee + "connected");
  } catch {
    return c.redirect(employee + "error");
  }
});

simone.post("/accounts/switch", async (c) => {
  const body = await c.req.json<{ address?: unknown; enabled?: unknown }>().catch(() => null);
  if (typeof body?.enabled !== "boolean") throw badRequest("Choose on or off.");
  await switchSimoneAccount(c.env, body.address, body.enabled);
  return ok(c, { accounts: await simoneAccounts(c.env) });
});

simone.post("/accounts/disconnect", async (c) => {
  const body = await c.req.json<{ address?: unknown }>().catch(() => null);
  await disconnectSimoneGoogle(c.env, body?.address);
  return ok(c, { accounts: await simoneAccounts(c.env) });
});

simone.get("/stop", async (c) => ok(c, { stopped: await operatingStopped(c.env.DB) }));

simone.post("/stop", async (c) => {
  const body = await c.req.json<{ stopped?: unknown }>().catch(() => null);
  if (typeof body?.stopped !== "boolean") throw badRequest("Choose stop or resume.");
  return ok(c, { stopped: await setOperatingStop(c.env.DB, body.stopped, Date.now()) });
});

simone.post("/message", async (c) => {
  const body = readSimoneText(await c.req.json<{ text?: string }>().catch(() => null));
  return ok(c, { taskId: await fileSimoneMessage(c.env, { source: "boss_page", subject: "Message to Simone", body }) }, 201);
});

simone.get("/message/:id", async (c) => {
  const result = await simoneMessageStatus(c.env, c.req.param("id"));
  if (!result) throw notFound("No Simone message with that id.");
  return ok(c, result);
});

simone.post("/claim", async (c) => {
  if (!(await machineTokenOk(c))) throw new AppError(401, "Locked");
  return ok(c, { call: await claimSimone(c.env) });
});

simone.post("/release", async (c) => {
  if (!(await machineTokenOk(c))) throw new AppError(401, "Locked");
  const b = await c.req.json<{ id: string; lease: number; code: string }>().catch(() => null);
  if (!b || typeof b.id !== "string" || !Number.isSafeInteger(b.lease) || !/^[A-Z0-9_]{1,50}$/.test(b.code)) throw badRequest("A task, lease and stop code are required.");
  return ok(c, { released: await releaseSimone(c.env, b.id, b.lease, b.code) });
});

simone.post("/reply", async (c) => {
  if (!(await machineTokenOk(c))) throw new AppError(401, "Locked");
  const b = await c.req.json<{ id: string; lease: number; text: string; work: string[]; assignments?: unknown; stop?: "ACTION_RESTRICTED" }>().catch(() => null);
  if (!b || typeof b.id !== "string" || !Number.isSafeInteger(b.lease) || typeof b.text !== "string" ||
      b.text.length > 20_000 || !Array.isArray(b.work) || b.work.length > 100 ||
      (b.stop !== undefined && (b.stop !== "ACTION_RESTRICTED" || b.assignments !== undefined)) ||
      b.work.some((item) => typeof item !== "string" || item.length > 200)) throw badRequest("A task, lease, reply and work receipts are required.");
  return ok(c, b.assignments === undefined
    ? { replied: await replySimone(c.env, b) }
    : await finishSimoneHandoff(c.env, { ...b, assignments: b.assignments }));
});

simone.post("/tool", async (c) => {
  if (!(await machineTokenOk(c))) throw new AppError(401, "Locked");
  const b = await c.req.json<{ id: string; lease: number; tool: string; task?: unknown }>().catch(() => null);
  if (!b || typeof b.id !== "string" || !Number.isSafeInteger(b.lease) || typeof b.tool !== "string" || b.tool.length > 60) {
    throw badRequest("A Simone task, lease and tool are required.");
  }
  const result = await simoneTool(c.env, b);
  if (containsCredential(JSON.stringify(result), c.env)) return ok(c, { ok: false, code: "SECRET_OUTPUT" });
  if (result.ok && await operatingStopped(c.env.DB)) return ok(c, { ok: false, code: "OWNER_STOPPED_OPERATIONS" });
  return ok(c, result);
});

simone.post("/handoff", async (c) => {
  if (!(await machineTokenOk(c))) throw new AppError(401, "Locked");
  const b = await c.req.json<{ id: string; lease: number; assignments: unknown }>().catch(() => null);
  if (!b || typeof b.id !== "string" || !Number.isSafeInteger(b.lease)) throw badRequest("A Simone task and lease are required.");
  return ok(c, await finishSimoneHandoff(c.env, b));
});

simone.get("/operations", async (c) => {
  const report = await operatingReport(c.env.DB);
  if (!report) throw new AppError(503, "Couldn't check: Simone has no operating inventory for today.");
  return ok(c, report);
});

simone.get("/operations/inputs", async (c) => {
  if (!(await machineTokenOk(c))) throw new AppError(401, "Locked");
  const address = c.req.query("google_account");
  const inputs = await operatingInputs(c.env.DB, Date.now(), address === undefined);
  if (address !== undefined) {
    return ok(c, { ...inputs, googleEnabled: Boolean(await simoneAccountGate(c.env, address.toLowerCase(), "mail")) });
  }
  return ok(c, inputs);
});

simone.post("/operations/report",
  async (c, next) => {
    if (!(await machineTokenOk(c))) throw new AppError(401, "Locked");
    await next();
  },
  bodyLimit({ maxSize: 850_000, onError: () => { throw new AppError(413, "The operating report is too large."); } }),
  async (c) => ok(c, await storeOperatingReport(c.env, await c.req.json<unknown>().catch(() => null))),
);

simone.post("/wake", async (c) => {
  if (!(await machineTokenOk(c))) throw new AppError(401, "Locked");
  if (await operatingStopped(c.env.DB)) return ok(c, { stopped: true });
  const day = dayIdInZone(Date.now());
  return ok(c, { taskId: await fileSimoneMessage(c.env, {
    source: "simone_daily", subject: "Simone’s daily work",
    body: "Read the operating inventory and its receiving-end evidence. Inspect the misses you can address with your existing tools, act where you have authority, and record what changed. Keep any unreadable or unproven result open.",
  }, day.replaceAll("-", "")) });
});
