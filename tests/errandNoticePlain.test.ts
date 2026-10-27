/**
 * EVERY ERRAND NOTICE, MAPPED BY THE REAL noticeArgs, THROUGH THE REAL GATE (26 Oct 2026 held mail:
 * "Your request needs you: they want a card" was held for "'needs a look' beside 'nothing needed'").
 *
 * `errandReplied` built the Decide card twice — once for `morning.decide` (what the morning email
 * reads) and never for the top-level `decide` (what `noticeArgs`, the mapping every notice actually
 * goes through, reads). `errandReplyNotice` (src/shared/boss/commands/parse.mjs) now builds that
 * card ONCE and hands back the SAME object as both `decide[0]` and `morning.decide`, so there is one
 * list, not two independent copies of the same information.
 *
 * Every kind it can produce — card, decide (options), confirmed, other — is built here, mapped by
 * the real `noticeArgs` (scripts/ops/simone-commands.mjs), laid out by the real `employeeMail`
 * (scripts/ops/notify.mjs), and run through the real send-time gate (`mailGate`): zero problems.
 * The bounce notice (`bounced`, src/worker/boss/commands/run.ts) gets the same proof. And the exact
 * held case — the club's words, rebuilt — is asserted to pass, with no replacement character
 * surviving into what she would see. Fixtures only (example.test).
 */
import { describe, expect, it } from "vitest";
import { readErrandReply, errandReplyNotice, bookingAt, errandDateIn } from "../src/shared/boss/commands/parse.mjs";
import { noticeArgs } from "../scripts/ops/simone-commands.mjs";
import { sendersFor, employeeMail, mailGate } from "../scripts/ops/notify.mjs";
import { DECIDE_HEADING, NOTHING_TO_DECIDE } from "../src/shared/boss/mail/plain.mjs";
import { OPTIONS_REPLY, VENUE } from "./fixtures/errandReplyOptions.mjs";

process.env.BOSS_OS_MAIL_KEY = "test-key-not-real";
const sender = sendersFor("Simone")[0]!;
const laidFor = (notice: Record<string, any>, id = "cmd_test1") => employeeMail(sender, noticeArgs(id, notice));

describe("the card notice: one Decide card, not a morning-only copy", () => {
  const read = readErrandReply("We can hold a table at 8:30. We'll need a credit card to secure the booking.", VENUE);
  const notice = errandReplyNotice({ to: VENUE, asked: "a table for two on Thursday after 8:00 pm", read, kind: read.kind, confirmed: false, booking: null, decideOpen: false, unproven: [] });
  it("decide[0] IS morning.decide — the same card, built once", () => {
    expect(read.kind).toBe("card");
    expect(notice.subject).toBe("Your request needs you: they want a card");
    expect(notice.decide).toHaveLength(1);
    expect(notice.decide[0]).toEqual(notice.morning.decide);
    expect(notice.decide[0]!.buttons).toEqual([{ label: "Ask how to give a card securely", url: `mailto:${VENUE}` }]);
  });
  it("passes the real gate, with Decide (1) first — never held for 'nothing needed'", () => {
    const laid = laidFor(notice);
    expect(mailGate(laid)).toEqual([]);
    expect(laid.text.split("\n")[2]).toBe(`${DECIDE_HEADING} (1)`);
  });
});

describe("the options notice (a Decide, never 'booked')", () => {
  const read = readErrandReply(OPTIONS_REPLY, VENUE);
  const notice = errandReplyNotice({
    to: VENUE, asked: "a table for two at The Example Club on Thursday, October 29, any time after 8:00 pm", read, kind: read.kind, confirmed: false, booking: null, decideOpen: true,
    answerUrl: "https://boss.sequoiataylor.com/tap/tok1?do=answer", cancelUrl: "https://boss.sequoiataylor.com/tap/tok1?do=cancel",
  });
  it("one card, two buttons, same card both places", () => {
    expect(read.kind).toBe("decide");
    expect(notice.subject).toBe("Your request needs you: pick a time");
    expect(notice.decide).toEqual([notice.morning.decide]);
    expect(notice.decide[0]!.buttons.map((b: any) => b.label)).toEqual(["Answer Simone", "Cancel it"]);
  });
  it("passes the real gate", () => expect(mailGate(laidFor(notice))).toEqual([]));
});

describe("the confirmed notice (nothing to decide, and it is true this time)", () => {
  const read = readErrandReply("You're all set for two at 8:30pm Thursday. See you then.");
  const date = errandDateIn("Reservation request: Thursday, October 29, party of 2", Date.parse("2026-10-26T20:00:00Z"));
  const one = read.offer.options[0]!;
  const booking = { ...(bookingAt(date, one) ?? {}), label: one.label, confirmed: true };
  const notice = errandReplyNotice({ to: VENUE, asked: "x", read, kind: "confirmed", confirmed: true, booking, decideOpen: false });
  it("no Decide card, a morning line that says it's booked", () => {
    expect(read.kind).toBe("confirmed");
    expect(notice.subject).toBe("Your request is booked");
    expect(notice.decide).toEqual([]);
    expect(notice.morning.line).toMatch(/it's booked/);
  });
  it("passes the real gate, with 'Nothing to decide'", () => {
    const laid = laidFor(notice);
    expect(mailGate(laid)).toEqual([]);
    expect(laid.text.split("\n")[2]).toBe(NOTHING_TO_DECIDE);
  });
});

describe("the 'other' notice (read it, answer only if something there needs it)", () => {
  const read = readErrandReply("Thanks for reaching out. We'll check and come back to you.");
  const notice = errandReplyNotice({ to: VENUE, asked: "x", read, kind: "other", confirmed: false, booking: null, decideOpen: false });
  it("never says 'needs you' beside 'nothing to decide' (found in passing, 26 Oct 2026)", () => {
    expect(read.kind).toBe("other");
    expect(notice.subject).toBe("They answered your request");
    expect(notice.decide).toEqual([]);
  });
  it("passes the real gate", () => expect(mailGate(laidFor(notice))).toEqual([]));
});

describe("the bounce notice (a question is never 'nothing to decide')", () => {
  const notice = {
    subject: "The email to Avery bounced",
    happened: "The email to Avery bounced: avery@example.com doesn't take mail. What's the right address?",
    details: ["Reply with it and I'll send the same email there."],
    decide: [{ title: "What's the right address?", body: "Reply with it and I'll send the same email there." }],
  };
  it("passes the real gate, with its own Decide card first", () => {
    const laid = laidFor(notice, "cmd_bounce");
    expect(mailGate(laid)).toEqual([]);
    expect(laid.text.split("\n")[2]).toBe(`${DECIDE_HEADING} (1)`);
  });
});

describe("the exact held case (9657424a30f0b162.json), rebuilt from the club's words", () => {
  // Their reply carried two windows-1252 bytes (an em dash and a curly apostrophe) that the old
  // reader decoded as UTF-8 and turned into U+FFFD — a second, independent defect in the same email.
  const theirReply = "Dear Simone, You should have received a secure paylink to enter the credit card details. Once you complete the form, the reservation will be confirmed. Kindly note the expiration time, after which the pending reservation will auto-cancel if the form is left incomplete. A note to also check spam/junk folders � our automated emails are often rerouted. The card you enter will only be charged in the event of a no-show or cancellation with less than 24 hours� notice, in which case we assess the performance fee (x) your party size + tax. We look forward to welcoming your guests. Warmly, Jamie Rivera";
  const read = readErrandReply(theirReply, VENUE);
  const notice = errandReplyNotice({
    to: VENUE, asked: "a table for two at The Example Jazz Club on Thursday, October 29, any time after 8:00 pm", read, kind: "card", confirmed: false, booking: null, decideOpen: false,
    unproven: ["Their email could not be fully proven to come from them, so check it before acting on it."],
  });
  it("is a card, not 'nothing to decide'", () => {
    expect(read.kind).toBe("card");
    expect(notice.decide).toHaveLength(1);
  });
  it("passes the real gate, and no replacement character reaches her", () => {
    const laid = laidFor(notice, "cmd_held");
    expect(mailGate(laid)).toEqual([]);
    expect(laid.text).not.toContain("�");
    expect(laid.html).not.toContain("�");
  });
});

it("the card button opens the secure card link instead of the venue homepage", () => {
  const words = "Credit card required. Our home: https://venue.example.test/menu . Add your card: https://secure.sevenrooms.com/card/fake . Expires October 28 at noon.";
  const read = readErrandReply(words, VENUE);
  const notice = errandReplyNotice({ to: VENUE, asked: "A table", read, kind: read.kind, confirmed: false, decideOpen: false });
  expect(notice.decide[0]!.buttons).toEqual([{ label: "Open their card link", url: "https://secure.sevenrooms.com/card/fake" }]);
  expect(notice.details[1]).toContain("https://venue.example.test/menu");
  expect(notice.details[1]).toContain("Expires October 28 at noon.");
  expect(mailGate(laidFor(notice))).toEqual([]);
});

it("keeps the card link, expiry and guarantee below a venue signature, but excludes quoted history", () => {
  const words = "Your reservation is confirmed for 9pm.\n\nWarmly,\nMorgan Example\n\nCredit Card required. Only charged for a no-show or cancellation. https://secure.sevenrooms.com/card/fake expires tomorrow at noon.";
  const read = readErrandReply(words + "\n\nOn Monday, someone wrote:\n> Old words and https://pay.example.test/old", VENUE);
  expect(read.kind).toBe("card");
  expect(read.what_they_said).toBe(words);
  expect(read.what_you_do).toContain("no-show or cancellation guarantee");
  expect(read.what_you_do).not.toContain("https://pay.example.test/old");
  const notice = errandReplyNotice({ to: VENUE, asked: "A table", read, kind: read.kind, confirmed: false, decideOpen: false });
  expect(notice.decide[0]!.buttons).toEqual([{ label: "Open their card link", url: "https://secure.sevenrooms.com/card/fake" }]);
});
