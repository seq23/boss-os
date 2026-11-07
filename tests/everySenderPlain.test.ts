/**
 * EVERY EMAIL BOSS OS SENDS HER IS PLAIN (owner, 25 Oct 2026). Every sender's real builder output —
 * Danielle, Simone, Monique, Camille, Toni — goes through the one send-time gate (`plainOrSimplified`,
 * scripts/ops/notify.mjs): it either passes as written or is simplified (technical lines into an
 * attached file) and SENT. It is never silently held, and no code word reaches her. Synthetic data.
 */
import { describe, expect, it } from "vitest";
import { employeeMail, sendersFor, plainOrSimplified, mailGate } from "../scripts/ops/notify.mjs";
// @ts-expect-error — plain ESM with no declaration file
import { planMail, stoppedMail, repairDoneMail } from "../scripts/ops/repo-change.mjs";
import { stoppedEmail, researchDoneEmail } from "../scripts/ops/task-notices.mjs";
import { NOTHING_TO_DECIDE } from "../src/shared/boss/mail/plain.mjs";
import { buildDay } from "../scripts/ops/your-day.mjs";
import { approvalNotice, composeDraft } from "../src/shared/boss/clients/hicksUpdate.mjs";

process.env.BOSS_OS_MAIL_KEY = process.env.BOSS_OS_MAIL_KEY ?? "test-key-not-real";
const NOW = Date.parse("2026-10-25T12:15:00Z");
const CODE = /\b[\w-]+\.(?:m?js|tsx?|json|md|sql|sh|py)\b|`|(?:^|\s)--[a-z][\w-]+|\bvalidators?\b|\bworktree\b|\b(?:rc|tsk|dd|cw|kml)_[a-z0-9]{4,}\b|^\s*#{1,6}\s|\*\*/m;

/** A heavy synthetic research page: 20 sections, a fee table with a Route column, an address with #9, 12 gaps, 16 sources. */
const HEAVY_PAGE = {
  id: "rpg_heavysynth01", state: "delivered", status: "partial",
  title: "Should a synthetic mobile sample shop open?",
  summary: "Worth a small test first. Start-up is about $1,200 (course $150, licence $50, kit $1,000), but no lab publishes what it pays per visit.",
  markdown: [
    "## The answer", "", "Worth a small test first. Start-up is about **$1,200**, and the first paid visits come through lab referrals.", "",
    "## The numbers", "", "| Route | Fee | Source |", "|---|---|---|",
    "| Lab referral | $45 a visit | [Lab A](https://example.com/lab-a) |", "| Direct legal test | $265 | [Shop B](https://example.com/shop-b) |", "| Court order | Not published | [Court](https://example.com/court) |", "",
    "Office space: Suite #9, 100 Example Street, Example City (shared, $300 a month).", "",
    ...Array.from({ length: 18 }, (_, i) => [`## ${i + 1}. Part ${i + 1} of the work`, "", `${"Plain words about this part of the work, what it takes, who pays and how long it lasts. ".repeat(6)}Cost here is $${(i + 1) * 20} a month.`, ""]).flat(),
    "## What I could not confirm", "", ...Array.from({ length: 12 }, (_, i) => `- Gap ${i + 1}: the fee for case type ${i + 1} is not published.`),
  ].join("\n"),
  sources: Array.from({ length: 16 }, (_, i) => ({ title: `Source ${i + 1}`, url: `https://example.com/source-${i + 1}` })),
  gaps: Array.from({ length: 12 }, (_, i) => `Gap ${i + 1}: the fee for case type ${i + 1} is not published.`),
};
const HEAVY_NOTICE = { kind: "done#3", from_name: "Camille", task_id: "tsk_heavysynth01", subject: "Synthetic report: Should a mobile sample shop open? (full report)", body: "Open the full report: https://boss.sequoiataylor.com/research/rpg_heavysynth01" };

/** [who, how it is built, the payload]. */
function senders(): Array<[string, string, any]> {
  const as = (who: string) => sendersFor(who)[0]!;
  const out: Array<[string, string, any]> = [];
  const dan = as("Danielle");
  out.push(["Danielle", "plan email", employeeMail(dan, { to: "o@example.com", subject: "", prelaid: planMail({ row: { id: "rc_m5sexample1" }, out: { publish_ready: true, in_plain: { change: "the morning email's deal list", so_that: "each deal is one short row", bullets: ["Each deal becomes one row.", "Tap Open to see it."] } }, chosen: "boss-os", asks: [], ready: true }) })]);
  out.push(["Danielle", "stopped email", employeeMail(dan, { to: "o@example.com", subject: "", prelaid: stoppedMail({ id: "rc_m5sexample2", repo: "example-site", reason: "the work got stuck", happened: "I stopped work on example-site: the build in scripts/ops/build.mjs exited with code 1 (`npm run validate` failed).", did: "I kept the worktree and the validator output on your Mac." }) })]);
  out.push(["Danielle", "repair report", employeeMail(dan, { to: "o@example.com", subject: "", prelaid: repairDoneMail({ id: "rc_m5sexample3", repair_kind: "held_mail" }, { in_plain: { what_broke: "plain.mjs held a `--self-test` flag", what_we_did: "Fixed the cleaner." } }, NOW) })]);
  const sim = as("Simone");
  out.push(["Simone", "stopped task notice", employeeMail(sim, { to: "o@example.com", subject: "", prelaid: stoppedEmail({ from_name: "Simone", subject: "Stopped: Weekly report [tsk_m5abcdef12]", task_id: "tsk_m5abcdef12", body: '"Weekly report" — I tried this three times and could not finish: stdout was not JSON from scripts/ops/report.mjs (exit code 1). To clear it by email, reply.' }) })]);
  const day = buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, feed: { items: [] }, morning: {} }, NOW);
  out.push(["Simone", "morning email", employeeMail(sim, { to: "o@example.com", subject: day.subject, prelaid: day })]);
  out.push(["Simone", "key received (legacy text)", employeeMail(sim, { to: "o@example.com", subject: "Key received: EXAMPLE_API_KEY", text: "Your key EXAMPLE_API_KEY is in the vault on your Mac (wrote ~/.boss-os/vault/x.json) and the work that waited for it is running again." })]);
  const mon = as("Monique");
  out.push(["Monique", "LP outcomes (legacy text)", employeeMail(mon, { to: "o@example.com", subject: "LP outcomes: 2 to suppress, 3 replied, 1 bounced", text: "Two people asked not to be written to again.\n\n## OPTED OUT (2)\n- a.person@example.com (see lp-outcomes.mjs)\n\n**BOUNCED (1)**\n- b.person@example.com" })]);
  out.push(["Monique", "comments digest (legacy text)", employeeMail(mon, { to: "o@example.com", subject: "3 comments worth a reply [cw_m5abc123]", text: "Three new comments are worth a reply.\n\nReply with one line per number: `1 delete`, `2 reply as drafted`." })]);
  const cam = as("Camille");
  out.push(["Camille", "research note (legacy text)", employeeMail(cam, { to: "o@example.com", subject: "Your research is ready", text: "The briefing is on its screen. The validator passed on report.json." })]);
  // The Hicks quarterly update's approval email (owner, 3 Nov 2026): the real builder, synthetic numbers.
  const clicks = { ok: true as const, now: 40, prev: 30, lastSent: 34, lastSentAt: NOW };
  const fixes = { ok: true as const, items: [{ key: "schema", line: "Fixing the behind-the-scenes labels that tell Google what each page is about." }] };
  const hq = approvalNotice({ draft: composeDraft({ name: "Pat", clicks, fixes, carryOver: [{ id: "c", line: "A carried line." }], now: NOW }), clicks, fixes,
    recipient: { name: "Pat", to: "pat@example.com" }, research: { wins: [], unread: [], dropped: ["AI-tool visits (not up)"] },
    taps: { approve: "https://boss.sequoiataylor.com/tap/hqAAAAAAAAAAAAAAAAAAAAAAAAAAAA?do=approve", change: "https://boss.sequoiataylor.com/tap/hqAAAAAAAAAAAAAAAAAAAAAAAAAAAA?do=change", skip: "https://boss.sequoiataylor.com/tap/hqAAAAAAAAAAAAAAAAAAAAAAAAAAAA?do=skip" } });
  out.push(["Camille", "Hicks quarterly update for approval", employeeMail(cam, { to: "o@example.com", subject: hq.subject, layout: { happened: hq.happened, details: hq.details, decide: hq.decide } as any })]);
  // The research Done email = the whole report (held 6 Nov 2026, the DNA report for Valerie: over 9,000
  // characters, no "nothing to decide" line, no report kind). Heavy, so the short-note cap is really tested.
  out.push(["Camille", "research full report (heavy)", employeeMail(cam, { to: "o@example.com", subject: HEAVY_NOTICE.subject, text: HEAVY_NOTICE.body, prelaid: researchDoneEmail(HEAVY_NOTICE, HEAVY_PAGE, "Camille") })]);
  const toni = as("Toni");
  out.push(["Toni", "money at risk (legacy text)", employeeMail(toni, { to: "o@example.com", subject: "Paid AI calls are being charged — the team is on it", text: "New OpenRouter spend of $0.01 since the last check, per stderr of risk-watch.mjs.\n\nThe team is switching the job back to a free model." })]);
  return out;
}

describe("every sender's real email goes through the one gate, plain", () => {
  for (const [who, what, payload] of senders()) {
    it(`${who}: ${what} — sent plain (as written or simplified), never held, no code words`, () => {
      const r: any = plainOrSimplified(payload);
      expect(r.held, `${who} ${what}: ${JSON.stringify(r.held)}`).toBeNull();
      expect(mailGate(r.payload)).toEqual([]);
      // Links are links; what she READS carries no code words.
      expect(String(r.payload.text).replace(/https?:\/\/\S+/g, ""), `${who} ${what}`).not.toMatch(CODE);
      expect(r.payload.text).not.toMatch(/^(?:What happened|What we did|Status):\s*$/m);
      expect(String(r.payload.subject)).not.toMatch(/\[|\]|`/);
    });
  }
  it("the jargon a simplified email carried rides as an attached file, for the team", () => {
    const [, , laid] = senders().find(([w, k]) => w === "Monique" && /LP outcomes/.test(k))!;
    // What a sender wrote straight into the payload, past the layout's cleaner: an id and a file name.
    const inject = (t: string) => t.replace("Two people asked not to be written to again.", "Two people asked not to be written to again (thread 1a08831e4f, lp-outcomes.mjs).");
    const payload = { ...laid, text: inject(laid.text), html: inject(laid.html) };
    expect(mailGate(payload).length).toBeGreaterThan(0);
    const r: any = plainOrSimplified(payload);
    expect(r.simplified).not.toBeNull();
    const att = r.payload.attachments.find((a: any) => a.filename === "details.txt");
    expect(Buffer.from(att.content, "base64").toString()).toMatch(/1a08831e4f/);
    expect(r.payload.text).not.toMatch(/1a08831e4f/);
  });
});

describe("the research full report goes as written (held 6 Nov 2026: the DNA report)", () => {
  const laid: any = researchDoneEmail(HEAVY_NOTICE, HEAVY_PAGE, "Camille");
  const payload: any = employeeMail(sendersFor("Camille")[0]!, { to: "o@example.com", subject: HEAVY_NOTICE.subject, text: HEAVY_NOTICE.body, prelaid: laid });
  it("is long enough to test the short-note cap, and carries the #9 and Route words that tripped it", () => {
    expect(String(payload.text).length).toBeGreaterThan(9000);
    expect(String(payload.text)).toContain("#9");
    expect(String(payload.text)).toContain("Route");
  });
  it("carries the report kind to the gate; the gate finds nothing; it goes as written", () => {
    expect(payload.headers?.["X-Boss-Kind"]).toBe("report");
    expect(mailGate(payload)).toEqual([]);
    const r: any = plainOrSimplified(payload);
    expect(r.held).toBeNull();
    expect(r.simplified, "sent as written, never simplified").toBeNull();
  });
  it("says there is nothing to decide: line 3 of the text, and in the HTML", () => {
    expect(String(payload.text).split("\n")[2]).toBe(NOTHING_TO_DECIDE);
    expect(String(payload.html)).toContain(NOTHING_TO_DECIDE);
  });
  it("negative proof: without the report kind the same words are held", () => {
    const { ["X-Boss-Kind"]: _gone, ...rest } = payload.headers ?? {};
    expect(mailGate({ ...payload, headers: rest })).toContain("longer than 9000 characters");
  });
});
