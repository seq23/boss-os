/**
 * MONIQUE'S WEEKLY "PEOPLE WORTH A CONVERSATION" READS AS SENTENCES (26 Oct 2026). The intro was
 * hard-wrapped, and the email showed "pick out the people worth a" then a bullet "- Conversation —".
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs with no types
import { weeklyNote } from "../scripts/ops/people-worth-a-call.mjs";
import { employeeMail, sendersFor, plainOrSimplified } from "../scripts/ops/notify.mjs";
import { fromLegacy } from "../src/shared/boss/mail/plain.mjs";

const picks = [{ name: "A. Person", email: "a.person@example.com", rank: 0, why: "They asked you a question on 12 Oct.", say: "Answer the question." }];

describe("the weekly note keeps its sentences whole", () => {
  it("no paragraph is broken across lines, in the text and in the HTML she receives", () => {
    const text = weeklyNote(picks, 541, 131);
    expect(text).toContain("pick out the people worth a conversation — not everyone who has gone quiet");
    for (const line of text.split("\n")) expect(line).not.toMatch(/ a$|^conversation/i);
    process.env.BOSS_OS_MAIL_KEY = "test-key-not-real";
    const mail = plainOrSimplified(employeeMail(sendersFor("Monique")[0]!, { to: "owner@example.com", subject: "1 people worth a conversation this week", text }));
    delete process.env.BOSS_OS_MAIL_KEY;
    const sent = mail.payload;
    const body = String(sent.text);
    expect(body).toContain("pick out the people worth a conversation");
    expect(body).not.toMatch(/^- Conversation/m);
    expect(String(sent.html)).not.toMatch(/people worth a<\/p>|<li>Conversation/i);
    expect(String(sent.html)).toMatch(/people worth a conversation/);
  });

  it("any sender's hard-wrapped paragraph is joined, never split into a bullet (the legacy path)", () => {
    const text = ["Sequoia,", "", "Once a week I read your correspondence and pick out the people worth a", "conversation — not everyone who has gone quiet.", "", "Nothing here needs a decision."].join("\n");
    const laid = fromLegacy({ who: "Monique", subject: "5 people worth a conversation this week", text });
    expect(laid.text).toContain("pick out the people worth a conversation — not everyone who has gone quiet.");
    expect(laid.text).not.toMatch(/^- Conversation/m);
  });
});
