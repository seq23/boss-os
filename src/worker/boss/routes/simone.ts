import { dayIdInZone } from "../../../shared/boss/timezone";
import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { claimSimone, fileSimoneMessage, releaseSimone, replySimone, simoneMessageStatus, finishSimoneHandoff } from "../agents/simone";
import { AppError, badRequest, notFound, ok } from "../lib/http";
import { machineTokenOk } from "./openLoops";
import { simoneTool } from "../agents/simoneTools";

export const simone = new Hono<{ Bindings: Env; Variables: Vars }>();
export const SIMONE_MACHINE_PATHS: ReadonlySet<string> = new Set([
  "/api/simone/tool", "/api/simone/handoff", "/api/simone/claim", "/api/simone/release", "/api/simone/reply", "/api/simone/wake",
]);

export function readSimoneText(body: { text?: unknown } | null) {
  if (typeof body?.text !== "string" || !body.text.trim()) throw badRequest("Type a message for Simone first.");
  if (new TextEncoder().encode(body.text).length > 60_000) throw badRequest("This message is longer than Simone's message box can hold.");
  return body.text.trim();
}

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
  return ok(c, await simoneTool(c.env, b));
});

simone.post("/handoff", async (c) => {
  if (!(await machineTokenOk(c))) throw new AppError(401, "Locked");
  const b = await c.req.json<{ id: string; lease: number; assignments: unknown }>().catch(() => null);
  if (!b || typeof b.id !== "string" || !Number.isSafeInteger(b.lease)) throw badRequest("A Simone task and lease are required.");
  return ok(c, await finishSimoneHandoff(c.env, b));
});

simone.post("/wake", async (c) => {
  if (!(await machineTokenOk(c))) throw new AppError(401, "Locked");
  const day = dayIdInZone(Date.now());
  return ok(c, { taskId: await fileSimoneMessage(c.env, {
    source: "simone_daily", subject: "Simone’s daily work",
    body: "Read your handoff and check the team’s work. Move along something that is ready or stuck and keep a record of what you did.",
  }, day.replaceAll("-", "")) });
});
