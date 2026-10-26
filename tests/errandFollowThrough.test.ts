/**
 * SIMONE READS THEIR ANSWER RIGHT AND FOLLOWS IT THROUGH (owner, 26 Oct 2026). Her first errand came
 * back with three times, a fee per show, a no-show charge and "please provide a telephone number,
 * along with your preference of the offered times" — and Simone told her "Nothing. It's booked.",
 * cutting their words at "In the event of a…". Pinned here on the real shape (anonymised): it is a
 * Decide with every option, fee and request; their whole answer is kept; her answer becomes the exact
 * follow-up in their thread; a card never goes; and the "do you still want to go?" email is set 28
 * true hours before the booking, clock-change weekends included. Fixtures only (example.test).
 */
import { describe, expect, it } from "vitest";
import {
  readErrandReply, errandAnswerIn, errandFollowUpText, errandCancelText, followUpProblems, errandDateIn,
  bookingAt, reminderDueAt, bookingWhen, partyIn, REMINDER_LEAD_MS,
} from "../src/shared/boss/commands/parse.mjs";
import { OPTIONS_REPLY, PHONE } from "./fixtures/errandReplyOptions.mjs";

describe("their answer with options is hers to decide, never 'booked'", () => {
  const r = readErrandReply(OPTIONS_REPLY, "reservations@club.example.test");
  it("is a Decide, not a confirmation", () => {
    expect(r.kind).toBe("decide");
    expect(r.what_you_do).not.toMatch(/Nothing|booked/i);
  });
  it("lists every option with its fee, the cancellation charge, and exactly what they need", () => {
    expect(r.offer.options.map((o) => [o.time, o.label, o.fee])).toEqual([
      ["6:30 pm", "live performance", "$75 per person"],
      ["9:00 pm", "live performance", "$100 per person"],
      ["11:00 pm", "DJ set", null],
    ]);
    expect(r.what_you_do).toContain("1) 6:30 pm (live performance, $75 per person); 2) 9:00 pm (live performance, $100 per person); 3) 11:00 pm (DJ set)");
    expect(r.what_you_do).toContain("Cancelling: In the event of a no-show or cancellation within 24 hours of your reservation time, we charge the performance fee (x) party size + tax.");
    expect(r.what_you_do).toContain("Their rules: We enforce an elegant dress code");
    expect(r.what_you_do).toContain("To book, they need your phone number and which time you want.");
  });
  it("keeps their whole answer, never cut mid-sentence, and never reads the quoted thread", () => {
    expect(r.what_they_said).toContain("we charge the performance fee (x) party size + tax.");
    expect(r.what_they_said).toContain("please provide a telephone number, along with your preference of the offered times.");
    expect(r.what_they_said).not.toMatch(/…$/);
    expect(r.what_they_said).not.toContain("anything you need to confirm");
    expect(r.offer.greet).toBe("Jamie");
  });
  it("NEGATIVE: a confirmation word only in the quoted thread is not a confirmation", () => {
    expect(readErrandReply("Thanks for reaching out. We'll check and come back to you.\r\n\r\nFrom: Simone <simone@example.test>\r\nanything you need to confirm").kind).toBe("other");
  });
});

describe("'booked' only for an explicit confirmation of one time with nothing asked", () => {
  it("a plain confirmation of one time", () => {
    expect(readErrandReply("You're all set for two at 8:30pm Thursday. See you then.").kind).toBe("confirmed");
    expect(readErrandReply("Your reservation is confirmed for 11:00 pm on Thursday, October 29.").kind).toBe("confirmed");
  });
  it("NEGATIVE: two times, a question, a fee or a cancellation charge is never 'confirmed'", () => {
    expect(readErrandReply("Confirmed: we can do 8pm or 9pm.").kind).toBe("decide");
    expect(readErrandReply("Your table is confirmed for 8:30pm. Could you send a phone number?").kind).toBe("decide");
    expect(readErrandReply("Your table is confirmed for 8:30pm. There is a $50 per person minimum.").kind).toBe("decide");
    expect(readErrandReply("Your table is confirmed for 8:30pm. Late cancellations are charged in full.").kind).toBe("decide");
    expect(readErrandReply("We are fully booked after 8, but we have a table at 6:30 instead.").kind).toBe("decide");
    expect(readErrandReply("Your reservation is confirmed.").kind).toBe("other");
  });
  it("a card or deposit is still always hers", () => {
    const r = readErrandReply("We can hold a table at 8:30. We'll need a credit card to secure the booking.", "res@club.example.test");
    expect(r.kind).toBe("card");
    expect(r.what_you_do).toMatch(/Only you can give that/);
  });
});

describe("her answer becomes the follow-up, word for word; a card never goes", () => {
  const offer = readErrandReply(OPTIONS_REPLY).offer;
  it("'11pm, my number is …' picks the DJ set and her number", () => {
    const a = errandAnswerIn(`11pm, my number is ${PHONE}`, offer);
    expect(a.choice?.time).toBe("11:00 pm");
    expect(a.phone).toBe(PHONE);
    expect(a.missing).toEqual([]);
    expect(errandAnswerIn(`3, ${PHONE}`, offer).choice?.label).toBe("DJ set");
    expect(errandAnswerIn(`the DJ set please. ${PHONE}`, offer).choice?.time).toBe("11:00 pm");
    const text = errandFollowUpText({ greet: offer.greet, choice: a.choice, when: "Thursday, October 29", party: partyIn("Reservation request: Thursday, October 29, party of 2"), phone: a.phone, offer });
    expect(text).toBe([
      "Hello Jamie,", "",
      `Thank you. Sequoia would like the 11:00 pm DJ set on Thursday, October 29, for a party of 2. Her phone number is ${PHONE}. Noted on the dress code and the 24-hour cancellation policy.`, "",
      "Could you please confirm the reservation?", "",
      "Thank you,", "Simone", "Assistant to Sequoia Taylor",
    ].join("\n"));
    expect(followUpProblems(text)).toEqual([]);
  });
  it("NEGATIVE: a missing time or number is asked for, and card details are refused", () => {
    expect(errandAnswerIn(`my number is ${PHONE}`, offer).missing[0]).toMatch(/^which time/);
    expect(errandAnswerIn("11pm", offer).missing).toEqual(["your phone number"]);
    expect(errandAnswerIn(`11pm, ${PHONE}, card 4111 1111 1111 1111`, offer).card).toBe(true);
    expect(errandAnswerIn(`11pm, ${PHONE}, use my visa`, offer).card).toBe(true);
    expect(followUpProblems("Her card is 4111 1111 1111 1111.\nAssistant to Sequoia Taylor")).toContain("it carries card details");
  });
  it("a cancellation in their thread is a fixed letter", () => {
    expect(errandCancelText({ greet: "Jamie", what: "the 11:00 pm DJ set", when: "Thursday, October 29", party: 2 }))
      .toContain("please cancel the reservation for the 11:00 pm DJ set on Thursday, October 29, party of 2.");
  });
});

describe("'do you still want to go?' goes 28 true hours before, New York time", () => {
  const date = errandDateIn("Reservation request: Thursday, October 29, party of 2", Date.parse("2026-10-26T20:00:00Z"));
  it("the 11:00 pm Thursday Oct 29 booking → Wednesday Oct 28, 7:00 pm ET", () => {
    expect(date).toEqual({ y: 2026, m: 10, d: 29 });
    const b = bookingAt(date, { time: "11:00 pm" })!;
    expect(new Date(b.at).toISOString()).toBe("2026-10-30T03:00:00.000Z");
    expect(new Date(reminderDueAt(b.at)).toISOString()).toBe("2026-10-28T23:00:00.000Z");
    expect(bookingWhen(reminderDueAt(b.at))).toBe("Wednesday, October 28 at 7:00 pm");
    expect(REMINDER_LEAD_MS).toBe(28 * 3_600_000);
  });
  it("across the autumn clock change: 28 real hours, not wall-clock hours", () => {
    const b = bookingAt({ y: 2026, m: 11, d: 1 }, { time: "10:00 am" })!; // EST, 15:00Z
    expect(new Date(b.at).toISOString()).toBe("2026-11-01T15:00:00.000Z");
    expect(new Date(reminderDueAt(b.at)).toISOString()).toBe("2026-10-31T11:00:00.000Z"); // 7:00 am EDT
    expect(bookingWhen(reminderDueAt(b.at))).toBe("Saturday, October 31 at 7:00 am");
  });
  it("across the spring clock change", () => {
    const b = bookingAt({ y: 2027, m: 3, d: 14 }, { time: "8:00 pm" })!; // EDT, 00:00Z next day
    expect(new Date(b.at).toISOString()).toBe("2027-03-15T00:00:00.000Z");
    expect(bookingWhen(reminderDueAt(b.at))).toBe("Saturday, March 13 at 3:00 pm");
  });
  it("a date already past this year is next year's", () => {
    expect(errandDateIn("dinner on January 5", Date.parse("2026-10-26T20:00:00Z"))).toEqual({ y: 2027, m: 1, d: 5 });
  });
});
