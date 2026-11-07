/**
 * EVERY EMAIL BOSS OS SENDS HER MEETS THE ONE MINIMUM (owner, 7 Nov 2026, personal brain, Settled
 * decisions: "ONE required minimum on every email … layouts used when they fit, never a gate").
 *
 *   1. the subject says what it is, plus a REF code where a reply matters;
 *   2. line 1 says why she is getting it and whether she must do anything ("Nothing to do." counts);
 *   3. a reply reaches the job that sent it (Reply-To is a routed employee address, the job token
 *      rides the thread, and the REF code finds the job when the thread is lost).
 *
 * Every case is the sender's REAL builder output, through the real `employeeMail` and the real
 * send-time gate, so what is checked is what she would receive. Every file in this repo that emails
 * her must have a case here (the census below reads the source), and zero senders examined is a
 * failure. Synthetic data only. The rules: src/shared/boss/mail/ownerLayout.mjs.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { employeeMail, sendersFor, plainOrSimplified, mailGate, EMPLOYEE_LOCAL_PARTS } from "../scripts/ops/notify.mjs";
// @ts-expect-error — plain ESM with no declaration file
import { planMail, stoppedMail, repairDoneMail } from "../scripts/ops/repo-change.mjs";
import { stoppedEmail, researchDoneEmail, noticeOwner } from "../scripts/ops/task-notices.mjs";
import { buildDay } from "../scripts/ops/your-day.mjs";
import { noticeArgs } from "../scripts/ops/simone-commands.mjs";
import { ancestralMail, hicksMail } from "../scripts/ops/errand-reminders.mjs";
import { practiceLayout } from "../scripts/ops/practice-nudges.mjs";
// @ts-expect-error — plain ESM with no declaration file
import { buildHuntEmail } from "../scripts/ops/lib/side-hunt.mjs";
import { prepEmail } from "../scripts/ops/meeting-prep.mjs";
// @ts-expect-error — plain ESM with no declaration file
import { urgentEmail } from "../scripts/ops/risk-watch.mjs";
// @ts-expect-error — plain ESM with no declaration file
import { spryLaid } from "../scripts/ops/spry-weekly.mjs";
// @ts-expect-error — plain ESM with no declaration file
import { outcomesOwner } from "../scripts/ops/lp-outcomes.mjs";
// @ts-expect-error — plain ESM with no declaration file
import { peopleOwner } from "../scripts/ops/people-worth-a-call.mjs";
// @ts-expect-error — plain ESM with no declaration file
import { askEmail, chaseEmail } from "../scripts/ops/kdp-surface-report.mjs";
import { digestEmail, confirmationEmail } from "../src/shared/boss/commentWatch/lane.mjs";
import { approvalNotice, composeDraft } from "../src/shared/boss/clients/hicksUpdate.mjs";
import { composeSpryWeekly } from "../src/shared/boss/spryWeekly/compose.mjs";
import { minimumProblems, ownerEmail } from "../src/shared/boss/mail/ownerLayout.mjs";
import { reminderNotice as ancestralNotice, ancestralHourState } from "../src/worker/boss/spirit/ancestralHour";
import { lapseNotice } from "../src/worker/boss/practice/lapse";
import { reminderNotice as errandNotice } from "../src/worker/boss/commands/run";
import { plainReply } from "../src/worker/boss/intake/mailRefs";

process.env.BOSS_OS_MAIL_KEY = process.env.BOSS_OS_MAIL_KEY ?? "test-key-not-real";
const NOW = Date.parse("2026-11-07T12:15:00Z");
const TO = "o@example.com";
const ORIGIN = "https://boss.sequoiataylor.com";

/** Every address the Worker's inbound route delivers to a seat: the employees' own Reply-To addresses. */
const NAMES = ["Simone", "Danielle", "Monique", "Camille", "Toni", "Imani", "Kendra", "Zora"];
const ROUTED = [...new Set(NAMES.flatMap((n) => sendersFor(n).map((s) => s.reply_to)))];
const INTAKE = "simone@sequoiataylor.com";

type Case = { file: string; who: string; what: string; payload: any };
const as = (who: string) => sendersFor(who)[0]!;
const mail = (who: string, msg: any) => employeeMail(as(who), { to: TO, ...msg });

const PAGE = {
  id: "rpg_synthguard1", state: "delivered", status: "complete", title: "Should a synthetic shop open on Saturdays?",
  summary: "Yes for a trial month: Saturday foot traffic is about twice a weekday's.",
  markdown: "## The answer\n\nYes, for a trial month.\n\n## The numbers\n\nSaturday traffic is about twice a weekday's.",
  sources: [{ title: "Source 1", url: "https://example.com/s1" }], gaps: [],
};

function cases(): Case[] {
  const out: Case[] = [];
  const add = (file: string, who: string, what: string, payload: any) => out.push({ file, who, what, payload });

  // Danielle (repo-change): approve, alarm, a repair's report.
  add("scripts/ops/repo-change.mjs", "Danielle", "plan to approve (A)", mail("Danielle", { subject: "", prelaid: planMail({ row: { id: "rc_m5sguard01" }, out: { in_plain: { change: "the morning email's deal list", so_that: "each deal is one short row", bullets: ["Each deal becomes one row.", "Tap Open to see it."] } }, chosen: "boss-os", asks: [], ready: true }) }));
  add("scripts/ops/repo-change.mjs", "Danielle", "stopped (C)", mail("Danielle", { subject: "", prelaid: stoppedMail({ id: "rc_m5sguard02", repo: "example-site", reason: "the checks went red", happened: "The checks on the example-site change went red, so I did not make it live.", did: "I left the pull request open for a fix." }) }));
  add("scripts/ops/repo-change.mjs", "Danielle", "repair report (C, done)", mail("Danielle", { subject: "", prelaid: repairDoneMail({ id: "rc_m5sguard03", repair_kind: "held_mail" }, { in_plain: { what_broke: "An email to you was held.", what_we_did: "Fixed the sender." } }, NOW) }));

  // Simone and the task notices drain.
  add("scripts/ops/task-notices.mjs", "Simone", "stopped task (C)", mail("Simone", { subject: "", prelaid: stoppedEmail({ from_name: "Simone", subject: "Stopped: Weekly report", task_id: "tsk_m5guard0001", body: '"Fix a held email: Done (partial): the weekly report for every side business, with its numbers" — I tried this three times and could not finish: the report did not load. To clear it by email, reply.' }) }));
  add("scripts/ops/task-notices.mjs", "Camille", "research report (D)", mail("Camille", { subject: "Done: synthetic", prelaid: researchDoneEmail({ kind: "done#1", from_name: "Camille", task_id: "tsk_m5guard0002", subject: "Done: Should a synthetic shop open on Saturdays?", body: `Open the full report: ${ORIGIN}/research/rpg_synthguard1` }, PAGE, "Camille") }));
  const done = { kind: "done#2", from_name: "Simone", task_id: "tsk_m5guard0003", subject: "Done: the contact you asked for", body: "I found the address you asked for: the front desk of Example Gym. It is on your Today page." };
  add("scripts/ops/task-notices.mjs", "Simone", "Done notice, plain text (D)", mail("Simone", { subject: done.subject, text: done.body, owner: noticeOwner(done) }));
  const cnd = { kind: "could_not_do", from_name: "Simone", task_id: "tsk_m5guard0004", subject: "I could not book the table", body: "I could not book the table at Example Cafe: they only take bookings by phone." };
  add("scripts/ops/task-notices.mjs", "Simone", "could not do (Note, she must reply)", mail("Simone", { subject: cnd.subject, text: cnd.body, owner: noticeOwner(cnd) }));

  // The morning email (B).
  const day = buildDay({ diary: [], tasks: [], approvals: [], repoChanges: [], briefing: null, feed: { items: [] }, morning: {} }, NOW);
  add("scripts/ops/your-day.mjs", "Simone", "morning digest (B)", mail("Simone", { subject: day.subject, prelaid: day }));

  // Simone's commands and her errand reminders.
  const errand = errandNotice({ to: "desk@example.com" }, { booking: { at: NOW + 28 * 3_600_000, time: "7:30 pm", label: "dinner", confirmed: true }, request: "a table for two at Example Cafe on Saturday", rules: [], cancel_rule: [] }, "tokAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  add("scripts/ops/errand-reminders.mjs", "Simone", "errand reminder (Note, one tap)", mail("Simone", noticeArgs("cmd_m5guard0005", errand, TO, { layout: "note" })));
  add("scripts/ops/simone-commands.mjs", "Simone", "command answer (D)", mail("Simone", noticeArgs("cmd_m5guard0006", { subject: "The number you asked for", happened: "Example Gym's front desk is 555 0100; it is on your Today page.", details: [] })));
  add("scripts/ops/simone-commands.mjs", "Simone", "command waiting on her (A)", mail("Simone", noticeArgs("cmd_m5guard0007", { subject: "An email to send for you", happened: "I wrote the email you asked for to Example Gym.", decide: [{ title: "Send it as written?", buttons: [{ label: "Send as is", url: `${ORIGIN}/tap/tokBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB?do=send` }] }] })));

  // Imani: the ancestral hour and the practice nudges.
  add("scripts/ops/errand-reminders.mjs", "Imani", "ancestral hour (Note)", mail("Imani", ancestralMail(ancestralNotice(ancestralHourState("2026-10-29", 0), `${ORIGIN}/tap/tokCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC?do=done`))));
  add("scripts/ops/practice-nudges.mjs", "Imani", "practice lapse (Note)", employeeMail(as("Imani"), practiceLayout(lapseNotice("firm" as any, 2, "2026-11-07", ORIGIN))));

  // Camille: the Hicks update for approval, the Spry Labs weekly.
  const clicks = { ok: true as const, now: 40, prev: 30, lastSent: 34, lastSentAt: NOW };
  const fixes = { ok: true as const, items: [{ key: "schema", line: "Fixing the behind-the-scenes labels that tell Google what each page is about." }] };
  const hq = approvalNotice({ draft: composeDraft({ name: "Pat", clicks, fixes, carryOver: [], now: NOW }), clicks, fixes, recipient: { name: "Pat", to: "pat@example.com" }, research: { wins: [], unread: [], dropped: [] },
    taps: { approve: `${ORIGIN}/tap/hqAAAAAAAAAAAAAAAAAAAAAAAAAAAA?do=approve`, change: `${ORIGIN}/tap/hqAAAAAAAAAAAAAAAAAAAAAAAAAAAA?do=change`, skip: `${ORIGIN}/tap/hqAAAAAAAAAAAAAAAAAAAAAAAAAAAA?do=skip` } });
  add("scripts/ops/errand-reminders.mjs", "Camille", "Hicks update to approve (A, v2)", mail("Camille", hicksMail(hq, 2)));
  const spry = composeSpryWeekly({}, { now: NOW });
  add("scripts/ops/spry-weekly.mjs", "Camille", "Spry Labs weekly (Note)", mail("Camille", { subject: "", prelaid: spryLaid(spry) }));

  // Monique: the weekly hunt, the comment watch, LP outcomes, people worth a conversation.
  const hunt = buildHuntEmail({ side: "buy", hunts: [], now: NOW });
  add("scripts/ops/buyer-hunt.mjs", "Monique", "weekly hunt (D)", mail("Monique", { subject: hunt.subject, layout: hunt.layout, owner: hunt.owner }));
  const dig = digestEmail({ new_comments: 3, by_class: { question: 2, praise: 1 }, items: [{ comment_id: "c1", n: 1, class: "question", video_id: "v1", video_title: "A video", author: "A viewer", published_at: "2026-11-06T10:00:00Z", text: "How long does it take?", proposed_action: "reply", proposed_reply: "About ten minutes." }] } as any, "cw_m5guard0008");
  add("scripts/ops/youtube-comment-watch.mjs", "Monique", "comments to approve (A)", mail("Monique", { subject: dig.subject, text: dig.text, owner: dig.owner }));
  const conf = confirmationEmail([{ n: 1, result: "replied", author: "A viewer" }], "cw_m5guard0008");
  add("scripts/ops/youtube-comment-watch.mjs", "Monique", "comment actions done (D)", mail("Monique", { subject: conf.subject, text: conf.text, owner: conf.owner }));
  add("scripts/ops/lp-outcomes.mjs", "Monique", "LP outcomes (Note)", mail("Monique", { subject: "LP outcomes: 1 to suppress, 2 replied, 0 bounced", text: "Two people replied and one asked to be removed.\n\nASKED TO BE REMOVED (1)\n- a.person@example.com", owner: outcomesOwner(1, 2, 0) }));
  add("scripts/ops/people-worth-a-call.mjs", "Monique", "people worth a conversation (D)", mail("Monique", { subject: "2 people worth a conversation this week", text: "Two people worth a note this week.\n\n1. A Person <a.person@example.com>\n   Why now: they replied last month.", owner: peopleOwner(2) }));

  // Simone's Kindle report: a decision, a stop only she can clear, a chase.
  const reg = { titles: [{ title_ref: "T1", title: "A Synthetic Book" }] };
  const ask = askEmail({ id: "kml_m5guard0009", due_at: null }, { title_ref: "T1", note: "Amazon asked for a new subtitle.", action_taken: "Drafted one.", owner_ask: "Approve the new subtitle." }, reg);
  add("scripts/ops/kdp-surface-report.mjs", "Simone", "Kindle decision (A)", mail("Simone", ask));
  const kstop = askEmail({ id: "kml_m5guard0010", due_at: null }, { title_ref: "T1", note: "Amazon needs you to sign in.", action_taken: "Tried the saved sign-in.", owner_ask: "sign in there and approve the device" }, reg);
  add("scripts/ops/kdp-surface-report.mjs", "Simone", "Kindle stop only she can clear (Note)", mail("Simone", kstop));
  add("scripts/ops/kdp-surface-report.mjs", "Simone", "Kindle chase (A)", mail("Simone", chaseEmail({ id: "kml_m5guard0011", title_ref: "T1", due_at: NOW + 3 * 86_400_000, note: "The subtitle still waits.", owner_ask: "Approve the new subtitle." }, reg)));

  // Toni: money at risk.
  add("scripts/ops/risk-watch.mjs", "Toni", "money at risk (C)", mail("Toni", { subject: "", prelaid: urgentEmail({ subject: "Paid AI calls are being charged — the team is on it", happened: "New paid AI spend of one cent since the last check.", did: "Opened a job for the team to switch the job back to a free model.", status: "Being fixed now." }) }));

  // Meeting prep (D).
  const kate = { calendar_uid: "k1", ical_uid: "k1@google.com", title: "Kate Example <> Sequoia", scheduled_at: NOW + 86_400_000, duration_min: 30, location: null, join_url: "https://meet.google.com/abc-defg-hij", calendar: "westpeek",
    attendees: [{ email: "me@example.com", self: true }, { email: "kate@gemfirm.example", name: "Kate Example" }] };
  const prep = prepEmail(kate, { prospects: [], touches: [], references: [], summaries: {}, deals: [] }, { refs: ["cmd_m5guard0012"] });
  add("scripts/ops/meeting-prep.mjs", "Simone", "meeting prep (D)", mail("Simone", { subject: prep.laid.subject, prelaid: prep.laid }));
  return out;
}

/** The Worker's own reply to her email (src/worker/index.ts message.reply), as the payload she gets. */
async function workerReplies(): Promise<Case[]> {
  const db: any = { prepare: () => ({ bind: () => ({ run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) }) }) };
  const laid: any = await plainReply(db, { text: "Done: I added the dentist on Tuesday at 9 to your calendar.", subject: "Re: dentist tuesday", signer: "Simone", messageId: "<m1@example.com>", from: INTAKE });
  const payload = { subject: laid.subject, text: laid.text, html: laid.html, reply_to: INTAKE, to: [TO], headers: { "X-Boss-Layout": laid.layout, ...(laid.refs.length ? { "X-Boss-Ref": laid.refs.join(" ") } : {}), "X-Boss-Owner-Line": "1" } };
  Object.defineProperty(payload, "minimum", { value: laid.minimum, enumerable: false });
  return [{ file: "src/worker/boss/intake/mailRefs.ts", who: "Simone", what: "the Worker's reply to her email (D)", payload }];
}

/** Every file in this repo that emails HER: a send through the Mac's one path, or the Worker's reply. */
const SEND_RE = /\b(?:postEmployeeMail|sendAsEmployee|sendAs)\(|\bplainReply\(/;
/** Files that send but are not a sender of their own: the transport, and a pass-through whose callers are cases. */
const NOT_A_SENDER: Record<string, string> = {
  "scripts/ops/notify.mjs": "the one transport itself",
  "scripts/ops/lib/duty-kit.mjs": "sendAs passes a caller's laid email through (risk-watch, spry-weekly are cases)",
  "scripts/ops/lib/email-map.mjs": "the Email Map's own pattern list",
  "src/worker/index.ts": "calls plainReply, whose output is the Worker reply case",
};
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(m?js|ts)$/.test(n) && !/\.d\.mts$/.test(n) ? [p] : [];
  });
}
function sendingFiles(): string[] {
  return ["scripts/ops", "src/worker", "src/shared"].flatMap((d) => walk(d))
    .filter((f) => SEND_RE.test(readFileSync(f, "utf8").replace(/^\s*(?:\/\/|\*).*$/gm, "")))
    .filter((f) => !NOT_A_SENDER[f] && !/(?:^|\/)(?:validate|tests?)\//.test(f));
}

describe("every email to her meets the 3-point minimum (owner, 7 Nov 2026)", async () => {
  const all = [...cases(), ...(await workerReplies())];

  it("examines real senders: never zero, and every file that emails her has a case", () => {
    expect(all.length, "zero senders examined is a failure, never a pass").toBeGreaterThanOrEqual(20);
    const covered = new Set(all.map((c) => c.file));
    const files = sendingFiles();
    expect(files.length, "the census found no sending files: the scan is broken").toBeGreaterThanOrEqual(10);
    expect(files.filter((f) => !covered.has(f)), "a file that emails her has no case in this guard").toEqual([]);
    // Every layout is in use by at least one real sender.
    expect(new Set(all.map((c) => c.payload.headers?.["X-Boss-Layout"]))).toEqual(new Set(["approve", "delivered", "digest", "alarm", "note"]));
  });

  for (const c of all) {
    it(`${c.who}: ${c.what}`, () => {
      expect(minimumProblems(c.payload, c.payload.minimum, { routed: [...ROUTED, INTAKE] }), `${c.file}`).toEqual([]);
      // What leaves after the send-time gate still meets it, and is never held.
      const r: any = c.file.startsWith("src/worker") ? { held: null, payload: c.payload } : plainOrSimplified(c.payload);
      expect(r.held, JSON.stringify(r.held)).toBeNull();
      expect(minimumProblems({ ...r.payload, reply_to: c.payload.reply_to }, c.payload.minimum, { routed: [...ROUTED, INTAKE] })).toEqual([]);
      expect(EMPLOYEE_LOCAL_PARTS.length).toBeGreaterThan(0);
    });
  }
});

describe("the guard catches an email that misses the minimum (negative proof)", () => {
  const laid: any = ownerEmail({ who: "Danielle", layout: "approve", subject: "Plan for example-site", why: "A plan for the example-site change you asked for", act: "Reply approved to go ahead", ref: "rc_m5sneg0001", decide: [{ title: "Reply approved to go ahead" }] });
  const payload: any = employeeMail(as("Danielle"), { to: TO, subject: "", prelaid: laid });
  const check = (p: any, m = laid.minimum) => minimumProblems(p, m, { routed: ROUTED });
  it("the real one passes", () => expect(check(payload)).toEqual([]));
  it("no subject is caught", () => expect(check({ ...payload, subject: "" }).join()).toMatch(/^1\. the subject/));
  it("a subject without its REF is caught", () => expect(check({ ...payload, subject: "Plan for example-site" }).join()).toMatch(/no REF/));
  it("no line 1 is caught", () => expect(check({ ...payload, text: `\n${payload.text}` }).join()).toMatch(/line 1 is empty/));
  it("a line 1 that does not say whether she must act is caught", () => expect(check({ ...payload, text: payload.text.replace(/ Reply approved to go ahead\./, "") }).join()).toMatch(/whether she must do anything/));
  it("a sender that never said why is caught", () => expect(check(payload, { ...laid.minimum, why: "", declared: false }).join()).toMatch(/never said why/));
  it('"Nothing to do" above a Decide list is caught', () => expect(check(payload, { ...laid.minimum, act: "Nothing to do." }).join()).toMatch(/above a Decide list/));
  it("a Reply-To the Worker does not route is caught", () => expect(check({ ...payload, reply_to: "nobody@example.com" }).join()).toMatch(/^3\./));
  it("a dropped job token is caught", () => expect(check({ ...payload, headers: {} }).join()).toMatch(/job token/));
  it("a copy to someone else is caught (Scooter is copied on no Boss OS email)", () => expect(check({ ...payload, cc: ["someone@example.com"] }).join()).toMatch(/copies someone else/));
  it("an email with no owner layout at all is caught", () => expect(check(payload, null)).toHaveLength(1));
  it("and the census is caught going blind", () => expect(sendingFiles().length).toBeGreaterThan(0));
});
