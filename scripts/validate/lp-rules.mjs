#!/usr/bin/env node
/**
 * BOSS FIX L'S RULES, CHECKED ON EVERY BUILD (owner, 23 Oct 2026, rulings 10, 11, 12, 14).
 *
 *   1. The prospect email she approves is soft and side-neutral: no sales ask ("do you want to buy",
 *      "buyer"…), a 15-minute compare-notes ask, "add or trim" (either side), "more than $100M in
 *      secondary transactions", "we", ≤90 words, the opt-out line. Same for the follow-up.
 *   2. The LP reply speaks in her voice: "we", "more than $100M in secondary transactions", a short
 *      call ask, never a fund size.
 *   3. 8Raise: the budget refuses over-spend, the floor, >5 contacts and a repeat company; the Mac
 *      lane can call no billing tool.
 *   4. The weekly Tuesday reminder is gone and the connector digest is retired: nothing in the
 *      installer schedules `lp:positive -- --email` or lp-replies.sh.
 *   5. A GET on a one-tap link never acts (mail scanners fetch links).
 *   6. THE CADENCE (owner ruling 6 Nov 2026, risk brain R-EML-04; replaced "one follow-up", 24 Oct):
 *      four emails to a person at most — the first and up to three follow-ups on day 3, 7 and 14 from
 *      the first send, never two under three days apart, never a fifth. A reply, an opt-out, a bounce
 *      or a complaint stops a person at once; any spam complaint pauses the WHOLE prospect sequence
 *      (desk.ts, a named stop); emails 3 and 4 never go in words she did not approve (the prospect
 *      card's follow_up_2 / follow_up_3, and the guides' Decide card in engine.ts).
 *   7. No address outside our own domains or example.com in any file this fix owns (public repo).
 *
 * RULE 0: every check examines something; an empty scan fails. `--self-test` breaks each rule and
 * watches it go red.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as plan from "../../src/shared/boss/lp/plan.mjs";
import { startOfCentralDay } from "../../src/shared/boss/outreach/cadence.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const OWNED = [
  "src/shared/boss/lp/plan.mjs", "src/worker/boss/lp/desk.ts", "src/worker/boss/routes/lpTap.ts", "src/worker/boss/routes/lp.ts",
  "scripts/ops/lp-daily.mjs", "scripts/ops/lp-prospects.mjs", "scripts/ops/lp-prospect-discovery.mjs", "scripts/ops/lp-catchups.mjs",
  "scripts/ops/lp-eightraise.mjs", "scripts/ops/lp-followups.mjs", "migrations/0294_boss_lps_and_prospects.sql",
  "src/client/boss/pages/deals/LpTab.tsx", "src/client/boss/pages/deals/ProspectsTab.tsx", "tests/boss/lpProspects.test.ts",
];

export function check({ template, lpBody, installer, tapSrc, eightSrc, files, deskSrc = "", engineSrc = "", P = plan }) {
  const bad = [];
  let examined = 0;
  const names = [{ name: "Alpha" }, { name: "Beta" }, { name: "Gamma" }];
  for (const touch of [1, 2, 3, 4]) {
    examined++;
    const r = P.renderProspect(template, { first: "Alex", names, touch });
    for (const p of P.prospectProblems(r)) bad.push(`prospect email touch ${touch}: ${p}`);
  }
  examined++;
  if (!/more than \$100M in secondary transactions/.test(lpBody)) bad.push('LP reply: missing "more than $100M in secondary transactions"');
  if (!/\bwe('ve|'ll| are| have)?\b/i.test(lpBody)) bad.push('LP reply: does not speak as "we"');
  if (/\bfund (size|of \$)|\$\d[\d,.]*\s?(m|mm|b|bn|million|billion)\s+fund\b/i.test(lpBody)) bad.push("LP reply: names a fund size");

  examined++;
  const ledger = [{ month: "2026-10", purpose: "prospecting", credits: 58, company: "Acme" }];
  const tries = [
    [{ purpose: "prospecting", credits: 5, ledger, balance: 100, month: "2026-10" }, "over the month's prospecting budget"],
    [{ purpose: "buyers_for_supply", credits: 5, ledger: [], balance: 33, month: "2026-10" }, "below the floor of 30"],
    [{ purpose: "buyers_for_supply", credits: 1, contacts: 6, ledger: [], balance: 100, month: "2026-10" }, "more than 5 contacts"],
    [{ purpose: "prospecting", credits: 1, company: "acme", ledger, balance: 100, month: "2026-10" }, "a second search for one company in a month"],
    [{ purpose: "prospecting", credits: 1, ledger: [], balance: null, month: "2026-10" }, "an unread balance"],
  ];
  for (const [args, what] of tries) if (P.canSpend(args).ok) bad.push(`8Raise budget allowed ${what}`);
  if (!P.canSpend({ purpose: "prospecting", credits: 1, ledger: [], balance: 100, month: "2026-10" }).ok) bad.push("8Raise budget refused an ordinary spend");
  if (/manage_subscription|get_billing_info|purchase|upgrade_plan|buy_credits/.test(eightSrc.replace(/const NEVER = .*$/m, ""))) bad.push("lp-eightraise.mjs names a billing tool");

  examined++;
  if (/lp:positive -- --email|duty-run\.sh lp-positive\.mjs/.test(installer)) bad.push("the installer still schedules the weekly LP reminder email");
  if (/duty-run\.sh lp-replies\.sh/.test(installer)) bad.push("the installer still runs the connector digest (lp-replies.sh), which reads the wrong mailbox");
  if (!/duty-run\.sh lp-daily\.mjs/.test(installer)) bad.push("the installer does not run lp-daily.mjs");

  examined++;
  const getBlock = /lpTap\.get\([\s\S]*?\n\}\);/.exec(tapSrc)?.[0] ?? "";
  if (!getBlock) bad.push("lpTap.ts: no GET handler found (rule 0)");
  if (/sendDraft\(|approveTemplate\(|UPDATE /.test(getBlock)) bad.push("lpTap.ts: a GET acts — a mail scanner could send or approve");

  examined++;
  const DAY = 86_400_000;
  const t0 = Date.UTC(2026, 9, 11);
  if (P.MAX_TOUCHES !== 4) bad.push(`MAX_TOUCHES is ${P.MAX_TOUCHES}; her rule is four emails at most (the first and up to three follow-ups)`);
  if (JSON.stringify([...(P.TOUCH_DAYS ?? [])]) !== "[0,3,7,14]") bad.push(`TOUCH_DAYS is ${JSON.stringify(P.TOUCH_DAYS)}; her rule is day 0, 3, 7 and 14 from the first send`);
  const due = (touches, last, now, status = "active") => P.dueTouch({ status, touches, first_sent_at: t0, last_touch_at: t0 + last * DAY }, t0 + now * DAY);
  if (due(4, 14, 400) !== null) bad.push("a fifth email is due");
  for (const [touches, last, day, n] of [[1, 0, 3, 2], [2, 3, 7, 3], [3, 7, 14, 4]]) {
    // Due from the first moment of that Central calendar day (cadence.mjs), never a millisecond of the day before.
    const dayStart = (startOfCentralDay(t0 + day * DAY) - t0) / DAY;
    if (due(touches, last, dayStart - 1 / DAY) !== null) bad.push(`email ${n} is due before day ${day}`);
    if (due(touches, last, dayStart) !== n || due(touches, last, day) !== n) bad.push(`email ${n} is not due on day ${day}`);
  }
  if (due(2, 6, 8) !== null) bad.push("two emails under three days apart");
  for (const status of ["replied", "interested", "opted_out", "bounced", "done"]) {
    for (const touches of [1, 2, 3]) if (due(touches, touches * 3, 60, status) !== null) bad.push(`a ${status} prospect is still due email ${touches + 1}`);
  }
  try {
    P.renderProspect({ subject: template.subject, body: template.body, follow_up: template.follow_up }, { first: "Alex", names, touch: 3 });
    bad.push("email 3 renders from a template without words she approved for it");
  } catch { /* refused: right */ }
  if (!P.PROSPECT_COMPLAINT?.test("Stop spamming me") || P.PROSPECT_COMPLAINT.test("Thanks, not for us right now")) bad.push("a spam complaint in a reply is not told apart from a polite no");
  if (!/complaintStop\(/.test(deskSrc) || !/reason = 'complaint' AND source = 'prospects'/.test(deskSrc)) bad.push("desk.ts: a spam complaint does not pause the whole prospect sequence");
  if (!/hasTouchWords\(words, touch\)/.test(deskSrc)) bad.push("desk.ts: emails 3 and 4 are not held for words she approved");
  if (!/laterWordsApproved\(env, b, step, pitch, now\)/.test(engineSrc)) bad.push("engine.ts: the guides' emails 3 and 4 are not held for her approved words");

  examined++;
  for (const [f, src] of Object.entries(files)) {
    for (const a of src.match(/[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) {
      if (/@(?:[\w-]+\.)?(westpeek\.ventures|sequoiataylor\.com|joinwestpeek\.com|example\.com|example\.org|theindustryguides\.com|time-2-read\.com)$/i.test(a)) continue;
      if (/^[\w.-]+@(mailer-daemon|types|cloudflare|anthropic-ai)$/i.test(a)) continue;
      bad.push(`${f}: carries an address outside our own domains (${a.replace(/^[^@]+/, "•••")})`);
    }
  }
  return { bad, examined };
}

function real() {
  const files = Object.fromEntries(OWNED.filter((f) => existsSync(join(ROOT, f))).map((f) => [f, read(f)]));
  if (Object.keys(files).length < OWNED.length) {
    const missing = OWNED.filter((f) => !(f in files));
    return { bad: [`files this validator guards are missing: ${missing.join(", ")}`], examined: 0 };
  }
  return check({
    template: plan.DEFAULT_PROSPECT_TEMPLATE,
    lpBody: plan.lpReplyBody({ name: "Alex", bucket: "call" }),
    installer: read("scripts/ops/install-agent-launchd.sh"),
    tapSrc: read("src/worker/boss/routes/lpTap.ts"),
    eightSrc: read("scripts/ops/lp-eightraise.mjs"),
    deskSrc: read("src/worker/boss/lp/desk.ts"),
    engineSrc: read("src/worker/boss/outreach/engine.ts"),
    files,
  });
}

if (process.argv.includes("--self-test")) {
  const base = real();
  const T = plan.DEFAULT_PROSPECT_TEMPLATE;
  const cases = [
    ["a direct sales ask", { template: { ...T, body: T.body.replace("I hope", "Do you want to buy? I hope") } }, /sales phrase/],
    ["buyer-only wording", { template: { ...T, follow_up: T.follow_up.replace("Just floating", "As a buyer, just floating") } }, /sales phrase/],
    ["a call ask", { template: { ...T, body: T.body.replace("I hope", "Could we find 15 minutes for a quick call? I hope") } }, /suggests a call/],
    ["no either-side invitation", { template: { ...T, body: T.body.replace("add or trim", "add") } }, /either side/],
    ["too long", { template: { ...T, body: T.body.replace("I hope you don't mind the direct note.", "I hope you don't mind the direct note. ".repeat(12)) } }, /words/],
    ["an LP reply with a fund size", { lpBody: "We have a $50M fund and did more than $100M in secondary transactions; a call?" }, /fund size/],
    ["the Tuesday reminder back", { installer: "duty-run.sh lp-daily.mjs\nduty-run.sh lp-positive.mjs -- npm run --silent lp:positive -- --email" }, /weekly LP reminder/],
    ["a GET that sends", { tapSrc: 'lpTap.get("/:token", async (c) => {\n  await sendDraft(c.env, "m", "d");\n});' }, /a GET acts/],
    ["a billing tool", { eightSrc: 'call8r("manage_subscription")' }, /billing tool/],
    ["a real address", { files: { "x.ts": "to: someone@realfirm.com" } }, /outside our own/],
    ["five emails allowed", { P: { ...plan, MAX_TOUCHES: 5 } }, /four emails at most/],
    ["the old day-5 spacing", { P: { ...plan, TOUCH_DAYS: [0, 5] } }, /TOUCH_DAYS/],
    ["a fifth email due", { P: { ...plan, dueTouch: (p, now) => (Number(p.touches) >= 4 ? 5 : plan.dueTouch(p, now)) } }, /fifth email/],
    ["a follow-up the next day", { P: { ...plan, dueTouch: (p) => (["new", "active"].includes(p.status) && p.touches < 4 ? Number(p.touches) + 1 : null) } }, /before day/],
    ["a reply that does not stop it", { P: { ...plan, dueTouch: (p, now) => plan.dueTouch({ ...p, status: "active" }, now) } }, /still due/],
    ["email 3 in unapproved words", { P: { ...plan, renderProspect: (t, a) => plan.renderProspect({ ...t, follow_up_2: t.follow_up_2 ?? t.follow_up, follow_up_3: t.follow_up_3 ?? t.follow_up }, a) } }, /without words she approved/],
    ["email 3 asks for a call", { template: { ...T, follow_up_2: T.follow_up_2.replace("One more thought", "Could we find 15 minutes for a quick call? One more thought") } }, /touch 3: suggests a call/],
    ["a complaint read as a polite no", { P: { ...plan, PROSPECT_COMPLAINT: /$^/ } }, /spam complaint in a reply/],
    ["the complaint pause removed", { deskSrc: read("src/worker/boss/lp/desk.ts").replaceAll("complaintStop(", "String(") }, /does not pause the whole/],
    ["emails 3 and 4 not held", { deskSrc: read("src/worker/boss/lp/desk.ts").replace("hasTouchWords(words, touch)", "true") }, /not held for words she approved/],
    ["the guides' emails 3 and 4 not held", { engineSrc: read("src/worker/boss/outreach/engine.ts").replace("laterWordsApproved(env, b, step, pitch, now)", "Promise.resolve(\"approved\")") }, /guides' emails 3 and 4/],
  ];
  let fails = 0;
  if (base.bad.length) { console.error(`SELF-TEST: the real repo is not clean first:\n  ${base.bad.join("\n  ")}`); process.exit(1); }
  const real0 = {
    template: plan.DEFAULT_PROSPECT_TEMPLATE, lpBody: plan.lpReplyBody({ name: "Alex", bucket: "call" }),
    installer: read("scripts/ops/install-agent-launchd.sh"), tapSrc: read("src/worker/boss/routes/lpTap.ts"),
    eightSrc: read("scripts/ops/lp-eightraise.mjs"), files: {},
    deskSrc: read("src/worker/boss/lp/desk.ts"), engineSrc: read("src/worker/boss/outreach/engine.ts"),
  };
  for (const [name, patch, want] of cases) {
    const r = check({ ...real0, ...patch });
    if (!r.bad.some((b) => want.test(b))) { console.error(`  SELF-TEST FAILED: "${name}" was not caught (${r.bad.join("; ") || "nothing reported"})`); fails++; }
  }
  if (fails) process.exit(1);
  console.log(`LP RULES SELF-TEST PASSED: ${cases.length}/${cases.length} breaks caught.`);
  process.exit(0);
}

const { bad, examined } = real();
if (examined === 0) { console.error(`LP RULES SCAN EXAMINED NOTHING. ${bad.join(" ")}`); process.exit(2); }
if (bad.length) {
  console.error(`LP RULES FAILED (${bad.length}):\n  ${bad.join("\n  ")}`);
  process.exit(1);
}
console.log(`LP RULES PASSED: ${examined} checks — soft side-neutral prospect email, her LP voice, the 8Raise budget, no Tuesday reminder, no acting GET, four emails at most on day 0/3/7/14 with replies, bounces, opt-outs and complaints stopping it, no outside address.`);
