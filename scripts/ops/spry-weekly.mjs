#!/usr/bin/env node
/**
 * THE SPRY LABS WEEKLY (owner, 1 Nov 2026): one email on Wednesday at 08:15 Central, one short
 * section per Spry Labs business, from Camille. It replaced the five separate weekly emails the
 * repos used to send on Monday.
 *
 * Each repo in src/shared/boss/spryWeekly/sources.mjs computes its weekly report on Wednesday morning
 * and uploads spry-weekly-summary.json as the GitHub Actions artifact `spry-weekly-summary`. This reads
 * the newest one per repo through `gh` (already signed in on her Mac: no new key, no paid service),
 * words it (src/shared/boss/spryWeekly/compose.mjs) and sends one email.
 *
 * A REPORT THAT IS LATE IS WAITED FOR, BRIEFLY. GitHub's scheduled runs start up to ~20 minutes late;
 * while any source is missing this re-reads every two minutes, for at most 25 minutes, then sends with
 * a plain "No report this week" line for whatever is still missing (rule 0: never silence).
 *
 * ONCE A WEEK. A sent week is recorded in ~/.boss-os/spry-weekly/sent.json so the launchd retry slot,
 * or a hand run, never sends it twice (`--force` does).
 *
 *   npm run spry:weekly             # wait for, word and send this week's email
 *   npm run spry:weekly -- --dry    # read and print only; sends nothing, waits for nothing
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { composeSpryWeekly, SPRY_WEEKLY, summaryProblem } from "../../src/shared/boss/spryWeekly/compose.mjs";
import { layoutEmail } from "../../src/shared/boss/mail/plain.mjs";
import { bossApi, fixJob, sendAs } from "./lib/duty-kit.mjs";
import { fetchLoopWeeks } from "./lib/search-loop-week.mjs";

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 << 20, stdio: ["ignore", "pipe", "pipe"] });

/** The newest spry-weekly-summary artifact of one repo, parsed; or `{ problem }` in plain words. */
export function fetchSummary(src, { run = gh } = {}) {
  let list;
  try {
    list = JSON.parse(run(["api", `repos/${SPRY_WEEKLY.owner}/${src.repo}/actions/artifacts?name=${SPRY_WEEKLY.artifact}&per_page=5`]));
  } catch {
    return { problem: "GitHub could not be reached from the Mac" };
  }
  const art = (list.artifacts ?? []).filter((a) => !a.expired).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!art) return { problem: "it has not run since the change to Wednesdays" };
  const dir = mkdtempSync(join(tmpdir(), "spry-weekly-"));
  try {
    run(["run", "download", String(art.workflow_run?.id), "-R", `${SPRY_WEEKLY.owner}/${src.repo}`, "-n", SPRY_WEEKLY.artifact, "-D", dir]);
    const file = join(dir, "spry-weekly-summary.json");
    if (!existsSync(file)) return { problem: "its report was empty" };
    return { summary: JSON.parse(readFileSync(file, "utf8")) };
  } catch {
    return { problem: "its report could not be read" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function fetchAll({ now = Date.now(), run = gh } = {}) {
  const got = {};
  for (const src of SPRY_WEEKLY.sources) {
    const g = fetchSummary(src, { run });
    const stale = g.summary ? summaryProblem(g.summary, { now, maxAgeHours: src.max_age_hours ?? 36 }) : null;
    got[src.key] = stale ? { summary: g.summary, problem: stale } : g;
  }
  return got;
}

const STATE_DIR = join(homedir(), ".boss-os", "spry-weekly");
const weekKey = (now) => new Date(now).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

async function main() {
  const dry = process.argv.includes("--dry");
  const force = process.argv.includes("--force");
  const started = Date.now();
  const sentFile = join(STATE_DIR, "sent.json");
  const sent = existsSync(sentFile) ? JSON.parse(readFileSync(sentFile, "utf8")) : {};
  const key = weekKey(started);
  if (!dry && !force && sent[key]) { console.log(`SKIPPED [ALREADY_SENT] the Spry Labs weekly for ${key} went at ${sent[key]}.`); return; }

  let got = fetchAll();
  const missing = () => SPRY_WEEKLY.sources.filter((s) => got[s.key]?.problem).map((s) => s.key);
  while (!dry && missing().length && Date.now() - started < 25 * 60_000) {
    console.log(`waiting for: ${missing().join(", ")}`);
    await new Promise((r) => setTimeout(r, 120_000));
    got = fetchAll();
  }
  // The search loop line (1 Nov 2026): each repo's newest search-loop-week reports, read once.
  const loop = Object.fromEntries([...new Set(SPRY_WEEKLY.search_loop.sites.flatMap((x) => x.repos))].map((r) => [r, fetchLoopWeeks(r)]));
  const mail = composeSpryWeekly(got, { loop });
  const laid = layoutEmail({ who: "Camille", subject: mail.subject, happened: mail.happened, sections: mail.sections });
  if (dry) { console.log(laid.subject); console.log(laid.text); return; }
  if (!(await sendAs("Camille", { subject: laid.subject, text: laid.text, html: laid.html, prelaid: laid }))) {
    console.error("NAMED STOP [NO_MAIL_SENT] the Spry Labs weekly could not be sent; not recorded, so the next run tries again.");
    process.exit(8);
  }
  // "THE TEAM CHECKS WHY" IS A PROMISE THE EMAIL MAKES, SO IT IS KEPT HERE: one fix job on Danielle's
  // desk naming each report that did not arrive (rule 3: a chore for the team, never her mail).
  const late = SPRY_WEEKLY.sources.filter((s) => got[s.key]?.problem);
  const loopLate = SPRY_WEEKLY.search_loop.sites.filter((x) => mail.loopLate.includes(x.key));
  if (late.length || loopLate.length) {
    const why = await fixJob(await bossApi().catch(() => null), {
      title: `Spry Labs weekly: ${late.length + loopLate.length} report(s) did not arrive`,
      prompt: [
        ...late.map((s) => `${s.label} (seq23/${s.repo}, ${s.workflow}): ${got[s.key].problem}. Find why the Wednesday run did not upload the ${SPRY_WEEKLY.artifact} artifact, fix it at source, and dispatch the workflow.`),
        ...loopLate.map((x) => `${x.label} search loop (${x.repos.map((r) => `seq23/${r}`).join(", ")}): the site runs the shared search-loop engine but uploaded no search-loop-week report in the last eight days. Find why its loop run did not upload it, fix it at source, and dispatch the workflow.`),
      ].join("\n"),
    }).catch((e) => e?.message ?? String(e));
    if (why) console.error(`NOTE [FIX_JOB_NOT_OPENED] ${why}`);
  }
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(sentFile, JSON.stringify({ ...sent, [key]: new Date().toISOString() }, null, 2));
  console.log(`sent: ${SPRY_WEEKLY.sources.length} sections, ${mail.looks} to look at, ${mail.missing} missing.`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
