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
import { macWork, errandSent } from "../../src/worker/boss/commands/run";
import { setCommandFetch } from "../../src/worker/boss/commands/google";
import { classify } from "../../src/worker/boss/intake/classify";
import { ERRAND_SENDERS } from "../../src/shared/boss/commands/parse.mjs";
import { layoutEmail, plainProblems } from "../../src/shared/boss/mail/plain.mjs";

const HER = ERRAND_SENDERS[0]!;
const BIZ = "reservations@club.example.test";
const NOW = Date.parse("2026-10-26T15:00:00Z");

function mail(o: { from: string; body: string; subject?: string; to?: string; dmarc?: string }) {
  const headers = new Headers({
    from: o.from, subject: o.subject ?? "",
    "authentication-results": o.dmarc ?? "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass",
    "message-id": `<${Math.random().toString(36).slice(2)}@mail.example.test>`,
  });
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

async function sentErrand() {
  const res = await say({ from: `Sequoia <${HER}>`, subject: "Dinner", body: `Book me a table for two on Thursday after 8pm: ${BIZ}` });
  const [row] = await errands();
  await errandSent(env as never, row.id, { message_id: "em_fake1", subject: "Reservation request", text: "Hello", request: "a table for two on Thursday after 8:00 pm" });
  return { res, id: row.id as string };
}

describe("her errand by email", () => {
  it("is queued for the Mac with no Send tap, and she is told it is going", async () => {
    const res = await say({ from: `Sequoia <${HER}>`, subject: "Dinner", body: `Book me a table for two on Thursday after 8pm: ${BIZ}` });
    expect(res.outcome).toBe("COMMAND");
    expect(res.reply).toContain(`I'm sending your request to ${BIZ} now, as your assistant`);
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

  it("NEGATIVE: money in her words makes no errand (it is a draft for her Send instead)", async () => {
    await say({ from: `Sequoia <${HER}>`, body: `Book me a table for two and pay the deposit: ${BIZ}` });
    expect(await errands()).toHaveLength(0);
  });

  it("their answer is read for her, never answered: a card request becomes hers, in plain words", async () => {
    const { id } = await sentErrand();
    const res = await say({ from: `Host <host@club.example.test>`, subject: "Re: Reservation request", body: "We can hold a table at 8:30. We will need a credit card to secure the booking." });
    expect(res.outcome).toBe("ERRAND_REPLY");
    expect(res.reply).toBeNull();
    const row = await env.DB.prepare(`SELECT * FROM boss_commands WHERE id = ?`).bind(id).first<any>();
    expect(row.state).toBe("needs_card");
    expect(JSON.parse(row.result).booking?.confirmed ?? false).toBe(false);
    expect(row.notice_state).toBe("due");
    const notice = JSON.parse(row.notice);
    expect(notice.subject).toBe("Your request needs you: they want a card");
    expect(notice.details[0]).toBe("What I asked for: a table for two on Thursday after 8:00 pm");
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
    await say({ from: BIZ, subject: "Re: Reservation request", body: "You're all set for two at 8:30pm Thursday. See you then." });
    const notice = JSON.parse((await env.DB.prepare(`SELECT notice FROM boss_commands WHERE id = ?`).bind(id).first<any>()).notice);
    expect(notice.subject).toBe("Your request is booked");
    expect(notice.morning.line).toContain("it's booked");
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
