/**
 * SIMONE RUNS HER ERRANDS BY EMAIL (owner, 26 Oct 2026) — the grammar, the letter and the send.
 *
 * "make sure going forward i can email simone to do this kind of thing" (a table at a club), then
 * "she doesnt have to cc me next time". Her email IS the approval for a booking or request to a
 * business whose address she wrote in it; everything else keeps the Send-first path. Each carve-out
 * is proven negatively: a guessed address, money, fund/LP work, a West Peek address and any other
 * sender are NOT errands. Fixtures only (example.test); no real business or address appears here.
 */
import { describe, expect, it } from "vitest";
import { ERRAND_SENDERS, errandIn, errandRefusal, errandText, errandProblems, readErrandReply, commandsIn } from "../src/shared/boss/commands/parse.mjs";
import { errandMail, errandPayloadProblems, postErrandMail, ERRAND_FROM, ERRAND_REPLY_TO } from "../scripts/ops/notify.mjs";
import { buildErrand, errandPrompt } from "../scripts/ops/simone-commands.mjs";

const HER = ERRAND_SENDERS[0]!;
const ASK = "get me reservations +1 to this place on thursday night after 8pm : reservations@club.example.test The Example Jazz Club";

describe("which emails are errands", () => {
  it("her own booking request to a business address she gave is an errand, and the whole email", () => {
    expect(errandIn({ sender: HER, text: ASK })).toEqual({ to: "reservations@club.example.test", ask: ASK });
    expect(errandIn({ sender: `Sequoia <${HER}>`, subject: "Dinner", text: "Book me a table for two Thursday after 8pm: hello@bistro.example.test" })?.to).toBe("hello@bistro.example.test");
    const found = commandsIn({ sender: HER, text: ASK, now: Date.parse("2026-10-26T15:00:00Z") });
    expect(found.map((c) => c.kind)).toEqual(["errand"]);
  });

  it("NEGATIVE: a guessed address (none in her words), two addresses, or her own address is not an errand", () => {
    expect(errandRefusal({ sender: HER, text: "Book me a table at The Example Club on Thursday" })).toMatch(/never guessed/);
    expect(errandIn({ sender: HER, text: "Book a table: a@one.example.test or b@two.example.test" })).toBeNull();
    expect(errandIn({ sender: HER, text: "Book a table and send it to simone@sequoiataylor.com" })).toBeNull();
  });

  it("NEGATIVE: money in her words is not an errand (agents never spend money)", () => {
    for (const t of ["Book a table and pay the deposit: res@club.example.test", "Reserve a spot, use my card: res@club.example.test", "Book the room for $200: res@club.example.test"]) {
      expect(errandRefusal({ sender: HER, text: t }), t).toBe("money is involved");
    }
  });

  it("NEGATIVE: fund, LP or trading work, or a West Peek address, is never an errand", () => {
    expect(errandIn({ sender: HER, text: "Book a meeting with the LP: lp@fund.example.test" })).toBeNull();
    expect(errandIn({ sender: HER, text: "Reserve a room for the West Peek offsite: events@hotel.example.test" })).toBeNull();
    expect(errandIn({ sender: HER, text: "Book a table: someone@westpeek.ventures" })).toBeNull();
  });

  it("NEGATIVE: the same words from any other sender, even another of her own addresses, are not an errand", () => {
    expect(errandRefusal({ sender: "someone@example.test", text: ASK })).toBe("not from her own address");
    expect(errandRefusal({ sender: "", text: ASK })).toBe("not from her own address");
    expect(commandsIn({ sender: "someone@example.test", text: ASK }).map((c) => c.kind)).not.toContain("errand");
    expect(commandsIn({ text: ASK }).map((c) => c.kind)).not.toContain("errand");
  });

  it("NEGATIVE: an email that asks for no booking is not an errand", () => {
    expect(errandRefusal({ sender: HER, text: "What are your hours? hello@bistro.example.test" })).toBe("not a booking or request");
  });
});

describe("the letter that goes", () => {
  it("is the short fixed letter, signed Simone as her assistant, with no AI, no money, no address", () => {
    const text = errandText("a table for two at The Example Jazz Club on Thursday, October 29, any time after 8:00 pm");
    expect(text).toBe("Hello,\n\nI'm writing on behalf of Sequoia Taylor to request a table for two at The Example Jazz Club on Thursday, October 29, any time after 8:00 pm. Please let me know what's available and anything you need to confirm.\n\nThank you,\nSimone\nAssistant to Sequoia Taylor");
    expect(text).not.toMatch(/copied|\bAI\b|card|deposit/i);
    const good = buildErrand({ subject: "Reservation request: Thursday, October 29, party of 2", request: "a table for two on Thursday, October 29, any time after 8:00 pm" });
    expect(good.problems).toEqual([]);
  });

  it("NEGATIVE: a phrase that mentions AI, money, a card number, a link or an address is refused before sending", () => {
    expect(errandProblems({ subject: "x", request: "a table booked by our AI assistant" })).toContain("it mentions AI");
    expect(errandProblems({ subject: "x", request: "a table, and we will pay a deposit" })).toContain("it mentions money");
    expect(errandProblems({ subject: "x", request: "a table, card 4111 1111 1111 1111" }).join()).toMatch(/long number/);
    expect(errandProblems({ subject: "x", request: "a table, see https://example.test" })).toContain("it carries an address or a link");
    expect(errandProblems({ subject: "", request: "" })).toEqual(expect.arrayContaining(["no subject", "no request"]));
  });

  it("the prompt gives today's date and forbids invention", () => {
    const p = errandPrompt({ to: "res@club.example.test", ask: ASK }, Date.parse("2026-10-26T15:00:00Z"));
    expect(p).toContain("Today is Monday, October 26, 2026");
    expect(p).toMatch(/Invent nothing/);
  });
});

describe("the send: from Simone, Reply-To Simone, no Cc to the owner by default", () => {
  it("builds one business, From and Reply-To simone@, and no Cc at all", () => {
    const p = errandMail({ to: "res@club.example.test", subject: "Reservation request", text: "Hello" });
    expect(p.from).toBe(ERRAND_FROM);
    expect(p.from).toBe("Simone <simone@sequoiataylor.com>");
    expect(p.reply_to).toBe(ERRAND_REPLY_TO);
    expect(p.reply_to).toBe("simone@sequoiataylor.com");
    expect(p).not.toHaveProperty("cc");
    expect(p).not.toHaveProperty("bcc");
    expect(errandPayloadProblems(p, { owner: "owner@example.test" })).toEqual([]);
  });

  it("NEGATIVE: a payload that copies the owner, or answers elsewhere, is refused and never reaches Resend", async () => {
    const calls: string[] = [];
    const fake = (async (u: string) => { calls.push(String(u)); return Response.json({ id: "em_1" }); }) as unknown as typeof fetch;
    const cc = errandMail({ to: "res@club.example.test", subject: "s", text: "t", cc: ["owner@example.test"] });
    expect(errandPayloadProblems(cc, { owner: "owner@example.test" })).toContain("copies the owner (no Cc by default)");
    const elsewhere = { ...errandMail({ to: "res@club.example.test", subject: "s", text: "t" }), reply_to: "owner@example.test" };
    expect((await postErrandMail(elsewhere, fake, { key: "k" })).ok).toBe(false);
    expect(calls).toHaveLength(0);
    const ok = await postErrandMail(errandMail({ to: "res@club.example.test", subject: "s", text: "t" }), fake, { key: "k" });
    expect(ok).toEqual({ ok: true, id: "em_1" });
    expect(calls).toEqual(["https://api.resend.com/emails"]);
  });
});

describe("their answer, read for her", () => {
  it("a card or deposit request is always hers", () => {
    const r = readErrandReply("We can hold a table at 8:30. We'll need a credit card to secure the booking.", "res@club.example.test");
    expect(r.kind).toBe("card");
    expect(r.what_you_do).toMatch(/Only you can give that/);
  });
  it("a confirmation needs nothing; an alternative time is hers to take", () => {
    expect(readErrandReply("You're all set for two at 8:30pm Thursday. See you then.").kind).toBe("confirmed");
    expect(readErrandReply("We are fully booked after 8, but we have a table at 6:30 instead.").kind).toBe("alternative");
  });
});
