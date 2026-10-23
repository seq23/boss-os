/**
 * THE EMAIL FIX (owner, 23 Oct 2026), rules 1, 3 and 4: the senders that stopped mailing her, the
 * stopped-task notice, and the bounce agent. Synthetic data only (the repo is public).
 */
import { describe, expect, it } from "vitest";
import { chooseReplacement } from "../src/worker/boss/outreach/bounceFix";
import { planRisk } from "../scripts/ops/risk-watch.mjs";
import { planLocks } from "../scripts/ops/outside-locks.mjs";
import { planArchive } from "../scripts/ops/archive-audit.mjs";
import { tailLine } from "../scripts/ops/boss-mail-tail-report.mjs";
import { stoppedEmail, stillStopped, mergeNotices } from "../scripts/ops/task-notices.mjs";
import { layoutProblem, lineProblems } from "../src/shared/boss/mail/plain.mjs";

describe("the bounce agent finds a replacement at the same organisation, never a guess (rule 4)", () => {
  const base = { bounced: "old.person@clinic-example.com", website: "https://www.clinic-example.com", suppressed: new Set<string>() };
  it("someone there who wrote to us comes first — a proven inbox", () => {
    const c = chooseReplacement({ ...base, pages: [{ url: "https://www.clinic-example.com/contact", html: "info@clinic-example.com" }], repliers: [{ email: "front.desk@clinic-example.com", classification: "not_now", gmail_message_id: "m1" }] });
    expect(c).toEqual({ email: "front.desk@clinic-example.com", source: "replied", source_url: "gmail:message/m1" });
  });
  it("else an address the organisation publishes on its own site, with the page it came from", () => {
    const c = chooseReplacement({ ...base, pages: [{ url: "https://www.clinic-example.com/contact", html: '<a href="mailto:info@clinic-example.com">x</a> vendor@webfirm-example.com' }], repliers: [] });
    expect(c).toEqual({ email: "info@clinic-example.com", source: "website", source_url: "https://www.clinic-example.com/contact" });
  });
  it("never the bounced address, a suppressed one, another organisation's, a complaint or unsubscribe sender — and null rather than a guess", () => {
    expect(chooseReplacement({ ...base, pages: [{ url: "u", html: "old.person@clinic-example.com vendor@webfirm-example.com" }], repliers: [] })).toBeNull();
    expect(chooseReplacement({ ...base, suppressed: new Set(["info@clinic-example.com"]), pages: [{ url: "u", html: "info@clinic-example.com" }], repliers: [] })).toBeNull();
    expect(chooseReplacement({ ...base, pages: [], repliers: [{ email: "boss@clinic-example.com", classification: "unsubscribe", gmail_message_id: "m2" }, { email: "x@clinic-example.com", classification: "complaint", gmail_message_id: "m3" }] })).toBeNull();
    expect(chooseReplacement({ ...base, website: null, pages: [], repliers: [] })).toBeNull();
  });
});

describe("Toni's routine risk folds into the morning email; only money at risk is its own email (rules 1, 3)", () => {
  const plan = planRisk([
    { key: "openrouter", state: "alert", was: "ok", line: "New OpenRouter spend: $0.0120 since the last check (balance $3.10). Something called a paid model." },
    { key: "renewal:example.com", state: "alert", was: null, line: "example.com renews November 2." },
    { key: "charge:abc", state: "notice", was: null, line: 'Charge notice October 22: example.com — "Your receipt" (personal Gmail).' },
    { key: "cloudflare", state: "stop", was: null, line: "Cloudflare bills cannot be read: the token has no Billing Read permission." },
    { key: "dkim:example.org", state: "alert", was: null, line: "example.org: no Google DKIM key published." },
    { key: "sender:guides", state: "paused", was: "ok", line: "hello@example.org: bounce rate 4% — already paused." },
    { key: "sender:other", state: "ok", was: "alert", line: "fine" },
  ]);
  it("money at risk → a problem email after the team's fix job is open; renewals → Decide; receipts → a line; chores → fix jobs; bounces → the bounce agent", () => {
    expect(plan.urgent?.subject).toBe("Paid AI calls are being charged — the team is on it");
    expect(plan.fixes.map((f) => f.title)).toEqual([
      "Paid AI calls on OpenRouter — switch them back to free",
      "Toni cannot check Cloudflare bills",
      "Publish the Google DKIM key for example.org",
    ]);
    expect(plan.decide.map((d) => d.title)).toEqual(["Renew example.com?"]);
    expect(plan.decide[0]!.buttons[0]!.url).toMatch(/^https:\/\/lookup\.icann\.org\//);
    expect(plan.lines).toEqual([
      { text: 'New receipt from example.com: "Your receipt".', links: [{ label: "Open the email", url: expect.stringMatching(/^https:\/\/mail\.google\.com\/mail\/u\/0\/#search\//) }] },
      "Outreach from other is back to normal.",
    ]);
    const laid = layoutProblem({ who: "Toni", ...plan.urgent! });
    expect(laid.problems).toEqual([]);
    expect(laid.text).toMatch(/^What happened: New OpenRouter spend: \$0\.0120 since the last check \(balance \$3\.10\)\.\nWhat we did: Opened a job/);
  });
  it("every line and decision it writes is plain", () => {
    for (const l of plan.lines) expect(lineProblems(typeof l === "string" ? l : l.text)).toEqual([]);
    for (const d of plan.decide) expect(lineProblems(`${d.title} ${d.body}`)).toEqual([]);
  });
  it("account locks are hers to answer (Decide, one tap to the notice); a gone lock is a line; an unreadable mailbox is a fix job", () => {
    const l = planLocks([
      { key: "lock:linkedin.com:x", state: "alert", line: 'October 21 linkedin.com: "Your account is restricted" (personal Gmail).' },
      { key: "lock:etsy.com:y", state: "cleared", was: "alert", line: "gone" },
      { key: "mailbox:spry", state: "stop", line: "The spry.vc mailbox could not be read (403)." },
    ]);
    expect(l.decide.map((d) => d.title)).toEqual(["Answer the linkedin.com notice on your account?"]);
    expect(l.lines).toEqual(["An account notice from etsy.com is no longer showing (resolved or older than 8 days)."]);
    expect(l.fixes.length).toBe(1);
  });
});

describe("Zora's audit and the tail are lines, not emails (rule 1)", () => {
  it("Zora: one line for what was fixed and filed; flagged items name their owner; an unreadable source is a fix job", () => {
    const p = planArchive({ fixing: 2, filed: 1, flagged: [{ owner: "Camille", line: "The research index is 20 days old." }], stops: [{ key: "open_loops", line: "x" }] });
    expect(p.lines).toEqual([
      "Zora's Friday check: 2 out-of-date documents are being brought up to date by Danielle; 1 delivered piece filed where you can find it.",
      "Zora flagged to Camille: The research index is 20 days old.",
    ]);
    expect(p.fixes.map((f) => f.title)).toEqual(["Zora cannot check open loops"]);
  });
  it("the tail: the report's plain second line; an INCOMPLETE run says it is still being worked on", () => {
    expect(tailLine("Fix the footer\nDanielle fixed the footer link and it is live.\nFRICTION_FIXED: 1", "Re: Fix the footer")).toEqual({ line: 'Your email "Fix the footer": Danielle fixed the footer link and it is live.', incomplete: false });
    expect(tailLine("x\n\nINCOMPLETE: ended\nFRICTION_FIXED: 0", "Make the cover").line).toBe('Your email "Make the cover": still being worked on; the team is finishing it.');
  });
});

describe("a Stopped email is a problem email, and only while it is true (rule 3)", () => {
  const notice = { from_name: "Simone", task_id: "tsk_m5jh8bjbxmhtfz1w", subject: "Stopped: Make the cover [tsk_m5jh8bjbxmhtfz1w]", body: '"Make the cover" stopped and did not finish.\n\nWaiting on: a word from you. Why: I tried this 3 times and could not finish: the model answered without the file. To clear it by email: reply "try again".\n\nReply to this email and your answer goes straight back to this job. tsk_m5jh8bjbxmhtfz1w' };
  it("What happened → What we did → Status, one Decide, the job code hidden in the header", () => {
    const e = stoppedEmail(notice);
    expect(e.problems).toEqual([]);
    expect(e.subject).toBe("Stopped: Make the cover");
    expect(e.text).toContain('What happened: "Make the cover" stopped before it finished: the model answered without the file.');
    expect(e.text).toContain("What we did: Tried it 3 times, kept everything as it was");
    expect(e.text).toMatch(/^Status: Waiting for your word\./m);
    expect(e.refs).toEqual(["tsk_m5jh8bjbxmhtfz1w"]);
    expect(`${e.subject}${e.text}`).not.toMatch(/tsk_/);
  });
  it("a task that is running or done again is a false alarm; duplicates are one email", () => {
    expect(stillStopped({ status: "running" })).toBe(false);
    expect(stillStopped({ status: "done" })).toBe(false);
    expect(stillStopped(null)).toBe(false);
    expect(stillStopped({ status: "failed" })).toBe(true);
    const groups = mergeNotices([notice, { ...notice, subject: "Stopped: Make the cover" }, { ...notice, from_name: "Toni" }]);
    expect(groups.length).toBe(2);
    expect(groups[0]!.also.length).toBe(1);
  });
});
