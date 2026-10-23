#!/usr/bin/env node
/**
 * The tail's report, FOLDED INTO SIMONE'S MORNING EMAIL (owner, 23 Oct 2026, rule 1: "#simone Tail"
 * stops as a standalone email). The report's second line — one plain sentence on where her job ended —
 * becomes one line under "Done for you" (src/shared/boss/mail/morning.mjs, section "tail"). A run that
 * ended INCOMPLETE is a fix job for the team, and her line says the job is still being worked on.
 * It sends no email. Run under `npm run vault:run` (the fix job needs BOSS_PASSCODE).
 *   node scripts/ops/boss-mail-tail-report.mjs <report.txt> <her subject>
 */
import { readFileSync } from "node:fs";
import { bossApi, fixJob, toMorning } from "./lib/duty-kit.mjs";

/** The report → `{ line, incomplete }`. Pure; tested. */
export function tailLine(report, subject) {
  const lines = String(report ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const incomplete = lines.some((l) => /^INCOMPLETE\b/.test(l));
  const subj = String(subject ?? "your email").replace(/^Re:\s*/i, "").slice(0, 80);
  const said = lines.slice(1).find((l) => !/^(INCOMPLETE|FRICTION_FIXED)\b/.test(l)) ?? null;
  if (incomplete) return { line: `Your email "${subj}": still being worked on; the team is finishing it.`, incomplete };
  return { line: `Your email "${subj}": ${said ?? "done."}`, incomplete };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, subject] = process.argv.slice(2);
  if (!file) { console.error("usage: boss-mail-tail-report.mjs <report.txt> <subject>"); process.exit(2); }
  const text = readFileSync(file, "utf8").trim();
  if (!text) { console.error("NAMED STOP [EMPTY_REPORT] the report file is empty; nothing was folded."); process.exit(3); }
  const { line, incomplete } = tailLine(text, subject);
  if (incomplete) {
    let why = null;
    try { why = await fixJob(await bossApi(), { title: `Finish the job from her email "${String(subject).slice(0, 80)}"`, prompt: `the tail on her Boss OS mail stopped before her job finished (report ${file} on her Mac). Finish the job and fix what stopped the tail.` }); }
    catch (e) { why = String(e?.message ?? e); }
    if (why) console.error(`  the fix job was not opened: ${why}`);
  }
  if (!toMorning("tail", { lines: [line] })) process.exit(8);
}
