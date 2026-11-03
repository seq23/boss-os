#!/usr/bin/env node
/**
 * THE CAPITAL CHAIN'S UNFINISHED-RUN MARK — written at the start of `com.seq.boss-capital`'s daily
 * chain, removed at its end. See src/shared/boss/capital/chainMark.mjs for why this exists (3 Nov
 * 2026: a kernel panic mid-chain lost a whole day's `monique_found` morning section, silently).
 *
 *   node scripts/ops/capital-chain.mjs -- --start <pid>     # the chain is beginning; <pid> is the
 *                                                            # live /bin/bash -lc's own $$
 *   node scripts/ops/capital-chain.mjs -- --done             # the chain reached its end
 *   node scripts/ops/capital-chain.mjs -- --resume-if-unfinished   # the launchd KeepAlive tick
 *
 * RULE 0: every path prints one line explaining what it did or why not.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { UNFINISHED_PATH, resumeDecision } from "../../src/shared/boss/capital/chainMark.mjs";
import { centralDay } from "../../src/shared/boss/scorecard/scorecard.mjs";

const MARK = path.join(os.homedir(), UNFINISHED_PATH);
const CAPITAL_LABEL = "com.seq.boss-capital";

function readMark() {
  try { return JSON.parse(fs.readFileSync(MARK, "utf8")); } catch { return null; }
}
function writeMark(record) {
  fs.mkdirSync(path.dirname(MARK), { recursive: true });
  fs.writeFileSync(`${MARK}.tmp`, JSON.stringify(record, null, 2));
  fs.renameSync(`${MARK}.tmp`, MARK);
}
function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function start(pid) {
  const record = { chain: "capital", day: centralDay(), pid: Number(pid) || null, started_at: new Date().toISOString(), attempts: 0 };
  writeMark(record);
  console.log(`capital-chain: started for ${record.day} (pid ${record.pid})`);
}

function done() {
  if (fs.existsSync(MARK)) fs.rmSync(MARK, { force: true });
  console.log("capital-chain: reached its end; the unfinished mark is cleared");
}

function resumeIfUnfinished() {
  const record = readMark();
  const today = centralDay();
  const decision = resumeDecision({ record, today, pidAlive: pidAlive(record?.pid) });
  console.log(`capital-chain: ${decision.reason}`);
  if (decision.action === "none" || decision.action === "wait") return;
  if (decision.action === "stale") {
    console.log(`NAMED STOP [CAPITAL_CHAIN_DAY_LOST] ${decision.reason}`);
    fs.rmSync(MARK, { force: true });
    process.exitCode = 2;
    return;
  }
  writeMark({ ...record, attempts: (record.attempts ?? 0) + 1 });
  try {
    execFileSync("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/${CAPITAL_LABEL}`], { stdio: "inherit" });
    console.log(`capital-chain: kickstarted ${CAPITAL_LABEL}`);
  } catch (e) {
    console.log(`NAMED STOP [CAPITAL_CHAIN_KICKSTART_FAILED] launchctl kickstart on ${CAPITAL_LABEL} failed: ${e.message}`);
    process.exitCode = 2;
  }
}

const args = process.argv.slice(2);
if (args[0] === "--start") start(args[1]);
else if (args[0] === "--done") done();
else if (args[0] === "--resume-if-unfinished") resumeIfUnfinished();
else {
  console.log("NAMED STOP [USAGE] capital-chain.mjs needs --start <pid> | --done | --resume-if-unfinished");
  process.exitCode = 2;
}
