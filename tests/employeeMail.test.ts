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
    // The layout it went out in rides beside the code (owner, 7 Nov 2026); a text-only sender is a Note.
    expect(p.headers).toEqual({ "X-Boss-Ref": "rc_1abc", "X-Boss-Layout": "note" });
    expect(p.to).toEqual(["seq.taylor@gmail.com"]);
    expect(plainProblems(p)).toEqual([]);
    const tagged = employeeMail(danielle, { to: "x@y", subject: "#danielle DONE: x", text: "t" });
    expect(tagged.subject).toBe("Done: x");
    // No job code, so no X-Boss-Ref; only the layout it went out in (a Note).
    expect(tagged.headers).toEqual({ "X-Boss-Layout": "note" });
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

describe("what reaches Resend carries no invisible prose marks (7 Nov 2026 live read)", () => {
  it("the gate reads them, the sent text never has them", async () => {
    const { postEmployeeMail, employeeMail: em, sendersFor: sf } = await import("../scripts/ops/notify.mjs");
    const { mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
    process.env.BOSS_OS_SENT_MAIL_DIR = mkdtempSync(join(tmpdir(), "employee-mail-sent-"));
    process.env.BOSS_OS_MAIL_KEY = "k";
    const sender = sf("Simone")[0]!;
    const p: any = em(sender, { to: "o@example.com", subject: "Your day", layout: { happened: "Good morning.", sections: [{ title: "Spirit", full: { summary: "Show ▾", blocks: [{ lines: ["A quiet line of prose."] }] } }] } as any });
    expect(p.text).toContain("\u2063");
    const bodies: string[] = [];
    await postEmployeeMail(sender, p, (async (_u: string, init: any) => { if (init?.body) bodies.push(String(init.body)); return new Response(JSON.stringify({ id: "x" }), { status: 200 }); }) as any);
    expect(bodies.length).toBeGreaterThan(0);
    expect(JSON.parse(bodies[0]!).text).not.toContain("\u2063");
    expect(JSON.parse(bodies[0]!).text).toContain("A quiet line of prose.");
  });
});
