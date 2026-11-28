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
  it("keeps the GitHub repo notification envelope out of Decide despite a false lock verdict", () => {
    expect(lockReading({ id: "x", kind: "lock", from: "Fixture <notifications@github.com>", subject: SUBJECT }, "spry.vc", "spry")).toBeNull();
    expect(lockReading({ id: "x", kind: "lock", from_domain: "github.com", subject: SUBJECT }, "personal Gmail", "personal")).toBeNull();
    expect(lockReading({ id: "x", kind: "github_ci", from_domain: "github.com", subject: "Those jobs stopped" }, "spry.vc", "spry")).toBeNull();
  });
  it("a real GitHub account lock is still a lock", () => {
    expect(lockReading({ id: "x", kind: "lock", from: "GitHub <support@github.com>", subject: "Your account has been suspended" }, "spry.vc", "spry")?.state).toBe("alert");
    expect(githubNotice({ from: "GitHub <support@github.com>", subject: "Your account has been suspended" })).toBeNull();
  });
  it("names the repo from the subject", () => {
    expect(githubNotice({ from_domain: "github.com", subject: SUBJECT })).toEqual({ repo: "seq23/local-guides-generator", subject: SUBJECT });
  });
  it("a model-read CI notice yields no lock or Decide line", () => {
    const read = [{ id: "m1", kind: "github_ci", from_domain: "github.com", subject: SUBJECT }];
    const locks = read.flatMap((m) => lockReading(m, "fixture", "spry") ?? []);
    expect(planLocks(locks)).toEqual({ decide: [], lines: [], fixes: [] });
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
