#!/usr/bin/env node
/** Guard the brokerage scan admission path and the existing evidence requirement in extraction. */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

const FILTER = "scripts/ops/interest-ledger.mjs";
const EXTRACTOR = "scripts/ops/interest-extract.mjs";
const MONIQUE_DEAL_READERS = [
  FILTER, EXTRACTOR, "scripts/ops/interest-grid.mjs", "scripts/ops/interest-match.mjs",
  "scripts/ops/ledger-hunt.mjs", "scripts/ops/filing-hunt.mjs", "scripts/ops/buyer-hunt.mjs",
  "scripts/ops/seller-hunt.mjs", "scripts/ops/lp-buyer-crossmatch.mjs",
  "scripts/ops/lib/side-hunt.mjs", "scripts/ops/lib/deal-reading.mjs",
];

function checkFreeReader(file, source) {
  if (/\b(?:claude-\w|gpt-\w|codex-\w)|\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(\s*["'](?:claude|codex)["']|\b(?:claudeCodeExecutor|codexExecutor)\b/i.test(source)) {
    return [`${file}: deal reading uses a provider outside the shared free router`];
  }
  return [];
}

function checkScan(src) {
  const bad = [];
  const required = [
    [/readWorkerSource/, "use the shared free-model reader"],
    [/\/threads\/.*format=full/, "load full Gmail threads"],
    [/r\.status === 403/, "retry Gmail throttling"],
    [/r\.status === 401/, "refresh a rejected token"],
    [/TOKEN_MAX_AGE_MS/, "refresh the token before it expires"],
  ];
  for (const [pattern, why] of required) if (!pattern.test(src)) bad.push(`${FILTER}: ${why}`);
  if (/GMAIL_SHAPE|shapeReason|bulkReason|withoutQuoted/.test(src)) bad.push(`${FILTER}: a prior meaning filter returned`);
  if (/rmSync\(batchDir/i.test(src)) bad.push(`${FILTER}: scan must preserve unextracted candidate batches`);
  return bad;
}

function checkExtract(extractSrc) {
  const bad = [];
  if (/gmail\.googleapis\.com|auth\/gmail/.test(extractSrc)) {
    bad.push(`${EXTRACTOR}: legacy extraction must reload through the scan’s read-only Gmail adapter`);
  }
  if (!/readWorkerSource/.test(extractSrc) || /structuredOrder|runClaude|decideSide|isRelayedNote/.test(extractSrc)) {
    bad.push(`${EXTRACTOR}: extraction must read all candidates via the shared model before deciding interest`);
  }
  if (!/NAMED STOP \[EXTRACTION_NEVER_RAN\]/.test(extractSrc)) {
    bad.push(`${EXTRACTOR}: report a named stop when every extract batch fails`);
  }
  if (!/no quote from the message/.test(extractSrc)) {
    bad.push(`${EXTRACTOR}: a row is admitted without the sentence that produced it. `
      + "An unquoted row cannot be checked, and precision judged on real sentences is the only "
      + "acceptance test this ledger has — she has no book of closed deals to reconcile against.");
  }
  if (!/NAMED STOP \[NOTHING_CHECKABLE\]/.test(extractSrc) || !/reviewSet/.test(extractSrc)) {
    bad.push(`${EXTRACTOR}: the review surface is gone. Without it the ledger's correctness is `
      + "asserted by the thing that produced it, which is no evidence at all.");
  }
  if (!/wrong\.json|WRONG_FILE/.test(extractSrc)) {
    bad.push(`${EXTRACTOR}: there is no way to mark a row wrong. A review she cannot answer is a report.`);
  }
  return bad;
}

const scan = readFileSync(new URL(`../../${FILTER}`, import.meta.url), "utf8");
const extract = readFileSync(new URL(`../../${EXTRACTOR}`, import.meta.url), "utf8");
const bad = [
  ...checkScan(scan), ...checkExtract(extract),
  ...MONIQUE_DEAL_READERS.flatMap((file) => checkFreeReader(file, readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"))),
];
if (process.argv.includes("--self-test")) {
  for (const example of ['spawn("claude", args)', 'const model = "gpt-4.1";', "await claudeCodeExecutor(input)"]) {
    if (!checkFreeReader(EXTRACTOR, example).length) bad.push("A paid route passed its deal reader guard");
  }
  for (const [check, changed] of [
    [checkScan, scan.replaceAll("readWorkerSource", "readSomewhereElse")],
    [checkScan, scan.replace("r.status === 403", "false")],
    [checkScan, scan.replace("r.status === 401", "false")],
    [checkScan, scan.replaceAll("TOKEN_MAX_AGE_MS", "tokenAge")],
    [checkScan, scan + "\nfunction shapeReason() {}"],
    [checkScan, scan + "\nfs.rmSync(batchDir);"],
    [checkExtract, extract + "\nfunction structuredOrder() {}"],
    [checkExtract, extract + '\nfetch("https://gmail.googleapis.com/x");'],
    [checkExtract, extract.replaceAll("no quote from the message", "ok")],
    [checkExtract, extract.replaceAll("NOTHING_CHECKABLE", "done")],
    [checkExtract, extract.replaceAll("wrong.json", "x").replaceAll("WRONG_FILE", "X")],
  ]) if (!check(changed).length) bad.push("A modified source passed its scan guard");
} else {
  const file = join(process.env.BOSS_OS_CAPITAL_DIR ?? join(os.homedir(), ".boss-os", "capital"), "scan.json");
  if (existsSync(file)) {
    const report = JSON.parse(readFileSync(file, "utf8"));
    const dropped = Object.values(report.drops ?? {}).reduce((sum, count) => sum + count, 0);
    if (dropped + report.never_read + report.kept !== report.census) bad.push(`${file}: scan counts do not balance`);
    if (report.status === "complete" && report.never_read !== 0) bad.push(`${file}: completed scan contains unread mail`);
  }
}
if (bad.length) {
  for (const violation of bad) console.error(violation);
  process.exitCode = 1;
} else {
  console.log("CAPITAL SCAN ACCOUNTING PASSED");
}
