#!/usr/bin/env node
/**
 * ALARM WATCH — the post-land proof for a Kendra repair (8 Nov 2026, alarm output:duty_exec_intel).
 *
 * A Kendra alarm closes itself on the Worker's hourly tick once its condition clears. A repair is
 * proven when its alarm reads `closed`, not when the PR is green. This is ONE bounded, blocking,
 * read-only command: it polls GET /api/boss/alarms for one key until the row is closed, prints the
 * closed reason, and exits 0; at the deadline it exits 2 as a NAMED STOP. It spends nothing and
 * sends nothing.
 *
 *   npm run -s alarm:watch -- output:duty_exec_intel [--minutes 90] [--every 60]
 *   node scripts/ops/alarm-watch.mjs --self-test
 *
 * THE FIX MUST BE LIVE FIRST (8 Nov 2026, rework of output:duty_exec_intel). The first watch waited
 * 75 minutes and blamed the repair, but the repair was never in production: main's e2e went red on a
 * sibling PR (#343), so Deploy skipped the merge and production stayed on 40cbe53. An alarm cannot
 * clear on code that is not running. So the watch first reads which sha production runs (the GitHub
 * Deployment `land` and deploy.yml record, environment `production`) and whether it carries the fix
 * (`--sha <merge sha>`, default main's head when the watch starts), keeps reading it until it does,
 * and at the deadline names THAT as the stop — [FIX_NOT_DEPLOYED] — never "the alarm is still open".
 *
 * Exit: 0 closed · 2 NAMED STOP (not deployed, still open at the deadline, or the key never seen) · 1 usage/error.
 */
import { execFileSync } from "node:child_process";
import { bossApi } from "./lib/duty-kit.mjs";

/**
 * Does production carry the fix? `compareStatus` is GitHub's compare of fix...production
 * ("identical" / "ahead": production is the fix or after it; "behind" / "diverged": it is not). Pure.
 */
export function deployState(fixSha, prodSha, compareStatus) {
  if (!fixSha) return { state: "not read", why: "no fix sha to look for" };
  if (!prodSha) return { state: "not read", why: "no production deployment recorded" };
  if (fixSha === prodSha || compareStatus === "identical" || compareStatus === "ahead") return { state: "live", prod: prodSha };
  if (compareStatus === "behind" || compareStatus === "diverged") return { state: "not live", prod: prodSha };
  return { state: "not read", why: `compare said ${compareStatus ?? "nothing"}`, prod: prodSha };
}

/** The words of the stop at the deadline: the deploy first, the alarm only once the fix runs. Pure. */
export function stopWords(key, minutes, deploy, alarm) {
  if (deploy.state === "not live") {
    return `NAMED STOP [FIX_NOT_DEPLOYED] ${key} — production still runs ${String(deploy.prod).slice(0, 7)}, which does not carry ${String(deploy.fix).slice(0, 7)}, after ${minutes} min; the alarm cannot clear until it does (Deploy runs on a green e2e of main)`;
  }
  const why = alarm.state === "open" ? `still open after ${minutes} min: ${alarm.text ?? ""}`
    : alarm.state === "absent" ? "no alarm with this key open or closed in the last 7 days"
    : `not read: ${alarm.why ?? "unknown"}`;
  const live = deploy.state === "live" && deploy.at ? ` (fix live in production since ${new Date(deploy.at).toISOString()})`
    : deploy.state === "not read" ? ` (production deploy not read: ${deploy.why})` : "";
  return `NAMED STOP [ALARM_NOT_CLOSED] ${key} — ${why}${live}`;
}

function gh(args) {
  return execFileSync("gh", ["api", ...args], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Read production's sha and whether it carries `fix`. Never throws. */
function readDeploy(fix) {
  try {
    const prod = gh(["repos/{owner}/{repo}/deployments?environment=production&per_page=1", "--jq", ".[0].sha // empty"]);
    const status = prod && prod !== fix ? gh([`repos/{owner}/{repo}/compare/${fix}...${prod}`, "--jq", ".status"]) : null;
    return { ...deployState(fix, prod, status), fix };
  } catch (err) {
    return { state: "not read", why: (err instanceof Error ? err.message : String(err)).split("\n")[0], fix };
  }
}

/** What one read of the alarm list says about a key. Pure. */
export function alarmState(alarms, key) {
  const row = (alarms ?? []).find((a) => a?.alarm_key === key);
  if (!row) return { state: "absent" };
  if (row.status === "closed") return { state: "closed", reason: row.closed_reason ?? "no reason recorded", at: row.closed_at };
  return { state: "open", text: row.text, seen: row.seen };
}

// Kendra checks hourly. A two-minute substitute cannot prove a repair failed.
// Validate before gh or Boss OS receives any request.
export function watchMinutes(value = 90) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 65 || minutes > 180) {
    throw new Error("NAMED STOP [WATCH_WINDOW_TOO_SHORT_OR_INVALID] --minutes must be 65..180: allow Kendra's hourly check to observe the live fix; never replace the recorded watch with a shorter probe");
  }
  return minutes;
}

function argText(name) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}

function selfTest() {
  const cases = [
    [alarmState([], "output:x").state, "absent"],
    [alarmState([{ alarm_key: "output:x", status: "open", text: "t", seen: 3 }], "output:x").state, "open"],
    [alarmState([{ alarm_key: "output:y", status: "closed" }, { alarm_key: "output:x", status: "closed", closed_reason: "the newest run met its floor" }], "output:x").reason, "the newest run met its floor"],
    [alarmState([{ alarm_key: "output:y", status: "closed" }], "output:x").state, "absent"],
    // 8 Nov 2026: the merge sat behind production (compare fix...prod = "behind") — not live.
    [deployState("6f2db22", "40cbe53", "behind").state, "not live"],
    [deployState("6f2db22", "87415e9", "ahead").state, "live"],
    [deployState("6f2db22", "6f2db22", null).state, "live"],
    [deployState("6f2db22", "", null).state, "not read"],
    [stopWords("output:x", 75, { state: "not live", prod: "40cbe53", fix: "6f2db22" }, { state: "open" }).includes("[FIX_NOT_DEPLOYED]"), true],
    [stopWords("output:x", 75, { state: "live", at: 1 }, { state: "open", text: "t" }).includes("[ALARM_NOT_CLOSED]"), true],
  ];
  const bad = cases.filter(([got, want]) => got !== want);
  if (bad.length) { console.error(`SELF-TEST FAILED: ${bad.length} case(s)`); process.exit(1); }
  console.log(`SELF-TEST PASSED: ${cases.length}/${cases.length} cases.`);
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const key = process.argv.slice(2).find((a) => /^(output|task|mail):/.test(a));
  if (!key) { console.error("usage: alarm-watch.mjs <alarm key, e.g. output:duty_exec_intel> [--sha <merge sha>] [--minutes 90] [--every 60]"); process.exit(1); }
  const minutes = watchMinutes(argText("--minutes") ?? 90);
  const every = Math.min(Math.max(arg("--every", 60), 15), 600);
  const deadline = Date.now() + minutes * 60_000;
  let last = { state: "not read" };
  // The fix to look for: the merge sha if given, else main's head as the watch starts (it holds the merge).
  let fix = argText("--sha");
  if (!fix) { try { fix = gh(["repos/{owner}/{repo}/commits/main", "--jq", ".sha"]); } catch { fix = null; } }
  let deploy = fix ? { state: "not live", fix } : { state: "not read", why: "main's head could not be read" };
  for (;;) {
    if (deploy.state !== "live" && fix) {
      const d = readDeploy(fix);
      deploy = d.state === "live" ? { ...d, at: Date.now() } : d;
      console.log(`deploy: ${d.state}${d.prod ? ` (production ${String(d.prod).slice(0, 7)}, fix ${fix.slice(0, 7)})` : ""}${d.why ? `: ${d.why}` : ""}`);
    }
    try {
      // A fresh session each poll: a 90-minute wait can outlive one.
      const api = await bossApi();
      last = alarmState((await api.get("/alarms"))?.alarms, key);
    } catch (err) {
      last = { state: "not read", why: err instanceof Error ? err.message : String(err) };
    }
    if (last.state === "closed") {
      console.log(`OUTPUT alarm ${key} closed: ${last.reason}${last.at ? ` (${new Date(Number(last.at)).toISOString()})` : ""}`);
      process.exit(0);
    }
    if (Date.now() + every * 1000 > deadline) break;
    await new Promise((r) => setTimeout(r, every * 1000));
  }
  console.error(stopWords(key, minutes, deploy, last));
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
