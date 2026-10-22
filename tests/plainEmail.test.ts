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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { plainProblems, fromLegacy, layoutEmail, JARGON, cleanSubject, NEEDS_HEADING, NOTHING_NEEDED } from "../src/shared/boss/mail/plain.mjs";
import { sendersFor, employeeMail, namesOnce } from "../scripts/ops/notify.mjs";

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
  "scripts/ops/repo-change.mjs": [
    { who: "Danielle", subject: "Building creator-studios now — I'll send a preview before it goes live [rc_m5jh89zfkeyv3tmm]", text: "Sequoia,\n\nFYI — you pre-approved this (\"your call\"); no reply needed. Reply `stop` within the build to hold it.\nIt is NOT publish-ready, so it stops at the preview: you will get the preview email and it lands only after you reply \"approved\" to that.\n\nNOT PUBLISH-READY — this ships with 2 placeholders: hero image; price.\n\nThis is Danielle. Here is my plan for creator-studios from your instruction.\n\nREPLY WITH ONE WORD — approved — and I take the recommended default on every question below.\n(Keep [rc_m5jh89zfkeyv3tmm] in the subject; replying keeps it.)\n\nQUESTIONS, EACH WITH MY RECOMMENDED DEFAULT\n1. Which headline? Options: A / B.\n   → My recommended default: A\n\nWHAT I DECIDED (recorded, no reply needed)\n- kept the existing nav\n\nTHE PLAN\n\nSwap the hero, keep the rest.\n\nRun log on your Mac: /Users/someone/.boss-os/repo-change/rc_m5jh89zfkeyv3tmm.log\n\n— Danielle, Technical Program Manager" },
    { who: "Danielle", subject: "Stopped work on example-site: the checks failed [rc_m5jh89zfkeyv3tmc]", text: "Sequoia,\n\nThis is Danielle. I stopped work on rc_m5jh89zfkeyv3tmc (example-site) and here is the named reason:\n\nNAMED STOP [CHECKS_RED] the unit tests failed on main.\n\nPull request: https://github.com/example/example-site/pull/12\n\n— Danielle, Technical Program Manager" },
    { who: "Danielle", subject: "example-site is live [rc_m5jh89zfkeyv3tmd]", text: "Sequoia,\n\nThis is Danielle. example-site is landed and proven live.\n\nPull request: https://github.com/example/example-site/pull/12\nMerge commit: 0123abc\n\nLIVE PROOF\n- home_status: 200\n\n— Danielle" },
  ],
  "scripts/ops/task-notices.mjs": [{ who: "Simone", subject: "Stopped: Make the cover [tsk_m5jh8bjbxmhtfz1w]", text: "I could not do this one as asked.\n\nWhat you asked: Make the cover\nWhat it said back: \"I do not have direct access to…\"\n\nWhat I need from you: a narrower ask.\n\nReply to this email and your answer goes straight back to this job. Nothing was sent to anyone outside Boss OS. tsk_m5jh8bjbxmhtfz1w" }],
  "scripts/ops/service-tick.mjs": [{ who: "Simone", subject: "Key received: EXAMPLE_API_KEY", text: "Your key EXAMPLE_API_KEY is in the vault on your Mac and the work that waited for it is running again." }],
  "scripts/ops/kdp-surface-report.mjs": [{ who: "Simone", subject: "The Example Book: one decision, reply approved [kml_m331j7a4gqr6qz47]", text: "Amazon flagged the subtitle.\n\nWhat I did: drafted a shorter subtitle.\n\nWhat I need from you: approve the new subtitle. Amazon's deadline: 2026-10-30.\n\nReply with one word — approved — and I do it on my next run.\n\n— Simone" }],
  "scripts/ops/youtube-comment-watch.mjs": [{ who: "Monique", subject: "3 comments worth a reply [cw_m5abc123]", text: "Three new comments on How We Know are worth a reply.\n\n1. \"Great video\" — reply as drafted: Thank you!\n\nReply with one line per number: `1 delete`, `2 reply as drafted`, `3 reply: <your words>`, `4 ignore` — or `your call`." }],
  "scripts/ops/ledger-hunt.mjs": [{ who: "Monique", subject: `5 people worth a look for ${namesOnce(["OpenAI", "OpenAI", "Blue Origin"])}`, text: "Sequoia,\n\nThis is Monique. Today's mail named a side; I went looking for the other one.\n\nI read 2 new messages that named something to buy or sell (2 companies) and looked for the other side.\nI found 5 people worth a look, each one backed by a filing, a quote from your own mail, or a\npress or podcast link.\n\nThis is a list for you. Nobody here has been contacted.\n\n─────────────────────────────\n\nOpenAI  —  wants to sell $5M\n\n— Monique, Director of Relationships" }],
  "scripts/ops/interest-match.mjs": [{ who: "Monique", subject: `5 buyer-seller matches in your inbox — ${namesOnce(["OpenAI", "OpenAI", "OpenAI", "OpenAI", "Blue Origin"])}`, text: "Sequoia,\n\nThis is Monique. Both sides of this were already in your mailbox.\n\n5 buyer and seller pairs worth a call today (I checked 673 possible matches).\n\n67 more had brokers at your own firm on both sides, so I left them out — they can match those themselves.\n\nOpenAI\n  BUY   $5.0M   A. Buyer   3d ago\n  SELL  $4.0M   B. Seller   2 weeks ago\n\n— Monique, Director of Relationships" }],
  "scripts/ops/buyer-hunt.mjs": [{ who: "Monique", subject: `3 possible buyers for ${namesOnce(["Example Co"])}`, text: "Sequoia,\n\nThis is Monique. I worked outward from your book rather than across your mailbox.\n\nExample Co  —  you have $2M\n\n— Monique, Director of Relationships" }],
  "scripts/ops/lp-outcomes.mjs": [{ who: "Monique", subject: "LP outcomes: 2 to suppress, 3 replied, 1 bounced", text: "Two people asked not to be written to again, three replied and one address bounced.\n\nOPTED OUT (2) - remove from the list\n- a.person@example.com\n\nBOUNCED (1) - the address did not accept mail\n- b.person@example.com" }],
  "scripts/ops/lp-positive.mjs": [{ who: "Monique", subject: "3 positive replies you haven't answered — oldest 23 days", text: "Three people who replied warmly have not had an answer yet. A draft for each is in your Gmail Drafts.\n\nWANT A CALL\n- A. Person, Example Family Office: \"happy to talk next week\"\n\n— Monique, Director of Relationships" }],
  "scripts/ops/people-worth-a-call.mjs": [{ who: "Monique", subject: "5 people worth a conversation this week", text: "Five people are worth a call this week.\n\n1. A. Person — Example Partners\n   Why now: they asked about secondaries last month.\n   What to say: a quick hello and the new fund note." }],
  "scripts/ops/risk-watch.mjs": [{ who: "Toni", subject: "Risk: 1 moved — OpenRouter balance fell to $2.10", text: "One reading moved since yesterday.\n\nMOVED\n- OpenRouter balance fell to $2.10 (was $4.00).\n- Domain renewal: example.com renews 2026-11-02.\n\n— Toni" }],
  "scripts/ops/outside-locks.mjs": [{ who: "Toni", subject: "Locks: 1 new — linkedin.com: \"Your account is restricted\"", text: "One outside lock this week.\n\n- 2026-10-21 linkedin.com: \"Your account is restricted\" (personal Gmail).\n\n— Toni" }],
  "scripts/ops/archive-audit.mjs": [{ who: "Zora", subject: "Archive: 2 stale, 3 filed", text: "Two living documents are out of date and three delivered pieces were filed.\n\nSTALE\n- The email map (last changed 20 days ago) — fixed through Danielle.\n\nFILED\n- Search Readiness Checklist\n\n— Zora" }],
  "scripts/ops/boss-mail-tail-report.mjs": [{ who: "Simone", subject: "Your email \"Fix the footer\": done", text: "Your email about the footer went to Danielle, who fixed it and made it live.\n\n- Danielle: fixed the footer link, https://github.com/example/example-site/pull/13\n\n— Simone, Chief of Staff (the tail on your Boss OS mail)" }],
  "scripts/ops/your-day.mjs": [{ who: "Simone", subject: "Your day: 2 things for you", text: "Two things need you today." }],
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

describe("the guard sees the problem", () => {
  it("every email in her inbox on 22 Oct 2026 fails it, as sent", () => {
    for (const e of TODAY) expect(plainProblems(e), e.subject).not.toEqual([]);
    expect(plainProblems(TODAY[0]!).join(" ")).toMatch(/internal id|time zone|snake_case/);
    expect(plainProblems(TODAY[2]!).join(" ")).toMatch(/#tag in the subject/);
    expect(plainProblems(TODAY[2]!).join(" ")).toMatch(/brackets in the subject/);
    expect(plainProblems(TODAY[2]!).join(" ")).toMatch(/capitals in the subject/);
    expect(plainProblems(TODAY[3]!).join(" ")).toMatch(/repeated name in the subject: "openai"/);
    expect(plainProblems(TODAY[3]!).join(" ")).toMatch(/jargon/);
    expect(plainProblems(TODAY[4]!).join(" ")).toMatch(/jargon "\\bledgers\?\\b"/);
  });
  it("each jargon word in the one list is caught", () => {
    for (const j of JARGON) {
      const word = j.ban.source.replace(/\\b|\(es\)\?|s\?|\(s\?\)/g, "").replace(/_$/, "_x");
      expect(plainProblems({ subject: "ok", text: `${NEEDS_HEADING} ${NOTHING_NEEDED}\nthe ${word} here` }), word).not.toEqual([]);
    }
  });
  it("a cron string, a bracketed id and a snake_case word are each caught alone", () => {
    const ok = `${NEEDS_HEADING} ${NOTHING_NEEDED}`;
    expect(plainProblems({ subject: "ok", text: `${ok}\nRuns 0 13 * * 1` })).toEqual([expect.stringMatching(/cron/)]);
    expect(plainProblems({ subject: "ok", text: `${ok}\nsee [ab_xyz]` }).join(" ")).toMatch(/bracketed id/);
    expect(plainProblems({ subject: "ok", text: `${ok}\nsent to executive_reports` }).join(" ")).toMatch(/snake_case/);
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
        expect(p.text).toContain(NEEDS_HEADING);
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
    expect((src.match(/message\.reply\(/g) ?? []).length).toBe(1);
    expect(src).toMatch(/const laid = await plainReply\(/);
    expect(src).toMatch(/text: laid\.text,\s*\n\s*html: laid\.html,/);
  });
});

describe("the layout itself", () => {
  it("first line, then What I need from you, then details, then the name once — in text and HTML", () => {
    const laid = layoutEmail({ who: "Toni", subject: "#toni Risk: [tsk_abc123] OPENROUTER", happened: "Your OpenRouter balance fell to $2.10.", needs: ["Top it up if you want the paid models back."], details: ["It was $4.00 yesterday."], refs: ["tsk_abc123"] });
    expect(laid.subject).toBe("Risk: openrouter");
    expect(laid.text.split("\n")[0]).toBe("Your OpenRouter balance fell to $2.10.");
    expect(laid.text).toMatch(/What I need from you:\n- Top it up/);
    expect(laid.text.trim().endsWith("— Toni")).toBe(true);
    expect(laid.html).toContain("What I need from you:");
    expect(laid.refs).toEqual(["tsk_abc123"]);
    const none = layoutEmail({ who: "Zora", subject: "Archive", happened: "Nothing moved." });
    expect(none.text).toContain(`What I need from you: ${NOTHING_NEEDED}`);
  });
  it("the job code rides in a header, never in what she reads", () => {
    const sender = sendersFor("Danielle")[0]!;
    const p = employeeMail(sender, { to: "owner@example.com", subject: "Plan for example-site: reply approved to start [rc_abc123]", text: "Here is my plan. (Keep [rc_abc123] in the subject; replying keeps it.)" });
    expect(p.headers).toEqual({ "X-Boss-Ref": "rc_abc123" });
    expect(`${p.subject}\n${p.text}\n${p.html}`).not.toMatch(/rc_abc123/);
    expect(p.reply_to).toBe("danielle@sequoiataylor.com");
  });
});
