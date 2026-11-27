/**
 * SIMONE RUNS HER ERRANDS BY EMAIL (owner, 26 Oct 2026), end to end through the real intake: her
 * email → an `errand` command queued with no Send tap → the Mac's tick sends it → the business's
 * answer at simone@ is read for her (never run, never answered) → a plain notice and a morning line.
 * And classify's one OUTBOUND carve-out. Each proven negatively: a stranger, a guessed address and
 * money keep the old path. Fixtures only (example.test).
 */
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { claimSimone, replySimone } from "../../src/worker/boss/agents/simone";
import { simoneTool } from "../../src/worker/boss/agents/simoneTools";
import { macWork, errandSent } from "../../src/worker/boss/commands/run";
import { setCommandFetch } from "../../src/worker/boss/commands/google";
import { classify } from "../../src/worker/boss/intake/classify";
import { recordSentMail } from "../../src/worker/boss/mail/history";
import { ERRAND_SENDERS } from "../../src/shared/boss/commands/parse.mjs";
import { layoutEmail, plainProblems } from "../../src/shared/boss/mail/plain.mjs";

const HER = ERRAND_SENDERS[0]!;
const BIZ = "reservations@club.example.test";
const NOW = Date.parse("2026-10-26T15:00:00Z");
const REQUEST = "a table for two on Thursday, October 29 after 8:00 pm";
const REQUEST_MESSAGE_ID = "<request-1@example.test>";
const CONFIRMATION = "You're all set for two at 8:30pm Thursday. See you then.";

function mail(o: { from: string; body: string; subject?: string; to?: string; dmarc?: string; inReplyTo?: string; references?: string }) {
  const headers = new Headers({
    from: o.from, subject: o.subject ?? "",
    "authentication-results": o.dmarc ?? "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass",
    "message-id": `<${Math.random().toString(36).slice(2)}@mail.example.test>`,
  });
  if (o.inReplyTo) headers.set("in-reply-to", o.inReplyTo);
  if (o.references) headers.set("references", o.references);
  const raw = `From: ${o.from}\r\nSubject: ${o.subject ?? ""}\r\nContent-Type: text/plain\r\n\r\n${o.body}`;
  return { from: o.from.replace(/.*<|>.*/g, ""), to: o.to ?? "simone@sequoiataylor.com", headers, raw: new Response(raw).body!, rawSize: new TextEncoder().encode(raw).length };
}
const say = (o: Parameters<typeof mail>[0]) => handleBossInboundMail(mail(o) as never, env as never);
const errands = async () => ((await env.DB.prepare(`SELECT * FROM boss_commands WHERE kind = 'errand' ORDER BY created_at`).all<any>()).results ?? []);
let gmail: string[] = [];
const REAL_NOW = Date.now;
beforeEach(async () => {
  gmail = [];
  setCommandFetch((async (u: string) => { gmail.push(String(u)); return new Response("no", { status: 500 }); }) as unknown as typeof fetch);
  Date.now = (() => { let t = NOW; return () => (t += 1000); })();
  await env.DB.exec("DELETE FROM boss_commands");
  await env.DB.exec("DELETE FROM boss_inbound_mail");
});
afterEach(() => { setCommandFetch(null); Date.now = REAL_NOW; });

async function queueErrand() {
  const quote = `Book me a table for two on Thursday after 8pm: ${BIZ}`;
  const res = await say({ from: `Sequoia <${HER}>`, subject: "Dinner", body: quote });
  expect(res).toMatchObject({ outcome: "SIMONE_QUEUED", reply: null });
  const call = (await claimSimone(env))!;
  expect(call.id).toBe(res.taskId);
  const queued = await simoneTool(env, { ...call, tool: "queue_errand", task: JSON.stringify({
    quote, subject: "Reservation request", request: REQUEST,
  }) });
  expect(queued).toMatchObject({ ok: true, receipt: expect.stringMatching(/^cmd_[a-f0-9]+$/), state: "queued", venue: BIZ });
  const answer = "I queued your reservation request. I’ll confirm once the venue answers.";
  expect(await replySimone(env, { ...call, text: answer, work: ["queue_errand"] })).toBe(true);
  const notice = await env.DB.prepare(`SELECT body FROM boss_task_notices WHERE task_id = ? AND kind = 'simone_result'`)
    .bind(call.id).first<{ body: string }>();
  expect(notice?.body).toBe(answer);
  return res;
}

async function sentErrand(messageId: string | null = REQUEST_MESSAGE_ID) {
  const res = await queueErrand();
  const row = (await errands()).find((entry) => entry.mail_id === res.mailId);
  const providerId = `em_${row.id}`;
  await recordSentMail(env, {
    provider_id: providerId, message_id: messageId ?? providerId, command_id: row.id,
    from: "simone@example.test", to: BIZ, subject: "Reservation request", text: "Hello",
  });
  await errandSent(env, row.id, { message_id: providerId, subject: "Reservation request", text: "Hello", request: REQUEST });
  return { res, id: row.id as string };
}

describe("her errand by email", () => {
  it("is queued for the Mac with no Send tap, and she is told it is going", async () => {
    await queueErrand();
    const rows = await errands();
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("queued");
    expect(rows[0].tap_token).toBeNull();
    const work = await macWork(env as never);
    expect(work.errands.map((e: any) => e.spec.to)).toEqual([BIZ]);
    // The Worker never sends it itself.
    expect(gmail.filter((u) => u.includes("/messages/send"))).toHaveLength(0);
  });

  it("NEGATIVE: the same words from a stranger make no errand", async () => {
    const res = await say({ from: "Someone <someone@example.test>", body: `Book me a table for two on Thursday after 8pm: ${BIZ}` });
    expect(res.outcome).toBe("REFUSED_SENDER");
    expect(await errands()).toHaveLength(0);
  });

  it("NEGATIVE: the agent refuses an errand that asks for a deposit and creates no draft", async () => {
    const quote = `Book me a table for two and pay the deposit: ${BIZ}`;
    await say({ from: `Sequoia <${HER}>`, body: quote });
    const call = (await claimSimone(env))!;
    expect(await simoneTool(env, { ...call, tool: "queue_errand", task: JSON.stringify({
      quote, subject: "Reservation request", request: "a table for two on Thursday",
    }) })).toEqual({ ok: false, code: "ERRAND_NOT_AUTHORIZED" });
    expect(await errands()).toHaveLength(0);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM boss_commands").first()).toEqual({ n: 0 });
  });

  it("their answer is read for her, never answered: a card request becomes hers, in plain words", async () => {
    const { id } = await sentErrand();
    const res = await say({ from: `Host <host@club.example.test>`, subject: "Re: Reservation request", inReplyTo: REQUEST_MESSAGE_ID, body: "We can hold a table at 8:30. We will need a credit card to secure the booking." });
    expect(res.outcome).toBe("ERRAND_REPLY");
    expect(res.reply).toBeNull();
    const row = await env.DB.prepare(`SELECT * FROM boss_commands WHERE id = ?`).bind(id).first<any>();
    expect(row.state).toBe("needs_card");
    expect(JSON.parse(row.result).booking?.confirmed ?? false).toBe(false);
    expect(row.notice_state).toBe("due");
    const notice = JSON.parse(row.notice);
    expect(notice.subject).toBe("Your request needs you: they want a card");
    expect(notice.details[0]).toBe(`What I asked for: ${REQUEST}`);
    expect(notice.details[1]).toMatch(/^What they said: We can hold a table at 8:30/);
    expect(notice.details[2]).toMatch(/^What you need to do: .*Only you can give that/);
    expect(notice.morning.decide.buttons[0].url).toBe(`mailto:${BIZ}`);
    // The same card is the email's own Decide item, never only the morning copy (26 Oct 2026 held
    // mail: "needs a look" beside "nothing needed" because this list stayed empty).
    expect(notice.decide).toEqual([notice.morning.decide]);
    const laid = layoutEmail({ who: "Simone", subject: notice.subject, happened: notice.happened, details: notice.details ?? [], decide: notice.decide, refs: [id] });
    expect(plainProblems(laid)).toEqual([]);
    expect(laid.text.split("\n")[2]).toBe("Decide (1)");
    const inbound = await env.DB.prepare(`SELECT outcome, reply_state FROM boss_inbound_mail ORDER BY received_at DESC LIMIT 1`).first<any>();
    expect(inbound).toEqual({ outcome: "ERRAND_REPLY", reply_state: "none_due" });
  });

  it("a confirmation is a morning line that needs nothing", async () => {
    const { id } = await sentErrand();
    await say({ from: BIZ, subject: "Re: Reservation request", inReplyTo: REQUEST_MESSAGE_ID, body: CONFIRMATION });
    const row = (await env.DB.prepare(`SELECT state, result, notice FROM boss_commands WHERE id = ?`).bind(id)
      .first<{ state: string; result: string; notice: string }>())!;
    expect(row.state).toBe("booked");
    expect(JSON.parse(row.result).booking).toMatchObject({ confirmed: true, at: expect.any(Number) });
    const notice = JSON.parse(row.notice);
    expect(notice.subject).toBe("Your request is booked");
    expect(notice.morning.line).toContain("it's booked");
  });

  it("uses an archived venue confirmation to request a free reservation without an address in the new mail", async () => {
    const previous = await sentErrand();
    await say({ from: BIZ, subject: "Re: Reservation request", inReplyTo: REQUEST_MESSAGE_ID, body: CONFIRMATION });
    const quote = "Find me three venues for Saturday and book the cheapest free one.";
    const incoming = await say({ from: HER, subject: "Saturday", body: quote });
    const call = (await claimSimone(env))!;
    expect(call.id).toBe(incoming.taskId);

    // Select the fixture venue by its archived booking receipt.
    const tools = { id: call.id, lease: call.lease };
    const channels = await simoneTool(env, { ...tools, tool: "booking_channels" });
    expect(channels).toEqual({ ok: true, rows: [{ id: previous.id, recipient: BIZ, subject: "Reservation request", request: REQUEST }] });
    const args = { quote, previous_booking: previous.id, at: "2026-10-31T20:00:00-04:00", party: 2 };
    const request = { ...tools, tool: "queue_errand", task: JSON.stringify(args) };
    const [first, second] = await Promise.all([simoneTool(env, request), simoneTool(env, request)]);
    expect(first).toMatchObject({ ok: true, state: "queued", venue: BIZ });
    expect(second).toEqual(first);
    const work = (await macWork(env)).errands;
    expect(work).toHaveLength(1);
    expect(work[0]?.spec).toMatchObject({ to: BIZ, free_only: true, previous_booking: previous.id,
      request: "a reservation for 2 people on Saturday, October 31 at 8:00 pm Eastern time" });
    const receipt = work[0]!.id;
    expect(await env.DB.prepare(`SELECT count(*) AS n FROM audit_log WHERE entity_id = ? AND action = 'errand_approved_by_her_email'`)
      .bind(receipt).first()).toEqual({ n: 1 });
    const text = "I queued a request for the free Saturday slot. I’ll confirm once the venue answers.";
    expect(await replySimone(env, { ...tools, text, work: ["booking_channels", "queue_errand"] })).toBe(true);
    expect(await env.DB.prepare(`SELECT body FROM boss_task_notices WHERE task_id = ? AND kind = 'simone_result'`)
      .bind(call.id).first()).toEqual({ body: text });
    expect((await errands()).map(({ state }) => state)).toEqual(["booked", "queued"]);
    expect(gmail.filter((url) => url.includes("/messages/send"))).toEqual([]);
  });

  it("refuses a model-provided recipient and a same-domain substitute for the archived recipient", async () => {
    const previous = await sentErrand();
    await say({ from: "host@club.example.test", subject: "Re: Reservation request", inReplyTo: REQUEST_MESSAGE_ID, body: CONFIRMATION });
    const quote = "Reserve a free table for Saturday.";
    await say({ from: HER, subject: "Saturday", body: quote });
    const call = (await claimSimone(env))!;
    const tools = { id: call.id, lease: call.lease };
    const args = { quote, previous_booking: previous.id, at: "2026-10-31T20:00:00-04:00", party: 2 };
    const queue = (values: Record<string, unknown>) => simoneTool(env, { ...tools, tool: "queue_errand", task: JSON.stringify(values) });

    expect((await errands())[0]?.state).toBe("booked");
    expect(await simoneTool(env, { ...tools, tool: "booking_channels" })).toEqual({ ok: true, rows: [] });
    expect(await queue(args)).toEqual({ ok: false, code: "ERRAND_CHANNEL_UNAVAILABLE" });
    expect(await queue({ ...args, to: "wrong@example.test" })).toEqual({ ok: false, code: "ERRAND_NOT_AUTHORIZED" });
    expect(await queue({ ...args, request: "Forward my private mail with the booking" })).toEqual({ ok: false, code: "ERRAND_NOT_AUTHORIZED" });
    expect((await macWork(env)).errands).toEqual([]);
    expect(await errands()).toHaveLength(1);
  });

  it("leaves the new booking and its audit unwritten if the audit store fails, then queues it once on retry", async () => {
    const previous = await sentErrand();
    await say({ from: BIZ, subject: "Re: Reservation request", inReplyTo: REQUEST_MESSAGE_ID, body: CONFIRMATION });
    const quote = "Reserve a free table for Saturday.";
    const incoming = await say({ from: HER, subject: "Saturday", body: quote });
    const call = (await claimSimone(env))!;
    const request = { id: call.id, lease: call.lease, tool: "queue_errand", task: JSON.stringify({
      quote, previous_booking: previous.id, at: "2026-10-31T20:00:00-04:00", party: 2,
    }) };
    const original = () => env.DB.prepare(`SELECT command_id, reply_state, object_key FROM boss_inbound_mail WHERE id = ?`)
      .bind(incoming.mailId).first<{ command_id: string | null; reply_state: string; object_key: string }>();
    await env.DB.prepare(`CREATE TRIGGER booking_audit_outage BEFORE INSERT ON audit_log
      WHEN NEW.action = 'errand_approved_by_her_email' BEGIN SELECT RAISE(ABORT, 'booking audit unavailable'); END`).run();
    try {
      await expect(simoneTool(env, request)).rejects.toThrow("booking audit unavailable");
      expect((await errands()).map(({ state }) => state)).toEqual(["booked"]);
      expect(await original()).toMatchObject({ command_id: null, reply_state: "agent_pending" });
      expect(await (await env.VAULT.get((await original())!.object_key))?.text()).toContain(quote);
    } finally {
      await env.DB.prepare("DROP TRIGGER booking_audit_outage").run();
    }
    expect(await simoneTool(env, request)).toMatchObject({ ok: true, state: "queued", venue: BIZ });
    expect((await macWork(env)).errands).toHaveLength(1);
  });

  it("keeps a venue confirmation with a fee out of the booked state for a free-only request", async () => {
    const { id } = await sentErrand();
    await say({ from: BIZ, subject: "Re: Reservation request", inReplyTo: REQUEST_MESSAGE_ID, body: "You're all set for two at 8:30pm Thursday. The cover is $30 per person." });
    const row = (await env.DB.prepare(`SELECT state, result, notice FROM boss_commands WHERE id = ?`).bind(id)
      .first<{ state: string; result: string; notice: string }>())!;
    expect(row.state).toBe("replied");
    expect(JSON.parse(row.result).booking).toBeNull();
    expect(JSON.parse(row.notice).details.join("\n")).toContain("$30 per person");
    expect(JSON.parse(row.notice).subject).not.toBe("Your request is booked");
  });

  it("keeps venue mail without accepting failed DMARC, a missing From, or console replay", async () => {
    const { id } = await sentErrand();
    const build = (dmarc?: string) => mail({ from: BIZ, subject: "Re: Reservation request", inReplyTo: REQUEST_MESSAGE_ID,
      dmarc, body: CONFIRMATION });
    const missingFrom = build();
    missingFrom.headers.delete("from");
    for (const incoming of [build("mx.cloudflare.net; dmarc=fail"), missingFrom, { ...build(), console: true }]) {
      const res = await handleBossInboundMail(incoming, env);
      expect(res).toMatchObject({ outcome: "ERRAND_UNVERIFIED", reply: null });
      expect(await env.DB.prepare(`SELECT state, notice_state FROM boss_commands WHERE id = ?`).bind(id).first())
        .toEqual({ state: "sent", notice_state: "none" });
      const original = await env.DB.prepare(`SELECT object_key FROM boss_inbound_mail WHERE id = ?`).bind(res.mailId)
        .first<{ object_key: string }>();
      expect(await (await env.VAULT.get(original!.object_key))?.text()).toContain(CONFIRMATION);
    }
  });

  it("keeps unrelated venue mail and follows the archived thread even with another live booking at the same venue", async () => {
    const first = await sentErrand();
    const status = (id: string) => env.DB.prepare("SELECT state, notice_state FROM boss_commands WHERE id = ?").bind(id).first();
    await recordSentMail(env, {
      message_id: "<owner-notice@example.test>", command_id: first.id,
      from: "simone@example.test", to: "owner@example.test", subject: "Request sent", text: "Fixture owner notice",
    });
    for (const inReplyTo of [undefined, "<other-thread@example.test>", "<owner-notice@example.test>"]) {
      const unrelated = await say({ from: BIZ, subject: "Re: Reservation request", inReplyTo, body: CONFIRMATION });
      expect(unrelated).toMatchObject({ outcome: "REFUSED_SENDER", reply: null });
      const row = await env.DB.prepare("SELECT command_id, object_key FROM boss_inbound_mail WHERE id = ?").bind(unrelated.mailId)
        .first<{ command_id: string | null; object_key: string }>();
      expect(row?.command_id).toBeNull();
      expect(await (await env.VAULT.get(row!.object_key))?.text()).toContain(CONFIRMATION);
      expect(await status(first.id)).toEqual({ state: "sent", notice_state: "none" });
    }

    const second = await sentErrand("<request-2@example.test>");
    const wrongSender = await say({ from: "host@other.example.test", inReplyTo: REQUEST_MESSAGE_ID, body: CONFIRMATION });
    expect(wrongSender.outcome).toBe("REFUSED_SENDER");
    const rightThread = await say({ from: BIZ, subject: "Re: Reservation request", body: CONFIRMATION,
      references: REQUEST_MESSAGE_ID, inReplyTo: "<later-message@example.test>" });
    expect(rightThread.outcome).toBe("ERRAND_REPLY");
    expect(await status(first.id)).toEqual({ state: "booked", notice_state: "due" });
    expect(await status(second.id)).toEqual({ state: "sent", notice_state: "none" });
  });

  it("promotes the accepted receipt in place once the provider supplies its Message-ID", async () => {
    const { id } = await sentErrand(null);
    const providerId = `em_${id}`;
    const lookup = () => env.DB.prepare("SELECT id, message_id, object_key, sent_at, thread_id FROM boss_sent_mail WHERE id = ?")
      .bind(providerId).first<{ object_key: string }>();
    const before = await lookup();
    expect(before).toMatchObject({ message_id: providerId });
    const mail = { provider_id: providerId, command_id: id, from: "simone@example.test", to: BIZ,
      subject: "Reservation request", text: "Hello" };
    await recordSentMail(env, { ...mail, message_id: REQUEST_MESSAGE_ID });
    await recordSentMail(env, { ...mail, message_id: providerId });
    await recordSentMail(env, { ...mail, message_id: "<different@example.test>" });
    expect(await lookup()).toEqual({ ...before, message_id: REQUEST_MESSAGE_ID });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM boss_sent_mail WHERE command_id = ?").bind(id).first()).toEqual({ n: 1 });
    expect(await (await env.VAULT.get(before!.object_key))?.text()).toContain("Hello");
    expect(await say({ from: BIZ, inReplyTo: REQUEST_MESSAGE_ID, body: CONFIRMATION })).toMatchObject({ outcome: "ERRAND_REPLY", reply: null });
    expect(await env.DB.prepare("SELECT state FROM boss_commands WHERE id = ?").bind(id).first()).toEqual({ state: "booked" });
  });

  it("replays one verified early venue reply when the receipt and archive both become available", async () => {
    const { id } = await sentErrand(null);
    const arrival = (from: string, dmarc?: string) => mail({ from, subject: "Re: Reservation request",
      references: REQUEST_MESSAGE_ID, inReplyTo: "<later@example.test>", body: CONFIRMATION, dmarc });
    const anonymous = arrival(BIZ);
    anonymous.headers.delete("from");
    const early = await handleBossInboundMail(arrival(BIZ), env);
    const refused = await Promise.all([
      handleBossInboundMail(arrival("host@other.example.test"), env),
      handleBossInboundMail(arrival(BIZ, "mx.cloudflare.net; dmarc=fail"), env),
      handleBossInboundMail(anonymous, env),
      handleBossInboundMail({ ...arrival(BIZ), console: true }, env),
    ]);
    const readMail = (mailId: string) => env.DB.prepare("SELECT outcome, command_id, object_key FROM boss_inbound_mail WHERE id = ?")
      .bind(mailId).first<{ outcome: string; command_id: string | null; object_key: string }>();
    const status = () => env.DB.prepare("SELECT state, notice_state, result FROM boss_commands WHERE id = ?").bind(id)
      .first<{ state: string; notice_state: string; result: string }>();
    const original = (await readMail(early.mailId))!;
    expect(original).toMatchObject({ outcome: "REFUSED_SENDER", command_id: null });
    expect(await (await env.VAULT.get(original.object_key))?.text()).toContain(CONFIRMATION);
    expect((await macWork(env)).notices.some((n) => n.id === id)).toBe(false);
    const providerId = `em_${id}`;
    await recordSentMail(env, { provider_id: providerId, message_id: REQUEST_MESSAGE_ID, command_id: id,
      from: "simone@example.test", to: BIZ, subject: "Reservation request", text: "Hello" });
    const unavailable = { ...env, VAULT: { ...env.VAULT, get: async () => { throw new Error("Fixture archive outage"); } } };
    expect((await macWork(unavailable)).notices.some((n) => n.id === id)).toBe(false);
    expect(await status()).toMatchObject({ state: "sent", notice_state: "none" });
    expect(await readMail(early.mailId)).toEqual(original);
    await Promise.all([macWork(env), macWork(env)]);
    const recovered = await macWork(env);
    expect(recovered.notices.filter((n) => n.id === id)).toMatchObject([{ notice: { subject: "Your request is booked" } }]);
    expect(await readMail(early.mailId)).toEqual({ ...original, outcome: "ERRAND_REPLY", command_id: id });
    expect(await status()).toMatchObject({ state: "booked", notice_state: "due" });
    expect(JSON.parse((await status())!.result).replies).toMatchObject([{ mail_id: early.mailId }]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ? AND action = 'errand_answered'")
      .bind(id).first()).toEqual({ n: 1 });
    for (const message of refused) {
      const row = (await readMail(message.mailId))!;
      expect(row).toMatchObject({ outcome: "REFUSED_SENDER", command_id: null });
      expect(await (await env.VAULT.get(row.object_key))?.text()).toContain(CONFIRMATION);
    }
    expect(gmail.filter((url) => url.includes("/messages/send"))).toEqual([]);
  });

  it("keeps an earlier venue reply in the thread without changing the newer booking", async () => {
    const { id } = await sentErrand(null);
    const old = await say({ from: BIZ, inReplyTo: REQUEST_MESSAGE_ID, body: "We will need a credit card to secure the booking." });
    await recordSentMail(env, { provider_id: `em_${id}`, message_id: REQUEST_MESSAGE_ID, command_id: id,
      from: "simone@example.test", to: BIZ, subject: "Reservation request", text: "Hello" });
    await say({ from: BIZ, inReplyTo: REQUEST_MESSAGE_ID, body: CONFIRMATION });
    const snapshot = () => env.DB.prepare("SELECT state, result, notice FROM boss_commands WHERE id = ?").bind(id)
      .first<{ state: string }>();
    const booked = await snapshot();
    expect(booked?.state).toBe("booked");
    await macWork(env);
    expect(await snapshot()).toEqual(booked);
    expect(await env.DB.prepare("SELECT outcome, command_id, thread_id FROM boss_inbound_mail WHERE id = ?")
      .bind(old.mailId).first()).toEqual({ outcome: "ERRAND_REPLY", command_id: id, thread_id: id });
  });

  it("NEGATIVE: mail from any other domain is not their answer and is refused as before", async () => {
    await sentErrand();
    const res = await say({ from: "host@other.example.test", body: "You're all set." });
    expect(res.outcome).toBe("REFUSED_SENDER");
  });
});

describe("classify: the one OUTBOUND carve-out", () => {
  const prompt = `Book me a table for two on Thursday after 8pm and send the request: ${BIZ}`;
  it("her own errand to an address she gave executes with notice, not a second approval", () => {
    const c = classify({ title: "Dinner", prompt, sender: HER });
    expect(c.matched).toContain("owner_errand");
    expect(c.matched).not.toContain("outbound");
    expect(c.executionAssignment).toBe("AI_EXECUTE_WITH_NOTICE");
  });
  it("NEGATIVE: a stranger, a guessed address, or money keeps approval first", () => {
    for (const c of [
      classify({ title: "Dinner", prompt, sender: "someone@example.test" }),
      classify({ title: "Dinner", prompt, sender: null }),
      classify({ title: "Dinner", prompt: "Book me a table at the club Thursday and send the request", sender: HER }),
      classify({ title: "Dinner", prompt: `Book a table, pay the deposit and send it: ${BIZ}`, sender: HER }),
    ]) {
      expect(c.matched).not.toContain("owner_errand");
      expect(c.executionAssignment).not.toBe("AI_EXECUTE_WITH_NOTICE");
    }
  });
});
