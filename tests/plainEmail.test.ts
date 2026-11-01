/**
 * EVERY BOSS OS EMAIL IS PLAIN (owner, 22 Oct 2026).
 *
 * Her words: "U need to fix the massive problem of all the emails from the boss OS agents being
 * confusing hard to read hard to understand. Lots of jargon not formatted well."
 *
 * Three things are pinned here:
 *   1. TODAY'S REAL EMAILS FAIL the guard as they were sent, so the guard can see the problem.
 *   2. EVERY SENDER'S SAMPLE PASSES once it goes through the one layout (`employeeMail` for the Mac,
 *      `fromLegacy` for the Worker's reply): no id, no snake_case, no `#tag` or brackets or capitals
 *      or repeated names in the subject, no cron or time zone, no word from the one jargon list.
 *   3. NO SENDER CAN SKIP THE LAYOUT: only notify.mjs posts to Resend, every Mac sender is in the
 *      sample list below (a new one fails until it is added), and the Worker's one `message.reply`
 *      sends what `plainReply` returns.
 *
 * Sample data is fake (the repo is public): no LP, customer or counterparty name is real.
 */
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { plainProblems, fromLegacy, layoutEmail, layoutProblem, lineProblems, JARGON, cleanSubject, cleanText, refsIn, DECIDE_HEADING, NOTHING_TO_DECIDE, simplifyForOwner } from "../src/shared/boss/mail/plain.mjs";
import { sendersFor, employeeMail, namesOnce, postEmployeeMail, mailGate, plainOrSimplified } from "../scripts/ops/notify.mjs";
import { INBOX } from "../scripts/validate/email-plain.mjs";

const ROOT = join(__dirname, "..");

/** The emails in her inbox on 22 Oct 2026, word for word (names in them are public companies). */
const TODAY: Array<{ subject: string; text: string }> = [
  { subject: "Re: #camille new duty", text: 'Created — you said "your call", so it is on the schedule now. [dd_m5jjjcm1sqfnb09a]\nFirst run: Monday, October 26 at 13:00 America/Chicago (duty_every_monday_research_what_changed_in_fr_fpvm)' },
  { subject: "Re: #camille new duty", text: "I have NOT created this duty for Camille, because it could not run as asked. [dd_m5jjjcm1sqfnb09b]\nAn agent duty must deliver into a route that exists (executive_reports, sourcing_candidates)." },
  { subject: '#danielle FYI — building creator-studios [rc_m5jh89zfkeyv3tmm] (you pre-approved: "your call") — NOT publish-ready, preview before landing', text: "FYI — you pre-approved this." },
  { subject: "#monique 5 crosses in your inbox — OpenAI, OpenAI, OpenAI, OpenAI, Blue Origin", text: "5 crosses worth a call, out of 673 pairing(s) considered. 67 pairing(s) were internal to example.com on BOTH sides." },
  { subject: "Re: try again", text: "Ledger hunt against 2 new message(s) since the last run." },
  { subject: "Re: try again", text: '"Make the cover" (tsk_m5jh8bjbxmhtfz1w) is running again on your word.' },
];

/**
 * ONE SAMPLE PER SENDING FILE, shaped like what that file actually writes (its subject template and
 * its body's opening, with fake data). Keyed by path: `every sender is listed` fails when a file
 * that sends mail is not here.
 */
const SAMPLES: Record<string, Array<{ who: string; subject: string; text: string }>> = {
  "scripts/ops/notify.mjs": [{ who: "Simone", subject: "KDP: needs you", text: "Amazon asked for a new cover file for The Example Book. Reply approved and I upload the one in your Drive." }],
  "scripts/ops/simone-commands.mjs": [
    { who: "Simone", subject: "Rowan's email", text: "I found 2 addresses that could be Rowan's. Which one? Reply with the number (or the address). Nothing has been sent.\n\n1. rowan.a@example.com: shared on the file \"Family Reunion 2025\"\n2. rowan.b@example.com: emailed you on 1 June [cmd_m5t02hhr65w5j4dp]" },
    { who: "Simone", subject: "The invite to Avery bounced", text: "The invite to Avery bounced: avery@example.com doesn't take mail. What's the right address?\n\nReply with it and I'll put them on the same invite (no new event). [cmd_m5t02hhr65w5j4dq]" },
  ],
  "scripts/ops/errand-reminders.mjs": [
    { who: "Simone", subject: "Do you still want to go? Thursday, October 29 at 11:00 pm", text: "Your booking is in 28 hours. They have NOT confirmed it yet: I asked them to, and I'm watching for their answer.\n\nWhat: The 11:00 pm DJ set, party of 2\nWhere: The Example Club (reservations@club.example.test)\nWhen: Thursday, October 29 at 11:00 pm (New York time)\nTheir rules: We enforce an elegant dress code.\nCancelling: In the event of a no-show or cancellation within 24 hours of your reservation time, we charge the performance fee.\nDo you still want to go? Tap one, or reply \"yes\" or \"cancel\". If you cancel, Simone tells them in the same thread. [cmd_m5t02hhr65w5j4dr]" },
  ],
  "scripts/ops/practice-nudges.mjs": [
    { who: "Imani", subject: "4 days. Some tough love.", text: "4 days: no gates, no coaching, app not opened.\n\nDecide (1)\n1. One tiny thing: a 5-minute coach talk\nFive minutes, one question at a time. Nothing you say is saved.\n- 5-minute coach talk ›: https://boss.sequoiataylor.com/?view=coach\n\nDetails:\n- In your own words (Law 10, Resume, Don’t Rebuild): \"After drift, resume from the current system. Do not restart it.\"\n- You built a cockpit and stopped sitting in it." },
    { who: "Imani", subject: "Midday: did you hold Law 4?", text: "Law 4, No Mid-Day Renegotiation: \"The day is an execution environment. Emotional spikes do not rewrite the morning plan.\"\n\nDecide (1)\n1. Your Midday gate\nDid you hold it today?\n- Open the Midday gate ›: https://boss.sequoiataylor.com/?view=gate&gate=midday" },
  ],
  "scripts/ops/repo-change.mjs": [
    { who: "Danielle", subject: "Building creator-studios now — I'll send a preview before it goes live [rc_m5jh89zfkeyv3tmm]", text: "Sequoia,\n\nFYI — you pre-approved this (\"your call\"); no reply needed. Reply `stop` within the build to hold it.\nIt is NOT publish-ready, so it stops at the preview: you will get the preview email and it lands only after you reply \"approved\" to that.\n\nNOT PUBLISH-READY — this ships with 2 placeholders: hero image; price.\n\nThis is Danielle. Here is my plan for creator-studios from your instruction.\n\nREPLY WITH ONE WORD — approved — and I take the recommended default on every question below.\n(Keep [rc_m5jh89zfkeyv3tmm] in the subject; replying keeps it.)\n\nQUESTIONS, EACH WITH MY RECOMMENDED DEFAULT\n1. Which headline? Options: A / B.\n   → My recommended default: A\n\nWHAT I DECIDED (recorded, no reply needed)\n- kept the existing nav\n\nTHE PLAN\n\nSwap the hero, keep the rest.\n\nRun log on your Mac: /Users/someone/.boss-os/repo-change/rc_m5jh89zfkeyv3tmm.log\n\n— Danielle, Technical Program Manager" },
    { who: "Danielle", subject: "example-site is live [rc_m5jh89zfkeyv3tmd]", text: "Sequoia,\n\nThis is Danielle. example-site is landed and proven live.\n\nPull request: https://github.com/example/example-site/pull/12\nMerge commit: 0123abc\n\nLIVE PROOF\n- home_status: 200\n\n— Danielle" },
  ],
  "scripts/ops/task-notices.mjs": [{ who: "Simone", subject: "One key only you hold: EXAMPLE_API_KEY [tsk_m5jh8bjbxmhtfz1w]", text: "The cover job needs a key only you hold.\n\nWhat you asked: Make the cover\n\nWhat I need from you: reply with SECRET EXAMPLE_API_KEY=<value>.\n\nReply to this email and your answer goes straight back to this job. Nothing was sent to anyone outside Boss OS. tsk_m5jh8bjbxmhtfz1w" }],
  "scripts/ops/service-tick.mjs": [{ who: "Simone", subject: "Key received: EXAMPLE_API_KEY", text: "Your key EXAMPLE_API_KEY is in the vault on your Mac and the work that waited for it is running again." }],
  "scripts/ops/kdp-surface-report.mjs": [{ who: "Simone", subject: "The Example Book: one decision, reply approved [kml_m331j7a4gqr6qz47]", text: "Amazon flagged the subtitle.\n\nWhat I did: drafted a shorter subtitle.\n\nWhat I need from you: approve the new subtitle. Amazon's deadline: 2026-10-30.\n\nReply with one word — approved — and I do it on my next run.\n\n— Simone" }],
  "scripts/ops/youtube-comment-watch.mjs": [{ who: "Monique", subject: "3 comments worth a reply [cw_m5abc123]", text: "Three new comments on How We Know are worth a reply.\n\n1. \"Great video\" — reply as drafted: Thank you!\n\nReply with one line per number: `1 delete`, `2 reply as drafted`, `3 reply: <your words>`, `4 ignore` — or `your call`." }],
  "scripts/ops/lp-outcomes.mjs": [{ who: "Monique", subject: "LP outcomes: 2 to suppress, 3 replied, 1 bounced", text: "Two people asked not to be written to again, three replied and one address bounced.\n\nOPTED OUT (2) - remove from the list\n- a.person@example.com\n\nBOUNCED (1) - the address did not accept mail\n- b.person@example.com" }],
  // The weekly hunt email (owner, 1 Nov 2026): Tuesday buyers, Thursday sellers, one sender for both.
  "scripts/ops/buyer-hunt.mjs": [{ who: "Monique", subject: "Sellers for what your LPs want to buy", text: "Sellers for what your LPs want to buy, Thursday, November 5: 1 company, 1 person you know and 1 fund worth a look. Nobody has been contacted.\n\nPeople you know who have it\n- Acme: your LP wants $15M, 2 days ago. Broker One has $100M, enough for all of your $15M; prices close." }],
  "scripts/ops/people-worth-a-call.mjs": [{ who: "Monique", subject: "5 people worth a conversation this week", text: "Five people are worth a call this week.\n\n1. A. Person — Example Partners\n   Why now: they asked about secondaries last month.\n   What to say: a quick hello and the new fund note." }],
  // Toni sends only money at risk now, as a problem email (prelaid); the legacy shape still has to pass.
  "scripts/ops/risk-watch.mjs": [{ who: "Toni", subject: "Paid AI calls are being charged — the team is on it", text: "New OpenRouter spend of $0.01 since the last check.\n\nThe team is switching the job back to a free model.\n\n— Toni" }],
  // The Spry Labs weekly (1 Nov 2026): one section per business; a report that did not arrive is a plain line.
  "scripts/ops/spry-weekly.mjs": [{ who: "Camille", subject: "Spry Labs weekly, Nov 4", text: "1 thing worth a look; 1 report did not arrive. The team has each one.\n\nA Player Mode\n- All 3 sites are fine.\n\nSearch across the portfolio\n- 12 fine, 1 worth a look.\n- theindustryguides.com: impressions down (40 -> 10).\n- Clicks from search this week: 31 (the week before: 28).\n\nCreator Network\n- No report this week: it did not arrive. Nothing is lost; the team checks why.\n\nSearch loop\n- Industry Guides: Published 21 pages · 38 indexed · 4 AI visitors · 2 form fills · 2 wins, 1 undone (7 sites).\n- Dream Wedding: not started yet.\n- Time-2-Read: this week's report did not arrive. The team checks why.\n\n— Camille" }],
  "scripts/ops/mac-cleanup.mjs": [{ who: "Simone", subject: "Mac disk: 14 GB free", text: "Mac disk: 14 GB free; cleaned 6.5 GB; biggest: Caches 40 GB." }],
  "scripts/ops/meeting-prep.mjs": [{ who: "Simone", subject: "Prep: Kate Example (GEM), Fri 30 Oct, 1pm ET", text: "Your prep for Kate Example (GEM), Fri 30 Oct, 1pm ET." }, { who: "Simone", subject: "Prep: Jo (Fake Co), Tue 27 Oct, 10am ET", text: "What's this meeting about? Reply in a line and I'll prep talking points, research them, or draft a follow-up." }],
  "scripts/ops/your-day.mjs": [{ who: "Simone", subject: "Friday: 2 decisions", text: "Good morning. Here is your Friday, October 23." }],
};

/** The Worker's replies, as the handler writes them before the layout (fake ids). */
const WORKER_REPLIES = [
  { who: "Camille", text: 'Done — you said "your call", so Camille\'s new regular job is set up. [dd_m5jjjcm1sqfnb09a]\n\nFirst run: Monday, October 26 at 1 pm.\nNothing is waiting on you. You can see every run on Team → Duties.\n\nWhat: What changed in fraud rules\nWho: Camille\nWhen: Mondays at 1 pm — on the day you named\nRuns on: an AI teammate — research reads the web\nResults go to: executive reports — it lands on Today\n\nWHAT IT WILL BE TOLD EACH TIME\nResearch what changed.\n\n— Camille' },
  { who: "Simone", text: "I'm working on \"Make the cover\" again, as you asked. I'll email you the result. tsk_m5jh8bjbxmhtfz1w" },
];

function sendingFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== "node_modules") walk(p); continue; }
      if (!/\.(mjs|js|ts)$/.test(name) || /\.d\.mts$/.test(name)) continue;
      const src = readFileSync(p, "utf8");
      if (/employeeMail\(|\bsendAs\(|sendAsEmployee\(|sendNotice\(/.test(src)) out.push(relative(ROOT, p));
    }
  };
  walk(join(ROOT, "scripts", "ops"));
  // The path itself, not a sender: notify.mjs holds employeeMail/sendAsEmployee, duty-kit holds sendAs.
  return out.filter((f) => f !== "scripts/ops/lib/duty-kit.mjs").sort();
}

const OK = `Something happened.\n\n${NOTHING_TO_DECIDE}`;

describe("the guard sees the problem", () => {
  it("every email in her inbox on 22 Oct 2026 fails it, as sent", () => {
    for (const e of TODAY) expect(plainProblems(e), e.subject).not.toEqual([]);
    expect(plainProblems(TODAY[0]!).join(" ")).toMatch(/internal id|time zone|snake_case/);
    expect(plainProblems(TODAY[2]!).join(" ")).toMatch(/#tag/);
    expect(plainProblems(TODAY[2]!).join(" ")).toMatch(/brackets in the subject/);
    expect(plainProblems(TODAY[2]!).join(" ")).toMatch(/capitals in the subject/);
    expect(plainProblems(TODAY[3]!).join(" ")).toMatch(/repeated name in the subject: "openai"/);
    expect(plainProblems(TODAY[3]!).join(" ")).toMatch(/jargon/);
    expect(plainProblems(TODAY[4]!).join(" ")).toMatch(/jargon "\\bledgers\?\\b"/);
  });
  it("every defect of her 22–23 Oct review is caught, by name (blurred copies, validate:email-plain's list)", () => {
    expect(INBOX.length).toBeGreaterThanOrEqual(13);
    for (const { why, e } of INBOX) expect(plainProblems(e).join(" | "), e.subject).toMatch(why);
  });
  it("each jargon word in the one list is caught, by its own sample, and the cleaner removes it", () => {
    for (const j of JARGON) {
      expect(plainProblems({ subject: "Ok", text: `${OK}\n${j.sample}` }), j.sample).not.toEqual([]);
      expect(lineProblems(j.sample), `the cleaner leaves "${j.sample}"`).toEqual([]);
    }
  });
  it("a cron string, a bracketed id and a snake_case word are each caught alone", () => {
    expect(plainProblems({ subject: "Ok", text: `${OK}\nRuns 0 13 * * 1` })).toEqual([expect.stringMatching(/cron/)]);
    expect(plainProblems({ subject: "Ok", text: `${OK}\nsee [ab_xyz]` }).join(" ")).toMatch(/bracketed id/);
    expect(plainProblems({ subject: "Ok", text: `${OK}\nsent to executive_reports` }).join(" ")).toMatch(/snake_case/);
  });
  it("the cleaner turns the 23 Oct defects into plain words", () => {
    expect(cleanText("Open 1a08831e4f… in Gmail.")).toBe("Open in Gmail.");
    expect(cleanText("Fixed (PR #112) and PR #12 landed.")).toBe("Fixed and the change landed.");
    expect(cleanText("Filed (GET /api/boss/research/delivered).")).toBe("Filed.");
    expect(cleanText("Write to #simone today.")).toBe("Write to Simone today.");
    expect(cleanText("Run npm run capital:match -- --not 3 to hide it.")).not.toMatch(/npm|--/);
    expect(cleanText("Done at 14:05 UTC.")).toMatch(/^Done at \d{1,2}:05 am\.$/);
  });
  it("a lost byte is never a black diamond in her mail (26 Oct 2026 held mail: windows-1252 bytes decoded as UTF-8)", () => {
    expect(cleanText("check spam/junk folders � our automated emails are often rerouted")).toBe("check spam/junk folders our automated emails are often rerouted");
    expect(cleanText("less than 24 hours� notice")).toBe("less than 24 hours notice");
    const laid = fromLegacy({ who: "Simone", subject: "They answered your request", text: "They want a card. Their note: spam/junk folders � our emails� rerouted." });
    expect(laid.text).not.toContain("�");
    expect(laid.html).not.toContain("�");
  });
});

describe("every sender, through the one layout, is plain", () => {
  process.env.BOSS_OS_MAIL_KEY = "test-key-not-real";
  it("today's emails, laid out, pass — and keep their job codes off-screen", () => {
    for (const e of TODAY) {
      const laid = fromLegacy({ who: "Simone", subject: e.subject, text: e.text });
      expect(plainProblems(laid), `${e.subject}\n${laid.text}`).toEqual([]);
    }
    expect(fromLegacy({ who: "Danielle", subject: TODAY[2]!.subject, text: TODAY[2]!.text }).refs).toEqual(["rc_m5jh89zfkeyv3tmm"]);
    expect(cleanSubject(TODAY[3]!.subject)).toBe("5 matches in your inbox — OpenAI and Blue Origin");
    expect(fromLegacy({ who: "Simone", subject: "x", text: TODAY[0]!.text }).text).toMatch(/Monday, October 26 at 1 pm/);
  });
  for (const [file, samples] of Object.entries(SAMPLES)) {
    it(`${file}`, () => {
      for (const s of samples) {
        const sender = sendersFor(s.who)[0]!;
        const p = employeeMail(sender, { to: "owner@example.com", subject: s.subject, text: s.text });
        expect(plainProblems(p), `${p.subject}\n${p.text}`).toEqual([]);
        expect(p.text.split("\n")[0]).not.toMatch(/^(Sequoia|Hi)/);
        expect(p.text.split("\n")[2]).toMatch(new RegExp(`^${DECIDE_HEADING} \\(\\d\\)$|^${NOTHING_TO_DECIDE}$`));
        expect(p.text.trim().endsWith(`— ${s.who}`)).toBe(true);
        expect(p.text.match(new RegExp(`— ${s.who}`, "g"))?.length).toBe(1);
        expect(p.html).toContain('name="viewport"');
      }
    });
  }
  it("the Worker's replies", () => {
    for (const r of WORKER_REPLIES) {
      const laid = fromLegacy({ who: r.who, subject: "Re: new duty", text: r.text });
      expect(plainProblems(laid), laid.text).toEqual([]);
      expect(laid.refs.length).toBe(1);
    }
  });
});

describe("no sender can skip the layout", () => {
  it("every Mac file that sends mail has a sample above (add yours)", () => {
    // No stale sample: every listed file still sends (notify.mjs is the CLI path every prompt uses).
    for (const f of Object.keys(SAMPLES)) if (f !== "scripts/ops/notify.mjs") expect(sendingFiles(), `${f} is listed but no longer sends`).toContain(f);
    for (const f of sendingFiles()) expect(Object.keys(SAMPLES), `${f} sends mail and has no sample in tests/plainEmail.test.ts`).toContain(f);
  });
  it("only notify.mjs posts to Resend (the chassis client is switched off), and every Mac post goes through postEmployeeMail", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== "node_modules" && name !== "validate") walk(p); continue; }
        if (/\.(mjs|js|ts|tsx)$/.test(name) && readFileSync(p, "utf8").includes("api.resend.com/emails")) hits.push(relative(ROOT, p));
      }
    };
    walk(join(ROOT, "scripts")); walk(join(ROOT, "src"));
    expect(hits.sort()).toEqual(["scripts/ops/notify.mjs", "src/worker/effects/resendClient.ts"]);
    for (const f of sendingFiles().filter((x) => x !== "scripts/ops/notify.mjs")) {
      const src = readFileSync(join(ROOT, f), "utf8");
      const raw = (src.match(/employeeMail\(/g) ?? []).length;
      const wrapped = (src.match(/postEmployeeMail\(\w+, employeeMail\(/g) ?? []).length;
      expect(raw, `${f}: an employeeMail payload that is not posted through postEmployeeMail`).toBe(wrapped);
    }
  });
  it("the Worker's one reply sends what plainReply laid out", () => {
    const src = readFileSync(join(ROOT, "src/worker/index.ts"), "utf8");
    const history = readFileSync(join(ROOT, "src/worker/boss/mail/history.ts"), "utf8");
    expect((src.match(/replyWithHistory\(message,/g) ?? []).length).toBe(1);
    expect((src.match(/message\.reply\(/g) ?? []).length).toBe(0);
    expect((history.match(/message\.reply\(/g) ?? []).length).toBe(1);
    expect(history).toMatch(/await message\.reply\(\{ from: mail\.from, subject: mail\.subject, text: mail\.text, html: mail\.html \}\)/);
    expect(src).toMatch(/const laid = await plainReply\(/);
    expect(src).toMatch(/replyWithHistory\(message,[^\n]*text: laid\.text, html: laid\.html/);
  });
});

describe("the layout itself", () => {
  it("first line, then Decide with buttons, then the sections, then the name once — in text and HTML", () => {
    const laid = layoutEmail({ who: "Toni", subject: "#toni Risk: [tsk_abc123] OPENROUTER", happened: "Your OpenRouter balance fell to $2.10.", decide: [{ title: "Top it up?", body: "The paid models stop at $0.", buttons: [{ label: "Open OpenRouter", url: "https://openrouter.ai/credits" }] }], details: ["It was $4.00 yesterday."], refs: ["tsk_abc123"] });
    expect(laid.subject).toBe("Risk: openrouter");
    expect(laid.text.split("\n").slice(0, 6)).toEqual(["Your OpenRouter balance fell to $2.10.", "", "Decide (1)", "1. Top it up?", "The paid models stop at $0.", "- Open OpenRouter: https://openrouter.ai/credits"]);
    expect(laid.text.trim().endsWith("— Toni")).toBe(true);
    expect(laid.html).toContain("Decide (1)");
    expect(laid.html).toMatch(/<a href="https:\/\/openrouter\.ai\/credits" style="display:inline-block[^"]*">Open OpenRouter<\/a>/);
    expect(laid.refs).toEqual(["tsk_abc123"]);
    expect(laid.problems).toEqual([]);
    const none = layoutEmail({ who: "Zora", subject: "Archive", happened: "Nothing moved." });
    expect(none.text.split("\n")[2]).toBe(NOTHING_TO_DECIDE);
  });
  it("a flag inside backticks, brackets or quotes is read as a command and dropped, same as a bare one (25 Oct 2026 held mail)", () => {
    const wrapped = [
      "Its `--self-test` fails on the shipped-today composition.",
      "Run `node scripts/validate/foo.mjs --self-test` to check it.",
      "The flag '--self-test' is read as a command too.",
      'The flag "--self-test" is read as a command too.',
      "See [--self-test] in the docs.",
      "Run --self-test to check it.",
    ];
    for (const line of wrapped) {
      expect(cleanText(line), line).not.toMatch(/self-test/);
      expect(lineProblems(line), line).toEqual([]);
    }
    // The exact held table row (25 Oct 2026), through the real sender path, keeps the rest of the row.
    const row = "| scripts/validate/a-notice-reaches-the-employee.mjs | Extended: it now also proves the notices reach the Mac teammate's prompt outside the fence, by running the real runner.buildPrompt over the real composed parts. Its `--self-test` fails on the shipped-today composition. |";
    const laid = fromLegacy({ who: "Danielle", subject: "Plan for boss-os [rc_abc123]", text: `Here is my plan.\n\n${row}` });
    expect(laid.text).not.toMatch(/self-test/);
    expect(laid.problems).toEqual([]);
  });
  it("no email exceeds its cap — trailing details are dropped by construction, never a Decide item, and it says how many (25 Oct 2026 held mail: 9,152 characters, nothing bounding it)", () => {
    const details = Array.from({ length: 400 }, (_, i) => `This is detail line number ${i} with a few extra words to pad it out.`);
    const laid = layoutEmail({ who: "Danielle", subject: "Plan for boss-os [rc_abc123]", happened: "Plan ready for boss-os.", decide: [{ title: "Reply approved to build it" }], details });
    expect(laid.text.length).toBeLessThanOrEqual(9000);
    expect(laid.problems).toEqual([]);
    expect(laid.text).toContain("Reply approved to build it");
    expect(laid.text).toMatch(/more lines? not shown here\./);
    expect(laid.text).toContain("This is detail line number 0 ");
    expect(laid.text).not.toContain("This is detail line number 399 ");
  });
  it("shows three decisions at most and says where the rest are", () => {
    const laid = layoutEmail({ who: "Simone", subject: "Friday", happened: "Morning.", decide: ["A?", "B?", "C?", "D?", "E?"] });
    expect(laid.text).toContain("Decide (5)");
    expect(laid.text).toContain("3. C?");
    expect(laid.text).not.toContain("4. D?");
    expect(laid.text).toContain("And 2 more on your Today page.");
  });
  it("a problem email is What happened → What we did → Status, and a Decide comes first only when she must act", () => {
    const p = layoutProblem({ who: "Toni", subject: "Some outreach emails bounced — already handled", happened: "4 emails bounced.", did: "Replaced them.", done: true, status: "Outreach restarted at 9:05 am. Nothing needed from you." });
    expect(p.text.split("\n").slice(0, 3)).toEqual(["What happened: 4 emails bounced.", "What we did: Replaced them.", "Status: done. Outreach restarted at 9:05 am. Nothing needed from you."]);
    expect(p.problems).toEqual([]);
    expect(p.kind).toBe("problem");
    const ask = layoutProblem({ who: "Toni", subject: "A key only you hold", happened: "x", did: "y", status: "Waiting on you.", decide: [{ title: "Add the key?", buttons: [{ label: "Open the vault", url: "https://boss.sequoiataylor.com/" }] }] });
    expect(ask.text.split("\n")[0]).toBe("Decide (1)");
    expect(ask.problems).toEqual([]);
  });
  it("the job code rides in a header, never in what she reads", () => {
    const sender = sendersFor("Danielle")[0]!;
    const p = employeeMail(sender, { to: "owner@example.com", subject: "Plan for example-site: reply approved to start [rc_abc123]", text: "Here is my plan. (Keep [rc_abc123] in the subject; replying keeps it.)" });
    expect(p.headers).toEqual({ "X-Boss-Ref": "rc_abc123" });
    expect(`${p.subject}\n${p.text}\n${p.html}`).not.toMatch(/rc_abc123/);
    expect(p.reply_to).toBe("danielle@sequoiataylor.com");
  });
});

describe("the send-time gate makes a jargon email plain, and holds only what it cannot (rule 13; 25 Oct 2026)", () => {
  it("a jargon email is simplified and SENT, the technical line attached; one it cannot make plain is held, written down, 422", async () => {
    process.env.BOSS_OS_MAIL_KEY = "test-key-not-real";
    const dir = mkdtempSync(join(tmpdir(), "held-"));
    process.env.BOSS_OS_HELD_MAIL_DIR = dir;
    const saved = process.env.BOSS_PASSCODE;
    delete process.env.BOSS_PASSCODE;
    const calls: string[] = [];
    const fake = (async (url: string) => { calls.push(String(url)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const sender = sendersFor("Monique")[0]!;
    const sent: any[] = [];
    const fake2 = (async (url: string, init?: RequestInit) => { calls.push(String(url)); if (String(url).includes("api.resend.com")) sent.push(JSON.parse(String(init?.body ?? "{}"))); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    // Jargon: simplified, never silently held.
    const jargon = { ...employeeMail(sender, { to: "o@example.com", subject: "Ok", text: "x" }), text: "x\n\nNothing to decide — this is just so you know.\nOpen 1a08831e4f in Gmail.\nThe validator plain.mjs ran `--self-test`.\n\n— Monique" };
    expect(mailGate(jargon).join(" ")).toMatch(/Gmail id/);
    const ready = plainOrSimplified(jargon);
    expect(ready.held).toBeNull();
    expect(mailGate(ready.payload)).toEqual([]);
    expect(ready.payload.text).not.toMatch(/1a08831e4f|validator|plain\.mjs|self-test/);
    expect(ready.payload.text).toContain("Technical details are in the attached file, for the team.");
    expect(Buffer.from(ready.payload.attachments.at(-1).content, "base64").toString()).toContain("1a08831e4f");
    expect((await postEmployeeMail(sender, jargon, fake2)).status).toBe(200);
    expect(sent.at(-1).text).not.toMatch(/1a08831e4f/);
    expect(readdirSync(dir).length).toBe(0);
    // What cannot be made plain (no Decide line where it belongs) is still held: written down, 422.
    const bad = { ...employeeMail(sender, { to: "o@example.com", subject: "Ok", text: "x" }), text: "x\n\nsomething\nOpen 1a08831e4f in Gmail." };
    const before = calls.filter((u) => u.includes("api.resend.com")).length;
    const res = await postEmployeeMail(sender, bad, fake);
    expect(res.status).toBe(422);
    expect(calls.filter((u) => u.includes("api.resend.com")).length).toBe(before);
    expect(readdirSync(dir).length).toBe(1);
    // A plain one goes.
    const good = employeeMail(sender, { to: "o@example.com", subject: "Ok", text: "Something happened today." });
    expect(mailGate(good)).toEqual([]);
    expect((await postEmployeeMail(sender, good, fake)).status).toBe(200);
    expect(calls.filter((u) => u.includes("api.resend.com")).length).toBe(before + 1);
    if (saved !== undefined) process.env.BOSS_PASSCODE = saved;
    delete process.env.BOSS_OS_HELD_MAIL_DIR;
    delete process.env.BOSS_OS_MAIL_KEY;
  });
});

describe("the rules in CLAUDE.md", () => {
  const doc = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
  const section = doc.slice(doc.indexOf("## Emails to her"));
  it("the section exists and names the code that enforces each rule, and that code exists", () => {
    expect(section.startsWith("## Emails to her")).toBe(true);
    for (const [name, file] of [["layoutEmail", "src/shared/boss/mail/plain.mjs"], ["layoutProblem", "src/shared/boss/mail/plain.mjs"], ["mailGate", "scripts/ops/notify.mjs"], ["plainOrSimplified", "scripts/ops/notify.mjs"], ["simplifyForOwner", "src/shared/boss/mail/plain.mjs"], ["plainReply", "src/worker/boss/intake/mailRefs.ts"]] as const) {
      expect(section).toContain(name);
      expect(readFileSync(join(ROOT, file), "utf8")).toMatch(new RegExp(`export (async )?function ${name}\\b`));
    }
    for (const f of ["scripts/ops/your-day.mjs", "src/shared/boss/mail/morning.mjs", "src/shared/boss/mail/plain.mjs", "scripts/ops/notify.mjs"]) expect(section).toContain(f);
    expect(section).toMatch(/07:45 Central/);
  });
});


/**
 * DANIELLE'S "STOPPED WORK ON …" EMAILS (combined boss fix, 23 Oct 2026; rule 3). Every stop is laid
 * out by `stoppedMail` (scripts/ops/repo-change.mjs): What happened → What we did → Status, one Decide
 * button to the change's own page. The gate now reads any "Stopped …" subject as a problem email, so
 * the old free-text stop is held.
 */
describe("Danielle's stopped emails", () => {
  const STOPS = [
    { reason: "the checks failed", happened: "The checks on the example-site change went red, so I did not make it live.", did: "I left the pull request open for a fix (https://github.com/example/example-site/pull/12) and recorded what failed: two unit tests." },
    { reason: "no checks ran", happened: "No checks ran on the example-site change, so there was nothing green to make it live on.", did: "I held it before going live and left the pull request open (https://github.com/example/example-site/pull/12). Trying again with \"add checks to the repo\" fixes it." },
    { reason: "the work got stuck", happened: "I stopped work on example-site because the work got stuck: the build ran out of turns.", did: "I kept everything done so far, so trying again picks up where it stopped. The full run log is on your Mac." },
  ];
  it("every stop is a problem email in three parts with one button to the change's page, and passes the gate", async () => {
    // @ts-expect-error — plain ESM with no declaration file
    const { stoppedMail } = await import("../scripts/ops/repo-change.mjs");
    for (const s of STOPS) {
      const laid = stoppedMail({ id: "rc_m5jh89zfkeyv3tmc", repo: "example-site", ...s, origin: "https://boss.example.com" });
      expect(laid.kind).toBe("problem");
      expect(laid.problems, laid.text).toEqual([]);
      expect(plainProblems({ ...laid, kind: null }), laid.text).toEqual([]);
      const body = laid.text;
      const at = ["Decide (1)", "What happened:", "What we did:", "Status:", "— Danielle"].map((h) => body.indexOf(h));
      expect(at.every((n) => n >= 0), body).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(body).toContain("Open the change: https://boss.example.com/?tab=systems&change=rc_m5jh89zfkeyv3tmc");
      expect(laid.subject).toMatch(/^Stopped work on example-site: /);
      expect(laid.refs).toEqual(["rc_m5jh89zfkeyv3tmc"]);
      const sent = employeeMail({ name: "Danielle", from: "Danielle <danielle@example.com>" } as any, { to: "owner@example.com", subject: laid.subject, text: laid.text, prelaid: laid });
      expect(sent.headers?.["X-Boss-Ref"]).toBe("rc_m5jh89zfkeyv3tmc");
      expect(sent.headers?.["X-Boss-Kind"]).toBe("problem");
    }
  });
  it("the old free-text stop is now held by the gate (no What we did, no Status)", () => {
    const old = employeeMail({ name: "Danielle", from: "Danielle <danielle@example.com>" } as any, { to: "owner@example.com", subject: "Stopped work on example-site: the checks failed [rc_m5jh89zfkeyv3tmc]", text: "Sequoia,\n\nThis is Danielle. I stopped work on rc_m5jh89zfkeyv3tmc (example-site) and here is the named reason:\n\nNAMED STOP [CHECKS_RED] the unit tests failed on main.\n\nPull request: https://github.com/example/example-site/pull/12\n\n— Danielle, Technical Program Manager" });
    expect(plainProblems(old).join(" ")).toMatch(/problem email without "What we did"/);
  });
  it("repo-change.mjs sends every stop through stoppedMail, never free text", () => {
    const src = readFileSync(join(ROOT, "scripts/ops/repo-change.mjs"), "utf8");
    expect(src.match(/stoppedMail\(\{/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(src).not.toMatch(/email\(`Stopped work on/);
    expect(src).not.toMatch(/"This is Danielle\. I stopped work on/);
  });
});

/**
 * THE PLAN EMAIL WAS HELD (25 Oct 2026): a table row carried a flag inside backticks, which the
 * cleaner unwrapped into something the gate then refused, and the free-text block ran to 9,152
 * characters with nothing bounding it. `scripts/ops/repo-change.mjs` now renders the plan's own
 * markdown into plain lines (`renderPlanLines`) and sends it through `layoutEmail`, the same bounded
 * layout every other sender uses, with the whole plan riding as an attached file.
 */
describe("Danielle's plan email", () => {
  it("renderPlanLines turns a table row, a heading and a wrapped paragraph into plain, bounded lines", async () => {
    // @ts-expect-error — plain ESM with no declaration file
    const { renderPlanLines } = await import("../scripts/ops/repo-change.mjs");
    const markdown = [
      "## What changes, file by file",
      "",
      "| File | Change |",
      "|---|---|",
      "| scripts/validate/a-notice-reaches-the-employee.mjs | Extended: it now also proves the notices reach the **Mac teammate's** prompt, by running the real runner.buildPrompt. Its `--self-test` fails on the shipped-today composition. |",
      "",
      "A paragraph that got hard-wrapped at some column, so the next physical line continues",
      "the same sentence instead of starting a new one.",
      "",
      "- A bullet whose own continuation",
      "  also wraps onto a second physical line.",
    ].join("\n");
    const lines = renderPlanLines(markdown);
    expect(lines[0]).toEqual({ heading: "What changes, file by file" });
    const row = lines.find((l: unknown) => typeof l === "string" && (l as string).includes("a-notice-reaches-the-employee.mjs"));
    expect(row).toBeTruthy();
    expect(row as string).not.toContain("|");
    // The row still carries the flag at this stage — `layoutEmail`'s own cleaner drops it (tested
    // above); this function's own job is the table-to-line and wrap-to-paragraph flattening.
    expect(cleanText(row as string)).not.toMatch(/self-test/);
    expect(lines).toContain("A paragraph that got hard-wrapped at some column, so the next physical line continues the same sentence instead of starting a new one.");
    expect(lines).toContain("A bullet whose own continuation also wraps onto a second physical line.");
  });
  it("the plan email is built from layoutEmail, bounded, with the plan attached as a file — the held mail's own defects are gone", () => {
    const src = readFileSync(join(ROOT, "scripts/ops/repo-change.mjs"), "utf8");
    // 25 Oct 2026 (owner): the plan email is `planMail`, plain words over `layoutEmail`; the plan in
    // full rides ONLY as the attached file — `planMail` never reads the plan's own text.
    expect(src).toMatch(/const laid = planMail\(\{/);
    const fn = src.slice(src.indexOf("export function planMail("), src.indexOf("async function email("));
    expect(fn).toMatch(/return layoutEmail\(\{/);
    expect(fn).not.toMatch(/plan_text|renderPlanLines/);
    expect(src).toMatch(/filesAt\(\[planFile\]\)/);
    expect(src).not.toMatch(/"THE PLAN", "", String\(out\.plan_text/);
  });
  it("the exact held mail (25 Oct 2026, rc_m5sd0byy3678wdjc) replays clean through the fixed layout", async () => {
    // @ts-expect-error — plain ESM with no declaration file
    const { renderPlanLines } = await import("../scripts/ops/repo-change.mjs");
    const markdown = [
      "## What changes, file by file",
      "",
      "| File | Change |",
      "|---|---|",
      "| scripts/validate/a-notice-reaches-the-employee.mjs | Extended: it now also proves the notices reach the Mac teammate's prompt outside the fence, by running the real runner.buildPrompt over the real composed parts. Its `--self-test` fails on the shipped-today composition. |",
      "",
      "## Proof",
      "",
      "Negative proof of the guard: the validator's `--self-test` composes the prompt the way it shipped",
      "this morning and must fail.",
    ].join("\n") + `\n\n${"Padding to push this plan past the ordinary cap. ".repeat(200)}`;
    const laid = layoutEmail({
      who: "Danielle", subject: "Plan for boss-os: reply approved to start [rc_m5sd0byy3678wdjc]",
      happened: "Plan ready for boss-os.",
      decide: [{ title: "Reply \"approved\" to build it", body: "I take the recommended default on every question below." }],
      details: [{ heading: "The plan" }, ...renderPlanLines(markdown)],
      refs: refsIn("Plan for boss-os: reply approved to start [rc_m5sd0byy3678wdjc]"),
    });
    expect(laid.problems).toEqual([]);
    expect(laid.text.length).toBeLessThanOrEqual(9000);
    expect(laid.text).not.toMatch(/self-test/);
  });
});

/**
 * A RESEARCH PAGE'S OWN LINK HELD THE WHOLE EMAIL (repair, 1 Nov 2026 — held mail
 * 9755e2553df7b488.json, f1ea62c2edaacc01.json). The research lane's own closing line, "Page:
 * https://boss.sequoiataylor.com/api/boss/research/pages/<id>", is an /api path: rule 13 refuses it,
 * and `API_PATH_RE`'s line-level check (used by `simplifyForOwner`) never saw it either, because the
 * slash in "…sequoiataylor.com/api/boss/…" is preceded by "m", not whitespace — so nothing could be
 * moved into the attachment and the whole email held. `researchPageUrl` now hands the run a page
 * address (src/shared/boss/research/page.mjs), and `cleanText`/`cleanProse` rewrite any surviving
 * /api link of that shape on sight (src/shared/boss/mail/plain.mjs `pageLinkFor`, inside `protect`);
 * any OTHER absolute /api link is moved into the attached details instead of holding the email.
 */
describe("Camille's research page link, never an /api path (repair, 1 Nov 2026)", () => {
  // Word for word, the line that held the email (~/.boss-os/held-mail/9755e2553df7b488.json).
  const HELD_TEXT = 'I\'ve written a file, but the faith feed is not connected yet: the job runs tomorrow, so the page is the plan for it.\n\nDecide (1)\n1. Reply to this email and your answer goes straight back to this job.\n\nDetails:\n- Status is "partial".\n- ✅ nothing needed from you\n- Page: https://boss.sequoiataylor.com/api/boss/research/pages/rpg_m6c03jvnpq9w0tan\n\n— Camille';

  it("before the fix, it was held for exactly the one reason recorded: a link to an API path", () => {
    expect(plainProblems({ subject: "Done: One-time Chrome job", text: HELD_TEXT }).join(" | ")).toMatch(/a link to an API path/);
  });

  it("a bare rewrite of the line carries the page address, never the /api path it reaches", () => {
    expect(cleanText("Page: https://boss.sequoiataylor.com/api/boss/research/pages/rpg_m6c03jvnpq9w0tan"))
      .toBe("Page: https://boss.sequoiataylor.com/research/rpg_m6c03jvnpq9w0tan");
  });

  it("the held email's own words, laid out again through the fixed cleaner, carry the page link and pass the gate clean", () => {
    const laid = fromLegacy({ who: "Camille", subject: "Done: One-time Chrome job", text: HELD_TEXT });
    expect(laid.text).toContain("https://boss.sequoiataylor.com/research/rpg_m6c03jvnpq9w0tan");
    expect(laid.text).not.toMatch(/\/api\//);
    expect(plainProblems(laid)).toEqual([]);
  });

  /**
   * THE LANE THAT ACTUALLY HELD f1ea62c2edaacc01.json NEVER WENT THROUGH `cleanText`/`fromLegacy`
   * (repair, 1 Nov 2026). `scripts/ops/notify.mjs`'s `plainOrSimplified` calls `simplifyForOwner`
   * directly on the raw text Camille wrote; `simplifyForOwner`'s own per-line check judged the line
   * before any rewrite ran, so it still saw the raw /api link, moved the whole "Page: …" line into
   * the attachment, and she lost the link into a file instead of reading it in the email. Fixed by
   * rewriting a known link before judging the line, not after.
   */
  it("simplifyForOwner — the function the actual sender calls — rewrites the research page link in place, never moves it to the attachment", () => {
    const s = simplifyForOwner({ subject: "Done: One-time Chrome job", text: HELD_TEXT });
    expect(s.text).toContain("https://boss.sequoiataylor.com/research/rpg_m6c03jvnpq9w0tan");
    expect(s.text).not.toMatch(/\/api\//);
    expect(s.details).toEqual([]);
    expect(plainProblems({ subject: s.subject, text: s.text, html: s.html })).toEqual([]);
  });

  it("any OTHER absolute /api link is moved into the attached details, never holds the whole email", () => {
    const text = `${OK}\nDetails:\n- See https://boss.sequoiataylor.com/api/boss/something/else for the record.`;
    expect(plainProblems({ subject: "Ok", text }).join(" | ")).toMatch(/a link to an API path/);
    const s = simplifyForOwner({ subject: "Ok", text });
    expect(s.text).not.toMatch(/\/api\//);
    expect(s.details.some((d: string) => /\/api\//.test(d))).toBe(true);
    expect(plainProblems({ subject: s.subject, text: s.text, html: s.html })).toEqual([]);
  });
});
