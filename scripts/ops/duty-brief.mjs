#!/usr/bin/env node
/**
 * "What does the owner say about this duty, right now?" — asked by duty-run.sh before every Mac job.
 *
 * Builder U, 23 Oct 2026: she edits her employees' duties on the site (instructions, which days,
 * pause, remove). A setting no code reads is a defect, so every Mac duty asks /api/duties/brief
 * before it runs and obeys the answer (`briefDecision`, src/shared/boss/duties/ownerEdits.mjs):
 *   - paused or removed                → exit 10, named SKIPPED line;
 *   - she changed its days (or the plist
 *     asked --only-if-due) and not due  → exit 10, named SKIPPED line;
 *   - her own instructions              → written to $BRIEF_OUT; duty-run.sh exports it as
 *                                         BOSS_DUTY_PROMPT_FILE, which each prompt-file script reads
 *                                         before its repo default.
 *
 * UNREACHABLE IS NOT "NOT DUE". With --only-if-due (ONLY_IF_DUE=1) it is a failure, exit 6, exactly
 * as duty-due.mjs always was. Without it the job ran on its own calendar before this existed, so it
 * still runs, on the repository's instructions, and says so in the log (NOTE [BRIEF_UNREACHABLE]).
 *
 *   LOCAL_JOB=lp-daily.mjs BRIEF_OUT=/tmp/x npm run vault:run -- node scripts/ops/duty-brief.mjs
 */
import { realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { briefDecision } from "../../src/shared/boss/duties/ownerEdits.mjs";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";

/** Pure: a fetched brief (or a failure) → { code, lines, instructions }. Exported for the test. */
export function plan(result, { onlyIfDue = false } = {}) {
  if (!result.ok) {
    if (onlyIfDue) return { code: 6, lines: [`NAMED STOP [DUE_UNKNOWN] ${result.why}`, "  Boss OS could not say whether this is due. That is a failure, not a skip."], instructions: null };
    return { code: 0, lines: [`NOTE [BRIEF_UNREACHABLE] ${result.why} — running on its own schedule with the repository's instructions.`], instructions: null };
  }
  const d = briefDecision(result.data, { onlyIfDue });
  return { code: d.code, lines: [d.line], instructions: d.run ? d.instructions ?? null : null };
}

async function fetchBrief(localJob) {
  if (!process.env.BOSS_PASSCODE) return { ok: false, why: "no passcode in this run (it goes through the vault)" };
  try {
    const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
    });
    if (!unlock.ok) return { ok: false, why: `Boss OS refused the passcode (${unlock.status})` };
    const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];
    const res = await fetch(`${ORIGIN}/api/boss/duties/brief/${encodeURIComponent(localJob)}`, { headers: { cookie } });
    if (!res.ok) return { ok: false, why: `${res.status}: ${(await res.text()).slice(0, 300)}` };
    const { data } = await res.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, why: `Boss OS could not be reached (${err instanceof Error ? err.message : String(err)})` };
  }
}

async function main() {
  const localJob = process.env.LOCAL_JOB ?? process.argv[2];
  if (!localJob) {
    console.error("NAMED STOP [NO_LOCAL_JOB] duty-brief needs the script name whose duty is being asked about.");
    process.exit(2);
  }
  const p = plan(await fetchBrief(localJob), { onlyIfDue: process.env.ONLY_IF_DUE === "1" });
  for (const l of p.lines) (p.code === 6 ? console.error : console.log)(l);
  if (p.instructions && process.env.BRIEF_OUT) writeFileSync(process.env.BRIEF_OUT, p.instructions);
  process.exit(p.code);
}

// Real paths on both sides: run through a symlinked checkout, a plain string compare would never
// match and the script would exit 0 having asked nothing — the one thing this wrapper must not do.
const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) void main();
