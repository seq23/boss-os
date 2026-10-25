#!/usr/bin/env node
/**
 * EVERY BOSS OS EMAIL PASSES THE PLAIN-EMAIL GATE, AND THE GATE CAN SEE (owner, 23 Oct 2026, rule 13).
 *
 * Her inbox review on 22–23 Oct: nine Boss OS emails in two days, none useful to a busy executive —
 * raw Gmail ids, shell commands, /api paths, PR numbers, UTC times, `#simone` tags, jargon, "Needs a
 * look" beside "Nothing needed", "I could not read", a "Stopped" email with no "what we did".
 *
 * `npm run validate:email-plain` proves, by RUNNING the shipped code:
 *   1. THE GATE SEES THE PROBLEM. Blurred copies of those emails, as they were sent, each FAIL
 *      `plainProblems` with the reason named (a gate that passes everything is watching an empty room).
 *   2. EVERY REWRITTEN SENDER PASSES. Simone's morning email (built by `buildDay` from section files
 *      shaped like D's and L's), a problem email, a stopped-task notice, Toni's risk plan, Zora's audit
 *      plan and the tail line — each laid out and each passing the gate.
 *   3. THE GATE IS WIRED WHERE MAIL LEAVES. `postEmployeeMail` holds before it posts; the Worker's
 *      `plainReply` holds too; the folded senders (Zora, Toni's routine risk, the tail) send nothing;
 *      a stopped notice re-checks its task first.
 * Rule 0: zero fixtures examined hard-fails. `--self-test` breaks each check and proves it goes red.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { plainProblems, layoutProblem, layoutEmail, fromLegacy, JARGON, lineProblems, MAX_TEXT_CHARS } from "../../src/shared/boss/mail/plain.mjs";
import { buildDay, briefingDecision } from "../ops/your-day.mjs";
import { stoppedEmail, stillStopped, mergeNotices } from "../ops/task-notices.mjs";
import { planRisk } from "../ops/risk-watch.mjs";
import { planArchive } from "../ops/archive-audit.mjs";
import { tailLine } from "../ops/boss-mail-tail-report.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

/** Her inbox, 22–23 Oct 2026, blurred (names and ids replaced). Each must fail, for the reason named. */
export const INBOX = [
  { why: /code or Gmail id/, e: { subject: "3 people worth a look for Company A", text: "Decide (1)\nOpen 1a08831e4f… in Gmail." } },
  { why: /command/, e: { subject: "Matches for Company A", text: "x\n\nNothing to decide — this is just so you know.\nTo hide one: npm run capital:match -- --not 3" } },
  { why: /#tag/, e: { subject: "#simone Tail: your email — 2 fixed", text: "x\n\nNothing to decide — this is just so you know." } },
  { why: /PR number/, e: { subject: "Your email: done", text: "x\n\nNothing to decide — this is just so you know.\nFixed in PR #108." } },
  { why: /UTC time/, e: { subject: "Your email: done", text: "x\n\nNothing to decide — this is just so you know.\nFinished at 14:05 UTC." } },
  { why: /API path/, e: { subject: "Archive: 2 stale, 3 filed", text: "x\n\nNothing to decide — this is just so you know.\nFiled (GET /api/boss/research/delivered)." } },
  { why: /jargon/, e: { subject: "Matches", text: "x\n\nNothing to decide — this is just so you know.\nThat is an answer, not an empty run. Friction: none. The N-PORT search read 2 filings." } },
  { why: /needs a look" beside "nothing needed/, e: { subject: "Risk: 3 moved", text: "x\n\nNothing to decide — this is just so you know.\nNeeds a look: a sender bounced.\nNothing needed from you." } },
  { why: /I could not read/, e: { subject: "Your day", text: "x\n\nNothing to decide — this is just so you know.\nI could not read your calendar this morning." } },
  { why: /without "What we did"|without its status/, e: { subject: "Stopped: Make the cover", text: "What happened: it stopped." } },
  { why: /Decide is not first/, e: { subject: "Your day", text: "Good morning.\n\nDetails:\n- one\n\nDecide (1)\n1. Approve it" } },
  { why: /longer than/, e: { subject: "Your day", text: `x\n\nNothing to decide — this is just so you know.\n${"word ".repeat(2000)}` } },
  { why: /bare links/, e: { subject: "Links", text: "x\n\nNothing to decide — this is just so you know.\nhttps://a.example/1\nhttps://a.example/2\nhttps://a.example/3" } },
];

/**
 * A COMMAND SURVIVES ANY WRAPPING (25 Oct 2026 held mail: a plan's table row carried a flag inside
 * backticks, which the cleaner then unwrapped into something the gate had to catch instead of
 * removing). Each line here must come out of the cleaner with the flag gone, not merely refused by
 * the gate afterward.
 */
export const COMMAND_CORPUS = [
  "Its `--self-test` fails on the shipped-today composition.",
  "Run `node scripts/validate/foo.mjs --self-test` to check it.",
  "The flag '--self-test' is read as a command too.",
  'The flag "--self-test" is read as a command too.',
  "See [--self-test] in the docs.",
  "Run --self-test to check it.",
];

const NOW = Date.parse("2026-10-23T12:15:00Z");
const G = "https://mail.google.com/mail/u/0/#all/";
const at = new Date(NOW).toISOString();

/** The morning, from section files shaped like D's and L's (synthetic). */
export function morningSample() {
  return buildDay({
    diary: [], tasks: [{ id: "tsk_x1", title: "Pick the cover", status: "awaiting_approval", employee_name: "Simone" }], approvals: [], repoChanges: [],
    briefing: { for_day: "2026-10-23", headline: "Rates hold", sections: [{ key: "one_minute_summary", bullets: ["Rates held.", "A large AI secondary priced up.", "Two IPO filings.", "A launch slipped.", "One ruling on fund disclosure."] }] },
    bounceFixes: { replaced: 4, dropped: 0, restarted: ["The Industry Guides"] },
    morning: {
      deals: { section: "deals", at, rows: [{ company: "Company A", side: "Buy", size: "$1B", from: "Broker 1", tag: "Rainmaker", url: `${G}a` }, { company: "Company B", side: "Sell", size: "$300M", price: "$138", from: "Broker 2", url: `${G}b` }], link: { label: "See the full grid", url: "https://boss.sequoiataylor.com/" } },
      monique_found: { section: "monique_found", at, lines: ["For your $1B Company A buyer: 5 funds hold $310M between them."] },
      lp: { section: "lp", at, decide: [{ title: "Reply to an LP who wants a call", body: "Monique wrote the reply.", buttons: [{ label: "Send as is", url: `${G}d` }, { label: "Edit, then send", url: `${G}e` }, { label: "Skip", url: "https://boss.sequoiataylor.com/" }], priority: 5 }] },
      prospects: { section: "prospects", at, lines: ["Prospecting: 12 new buyers found, 3 follow-ups sent."] },
      tail: { section: "tail", at, lines: [tailLine("Fix the footer\nDanielle fixed the footer link and it is live.\nFRICTION_FIXED: 1", "Fix the footer").line] },
      eightraise: { section: "eightraise", at, credits: { used: 3, budget: 75, kept: 30 } },
    },
    feed: { items: [{ kind: "money", title: "A customer · $180 due today", detail: "$130 + $50 refundable deposit" }] },
  }, NOW);
}

export function senderSamples() {
  const risk = planRisk([
    { key: "openrouter", state: "alert", was: "ok", line: "New OpenRouter spend: $0.0120 since the last check (balance $3.10). Something called a paid model." },
    { key: "renewal:example.com", state: "alert", was: null, line: "example.com renews November 2." },
    { key: "charge:abc", state: "notice", was: null, line: 'Charge notice October 22: example.com — "Your receipt" (personal Gmail).' },
    { key: "cloudflare", state: "stop", was: null, line: "Cloudflare bills cannot be read." },
  ]);
  const archive = planArchive({ fixing: 1, filed: 3, flagged: [], cleared: [], stops: [{ key: "open_loops", line: "x" }] });
  return {
    risk, archive,
    emails: [
      ["morning email", morningSample()],
      ["problem email", layoutProblem({ who: "Toni", subject: "Some outreach emails bounced — already handled", happened: "4 outreach emails went to addresses that no longer work.", did: "Removed them for good and found working ones on each company's own site.", done: true, status: "Outreach restarted at 9:05 am. Nothing needed from you." })],
      ["money at risk", layoutProblem({ who: "Toni", ...risk.urgent })],
      ["stopped notice", stoppedEmail({ from_name: "Simone", subject: "Stopped: Make the cover [tsk_m5jh8bjbxmhtfz1w]", task_id: "tsk_m5jh8bjbxmhtfz1w", body: '"Make the cover" stopped and did not finish.\n\nWaiting on: a word from you. Why: I tried this once and could not finish: the model answered without the file. To clear it by email: reply "try again".\n\nReply to this email and your answer goes straight back to this job. tsk_m5jh8bjbxmhtfz1w' })],
      ["a legacy email fitted to the layout", fromLegacy({ who: "Monique", subject: "#monique 5 crosses — OpenAI, OpenAI", text: "Sequoia,\n\nI found 5 matches worth a call. Run npm run capital:match -- --not to hide one.\nSaved at 14:05 UTC (PR #112).\n\nReply approved to send the intros.\n\n— Monique" })],
    ],
  };
}

export function check() {
  const fails = [];
  let examined = 0;
  // 1. The gate sees each defect.
  for (const { why, e } of INBOX) {
    examined += 1;
    const p = plainProblems(e);
    if (!p.some((x) => why.test(x))) fails.push(`the gate missed ${why} in "${e.subject}" (it said: ${p.join("; ") || "nothing"})`);
  }
  for (const j of JARGON) { examined += 1; if (!lineProblems(j.sample).length && !j.ban.test(j.sample)) fails.push(`jargon ${j.ban} cannot catch its own sample "${j.sample}"`); }
  // The cleaner's output always passes the check, over a corpus of hostile wrapped flags (25 Oct 2026).
  for (const line of COMMAND_CORPUS) { examined += 1; const p = lineProblems(line); if (p.length) fails.push(`the cleaner left a command in "${line}": ${p.join("; ")}`); }
  // A plan email built from a 30,000 character plan passes and fits (25 Oct 2026 held mail: 9,152
  // characters with nothing bounding it).
  {
    examined += 1;
    const details = Array.from({ length: 1 }, () => "x".repeat(30000)).flatMap((s) => s.match(/.{1,80}/g) ?? []);
    const laid = layoutEmail({ who: "Danielle", subject: "Plan for example-site [rc_abc123]", happened: "Plan ready for example-site.", decide: [{ title: "Reply approved to build it" }], details });
    if (laid.text.length > MAX_TEXT_CHARS) fails.push(`a 30,000 character plan email is ${laid.text.length} characters, over the ${MAX_TEXT_CHARS} cap`);
    if (laid.problems.length) fails.push(`a 30,000 character plan email fails the gate: ${laid.problems.join("; ")}`);
  }
  // 2. Every rewritten sender passes.
  const { risk, archive, emails } = senderSamples();
  for (const [name, laid] of emails) {
    examined += 1;
    if (laid.problems.length) fails.push(`${name} fails the gate: ${laid.problems.join("; ")}`);
  }
  const morning = emails[0][1];
  const order = ["Decide (", "New deals since yesterday", "Monique found", "This morning's briefing (Camille)", "Done for you", "Porch & Party: To do for Valerie", "— Simone"];
  const idx = order.map((h) => morning.text.indexOf(h));
  if (idx.some((n) => n < 0) || idx.some((n, i) => i && n < idx[i - 1])) fails.push(`the morning email is not in her order: ${order.map((h, i) => `${h}@${idx[i]}`).join(", ")}`);
  // Owner, 24 Oct 2026: the 8Raise line only when something is wrong (3 of 75 used is not).
  if (/8Raise/.test(morning.text)) fails.push("the morning email carries the 8Raise line when nothing is wrong with the credits");
  if (/more on your Today page/.test(morning.text)) fails.push("the morning email hides decisions behind \"more on your Today page\"");
  if (!risk.urgent || risk.decide.length !== 1 || risk.fixes.length !== 2 || risk.lines.length !== 1) fails.push(`planRisk did not route money/renewal/receipt/unreadable as ruled: ${JSON.stringify({ urgent: Boolean(risk.urgent), d: risk.decide.length, f: risk.fixes.length, l: risk.lines.length })}`);
  if (archive.fixes.length !== 1 || archive.lines.length !== 1) fails.push("planArchive did not turn a stop into a fix job and the rest into one line");
  if (briefingDecision(null, Date.parse("2026-10-23T11:40:00Z")) !== "wait" || briefingDecision(null, Date.parse("2026-10-23T12:45:00Z")) !== "send_late") fails.push("the briefing wait is not 06:40 → 07:45 Central");
  if (stillStopped({ status: "running" }) || !stillStopped({ status: "failed" })) fails.push("stillStopped does not kill a false alarm");
  if (mergeNotices([{ from_name: "Simone", subject: "Stopped: x [tsk_a1]" }, { from_name: "Simone", subject: "Stopped: x [tsk_a1]" }]).length !== 1) fails.push("duplicate notices are not merged");
  // 3. Wired where mail leaves.
  const notify = read("scripts/ops/notify.mjs");
  const post = notify.slice(notify.indexOf("export async function postEmployeeMail"), notify.indexOf("export function mailGate"));
  // 25 Oct 2026: the gate makes a failing email plain first (`plainOrSimplified`), sends what it made
  // plain, and holds only what is still failing — all before anything is posted.
  const sendPart = post.slice(0, post.indexOf("export function plainOrSimplified") === -1 ? post.length : post.indexOf("export function plainOrSimplified"));
  const simplifier = post.slice(post.indexOf("export function plainOrSimplified"));
  if (!/const ready = plainOrSimplified\(payload\);\s*\n\s*if \(ready\.held\) return holdMail\(/.test(sendPart) || !/payload = ready\.payload;/.test(sendPart) || sendPart.indexOf("plainOrSimplified(") > sendPart.indexOf("fetchImpl(RESEND")) fails.push("postEmployeeMail does not hold a failing email before it posts");
  if (!/const problems = mailGate\(payload\)/.test(simplifier) || !/simplifyForOwner\(/.test(simplifier) || !/const still = mailGate\(next\)/.test(simplifier)) fails.push("plainOrSimplified does not re-check what it simplified before it may be sent");
  if (!/if \(laid\.problems\.length\) \{[\s\S]{0,400}reply_held/.test(read("src/worker/boss/intake/mailRefs.ts"))) fails.push("the Worker's plainReply does not hold a failing reply");
  for (const f of ["scripts/ops/archive-audit.mjs", "scripts/ops/outside-locks.mjs", "scripts/ops/boss-mail-tail-report.mjs"]) {
    if (/\bsendAs\(|employeeMail\(|sendAsEmployee\(/.test(read(f))) fails.push(`${f} still sends its own email (rule 1: it folds into the morning email)`);
  }
  if ((read("scripts/ops/risk-watch.mjs").match(/\bsendAs\(/g) ?? []).length !== 1 || !/sendAs\("Toni", \{ subject: laid\.subject, text: laid\.text, prelaid: laid \}\)/.test(read("scripts/ops/risk-watch.mjs"))) fails.push("risk-watch sends anything but the one money-at-risk problem email");
  if (!/if \(t\.read && !stillStopped\(task\)\)/.test(read("scripts/ops/task-notices.mjs"))) fails.push("task-notices does not re-check a stopped task before emailing");
  return { fails, examined };
}

function main() {
  if (process.argv.includes("--self-test")) {
    // Each check must go red when what it guards is broken.
    let caught = 0;
    const broken = [
      () => plainProblems({ subject: "Ok", text: "x\n\nNothing to decide — this is just so you know.\nOpen 1a08831e4f in Gmail." }).length > 0,
      () => plainProblems({ subject: "Ok", text: "x\n\nDetails:\n- a\n\nDecide (1)\n1. b" }).some((p) => /Decide is not first/.test(p)),
      () => plainProblems({ subject: "Stopped: x", text: "What happened: x\nStatus: done." }).some((p) => /What we did/.test(p)),
      () => plainProblems({ subject: "Ok", text: "x\n\nNothing to decide — this is just so you know.", html: "<p>Open the link</p>" }).some((p) => /HTML has no Decide/.test(p)),
      () => plainProblems({ subject: "Ok", text: "x\n\nNothing to decide — this is just so you know.\nSee https://boss.sequoiataylor.com/api/boss/tasks" }).some((p) => /API path/.test(p)),
      // The gate still catches a command that survives backticks, even if the cleaner's own fix
      // were reverted — belt and braces, same rule both ends (25 Oct 2026).
      () => plainProblems({ subject: "Ok", text: "x\n\nNothing to decide — this is just so you know.\nIts `--self-test` fails." }).some((p) => /command/.test(p)),
      // A plan with nothing bounding it is still over the cap, so the backstop gate catches it.
      () => plainProblems({ subject: "Ok", text: `x\n\nNothing to decide — this is just so you know.\n${"word ".repeat(2000)}` }).some((p) => /longer than/.test(p)),
    ];
    for (const [i, t] of broken.entries()) { if (t()) caught += 1; else console.error(`self-test ${i + 1}: a broken email passed`); }
    if (caught !== broken.length) process.exit(1);
    console.log(`validate:email-plain self-test: ${caught}/${broken.length} broken emails caught.`);
    return;
  }
  const { fails, examined } = check();
  if (examined === 0) { console.error("validate:email-plain: Rule 0 — zero fixtures examined."); process.exit(1); }
  if (fails.length) { for (const f of fails) console.error(`  ✗ ${f}`); console.error(`validate:email-plain: ${fails.length} failure(s).`); process.exit(1); }
  console.log(`validate:email-plain: ${examined} emails and checks — the gate sees every 22–23 Oct defect, every rewritten sender passes, and the gate stands where mail leaves.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
