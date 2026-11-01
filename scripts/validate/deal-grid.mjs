#!/usr/bin/env node
/**
 * validate:deal-grid — Boss fix D (owner, 23 Oct 2026), the deal grid and what Monique finds.
 *
 * Each check is a defect from her inbox review, made impossible to ship again:
 *   1. NO STANDALONE DEAL EMAIL. The match, the daily hunt and the grid never mail her; their findings
 *      go to the morning sections and the Deals page. A send call in any of them fails the build.
 *   1a. THE WEEKLY HUNT EMAIL IS ONE SEND, AND NEVER A DECIDE (owner, 1 Nov 2026, "the brokerage
 *      week"): Tuesday "Buyers for what you're selling" and Thursday "Sellers for what your LPs want
 *      to buy" are her two deal emails. `buyer-hunt.mjs` holds exactly one send, behind `--email`;
 *      `seller-hunt.mjs` sends nothing of its own; the built email has no Decide item (the ⭐ rule).
 *   2. HER OWN NAME IS NEVER A COUNTERPARTY. "Unnamed buyer of Sequoia Taylor" becomes a Yours row
 *      from "You"; her firm address by local part is hers.
 *   3. NO ABSURD PRICE. "$ 1,484,000 M" prints as "—".
 *   4. THE N-PORT READ CAN READ A FILING. `positionFromXml` once called an import that did not
 *      exist, inside a try, so every filing was "unreadable" and every hunt said nobody.
 *   5. THE ~6-MONTH WINDOW IS ONE CONSTANT, and every reader of the inbox ledger uses it.
 *   6. NO NAME FROM HER LISTS IN THE REPO. The lists live in D1; the validator knows only hashes of
 *      the seeded entries and fails if any tracked file contains one.
 *
 *   node scripts/validate/deal-grid.mjs            # check the repo
 *   node scripts/validate/deal-grid.mjs --self-test  # prove each check fails on a broken input
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

const NO_MAIL_FILES = ["scripts/ops/interest-match.mjs", "scripts/ops/ledger-hunt.mjs", "scripts/ops/seller-hunt.mjs",
  "scripts/ops/interest-grid.mjs", "scripts/ops/filing-hunt.mjs", "scripts/ops/lib/side-hunt.mjs"];
const WEEKLY_HUNT_FILE = "scripts/ops/buyer-hunt.mjs";
const WINDOW_READERS = ["scripts/ops/interest-match.mjs", "scripts/ops/ledger-hunt.mjs", "scripts/ops/interest-grid.mjs", "src/worker/boss/capital/grid.ts"];
/** sha256 of each seeded list entry, lowercased. The entries themselves are never written here. */
const SEEDED_HASHES = new Set([
  "9c52437be4c204d2bd53cfbe3f17114974ad0443a65f0b1b5374f8104d107f70",
  "9d072bb8c1d3eccbaf35aed41a5bd65ad3fe416f223b47164ff6785aec44435e",
]);

const sha = (s) => createHash("sha256").update(String(s).toLowerCase()).digest("hex");

export function checkNoMail(sources) {
  return Object.entries(sources).filter(([, src]) => /\b(postEmployeeMail|sendersFor|employeeMail|sendAsEmployee)\s*\(/.test(src))
    .map(([f]) => `${f} sends an email; deal findings go to the morning sections and the Deals page, never a standalone email`);
}

/** 1a: the weekly hunt sends once, only behind `--email`, and its email never carries a Decide item. */
export function checkWeeklyHunt(src, build) {
  const out = [];
  const sends = [...src.matchAll(/\b(postEmployeeMail|sendersFor|employeeMail|sendAsEmployee)\s*\(/g)];
  if (sends.length !== 1 || sends[0][1] !== "sendAsEmployee") out.push(`${WEEKLY_HUNT_FILE} must hold exactly one send (sendAsEmployee), found ${sends.length}`);
  if (!/const EMAIL = ARGS\.includes\("--email"\)/.test(src) || !/if \(EMAIL\)/.test(src)) out.push(`${WEEKLY_HUNT_FILE} sends without the --email gate; a hunt she asked for by email would mail her twice`);
  for (const side of ["buy", "sell"]) {
    const lot = { asset: "Acme", size_usd: 15e6, received_on: "2026-10-30", ageDays: 2 };
    const row = { principal: "A. Broker", quote: "we have Acme", size_usd: 100e6, price_text: null };
    const mail = build({ side, hunts: [{ lot, people: { hits: [{ row, ageDays: 3, fill: "$100M", price: "worth asking" }] }, funds: { holders: [] } }], now: Date.parse("2026-11-03T13:00:00Z") });
    if ((mail.layout.decide ?? []).length || (mail.layout.needs ?? []).length) out.push(`the ${side === "sell" ? "Thursday" : "Tuesday"} hunt email carries a Decide item; matches never go to Decide`);
  }
  return out;
}

export function checkHerself(lib) {
  const id = { names: ["Sequoia Taylor"], addresses: ["owner@example-own.com"] };
  const lists = { same_firm: [], do_not_suggest: [] };
  const g = lib.gridRow({ principal: "Unnamed buyer of Sequoia Taylor", side: "buy", asset: "Acme", size_usd: 1e7, source_message: "x", date: "2026-10-01" }, { identity: id, lists });
  const out = [];
  if (g.side !== "yours" || g.from_text !== "You") out.push(`her own name was read as a counterparty (side ${g.side}, from ${g.from_text})`);
  if (!lib.isHerAddress("owner@rainmakersecurities.com", id)) out.push("her firm address (her local part on her firm's domain) is not recognised as hers");
  return out;
}

export function checkPrice(lib) {
  const out = [];
  for (const [input, want] of [["$ 1,484,000 M", "—"], ["$ 600,000,000,000 M", "—"], ["$9T", "—"]]) {
    if (lib.priceWords(input) !== want) out.push(`price "${input}" printed as "${lib.priceWords(input)}", not "${want}"`);
  }
  return out;
}

export function checkNport(hunt) {
  const xml = "<genInfo><seriesName>Fund</seriesName></genInfo><totAssets>100</totAssets><invstOrSec><name>Acme Inc</name><valUSD>5</valUSD></invstOrSec>";
  try {
    const p = hunt.positionFromXml(xml, "Acme");
    return p?.valUSD === 5 ? [] : ["positionFromXml read no position from a filing that holds one"];
  } catch (e) {
    return [`positionFromXml throws (${e.message}) — every filing would be swallowed as unreadable`];
  }
}

export function checkWindow(sources, lookbackDays) {
  const out = [];
  if (lookbackDays < 150 || lookbackDays > 200) out.push(`LOOKBACK_DAYS is ${lookbackDays}; her rule is about six months`);
  for (const [f, src] of Object.entries(sources)) {
    if (!/withinLookback|LOOKBACK_DAYS/.test(src)) out.push(`${f} reads the inbox ledger without the ~6-month window`);
    if (/const\s+LOOKBACK_DAYS\s*=/.test(src)) out.push(`${f} defines its own LOOKBACK_DAYS; there is one, in partyLists.mjs`);
  }
  return out;
}

export function checkNoSeededNames(files, read, hashes = SEEDED_HASHES) {
  const out = [];
  for (const f of files) {
    let text;
    try { text = read(f); } catch { continue; }
    for (const m of text.toLowerCase().matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g)) {
      if (hashes.has(sha(m[0]))) out.push(`${f} contains an entry from her private lists`);
    }
  }
  return out;
}

async function load() {
  const lib = await import("../ops/interest-grid.mjs");
  const hunt = await import("../ops/filing-hunt.mjs");
  const { buildHuntEmail } = await import("../ops/lib/side-hunt.mjs");
  const { LOOKBACK_DAYS } = await import("../../src/shared/boss/capital/partyLists.mjs");
  return { lib, hunt, LOOKBACK_DAYS, buildHuntEmail };
}

const readSources = (files) => Object.fromEntries(files.map((f) => [f, fs.readFileSync(f, "utf8")]));

async function main() {
  const { lib, hunt, LOOKBACK_DAYS, buildHuntEmail } = await load();
  if (process.argv.includes("--self-test")) {
    const cases = [
      ["a hunt that emails her is caught", checkNoMail({ "x.mjs": "await postEmployeeMail(sender, m)" }).length === 1],
      ["a no-mail file using sendAsEmployee is caught", checkNoMail({ "x.mjs": "await sendAsEmployee(\"monique\", m)" }).length === 1],
      ["a second weekly send is caught", checkWeeklyHunt('const EMAIL = ARGS.includes("--email"); if (EMAIL) {} sendAsEmployee(a); sendAsEmployee(b)', buildHuntEmail).length === 1],
      ["a weekly send with no --email gate is caught", checkWeeklyHunt("sendAsEmployee(a)", buildHuntEmail).length === 1],
      ["a hunt email with a Decide item is caught", checkWeeklyHunt('const EMAIL = ARGS.includes("--email"); if (EMAIL) {} sendAsEmployee(a)', (x) => ({ layout: { decide: ["match"] } })).length === 2],
      ["her name as a counterparty is caught", checkHerself({ ...lib, gridRow: (r, c) => ({ ...lib.gridRow(r, c), side: "buy", from_text: "Sequoia Taylor" }) }).length >= 1],
      ["an absurd price printed is caught", checkPrice({ priceWords: (s) => s }).length === 3],
      ["a filing reader that throws is caught", checkNport({ positionFromXml: () => { throw new ReferenceError("assetKey is not defined"); } }).length === 1],
      ["a reader with no window is caught", checkWindow({ "y.mjs": "interests.filter(Boolean)" }, 183).length === 1],
      ["a second window constant is caught", checkWindow({ "y.mjs": "const LOOKBACK_DAYS = 90; withinLookback" }, 183).length === 1],
      ["a wrong window length is caught", checkWindow({}, 30).length === 1],
      ["a seeded entry in a tracked file is caught", checkNoSeededNames(["f"], () => "ping someone@private.example", new Set([sha("someone@private.example")])).length === 1],
    ];
    let failed = 0;
    for (const [name, pass] of cases) { console.log(`${pass ? "ok  " : "FAIL"} ${name}`); if (!pass) failed += 1; }
    if (failed) { console.error(`SELF-TEST FAILED: ${failed}/${cases.length}`); process.exit(1); }
    console.log(`SELF-TEST PASSED: ${cases.length}/${cases.length} cases.`);
    return;
  }
  const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n")
    .filter((f) => f && !/\.(png|jpg|jpeg|gif|webp|woff2?|ttf|otf|ico|pdf|zip)$/i.test(f));
  const errors = [
    ...checkNoMail(readSources(NO_MAIL_FILES)),
    ...checkWeeklyHunt(fs.readFileSync(WEEKLY_HUNT_FILE, "utf8"), buildHuntEmail),
    ...checkHerself(lib),
    ...checkPrice(lib),
    ...checkNport(hunt),
    ...checkWindow(readSources(WINDOW_READERS), LOOKBACK_DAYS),
    ...checkNoSeededNames(tracked, (f) => fs.readFileSync(f, "utf8")),
  ];
  if (errors.length) {
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error(`validate:deal-grid FAILED: ${errors.length} problem(s).`);
    process.exit(1);
  }
  console.log(`validate:deal-grid: ok — no deal email, her name is never a counterparty, prices are sane, filings read, ${LOOKBACK_DAYS}-day window, no private names in ${tracked.length} files.`);
}

main().catch((e) => { console.error(`validate:deal-grid crashed: ${e?.stack ?? e}`); process.exit(1); });
