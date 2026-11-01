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
 *   6. The sequence stops at two emails — the first and ONE follow-up (owner, 24 Oct 2026) — five days apart at least.
 *   7. No address outside our own domains or example.com in any file this fix owns (public repo).
 *
 * RULE 0: every check examines something; an empty scan fails. `--self-test` breaks each rule and
 * watches it go red.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as plan from "../../src/shared/boss/lp/plan.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const OWNED = [
  "src/shared/boss/lp/plan.mjs", "src/worker/boss/lp/desk.ts", "src/worker/boss/routes/lpTap.ts", "src/worker/boss/routes/lp.ts",
  "scripts/ops/lp-daily.mjs", "scripts/ops/lp-prospects.mjs", "scripts/ops/lp-prospect-discovery.mjs", "scripts/ops/lp-catchups.mjs",
  "scripts/ops/lp-eightraise.mjs", "scripts/ops/lp-followups.mjs", "migrations/0294_boss_lps_and_prospects.sql",
  "src/client/boss/pages/deals/LpTab.tsx", "src/client/boss/pages/deals/ProspectsTab.tsx", "tests/boss/lpProspects.test.ts",
];

export function check({ template, lpBody, installer, tapSrc, eightSrc, files, P = plan }) {
  const bad = [];
  let examined = 0;
  const names = [{ name: "Alpha" }, { name: "Beta" }, { name: "Gamma" }];
  for (const touch of [1, 2]) {
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
  if (P.MAX_TOUCHES !== 2) bad.push(`MAX_TOUCHES is ${P.MAX_TOUCHES}; her rule is the first email and ONE follow-up`);
  if (P.dueTouch({ status: "active", touches: 2, first_sent_at: t0, last_touch_at: t0 + 5 * DAY }, t0 + 60 * DAY) !== null) bad.push("a third touch is due");
  if (P.dueTouch({ status: "active", touches: 1, first_sent_at: t0, last_touch_at: t0 + 4 * DAY }, t0 + 6 * DAY) !== null) bad.push("two touches two days apart");
  if (P.dueTouch({ status: "replied", touches: 1, first_sent_at: t0 }, t0 + 30 * DAY) !== null) bad.push("a reply did not stop the sequence");

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
  ];
  let fails = 0;
  if (base.bad.length) { console.error(`SELF-TEST: the real repo is not clean first:\n  ${base.bad.join("\n  ")}`); process.exit(1); }
  const real0 = {
    template: plan.DEFAULT_PROSPECT_TEMPLATE, lpBody: plan.lpReplyBody({ name: "Alex", bucket: "call" }),
    installer: read("scripts/ops/install-agent-launchd.sh"), tapSrc: read("src/worker/boss/routes/lpTap.ts"),
    eightSrc: read("scripts/ops/lp-eightraise.mjs"), files: {},
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
console.log(`LP RULES PASSED: ${examined} checks — soft side-neutral prospect email, her LP voice, the 8Raise budget, no Tuesday reminder, no acting GET, one follow-up at most, no outside address.`);
