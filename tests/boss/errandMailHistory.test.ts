import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, apiJson, insertTask } from "./helpers";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { commandFromMail, errandReplied, getCommand, macWork, openErrandFor, errandRemindersDue, errandFollowedUp } from "../../src/worker/boss/commands/run";
import { mailHistory, recordSentMail, replyWithHistory, stageSentMail } from "../../src/worker/boss/mail/history";
import { BOSS_INTAKE_MAILBOX } from "../../src/shared/boss/intake/mail.mjs";
import { readErrandReply, errandReplyNotice, ERRAND_SENDERS } from "../../src/shared/boss/commands/parse.mjs";
import { layoutEmail, plainProblems } from "../../src/shared/boss/mail/plain.mjs";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const VENUE = "reservations@lantern.example.test";
const CARD = "Your reservation is confirmed for 9pm. Credit Card required for The Lantern Room. This card is a guarantee and will only be charged for a no-show or cancellation within 24 hours. Use https://secure.sevenrooms.com/card/fake-token?test=1&guest=2 before it expires on October 28 at noon.";
async function seed(id = "cmd_mail1", over: Record<string, unknown> = {}) {
  await env.DB.prepare(`INSERT INTO boss_commands (id, kind, state, spec, result, created_at, updated_at) VALUES (?,'errand',?,?,?,?,?)`).bind(id, over.state ?? "sent", JSON.stringify({ to: VENUE, ask: "Book a table at The Lantern Room on Thursday, October 29", owner_name: "Alex Example", ...over.spec as object }), JSON.stringify({ request: "a table for two at The Lantern Room on Thursday, October 29", booking: { time: "9:00 pm", at: Date.parse("2026-10-30T01:00:00Z"), confirmed: false }, ...over.result as object }), NOW, Date.now()).run();
  return (await getCommand(env as never, id))!;
}
function incoming(from: string, text: string, subject = "The Lantern Room", html = false) {
  const raw = `From: ${from}\r\nSubject: ${subject}\r\nContent-Type: text/${html ? "html" : "plain"}; charset=utf-8\r\n\r\n${text}`;
  const headers = new Headers({ from, subject, "message-id": "<card1@platform.example.test>", "authentication-results": "mx.example.test; dmarc=pass" });
  return { raw, message: { from, to: BOSS_INTAKE_MAILBOX, headers, raw: new Response(raw).body!, rawSize: new TextEncoder().encode(raw).length } };
}
beforeEach(async () => {
  await env.DB.exec("DELETE FROM boss_sent_mail; DELETE FROM boss_inbound_mail; DELETE FROM boss_commands; DELETE FROM boss_mail_senders; DELETE FROM boss_mail_refs; DELETE FROM morning_digests;");
});

describe("booking platforms only join an identifiable errand", () => {
  it.each(["sevenrooms.com", "opentable.com", "resy.com", "exploretock.com", "tock.com", "tock.to"])("matches %s by venue in subject or owner in body", async (domain) => {
    await seed();
    expect((await openErrandFor(env as never, `booking@${domain}`, Date.now(), { subject: "The Lantern Room needs a card" }))?.id).toBe("cmd_mail1");
    expect((await openErrandFor(env as never, `booking@${domain}`, Date.now(), { text: "Dear Alex Example, please finish this booking." }))?.id).toBe("cmd_mail1");
    expect((await openErrandFor(env as never, `booking@${domain}`, Date.now(), { text: "Dear Alex, please finish this booking." }))?.id).toBe("cmd_mail1");
    expect(await openErrandFor(env as never, `booking@${domain}`, Date.now(), { text: "A different venue needs a card" })).toBeNull();
  });
  it("refuses lookalike domains, arbitrary senders, expired threads and ambiguous owner matches", async () => {
    await seed();
    expect(await openErrandFor(env as never, "booking@sevenrooms.com.evil.test", Date.now(), { text: CARD })).toBeNull();
    expect(await openErrandFor(env as never, "stranger@other.example.test", Date.now(), { text: CARD })).toBeNull();
    await seed("cmd_mail2", { spec: { to: "table@other.example.test" } });
    expect(await openErrandFor(env as never, "booking@sevenrooms.com", Date.now(), { text: "Dear Alex Example" })).toBeNull();
    await env.DB.prepare(`UPDATE boss_commands SET updated_at = ?`).bind(Date.now() - 22 * 86_400_000).run();
    expect(await openErrandFor(env as never, "booking@sevenrooms.com", Date.now(), { text: CARD })).toBeNull();
  });
});

it("archives the full raw errand email and quotes exact words, link and expiry in a working original-email page", async () => {
  await seed();
  const { raw, message } = incoming("booking@sevenrooms.com", CARD + "\n\nVenue signature.\n" + "Extra terms. ".repeat(800));
  const handled = await handleBossInboundMail(message as never, env as never);
  expect(handled).toMatchObject({ outcome: "ERRAND_REPLY", reply: null });
  const saved = await env.DB.prepare(`SELECT object_key, command_id FROM boss_inbound_mail WHERE id = ?`).bind(handled.mailId).first<any>();
  expect(saved.command_id).toBe("cmd_mail1");
  expect(await (await env.VAULT.get(saved.object_key))!.text()).toBe(raw);
  const row = (await getCommand(env as never, "cmd_mail1"))!;
  expect(row.state).toBe("needs_card");
  expect(JSON.parse(row.result).replies[0].text).toHaveLength(8000);
  expect(JSON.parse(row.result).replies[0].mail_id).toBe(handled.mailId);
  const notice = JSON.parse(row.notice!);
  expect(notice.details[1]).toBe(`What they said: ${CARD}\n\nVenue signature.\n${"Extra terms. ".repeat(800).trim()}`);
  expect(notice.details.join("\n")).toContain(`/?mail=${handled.mailId}`);
  expect(notice.decide[0].key).toBe("errand:cmd_mail1");
  expect(notice.decide[0].screen).toContain("?command=cmd_mail1");
  expect(notice.decide[0].buttons[0]).toEqual({ label: "Open their card link", url: "https://secure.sevenrooms.com/card/fake-token?test=1&guest=2" });
  expect(notice.details.join("\n")).not.toMatch(/write to them|They confirmed/i);
  const original = await api(`/api/mail/${handled.mailId}/original`);
  expect(original.status).toBe(200);
  expect(await original.text()).toBe(raw);
  expect(original.headers.get("content-type")).toContain("text/plain");
  const page = await apiJson(`/api/mail/${handled.mailId}`);
  expect(page.status).toBe(200);
  expect(page.body.data.received[0].body).toContain("Extra terms. ".repeat(799));
});

it("keeps HTML-only card URLs that used to disappear when tags were stripped", async () => {
  await seed();
  const { message } = incoming("booking@sevenrooms.com", '<p>The Lantern Room: Credit Card required. Only charged for a no-show.</p><a href="https://secure.sevenrooms.com/card/fake-token?x=1&amp;y=2">Give your card</a><p>Expires October 28 at noon.</p>', "Card required", true);
  await handleBossInboundMail(message as never, env as never);
  const row = (await getCommand(env as never, "cmd_mail1"))!;
  expect(row.state).toBe("needs_card");
  expect(JSON.parse(row.notice!).details.join("\n")).toContain("https://secure.sevenrooms.com/card/fake-token?x=1&y=2");
});

it.each([false, true])("a card never confirms a pending or previously confirmed booking (%s)", async (confirmed) => {
  const row = await seed("cmd_card", { result: { booking: { at: Date.parse("2026-10-30T01:00:00Z"), time: "9:00 pm", confirmed } } });
  await errandReplied(env as never, row, { from: VENUE, subject: "Credit Card required", text: CARD, dmarc: true });
  const after = (await getCommand(env as never, row.id))!;
  expect(after.state).toBe("needs_card");
  expect(JSON.parse(after.result).booking.confirmed).toBe(false);
  const [reminder] = await errandRemindersDue(env as never, Date.parse("2026-10-28T21:00:00Z"));
  expect(reminder!.notice.happened).toContain("NOT confirmed");
  expect(reminder!.notice.happened).not.toContain("They have confirmed it.");
});

it.each(["N: I'll handle it", "1: I'll handle it", "dismiss", "I'm handling it myself"])("%s stands down without contacting the venue", async (text) => {
  await seed("cmd_self", { state: "follow_up", result: { pending: { text: "A queued answer", purpose: "answer" }, decide_open: true } });
  await env.DB.prepare(`UPDATE boss_commands SET notice = '{}', notice_state = 'due' WHERE id = 'cmd_self'`).run();
  const answer = await commandFromMail(env as never, { mailId: "owner_reply", sender: "owner@example.test", subject: "Re: errand", text, refs: ["cmd_self"], now: NOW });
  expect(answer?.reply).toContain("Owner is handling this herself");
  expect((await getCommand(env as never, "cmd_self"))!.state).toBe("done");
  const work = await macWork(env as never);
  expect(work.errand_follow_ups).toEqual([]); expect(work.notices).toEqual([]); expect(work.errands).toEqual([]);
  expect(await errandRemindersDue(env as never, Date.parse("2026-10-28T21:00:00Z"))).toEqual([]);
  expect(await errandFollowedUp(env as never, "cmd_self", { message_id: "stale_ack" })).toBe(false);
  expect(await openErrandFor(env as never, VENUE)).toBeNull();
});

it("the session action stands down even a queued errand, with no venue mail", async () => {
  await seed("cmd_self", { state: "queued" });
  const r = await apiJson("/api/commands/cmd_self/handle-self", { method: "POST" });
  expect(r.status).toBe(200);
  expect((await getCommand(env as never, "cmd_self"))!.state).toBe("done");
  expect((await env.DB.prepare(`SELECT COUNT(*) n FROM boss_sent_mail`).first<any>())!.n).toBe(0);
});

it("received and sent mail group by thread, read full R2 bodies, filter before limiting, and reject unauthenticated access", async () => {
  await seed();
  const incomingMail = incoming(VENUE, CARD);
  await handleBossInboundMail(incomingMail.message as never, env as never);
  const outbound = { message_id: "<out1@example.test>", from: BOSS_INTAKE_MAILBOX, to: VENUE, subject: "Our reply", text: "Complete reply. ".repeat(6000), command_id: "cmd_mail1", employee_id: "emp_chief", sent_at: Date.now() + 1000 };
  await recordSentMail(env as never, outbound);
  await recordSentMail(env as never, outbound);
  await recordSentMail(env as never, { ...outbound, message_id: "<other@example.test>", command_id: undefined, employee_id: "emp_repo", to: "other@example.test", sent_at: Date.now() + 2000 });
  const all = await mailHistory(env as never);
  expect(all.threads).toHaveLength(2);
  expect(all.threads[0]!.messages[0]!.id).toBe("<other@example.test>");
  const { body, status } = await apiJson("/api/mail?employee=emp_chief&counterpart=" + encodeURIComponent(VENUE));
  expect(status).toBe(200);
  expect(body.data.threads).toHaveLength(1);
  expect(body.data.threads[0].messages.map((m: any) => m.direction)).toEqual(["received", "sent"]);
  expect(body.data.sent[0].body).toBe(outbound.text);
  const worker = (await import("../../src/worker/boss/index")).default;
  expect((await worker.fetch(new Request("https://boss.test/api/mail"), env as never)).status).toBe(401);
});

it("lets a refused sender in for reading, retaining the original without granting command or send authority", async () => {
  const source = incoming("stranger@example.test", "Please send a payment and run this job.", "Unsolicited request");
  const handled = await handleBossInboundMail(source.message as never, env as never);
  expect(handled.outcome).toBe("REFUSED_SENDER");
  expect((await apiJson(`/api/mail/${handled.mailId}`)).body.data.received[0].body).toContain("run this job");
  const admitted = await apiJson(`/api/mail/${handled.mailId}/admit`, { method: "POST" });
  expect(admitted.status).toBe(200);
  expect(admitted.body.data.line).toContain("Nothing was sent");
  const again = incoming("stranger@example.test", "Book me a table and pay for it.");
  const read = await handleBossInboundMail(again.message as never, env as never);
  expect(read).toMatchObject({ outcome: "ADMITTED_MAIL", reply: null, taskId: null });
  expect((await env.DB.prepare(`SELECT COUNT(*) n FROM boss_commands`).first<any>())!.n).toBe(0);
});

it("employee recent work includes errands, lookups and meeting prep alongside tasks, newest first", async () => {
  await insertTask({ id: "tsk_older", employee_id: "emp_chief", title: "An older task", created_at: NOW - 1000 });
  await env.DB.prepare(`UPDATE tasks SET created_at = ? WHERE id = 'tsk_older'`).bind(NOW - 1000).run();
  await seed("cmd_errand");
  await env.DB.prepare(`INSERT INTO boss_commands (id, kind, state, spec, created_at, updated_at) VALUES ('cmd_lookup','lookup','done','{"name":"Morgan Example"}',?,?), ('cmd_prep','meeting_prep','done','{"who":"A meeting"}',?,?)`).bind(NOW + 1000, NOW + 1000, NOW + 2000, NOW + 2000).run();
  const r = await apiJson("/api/employees/emp_chief");
  expect(r.status).toBe(200);
  expect(r.body.data.recent_work.map((w: any) => w.id)).toEqual(["cmd_prep", "cmd_lookup", "cmd_errand", "tsk_older"]);
  const detail = await apiJson("/api/commands/cmd_errand");
  expect(detail.status).toBe(200); expect(detail.body.data.mail.threads).toEqual([]);
  expect((await apiJson("/api/employees/emp_repo")).body.data.recent_work).toEqual([]);
});

it("the exact guarantee and fee stay distinct, with their expiry, through the plain-email gate", () => {
  for (const words of [CARD, "A credit card deposit of $40 is charged now. Use https://pay.example.test/fake before October 28."]) {
    const read = readErrandReply(words, VENUE);
    const n = errandReplyNotice({ to: VENUE, asked: "A table", read, kind: read.kind, confirmed: false, decideOpen: false });
    expect(n.details[1]).toBe(`What they said: ${words}`);
    expect(n.details[2]).toContain(words === CARD ? "no-show or cancellation guarantee" : "pay a fee or deposit now");
    expect(plainProblems(layoutEmail({ who: "Simone", ...n, decide: n.decide as never }))).toEqual([]);
    expect(n.decide[0]!.buttons[0].label).toBe("Open their card link");
  }
});

it("a card request in the subject overrides confirmation words in the body", async () => {
  const row = await seed();
  await errandReplied(env as never, row, { from: VENUE, subject: "Credit Card required", text: "You are confirmed for 9pm. Finish here: https://pay.example.test/fake", dmarc: true });
  expect((await getCommand(env as never, row.id))!.state).toBe("needs_card");
});

it("older errands still show their kept outgoing and incoming copies with no invented original", async () => {
  await seed("cmd_older", { result: { text: "The original outgoing request", message_id: "old-out", sent_at: NOW, replies: [{ from: VENUE, subject: "Our answer", text: "The old answer in full", at: NOW + 1, message_id: "old-in" }] } });
  const detail = await apiJson("/api/commands/cmd_older");
  expect(detail.body.data.mail.threads[0].messages.map((m: any) => m.body)).toEqual(["The original outgoing request", "The old answer in full"]);
  expect(detail.body.data.mail.threads[0].messages.every((m: any) => m.original_url === null)).toBe(true);
});

it("the Worker reply archives its exact outgoing body; a refused transport is never listed as sent", async () => {
  const words = { message_id: "<worker-reply@example.test>", from: BOSS_INTAKE_MAILBOX, to: "owner@example.test", subject: "Your answer", text: "The exact answer", html: "<p>The exact answer</p>" };
  let calls = 0;
  await replyWithHistory({ reply: async (payload) => { calls++; expect(payload.text).toBe(words.text); } }, env as never, words);
  expect(calls).toBe(1);
  expect((await mailHistory(env as never)).sent[0]!.body).toBe(words.text);
  await expect(replyWithHistory({ reply: async () => { throw new Error("fixture transport refused"); } }, env as never, { ...words, message_id: "<failed@example.test>" })).rejects.toThrow("fixture transport refused");
  expect((await mailHistory(env as never)).sent).toHaveLength(1);
  expect((await env.DB.prepare(`SELECT delivery_state FROM boss_sent_mail WHERE delivery_state = 'failed'`).first<any>()).delivery_state).toBe("failed");
});
it("a staged Worker send keeps its body before any transport call and is not claimed as sent", async () => {
  await stageSentMail(env as never, { from: BOSS_INTAKE_MAILBOX, to: "owner@example.test", subject: "A staged letter", text: "Complete letter" });
  const row = await env.DB.prepare(`SELECT object_key, delivery_state FROM boss_sent_mail`).first<any>();
  expect(row.delivery_state).toBe("pending");
  expect(JSON.parse(await (await env.VAULT.get(row.object_key))!.text()).text).toBe("Complete letter");
  expect((await mailHistory(env as never)).sent).toEqual([]);
});

it("a multipart platform email keeps a card link present only in the HTML alternative", async () => {
  await seed();
  const from = "booking@sevenrooms.com";
  const source = incoming(from, "");
  const raw = `From: ${from}\r\nContent-Type: multipart/alternative; boundary="fake"\r\n\r\n--fake\r\nContent-Type: text/plain\r\n\r\nThe Lantern Room: Credit Card required. Expires tomorrow.\r\n--fake\r\nContent-Type: text/html\r\n\r\n<p>The Lantern Room: Credit Card required. Expires tomorrow.</p><a href="https://secure.sevenrooms.com/fake">Give your card</a>\r\n--fake--`;
  source.message.raw = new Response(raw).body!; source.message.rawSize = raw.length;
  await handleBossInboundMail(source.message as never, env as never);
  const row = (await getCommand(env as never, "cmd_mail1"))!;
  expect(JSON.parse(row.notice!).decide[0].buttons[0].url).toBe("https://secure.sevenrooms.com/fake");
});

it("reads a formerly misconfirmed card row honestly without rewriting the stored errand", async () => {
  await seed("cmd_old_card", { state: "booked", result: { booking: { at: Date.parse("2026-10-30T01:00:00Z"), time: "9:00 pm", confirmed: true }, replies: [{ at: NOW, text: CARD, kind: "card" }] } });
  const detail = await apiJson("/api/commands/cmd_old_card");
  expect(detail.body.data.state).toBe("needs_card");
  expect(detail.body.data.result.booking.confirmed).toBe(false);
  const original = (await getCommand(env as never, "cmd_old_card"))!;
  expect(original.state).toBe("booked"); expect(JSON.parse(original.result).booking.confirmed).toBe(true);
  const [due] = await errandRemindersDue(env as never, Date.parse("2026-10-28T21:00:00Z"));
  expect(due!.notice.happened).toContain("NOT confirmed");
});

it("a named venue wins over the shared owner name when she has two live errands", async () => {
  await seed("cmd_lantern");
  await seed("cmd_other", { spec: { to: "booking@other.example.test" }, result: { request: "a table at The Other Room on Thursday, October 29" } });
  expect((await openErrandFor(env as never, "booking@sevenrooms.com", Date.now(), { text: "Dear Alex Example, The Lantern Room needs your card." }))?.id).toBe("cmd_lantern");
  expect(await openErrandFor(env as never, "booking@sevenrooms.com", Date.now(), { text: "Dear Alex Example, please add your card." })).toBeNull();
});

it.each([true, false])("a numbered morning reply stands down its errand through the real intake (keyed: %s)", async (keyed) => {
  await seed("cmd_target");
  if (keyed) await seed("cmd_newer", { spec: { to: "other@example.test" } });
  const card = { ...(keyed ? { key: "errand:cmd_target" } : {}), title: `${VENUE} wants a card or deposit to hold your request` };
  const now = Date.now();
  await env.DB.prepare(`INSERT OR REPLACE INTO morning_digests (day, payload, sent_at, created_at, updated_at) VALUES ('2026-10-27',?,?,?,?)`).bind(JSON.stringify({ decide: [{ title: "A different decision" }, card] }), now, now, now).run();
  await env.DB.prepare(`INSERT INTO boss_mail_refs (message_id, refs, created_at) VALUES ('<morning-fixture@example.test>','yd_20261027',?)`).bind(now).run();
  const { message } = incoming(ERRAND_SENDERS[0]!, "2: I'll handle it", "Re: Tuesday: your morning");
  message.headers.set("references", "<morning-fixture@example.test>"); message.headers.set("in-reply-to", "<morning-fixture@example.test>");
  const reply = await handleBossInboundMail(message as never, env as never);
  expect(reply.outcome).toBe("DECIDE_ANSWERED");
  expect((await getCommand(env as never, "cmd_target"))!.state).toBe("done");
  if (keyed) expect((await getCommand(env as never, "cmd_newer"))!.state).toBe("sent");
  expect((await macWork(env as never)).errand_follow_ups).toEqual([]);
  const morning = await env.DB.prepare(`SELECT payload FROM morning_digests WHERE day = '2026-10-27'`).first<any>();
  expect(JSON.parse(morning.payload).decide[1].answered_at).toBeTruthy();
  expect((await env.DB.prepare(`SELECT COUNT(*) n FROM boss_sent_mail`).first<any>()).n).toBe(0);
});

it("a shared fallback sender is still filtered under the employee whose Reply-To it uses", async () => {
  await recordSentMail(env as never, { message_id: "<fallback@example.test>", from: "relay@example.test", employee_address: "simone@example.test", to: VENUE, subject: "Your update", text: "From your assistant" });
  const history = await mailHistory(env as never, { employee: "emp_chief" });
  expect(history.sent).toHaveLength(1);
  expect(history.sent[0]!.from_addr).toBe("relay@example.test");
});
