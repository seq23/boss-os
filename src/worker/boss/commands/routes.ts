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
import { mailHistory } from "../mail/history";
import { ok, badRequest } from "../lib/http";
import { macWork, cancelCommand, errandTap, handleErrandSelf, codeAnswered, lookupAnswered, draftReady, bounced, noticeSent, commandFailed, getCommand, errandSent, errandFollowedUp, errandRemindersDue, errandReminded, openMeetingPrep, prepFinished, prepMentions, personalPreps } from "./run";

export const commands = new Hono<{ Bindings: Env; Variables: Vars }>();

commands.post("/tick", async (c) => ok(c, await macWork(c.env)));

// Simone's meeting prep: one row per prep, so her reply in its thread finds it (meeting-prep.mjs).
commands.post("/meeting-prep", async (c) => {
  const b = await c.req.json<{ key?: string; spec?: Record<string, unknown>; asked?: boolean }>().catch(() => null);
  if (!b?.key || !b.spec) throw badRequest("key and spec are both required");
  return ok(c, { id: await openMeetingPrep(c.env, { key: b.key, spec: b.spec, asked: Boolean(b.asked) }) });
});
commands.get("/meeting-prep/mentions", async (c) => ok(c, { cards: await prepMentions(c.env, c.req.queries("q") ?? []) }));
commands.get("/meeting-prep/personal", async (c) => ok(c, await personalPreps(c.env)));
commands.post("/:id/prep-done", async (c) => {
  const b = await c.req.json<{ message_id?: string }>().catch(() => ({} as { message_id?: string }));
  return ok(c, { recorded: await prepFinished(c.env, c.req.param("id"), { message_id: b?.message_id ?? null }) });
});

commands.get("/:id", async (c) => {
  const row = await getCommand(c.env, c.req.param("id"));
  if (!row) throw badRequest("no such command");
  const spec = JSON.parse(row.spec); const result = JSON.parse(row.result);
  // Older rows may carry the former card-as-confirmation bug. Tell the truth on read, without
  // rewriting any production errand: a later genuine confirmation replaces the card reply.
  const cardPending = result.replies?.at(-1)?.kind === "card" || result.offer?.needs?.some((n: string) => /card/.test(n));
  const state = cardPending && ["sent", "replied", "booked"].includes(row.state) ? "needs_card" : row.state;
  if (cardPending && result.booking) result.booking = { ...result.booking, confirmed: false };
  const history = await mailHistory(c.env, { command: row.id });
  // Older errands predate the mail ledger. Show the copies kept with the errand, labelled as
  // such, rather than presenting their existing correspondence as an empty thread.
  const known = new Set(history.threads.flatMap((t) => t.messages.flatMap((m) => [m.id, m.message_id])));
  const legacy = [];
  if (row.kind === "errand") {
    if (result.text && !known.has(result.message_id)) legacy.push({ id: result.message_id ?? `${row.id}:sent`, direction: "sent", at: result.sent_at ?? row.created_at, from_addr: "Simone", to_addr: spec.to, subject: result.subject ?? "Your request", body: result.text });
    for (const r of result.replies ?? []) if (!known.has(r.mail_id ?? r.message_id)) legacy.push({ id: r.mail_id ?? r.message_id ?? `${row.id}:${r.at}`, direction: "received", at: r.at, from_addr: r.from, to_addr: "Simone", subject: r.subject, body: r.text });
    for (const f of result.follow_ups ?? []) if (f.text && !known.has(f.message_id)) legacy.push({ id: f.message_id, direction: "sent", at: f.sent_at, from_addr: "Simone", to_addr: spec.to, subject: f.subject, body: f.text });
  }
  const copies = legacy.map((m) => ({ ...m, message_id: m.id, employee_id: "emp_chief", object_key: null, thread_id: row.id, command_id: row.id, outcome: null, original_url: null }));
  if (copies.length) history.threads.push({ id: `${row.id}:older-copies`, at: Math.max(...copies.map((m) => m.at)), messages: copies.sort((a, b) => a.at - b.at) });
  history.threads.sort((a, b) => b.at - a.at);
  return ok(c, { ...row, state, spec, result, mail: history });
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

commands.post("/:id/handle-self", async (c) => ok(c, { line: await handleErrandSelf(c.env, c.req.param("id")) }));
commands.post("/:id/answer", async (c) => {
  const b = await c.req.json<{ words?: string; action?: string }>();
  const row = await getCommand(c.env, c.req.param("id"));
  if (!row || row.kind !== "errand") throw badRequest("No such errand.");
  if (b.action && !["keep", "cancel", "answer"].includes(b.action)) throw badRequest("Choose keep, cancel or answer.");
  return ok(c, { line: await errandTap(c.env, row, b.action as "keep" | "cancel" | "answer" || "answer", String(b.words ?? "").slice(0, 2000)) });
});
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
