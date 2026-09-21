/**
 * EVERY EMPLOYEE EMAIL CAN BE REPLIED TO WITH ONE WORD — Reply-To is the employee's own address
 * and the subject leads with her tag, so a reply routes by address or by tag, whichever survives
 * the client. 21 Sep 2026: her "approved" to danielle@ bounced; this is the belt-and-braces half.
 */
import { describe, expect, it } from "vitest";
import { sendersFor, employeeMail, EMPLOYEE_LOCAL_PARTS } from "../scripts/ops/notify.mjs";

describe("employeeMail", () => {
  it("sets reply_to to the sender's own address and leads the subject with the tag, once", () => {
    process.env.BOSS_OS_MAIL_KEY = "k";
    const danielle = sendersFor("Danielle")[0]!;
    expect(danielle.reply_to).toBe("danielle@sequoiataylor.com");
    expect(danielle.tag).toBe("#danielle");
    const p = employeeMail(danielle, { to: "seq.taylor@gmail.com", subject: "plan for WPP-llm [rc_1]", text: "t" });
    expect(p.reply_to).toBe("danielle@sequoiataylor.com");
    expect(p.subject).toBe("#danielle plan for WPP-llm [rc_1]");
    expect(p.to).toEqual(["seq.taylor@gmail.com"]);
    const already = employeeMail(danielle, { to: "x@y", subject: "#danielle DONE: x", text: "t" });
    expect(already.subject).toBe("#danielle DONE: x");
    const boss = sendersFor("Boss OS")[0]!;
    expect(boss.tag).toBeNull();
    expect(employeeMail(boss, { to: "x@y", subject: "system", text: "t" }).subject).toBe("system");
    delete process.env.BOSS_OS_MAIL_KEY;
  });
  it("the roster's local parts are the addresses the routing rules are checked for", () => {
    expect(EMPLOYEE_LOCAL_PARTS).toEqual(expect.arrayContaining(["danielle", "simone", "monique", "camille", "toni", "kendra", "zora", "imani"]));
    expect(EMPLOYEE_LOCAL_PARTS).not.toContain("boss");
  });
});
