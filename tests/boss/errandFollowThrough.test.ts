/**
 * SIMONE FOLLOWS AN ERRAND THROUGH, END TO END (owner, 26 Oct 2026), through the real intake and the
 * Mac's tick: the venue's answer with options is a Decide (never "booked"); her reply sends the exact
 * follow-up in THEIR thread; the "do you still want to go?" email is due 28 hours before the booking
 * and says whether they confirmed; her "cancel" cancels with them in the thread and is confirmed to
 * her. Each proven negatively. Fixtures only (example.test).
 */
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { macWork, errandSent, commandFromMail, errandFollowedUp, errandRemindersDue, errandReminded, errandTap, getCommand } from "../../src/worker/boss/commands/run";
import { setCommandFetch } from "../../src/worker/boss/commands/google";
import { ERRAND_SENDERS } from "../../src/shared/boss/commands/parse.mjs";
import { layoutEmail, plainProblems } from "../../src/shared/boss/mail/plain.mjs";
import { OPTIONS_REPLY, VENUE, VENUE_MESSAGE_ID, PHONE } from "../fixtures/errandReplyOptions.mjs";

const HER = ERRAND_SENDERS[0]!;
const NOW = Date.parse("2026-10-26T20:00:00Z");
const DUE = Date.parse("2026-10-28T23:00:00Z"); // Wednesday 7:00 pm New York time

function mail(o: { from: string; body: string; subject?: string; messageId?: string }) {
  const headers = new Headers({
    from: o.from, subject: o.subject ?? "",
    "authentication-results": "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass",
    "message-id": o.messageId ?? `<${Math.random().toString(36).slice(2)}@mail.example.test>`,
  });
  const raw = `From: ${o.from}\r\nSubject: ${o.subject ?? ""}\r\nContent-Type: text/plain\r\n\r\n${o.body}`;
  return { from: o.from.replace(/.*<|>.*/g, ""), to: "simone@sequoiataylor.com", headers, raw: new Response(raw).body!, rawSize: new TextEncoder().encode(raw).length };
}
const say = (o: Parameters<typeof mail>[0]) => handleBossInboundMail(mail(o) as never, env as never);
const row = async (id: string) => (await getCommand(env as never, id))!;
const result = async (id: string) => JSON.parse((await row(id)).result);
const herReply = (id: string, text: string) => commandFromMail(env as never, { subject: "Re: Your request needs you", text, mailId: "m_her", sender: HER, refs: [id], now: Date.now() });
const REAL_NOW = Date.now;

beforeEach(async () => {
  setCommandFetch((async () => new Response("no", { status: 500 })) as unknown as typeof fetch);
  Date.now = (() => { let t = NOW; return () => (t += 1000); })();
  await env.DB.exec("DELETE FROM boss_commands");
  await env.DB.exec("DELETE FROM boss_inbound_mail");
});
afterEach(() => { setCommandFetch(null); Date.now = REAL_NOW; });

async function answered() {
  await say({ from: `Sequoia <${HER}>`, subject: "Club", body: `Get me reservations +1 Thursday night after 8pm: ${VENUE}` });
  const id = ((await env.DB.prepare(`SELECT id FROM boss_commands WHERE kind = 'errand'`).first<any>())).id as string;
  await errandSent(env as never, id, { message_id: "em_fake1", subject: "Reservation request: Thursday, October 29, party of 2", text: "Hello", request: "a table for two at The Example Club on Thursday, October 29, any time after 8:00 pm" });
  await say({ from: `Jamie Rivera <${VENUE}>`, subject: "Re: Reservation request: Thursday, October 29, party of 2", body: OPTIONS_REPLY, messageId: VENUE_MESSAGE_ID });
  return id;
}

describe("their answer with options", () => {
  it("is a Decide with every option and fee, never 'booked', and keeps their whole answer", async () => {
    const id = await answered();
    const r = await row(id);
    expect(r.state).toBe("replied");
    const notice = JSON.parse(r.notice!);
    expect(notice.subject).toBe("Your request needs you: pick a time");
    expect(notice.subject).not.toMatch(/booked/i);
    expect(notice.details[1]).toContain("In the event of a no-show or cancellation within 24 hours of your reservation time, we charge the performance fee (x) party size + tax.");
    expect(notice.details[2]).toContain("3) 11:00 pm (DJ set)");
    expect(notice.details[2]).toContain("your phone number and which time you want");
    expect(notice.morning.decide.buttons.map((b: any) => b.label)).toEqual(["Answer Simone", "Cancel it"]);
    expect((await result(id)).thread).toMatchObject({ message_id: VENUE_MESSAGE_ID, greet: "Jamie" });
  });
});

describe("her answer goes to them in their thread", () => {
  it("'11pm, my number is …' queues the exact follow-up, In-Reply-To their message", async () => {
    const id = await answered();
    const res = await herReply(id, `11pm, my number is ${PHONE}`);
    expect(res?.reply).toContain(`Sending this to ${VENUE} now, in the same thread`);
    const work = await macWork(env as never);
    expect(work.errand_follow_ups).toHaveLength(1);
    const f = work.errand_follow_ups[0];
    expect(f).toBeDefined();
    expect(f).toMatchObject({ to: VENUE, in_reply_to: VENUE_MESSAGE_ID, subject: "Re: Reservation request: Thursday, October 29, party of 2", purpose: "answer" });
    expect(f!.text).toContain(`Sequoia would like the 11:00 pm DJ set on Thursday, October 29, for a party of 2. Her phone number is ${PHONE}.`);
    expect(await errandFollowedUp(env as never, id, { message_id: "em_fake2" })).toBe(true);
    expect((await row(id)).state).toBe("sent");
    expect((await result(id)).booking).toMatchObject({ time: "11:00 pm", confirmed: false, at: Date.parse("2026-10-30T03:00:00Z") });
  });
  it("NEGATIVE: card details are never queued; a missing number is asked for", async () => {
    const id = await answered();
    expect((await herReply(id, `11pm, ${PHONE}, card 4111 1111 1111 1111`))?.reply).toMatch(/never send card details/);
    expect((await herReply(id, "11pm"))?.reply).toMatch(/still need your phone number/);
    expect((await macWork(env as never)).errand_follow_ups).toHaveLength(0);
  });
});

describe("'do you still want to go?' 28 hours before", () => {
  async function chosen() {
    const id = await answered();
    await herReply(id, `11pm, my number is ${PHONE}`);
    await errandFollowedUp(env as never, id, { message_id: "em_fake2" });
    return id;
  }
  it("is due Wednesday 7:00 pm ET, not a minute before, says NOT confirmed when they haven't, and goes once", async () => {
    const id = await chosen();
    expect(await errandRemindersDue(env as never, DUE - 60_000)).toHaveLength(0);
    const due = await errandRemindersDue(env as never, DUE);
    expect(due).toHaveLength(1);
    expect(due[0]!.notice.subject).toBe("Do you still want to go? Thursday, October 29 at 11:00 pm");
    expect(due[0]!.notice.happened).toContain("NOT confirmed");
    expect(due[0]!.notice.details).toContain("Cancelling: In the event of a no-show or cancellation within 24 hours of your reservation time, we charge the performance fee (x) party size + tax.");
    expect(due[0]!.notice.decide![0]!.buttons.map((b: any) => b.label)).toEqual(["Yes, keep it", "Cancel it"]);
    // The real reminder and the real Decide notice pass her plain-email gate as they are.
    const n = due[0]!.notice;
    expect(plainProblems(layoutEmail({ who: "Simone", subject: n.subject, happened: n.happened, details: n.details ?? [], decide: (n.decide ?? []) as never, refs: [id] }))).toEqual([]);
    await errandReminded(env as never, id, DUE);
    expect(await errandRemindersDue(env as never, DUE + 600_000)).toHaveLength(0);
  });
  it("says confirmed once the venue confirms the one time", async () => {
    const id = await chosen();
    await say({ from: VENUE, subject: "Re: Reservation request", body: "Your reservation is confirmed for 11:00 pm on Thursday, October 29. We look forward to welcoming you." });
    const r = await row(id);
    expect(r.state).toBe("booked");
    expect(JSON.parse(r.notice!).subject).toBe("Your request is booked");
    const [due] = await errandRemindersDue(env as never, DUE);
    expect(due!.notice.happened).toContain("They have confirmed it.");
  });
  it("'Yes, keep it' changes nothing; 'cancel' cancels with them in their thread and tells her", async () => {
    const id = await chosen();
    expect(await errandTap(env as never, await row(id), "keep")).toBe("Kept. Nothing changes.");
    expect((await row(id)).state).toBe("sent");
    const res = await herReply(id, "cancel");
    expect(res?.reply).toContain(`Cancelling it: I'm writing to ${VENUE} now, in the same thread`);
    const [f] = (await macWork(env as never)).errand_follow_ups;
    expect(f).toMatchObject({ purpose: "cancel", in_reply_to: VENUE_MESSAGE_ID });
    expect(f!.text).toContain("please cancel the reservation for the 11:00 pm DJ set on Thursday, October 29, party of 2.");
    await errandFollowedUp(env as never, id, { message_id: "em_fake3" });
    const r = await row(id);
    expect(r.state).toBe("cancel_sent");
    expect(JSON.parse(r.notice!).subject).toBe("Cancelling your booking");
    expect(await errandRemindersDue(env as never, DUE)).toHaveLength(0);
    await say({ from: VENUE, subject: "Re: Reservation request", body: "Your reservation has been cancelled." });
    expect((await row(id)).state).toBe("cancelled");
  });
});
