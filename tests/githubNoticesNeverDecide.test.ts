/**
 * GITHUB NOTIFICATION MAIL IS NEVER A DECIDE ITEM (owner, 27 Oct 2026).
 *
 * Simone's morning email asked "Answer the github.com notice on your account?" for
 * "[seq23/local-guides-generator] PR run failed: Validate - Drop form leads from blocked email domains
 * quietly" — a CI mail for a PR merged long before, on a green main. Toni's outside-locks check read
 * github.com + "blocked" as an account lock. A CI/PR mail is now a repair when still red on the
 * default branch, and nothing at all when resolved.
 */
import { describe, expect, it } from "vitest";
import { ciStateOf, githubNotice, lockReading, planCiNotices, planLocks } from "../scripts/ops/outside-locks.mjs";
import { lineProblems } from "../src/shared/boss/mail/plain.mjs";

const SUBJECT = "[seq23/local-guides-generator] PR run failed: Validate - Drop form leads from blocked email domains quietly (78809fa)";

describe("GitHub CI and PR mail never becomes a lock or a Decide item", () => {
  it("the 27 Oct notice is not a lock reading, from either mailbox shape", () => {
    expect(lockReading({ from: "seq23 <notifications@github.com>", subject: SUBJECT, date: "2026-10-26" }, "spry.vc")).toBeNull();
    expect(lockReading({ from_domain: "github.com", subject: SUBJECT, date: "2026-10-26" }, "personal Gmail")).toBeNull();
    expect(lockReading({ from_domain: "github.com", subject: "Re: [seq23/local-guides-generator] Drop form leads from blocked email domains quietly (PR #90)" }, "personal Gmail")).toBeNull();
    for (const s of ["Run failed: CI - main (abc123)", "[seq23/boss-os] Pull request blocked by required checks", "Workflow run cancelled: deploy"]) {
      expect(lockReading({ from_domain: "github.com", subject: s }, "spry.vc")).toBeNull();
    }
  });
  it("a real GitHub account lock is still a lock", () => {
    expect(lockReading({ from: "GitHub <support@github.com>", subject: "Your account has been suspended" }, "spry.vc")?.state).toBe("alert");
    expect(githubNotice({ from: "GitHub <support@github.com>", subject: "Your account has been suspended" })).toBeNull();
  });
  it("names the repo from the subject", () => {
    expect(githubNotice({ from_domain: "github.com", subject: SUBJECT })).toEqual({ repo: "seq23/local-guides-generator", subject: SUBJECT });
  });
  it("planLocks never writes a Decide item or a line for a GitHub notice, alerting or cleared (old state included)", () => {
    const l = planLocks([
      { key: "lock:github.com:seq23 local guides generator pr run failed validate drop form leads from blocked em", state: "alert", line: `2026-10-26 github.com: "${SUBJECT}" (personal Gmail).` },
      { key: "lock:github.com:seq23 local guides generator pr run failed validate drop form leads from blocked em", state: "cleared", was: "alert", line: "gone" },
      { key: "lock:github.com:re seq23 local guides generator drop form leads from blocked", state: "cleared", was: "alert", line: "gone" },
    ]);
    expect(l).toEqual({ decide: [], lines: [], fixes: [] });
    expect(JSON.stringify(l)).not.toMatch(/github\.com notice/);
  });
});

describe("planCiNotices: still red → a repair and one thin line; resolved → silence", () => {
  const notice = { repo: "seq23/local-guides-generator", subject: SUBJECT };
  const at = Date.parse("2026-10-27T12:00:00Z");
  it("green or closed: dropped silently", () => {
    expect(planCiNotices([notice], { "seq23/local-guides-generator": "green" }, { at })).toEqual({ fixes: [], lines: [] });
    expect(planCiNotices([notice], { "seq23/local-guides-generator": "closed" }, { at })).toEqual({ fixes: [], lines: [] });
  });
  it("red: one red_check repair for Danielle, one plain What broke / What we did / Status line, nothing to decide", () => {
    const p = planCiNotices([notice, notice], { "seq23/local-guides-generator": "red" }, { at });
    expect(p.fixes).toHaveLength(1);
    expect(p.fixes[0]!.prompt).toMatch(/^seq23\/local-guides-generator — /);
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]).toMatch(/^What broke: .+ What we did: Danielle .+ Status: Still working on it/);
    expect(lineProblems(p.lines[0]!)).toEqual([]);
    expect(p).not.toHaveProperty("decide");
  });
  it("a repair already handed over this week is not opened again", () => {
    expect(planCiNotices([notice], { "seq23/local-guides-generator": "red" }, { at, handed: { "seq23/local-guides-generator": "2026-10-25T12:00:00Z" } }).fixes).toEqual([]);
  });
  it("ciStateOf reads the newest run of each workflow on the default branch", () => {
    const gh = (runs: unknown[]) => (args: string[]) => (args[0] === "api" ? "main\n" : JSON.stringify(runs));
    expect(ciStateOf("o/r", gh([{ workflowName: "CI", status: "completed", conclusion: "success" }, { workflowName: "CI", status: "completed", conclusion: "failure" }]))).toBe("green");
    expect(ciStateOf("o/r", gh([{ workflowName: "CI", status: "completed", conclusion: "failure" }, { workflowName: "E2E", status: "completed", conclusion: "success" }]))).toBe("red");
    expect(ciStateOf("o/r", () => { throw new Error("gh missing"); })).toBe("unknown");
  });
});
