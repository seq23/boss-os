/**
 * A REPLY ONLY WHEN IT IS NEEDED, TO EVERYONE ON THEIR LATEST MESSAGE (owner, 2 Nov 2026: "Every email
 * doesn't need a fucking reply"; "Make sure this is the case for boss os - Simone too").
 *
 * Worker reply decisions are tested through the outreach tick and Mac draft job.
 */
import { describe, expect, it } from "vitest";
import { replyAllRecipients } from "../src/shared/boss/mail/replyNeed.mjs";
import { draftRecipients } from "../scripts/ops/lp-followups.mjs";
import { lpDecideItems } from "../src/shared/boss/lp/plan.mjs";

const LATEST = {
  From: "Kim Lee <kim@acme-capital.example>",
  To: "Owner <owner@fund.example>",
  Cc: "Dana Cole <dana@acme-capital.example>",
};

describe("who the draft goes to", () => {
  it("keeps everyone on their latest message, the person they newly copied included, minus us", () => {
    const r = replyAllRecipients(LATEST, { ours: ["fund.example"] });
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
