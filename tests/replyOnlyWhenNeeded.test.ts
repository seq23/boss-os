/**
 * A REPLY ONLY WHEN IT IS NEEDED, TO EVERYONE ON THEIR LATEST MESSAGE (owner, 2 Nov 2026: "Every email
 * doesn't need a fucking reply"; "Make sure this is the case for boss os - Simone too").
 *
 * The shared helper (src/shared/boss/mail/replyNeed.mjs) and the LP decision point on her Mac
 * (scripts/ops/lp-followups.mjs: the first reply and the reply to someone who wrote again). Monique's
 * outreach replies are pinned where they run, in tests/boss/moniqueOutreach.test.ts.
 */
import { describe, expect, it } from "vitest";
import { replyAllRecipients, replyNeed } from "../src/shared/boss/mail/replyNeed.mjs";
import { draftRecipients, lpReplyDecision } from "../scripts/ops/lp-followups.mjs";
import { lpDecideItems } from "../src/shared/boss/lp/plan.mjs";

const PASS_ALONG = "Thanks Sequoia, I've forwarded this to our investment team. They'll be in touch if it's a fit.";
const LATEST = {
  From: "Kim Lee <kim@acme-capital.example>",
  To: "Sequoia Taylor <sequoia@westpeek.ventures>",
  Cc: "Dana Cole <dana@acme-capital.example>, scooter@westpeek.ventures",
};

describe("does it need a reply", () => {
  it("a pass-along, a loop-in, 'we're reviewing', a thank-you, an FYI and an auto-reply get no draft", () => {
    for (const words of [
      PASS_ALONG,
      "Looping in my colleague Dana who handles secondaries. Dana, can you take it from here?",
      "Thanks, we're reviewing and will get back to you next week.",
      "Thanks, got it!",
      "FYI our fund closed last month.",
      "I'm out of the office until Monday with limited access to email.",
    ]) {
      expect(replyNeed(words).needed, words).toBe(false);
      expect(lpReplyDecision(words).draft, words).toBe(false);
    }
  });

  it("a question, a request, a time or a yes gets a draft, read from their own words only", () => {
    for (const words of ["Are you in NYC? The only day available is Wednesday.", "Please send the deck.", "Nov 5 at 11am can work.", "Happy to chat next week."]) {
      expect(lpReplyDecision(words).draft, words).toBe(true);
    }
    // A question in the quoted history under a pass-along is not theirs.
    expect(replyNeed(`${PASS_ALONG}\n\nOn Mon, Nov 2, 2026 at 9:00 AM Sequoia wrote:\n> Would you have 20 minutes?`).needed).toBe(false);
  });
});

describe("who the draft goes to", () => {
  it("keeps everyone on their latest message, the person they newly copied included, minus us", () => {
    const r = replyAllRecipients(LATEST);
    expect(r.to).toEqual(["Kim Lee <kim@acme-capital.example>"]);
    expect(r.cc).toEqual(["Dana Cole <dana@acme-capital.example>"]);
    // The LP draft on her Mac uses exactly that, and her approval email shows To and Cc.
    expect(draftRecipients("kim@acme-capital.example", { recipients: r })).toEqual(r);
    const [card] = lpDecideItems([{ id: "lpr_1", address: "kim@acme-capital.example", status: "drafted", tap_token: "t", bucket: "call", first_seen: "2026-11-01",
      draft_body: "Hi Kim", draft_message_id: "m1", reply_to: JSON.stringify(r.to), reply_cc: JSON.stringify(r.cc) }], Date.parse("2026-11-02T12:00:00Z"));
    expect(card!.details).toContain("To: Kim Lee <kim@acme-capital.example>");
    expect(card!.details).toContain("Cc: Dana Cole <dana@acme-capital.example>");
  });
});
