/**
 * THE MAC'S DOOR INTO SIMONE'S COMMANDS (behind the passcode, like every /api/boss route).
 *
 * scripts/ops/simone-commands.mjs ticks every ten minutes: it asks what is waiting (`POST /tick`),
 * does the parts only her Mac can do — her own Drive and Gmail for a lookup, a draft in her voice, a
 * bounce check in the sending mailbox — posts each answer back here, and sends the notices this side
 * laid out (the Worker can only answer HER mail; anything said later goes from the Mac).
 */
import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest } from "../lib/http";
import { macWork, cancelCommand, codeAnswered, lookupAnswered, draftReady, bounced, noticeSent, commandFailed, getCommand, errandSent, errandFollowedUp, errandRemindersDue, errandReminded, openMeetingPrep, prepFinished, prepMentions } from "./run";

export const commands = new Hono<{ Bindings: Env; Variables: Vars }>();

commands.post("/tick", async (c) => ok(c, await macWork(c.env)));

// Simone's meeting prep: one row per prep, so her reply in its thread finds it (meeting-prep.mjs).
commands.post("/meeting-prep", async (c) => {
  const b = await c.req.json<{ key?: string; spec?: Record<string, unknown>; asked?: boolean }>().catch(() => null);
  if (!b?.key || !b.spec) throw badRequest("key and spec are both required");
  return ok(c, { id: await openMeetingPrep(c.env, { key: b.key, spec: b.spec, asked: Boolean(b.asked) }) });
});
commands.get("/meeting-prep/mentions", async (c) => ok(c, { cards: await prepMentions(c.env, c.req.queries("q") ?? []) }));
commands.post("/:id/prep-done", async (c) => {
  const b = await c.req.json<{ message_id?: string }>().catch(() => ({} as { message_id?: string }));
  return ok(c, { recorded: await prepFinished(c.env, c.req.param("id"), { message_id: b?.message_id ?? null }) });
});

commands.get("/:id", async (c) => {
  const row = await getCommand(c.env, c.req.param("id"));
  if (!row) throw badRequest("no such command");
  return ok(c, { ...row, spec: JSON.parse(row.spec), result: JSON.parse(row.result) });
});

commands.post("/:id/lookup", async (c) => {
  const b = await c.req.json<{ candidates?: Array<{ email: string; name?: string; evidence?: string[] }> }>().catch(() => null);
  if (!b || !Array.isArray(b.candidates)) throw badRequest("candidates[] is required (an empty list means none were found)");
  await lookupAnswered(c.env, c.req.param("id"), b.candidates);
  return ok(c, { recorded: true });
});

commands.post("/:id/draft", async (c) => {
  const b = await c.req.json<{ subject?: string; text?: string }>().catch(() => null);
  if (!b?.subject || !b?.text) throw badRequest("subject and text are both required");
  await draftReady(c.env, c.req.param("id"), { subject: b.subject, text: b.text });
  return ok(c, { recorded: true });
});

commands.post("/:id/bounced", async (c) => {
  const b = await c.req.json<{ address?: string }>().catch(() => null);
  if (!b?.address) throw badRequest("address is required");
  await bounced(c.env, c.req.param("id"), b.address);
  return ok(c, { recorded: true });
});

commands.post("/:id/code", async (c) => {
  const b = await c.req.json<{ done?: boolean; already?: boolean; missing?: boolean; codes?: Array<Record<string, unknown>> }>().catch(() => null);
  if (!b || !Array.isArray(b.codes)) throw badRequest("codes[] is required (the rows of the signups view)");
  await codeAnswered(c.env, c.req.param("id"), { done: Boolean(b.done), already: b.already, missing: b.missing, codes: b.codes });
  return ok(c, { recorded: true });
});

// An errand went (her email was the approval): the provider's id and the exact words, then the watch.
commands.post("/:id/errand-sent", async (c) => {
  const b = await c.req.json<{ message_id?: string; subject?: string; text?: string; request?: string }>().catch(() => null);
  if (!b?.message_id || !b?.subject || !b?.text) throw badRequest("message_id, subject and text are all required");
  return ok(c, { recorded: await errandSent(c.env, c.req.param("id"), { message_id: b.message_id, subject: b.subject, text: b.text, request: b.request ?? null }) });
});

// Her answer or cancellation went to the business in their thread.
commands.post("/:id/errand-followed-up", async (c) => {
  const b = await c.req.json<{ message_id?: string }>().catch(() => null);
  if (!b?.message_id) throw badRequest("message_id is required");
  return ok(c, { recorded: await errandFollowedUp(c.env, c.req.param("id"), { message_id: b.message_id }) });
});

// "Do you still want to go?": the reminders due now (28 hours before each booking), and each one sent.
commands.post("/errand-reminders", async (c) => ok(c, { reminders: await errandRemindersDue(c.env) }));
commands.post("/:id/reminded", async (c) => ok(c, { recorded: await errandReminded(c.env, c.req.param("id")) }));

commands.post("/:id/cancel", async (c) => ok(c, { line: await cancelCommand(c.env, c.req.param("id")) }));

commands.post("/:id/noticed", async (c) => {
  await noticeSent(c.env, c.req.param("id"));
  return ok(c, { recorded: true });
});

commands.post("/:id/failed", async (c) => {
  const b = await c.req.json<{ why?: string }>().catch(() => null);
  await commandFailed(c.env, c.req.param("id"), String(b?.why ?? "the Mac run failed").slice(0, 300));
  return ok(c, { recorded: true });
});
