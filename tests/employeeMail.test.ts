/**
 * EVERY EMPLOYEE EMAIL CAN BE REPLIED TO WITH ONE WORD — Reply-To is the employee's own address, so a
 * reply routes by address (21 Sep 2026: her "approved" to danielle@ bounced; every employee address now
 * has a routing rule). The `#tag` and the `[rc_…]` code LEFT THE SUBJECT on 22 Oct 2026 (owner:
 * "confusing hard to read"): the code rides in `X-Boss-Ref` and against the Message-ID her reply quotes
 * (tests/boss/mailThread.test.ts proves the reply still lands on its job).
 */
import { describe, expect, it } from "vitest";
import { sendersFor, employeeMail, EMPLOYEE_LOCAL_PARTS } from "../scripts/ops/notify.mjs";
import { plainProblems } from "../src/shared/boss/mail/plain.mjs";

describe("employeeMail", () => {
  it("sets reply_to to the sender's own address; the subject is plain and the job code rides in a header", () => {
    process.env.BOSS_OS_MAIL_KEY = "k";
    const danielle = sendersFor("Danielle")[0]!;
    expect(danielle.reply_to).toBe("danielle@sequoiataylor.com");
    expect(danielle.tag).toBe("#danielle");
    const p = employeeMail(danielle, { to: "seq.taylor@gmail.com", subject: "plan for WPP-llm [rc_1abc]", text: "t" });
    expect(p.reply_to).toBe("danielle@sequoiataylor.com");
    expect(p.subject).toBe("Plan for WPP-llm");
    expect(p.headers).toEqual({ "X-Boss-Ref": "rc_1abc" });
    expect(p.to).toEqual(["seq.taylor@gmail.com"]);
    expect(plainProblems(p)).toEqual([]);
    const tagged = employeeMail(danielle, { to: "x@y", subject: "#danielle DONE: x", text: "t" });
    expect(tagged.subject).toBe("Done: x");
    expect(tagged.headers).toBeUndefined();
    const boss = sendersFor("Boss OS")[0]!;
    expect(boss.tag).toBeNull();
    expect(employeeMail(boss, { to: "x@y", subject: "system", text: "t" }).subject).toBe("System");
    delete process.env.BOSS_OS_MAIL_KEY;
  });
  it("the roster's local parts are the addresses the routing rules are checked for", () => {
    expect(EMPLOYEE_LOCAL_PARTS).toEqual(expect.arrayContaining(["danielle", "simone", "monique", "camille", "toni", "kendra", "zora", "imani"]));
    expect(EMPLOYEE_LOCAL_PARTS).not.toContain("boss");
  });
});
