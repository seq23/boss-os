#!/usr/bin/env node
/**
 * DANIELLE'S REPO-CHANGE LANE — the runner on her Mac.
 *
 * ─── What one tick does ─────────────────────────────────────────────────────
 *
 *   1. Ask Boss OS what is claimable (`GET /api/repo-changes/claimable`). Nothing → NAMED STOP
 *      [NOTHING_CLAIMABLE], exit 7, with the waiting rows and their reasons in the log. That is the
 *      ordinary tick, and it is loud about being ordinary.
 *   2. For every row in `landing`, ask `gh pr checks` and record what it said — green moves the row
 *      to `land`, which makes it claimable in the same tick.
 *   3. Claim ONE phase at a time (one live run per task, enforced by the Worker), pull the Drive
 *      package if there is one, read the target repo's RUNBOOK.md (BLOCK if there is none), compose
 *      the phase prompt from `repo-change-prompt.md`, and run a FRESH `claude -p` on the phase's
 *      model with the phase's turn cap and a hard wall-clock cap. Fresh context per phase, the way
 *      the Ahrefs fixer runs.
 *   4. Read the JSON the phase wrote, email her (the plan and its asks; the DONE proof; a named
 *      stop), and report to the Worker with the email's id — the Worker refuses a report that
 *      claims she was told without the id that proves it.
 *
 * ─── What lives where ───────────────────────────────────────────────────────
 *
 * The models, the turn caps, the timeouts, the parse and the two guards are in
 * `src/shared/boss/repoChange/lane.mjs` — imported here, restated nowhere. The Worker enforces the
 * guards at the claim; this file ALSO checks `canEnterBuild` / `canLand` on the row it was handed,
 * so a Worker bug cannot hand it a phase it may not run. Belt and braces, same rule both ends.
 *
 * ─── Never a bare `wrangler deploy`, never a merge outside `~/bin/land` ─────
 *
 * The LAND phase runs `~/bin/land <pr>`, which verifies green, merges, watches main and deploys per
 * repo — or refuses. This file never calls `gh pr merge`, never dispatches a workflow, and the
 * validator `the-repo-lane-lands-only-on-green.mjs` fails the build if it starts to.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PHASE_MODELS, PHASE_MAX_TURNS, PHASE_TIMEOUT_MIN, ASK_POLICY, TASK_KIND, EXECUTOR_SCRIPT,
  canEnterBuild, canLand, canPreview, needsPreview, isForced, changeToken, gridRepoNames, APPROVED_DEFAULTS_TEXT, PREVIEW_DEFAULTS_TEXT, FORCED_TEXT,
} from "../../src/shared/boss/repoChange/lane.mjs";
import { sendersFor } from "./notify.mjs";
import { resolveDeviceId, missingDeviceIdMessage } from "./device-id.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const PROMPT_FILE = process.env.REPO_CHANGE_PROMPT ?? join(HERE, "repo-change-prompt.md");
const WORK_ROOT = process.env.REPO_CHANGE_WORK_DIR ?? join(homedir(), ".boss-os", "repo-change");
const GITHUB_DIR = process.env.REPO_CHANGE_GITHUB_DIR ?? join(homedir(), "GitHub");
const LAND = process.env.REPO_CHANGE_LAND ?? join(homedir(), "bin", "land");
const TO = process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com";
const CLAUDE = process.env.REPO_CHANGE_CLAUDE ?? "claude";
const DRY = process.argv.includes("--dry-run");
/** The lane's own name, cross-checked by `validate:duty-delivery` against the script and the kind. */
export const LANE = { kind: TASK_KIND, executor: EXECUTOR_SCRIPT };

const NOTHING_CLAIMABLE = 7;
let cookie = "";
const say = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const stop = (code, tag, why) => { console.error(`NAMED STOP [${tag}] ${why}`); process.exit(code); };

// ─── Boss OS ──────────────────────────────────────────────────────────────────

async function unlock() {
  if (!process.env.BOSS_PASSCODE) stop(4, "NO_PASSCODE", "this runs through the vault: npm run vault:run -- node scripts/ops/repo-change.mjs");
  const res = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!res.ok) stop(5, "UNLOCK_FAILED", `Boss OS refused the passcode (${res.status}).`);
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function api(path, body) {
  const res = await fetch(`${ORIGIN}/api/boss/repo-changes${path}`, {
    method: body ? "POST" : "GET",
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: json?.data ?? null, error: json?.error ?? null, hint: json?.hint ?? null };
}

// ─── Email, as Danielle ───────────────────────────────────────────────────────

async function email(subject, text) {
  if (DRY) { say(`DRY RUN — would email "${subject}"`); return "dry_run"; }
  const senders = sendersFor("Danielle");
  if (senders.length === 0) return null;
  for (const { from, key } of senders) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ from, to: [TO], subject: subject.slice(0, 200), text: text.slice(0, 60_000) }),
    });
    if (res.ok) {
      const id = (await res.json().catch(() => ({})))?.id ?? "sent";
      say(`emailed ${TO} from ${from}: ${subject}`);
      if (from.includes("westpeek.ventures")) say("NAMED STOP [WRONG_SENDING_IDENTITY] the Boss OS sender was refused; the message went from a West Peek domain.");
      return String(id);
    }
    say(`${from} refused: ${res.status} ${(await res.text()).slice(0, 140)}`);
  }
  return null;
}

// ─── The phase run ───────────────────────────────────────────────────────────

function render(template, vars) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => (k in vars ? String(vars[k] ?? "") : `{{${k}}}`));
}

/** The prompt file's common header plus ONE phase section, so a phase never sees another's orders. */
function phasePrompt(phase, vars) {
  const src = readFileSync(PROMPT_FILE, "utf8");
  const sections = src.split(/^## PHASE: /m);
  const header = sections[0];
  const own = sections.slice(1).find((s) => s.toUpperCase().startsWith(phase.toUpperCase()));
  if (!own) throw new Error(`repo-change-prompt.md has no "## PHASE: ${phase.toUpperCase()}" section`);
  return render(`${header}\n## PHASE: ${own}`, vars);
}

function runClaude({ phase, prompt, cwd, log, model, maxTurns, timeoutMin }) {
  return new Promise((resolve) => {
    appendFileSync(log, `\n=== ${phase} starting ${new Date().toISOString()} model=${model} max-turns=${maxTurns} timeout=${timeoutMin}m cwd=${cwd}\n`);
    if (DRY) { appendFileSync(log, "DRY RUN — claude not invoked\n"); return resolve({ rc: 0, timedOut: false }); }
    const child = spawn(CLAUDE, ["-p", prompt, "--model", model, "--max-turns", String(maxTurns), "--dangerously-skip-permissions"], {
      cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"],
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 10_000); }, timeoutMin * 60_000);
    child.stdout.on("data", (d) => appendFileSync(log, d));
    child.stderr.on("data", (d) => appendFileSync(log, d));
    child.on("close", (rc) => { clearTimeout(timer); appendFileSync(log, `\n=== ${phase} exited rc=${rc} timedOut=${timedOut}\n`); resolve({ rc, timedOut }); });
  });
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function repoPathFor(repo) {
  if (!repo) return null;
  const p = join(GITHUB_DIR, repo);
  return existsSync(join(p, ".git")) ? p : null;
}

/** `gh pr checks`, read as a verdict. */
function checksFor(repo, prNumber) {
  const run = spawnSync("gh", ["pr", "checks", String(prNumber), "--repo", `seq23/${repo}`, "--json", "name,state,bucket"], { encoding: "utf8" });
  if (run.status !== 0) {
    const err = (run.stderr ?? "").trim();
    if (/no checks reported/i.test(err)) return { state: "none", detail: "gh: no checks reported on this pull request" };
    return { state: "unknown", detail: `gh pr checks exited ${run.status}: ${err.slice(0, 300)}` };
  }
  let rows = [];
  try { rows = JSON.parse(run.stdout || "[]"); } catch { return { state: "unknown", detail: "gh printed something that is not JSON" }; }
  if (rows.length === 0) return { state: "none", detail: "gh: zero checks on this pull request" };
  const detail = rows.map((r) => `${r.name}: ${r.bucket ?? r.state}`).join(", ");
  if (rows.some((r) => r.bucket === "fail" || r.bucket === "cancel")) return { state: "red", detail };
  if (rows.some((r) => r.bucket === "pending")) return { state: "pending", detail };
  if (rows.every((r) => r.bucket === "pass" || r.bucket === "skipping")) return { state: "green", detail };
  return { state: "pending", detail };
}

// ─── The arc ─────────────────────────────────────────────────────────────────

async function fail(row, tag, why, log) {
  const subject = `#danielle stopped on ${row.repo ?? "your package"} ${changeToken(row.id)} — ${tag}`;
  const text = [
    "Sequoia,", "",
    `This is Danielle. I stopped work on ${row.id} (${row.repo ?? "the package you sent"}) and here is the named reason:`, "",
    `NAMED STOP [${tag}] ${why}`, "",
    row.pr_url ? `Pull request: ${row.pr_url}` : null,
    log ? `Run log on your Mac: ${log}` : null,
    "", "Send a new #danielle instruction when you want me to try again, or fix the thing named above and reply here.",
    "", "— Danielle, Technical Program Manager",
  ].filter((l) => l !== null).join("\n");
  const id = await email(subject, text);
  const reported = await api(`/${row.id}/failed`, { failure: `NAMED STOP [${tag}] ${why}`, notified_message_id: id, run_log: log });
  if (!reported.ok) say(`NAMED STOP [FAILURE_NOT_RECORDED] ${reported.status} ${reported.error ?? ""}`);
  say(`NAMED STOP [${tag}] ${why}`);
}

async function release(row, reason, log) {
  const r = await api(`/${row.id}/release`, { device_id: DEVICE, reason, run_log: log });
  if (!r.ok) say(`NAMED STOP [RELEASE_FAILED] ${r.status} ${r.error ?? ""}`);
}

let DEVICE = "";

async function runPhase(claim) {
  const row = claim; // the claim response is the row plus phase/model/max_turns/task
  const phase = claim.phase;
  const dir = join(WORK_ROOT, row.id);
  mkdirSync(dir, { recursive: true });
  const log = join(dir, `${phase}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  say(`── ${row.id} ${phase} (${row.repo ?? "package"}) → ${log}`);

  // Belt and braces: the Worker checked, and so does the runner.
  if (phase === "build" && !canEnterBuild(row).ok) { await release(row, `runner refused build: ${canEnterBuild(row).why}`, log); return; }
  if (phase === "land" && !canLand(row).ok) { await release(row, `runner refused land: ${canLand(row).why}`, log); return; }
  if (phase === "preview") {
    if (!canPreview(row).ok) { await release(row, `runner refused preview: ${canPreview(row).why}`, log); return; }
    await sendPreview(row, log);
    return;
  }

  // The package, pulled fresh at PLAN time; reused after.
  const packageDir = join(dir, "package");
  if (row.drive_folder && phase === "plan") {
    if (!process.env.GSC_SERVICE_ACCOUNT_JSON) { await fail(row, "NO_DRIVE_CREDENTIAL", "GSC_SERVICE_ACCOUNT_JSON is not in the vault, so the Drive package cannot be read.", log); return; }
    const pull = spawnSync(process.execPath, [join(HERE, "drive-pull.mjs"), row.drive_folder, packageDir], { encoding: "utf8", env: process.env });
    appendFileSync(log, `=== drive pull rc=${pull.status}\n${pull.stdout ?? ""}${pull.stderr ?? ""}\n`);
    if (pull.status !== 0) { await fail(row, "PACKAGE_UNREADABLE", `drive-pull.mjs exited ${pull.status}: ${(pull.stderr ?? "").trim().split("\n").pop() ?? ""}`, log); return; }
  }

  // The repo and its RUNBOOK. At PLAN time the package may name the repo; the phase output says which.
  let repo = row.repo;
  let repoPath = repoPathFor(repo);
  if (repo && !repoPath) { await fail(row, "NO_WORKING_COPY", `${GITHUB_DIR}/${repo} is not a git checkout on this Mac.`, log); return; }
  if (repoPath && !existsSync(join(repoPath, "RUNBOOK.md"))) {
    await fail(row, "NO_RUNBOOK", `${repo} has no RUNBOOK.md. The lane reads the repo's runbook at plan time and will not guess at a repo's rules; add one (join-west-peek-main/RUNBOOK.md is the model) and send the instruction again.`, log);
    return;
  }
  if (repoPath) {
    const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: repoPath, encoding: "utf8" }).stdout.trim();
    if (dirty && phase !== "land") { await fail(row, "REPO_HAS_UNCOMMITTED_CHANGES", `${repo} has uncommitted changes on this Mac; somebody is working in there. Nothing was touched.`, log); return; }
  }

  /*
   * A RESULT THAT WAS NEVER REPORTED IS REUSED, NOT REDONE. A build that opened a PR and then could
   * not reach Boss OS must not run again and open a second PR; a plan that was written and could
   * not be emailed must not cost another Opus run. The result file stays until its report lands
   * (`.reported` marker); a fresh run starts only when there is nothing unreported on disk.
   */
  const outFile = join(dir, `${phase}.json`);
  const reportedMark = outFile + ".reported";
  const unreported = existsSync(outFile) && !existsSync(reportedMark);
  if (existsSync(outFile) && !unreported) { writeFileSync(outFile + ".previous", readFileSync(outFile)); spawnSync("rm", ["-f", outFile, reportedMark]); }
  const markReported = () => writeFileSync(reportedMark, new Date().toISOString());
  const vars = {
    CHANGE_ID: row.id, TOKEN: changeToken(row.id), REPO: repo ?? "(not named — read the package)", REPO_PATH: repoPath ?? "(none yet)",
    GRID_REPOS: gridRepoNames().join(", "), GITHUB_DIR,
    PACKAGE_DIR: row.drive_folder ? packageDir : "(no Drive package was linked)", DRIVE_URL: row.drive_url ?? "",
    INSTRUCTION: row.instruction, PLAN: row.plan_text ?? "",
    ANSWERS: ["approved", "preview", "forced"].includes(row.answers_mode) || [APPROVED_DEFAULTS_TEXT, PREVIEW_DEFAULTS_TEXT, FORCED_TEXT].includes(row.answers_text)
      ? `${row.answers_text}. She replied with a single word of approval: take the recommended default on EVERY question below, exactly as written in its "default" field.`
      : row.answers_text ?? "",
    ASKS: (row.asks ?? []).map((a, i) => `${i + 1}. ${typeof a === "string" ? a : `${a.question ?? JSON.stringify(a)} — default: ${a.default ?? "(none)"}`}`).join("\n") || "(none)",
    DECIDED: (row.decided ?? []).map((d) => `- ${typeof d === "string" ? d : JSON.stringify(d)}`).join("\n") || "(none)",
    PR_URL: row.pr_url ?? "", PR_NUMBER: row.pr_number ?? "", BRANCH: row.branch ?? "", OUT_FILE: outFile, WORK_DIR: dir,
    ASK_LIST: ASK_POLICY.ask.map((a) => `- ${a}`).join("\n"), DECIDE_LIST: ASK_POLICY.decide.map((d) => `- ${d}`).join("\n"),
    LAND: LAND, PROOF: row.proof ? JSON.stringify(row.proof, null, 2) : "{}",
  };
  const prompt = phasePrompt(phase, vars);
  const { rc, timedOut } = unreported
    ? (say(`reusing the unreported ${phase}.json from the previous tick; claude is not run again`), { rc: 0, timedOut: false })
    : await runClaude({
      phase, prompt, cwd: repoPath ?? dir, log,
      model: claim.model ?? PHASE_MODELS[phase], maxTurns: claim.max_turns ?? PHASE_MAX_TURNS[phase], timeoutMin: PHASE_TIMEOUT_MIN[phase],
    });
  const out = readJson(outFile);
  if (!out) {
    const why = timedOut ? `the ${phase} phase hit its ${PHASE_TIMEOUT_MIN[phase]}-minute wall and was stopped` : `claude exited ${rc} and wrote no ${phase}.json`;
    await fail(row, "PHASE_DID_NOT_COMPLETE", `${why}. Its silence is not a result. Log: ${log}`, log);
    return;
  }
  if (out.blocked) { await fail(row, String(out.blocked.tag ?? "BLOCKED").replace(/[^A-Z_]/g, "_"), String(out.blocked.why ?? "the phase named a block without a reason"), log); markReported(); return; }

  if (phase === "plan") {
    const chosen = out.repo ?? repo;
    if (!chosen || !gridRepoNames().includes(chosen)) { await fail(row, "NO_GRID_REPO", `the plan names "${chosen ?? "nothing"}" as the repository, and that is not a grid repo. Grid: ${gridRepoNames().join(", ")}.`, log); return; }
    if (!repoPathFor(chosen)) { await fail(row, "NO_WORKING_COPY", `${GITHUB_DIR}/${chosen} is not a git checkout on this Mac.`, log); return; }
    if (!existsSync(join(repoPathFor(chosen), "RUNBOOK.md"))) { await fail(row, "NO_RUNBOOK", `${chosen} has no RUNBOOK.md; the lane will not plan against a repo without one.`, log); return; }
    const asks = Array.isArray(out.asks) ? out.asks : [];
    const decided = Array.isArray(out.decided) ? out.decided : [];
    /*
     * ZERO-FRICTION APPROVAL (owner, 21 Sep 2026). The whole plan is IN the email, every ask is a
     * numbered question with the recommended default beside it, and one word back — "approved" —
     * takes every default and starts the build. Anything else she types is her answers; "no" /
     * "changes:" holds. The Worker's `readReply` is the reader; this email just has to make the
     * word obvious.
     */
    const askLine = (a, i) => {
      if (typeof a === "string") return `${i + 1}. ${a}`;
      const opts = Array.isArray(a.options) && a.options.length ? ` Options: ${a.options.join(" / ")}.` : "";
      return `${i + 1}. ${a.question ?? JSON.stringify(a)}${opts}\n   → My recommended default: ${a.default ?? "(none given — say which)"}${a.why ? ` — ${a.why}` : ""}`;
    };
    /*
     * NOT PUBLISH-READY IS SAID AT THE TOP. When a placeholder would ship, the plan says so first,
     * names them, and says the landing waits for a second word after the preview. Her force phrase
     * is named beside it so the bypass is a choice she can see, not one she has to know about.
     */
    const ready = out.publish_ready === true;
    const placeholders = Array.isArray(out.placeholders) ? out.placeholders.map(String) : [];
    if (!ready && placeholders.length === 0) placeholders.push("(the plan marked itself not publish-ready without naming what would ship as a placeholder)");
    const subject = `#danielle plan for ${chosen} ${changeToken(row.id)} — ${ready ? 'reply "approved"' : `NOT publish-ready (${placeholders.length} placeholder${placeholders.length === 1 ? "" : "s"}) — reply "approved" for a preview`} ${asks.length ? `(${asks.length} question${asks.length === 1 ? "" : "s"}, each with a default)` : ""}`.trim();
    const text = [
      "Sequoia,", "",
      ...(ready ? [] : [
        `NOT PUBLISH-READY — this ships with ${placeholders.length} placeholder${placeholders.length === 1 ? "" : "s"}: ${placeholders.join("; ")}.`,
        "I will build it, open the PR and send you the preview; landing needs a second \"approved\" after you have seen it.",
        "If the placeholders do not matter, reply exactly \"approved to production\" and it lands on green with them, recorded as your instruction.",
        "",
      ]),
      `This is Danielle. Here is my plan for ${chosen} from your instruction${row.drive_url ? ` and the package at ${row.drive_url}` : ""}.`,
      "",
      ready
        ? "REPLY WITH ONE WORD — approved — and I take the recommended default on every question below, build it, open the PR, land it once the checks are green, and email you the proof. Nothing else waits on you."
        : "REPLY WITH ONE WORD — approved — and I take the recommended default on every question below, build it, open the PR, and send you the preview. It lands only after you reply \"approved\" to the preview email.",
      ready
        ? "Reply \"preview\" to see it before it lands. Reply with your own answers if you want something other than a default. Reply \"no\" or \"changes: …\" to hold it."
        : "Reply with your own answers if you want something other than a default. Reply \"no\" or \"changes: …\" to hold it.",
      `(Keep ${changeToken(row.id)} in the subject; replying keeps it.)`,
      "",
      asks.length ? "QUESTIONS, EACH WITH MY RECOMMENDED DEFAULT" : "NOTHING TO ASK — \"approved\" starts it.",
      ...asks.map(askLine),
      "",
      "WHAT I DECIDED (recorded, no reply needed)",
      ...(decided.length ? decided.map((d) => `- ${typeof d === "string" ? d : d.decision ?? JSON.stringify(d)}`) : ["- nothing beyond the plan itself"]),
      "",
      "THE PLAN", "", String(out.plan_text ?? "").trim(),
      "", `Run log on your Mac: ${log}`,
      "", "— Danielle, Technical Program Manager",
    ].join("\n");
    const messageId = await email(subject, text);
    if (!messageId) { await release(row, "plan written but the email could not be sent; will retry next tick", log); say("NAMED STOP [PLAN_NOT_SENT] Resend refused every sender; the plan is on disk and the claim is released."); return; }
    const r = await api(`/${row.id}/plan`, { device_id: DEVICE, plan_text: String(out.plan_text ?? ""), decided, asks, publish_ready: ready, placeholders, ask_message_id: messageId, written_by: claim.model ?? PHASE_MODELS.plan, run_log: log, repo: chosen });
    if (!r.ok) say(`NAMED STOP [PLAN_NOT_RECORDED] ${r.status} ${r.error ?? ""} — the plan was emailed and Boss OS was not told.`);
    else { markReported(); say(`planned: ${asks.length} ask(s), ${decided.length} decided; waiting on her reply.`); }
    return;
  }

  if (phase === "build") {
    if (!out.pr_url || !out.pr_number) { await fail(row, "NO_PULL_REQUEST", "the build phase ended without a pull request; a build with no PR is not a build.", log); return; }
    const r = await api(`/${row.id}/build`, { device_id: DEVICE, branch: out.branch ?? null, pr_url: out.pr_url, pr_number: Number(out.pr_number), proof: out.proof ?? null, written_by: claim.model ?? PHASE_MODELS.build, run_log: log });
    if (!r.ok) { say(`NAMED STOP [BUILD_NOT_RECORDED] ${r.status} ${r.error ?? ""} — the PR is open; the next tick reports it without building again.`); return; }
    markReported();
    if (r.data?.phase === "preview") {
      say(`built: ${out.pr_url}; this change needs a preview — claiming the preview step now.`);
      const claimed = await api(`/${row.id}/claim`, { device_id: DEVICE });
      if (claimed.ok) await sendPreview(claimed.data, log); else say(`preview not claimed now: ${claimed.error ?? claimed.status}`);
      return;
    }
    say(`built: ${out.pr_url}; now watching its checks.`);
    // Watch the checks in this same run for a while, so a quick CI lands in the same tick.
    await watchChecks({ ...row, repo, pr_url: out.pr_url, pr_number: Number(out.pr_number), proof: out.proof ?? null }, log, 15);
    return;
  }

  if (phase === "land") {
    if (!out.merge_sha) { await fail(row, "NO_MERGE_COMMIT", `the land phase wrote no merge_sha; ${LAND} did not report a merge.`, log); return; }
    const proof = out.live_proof ?? {};
    const forcedList = Array.isArray(row.forced_placeholders) ? row.forced_placeholders.map(String) : [];
    const subject = `#danielle DONE: ${repo} ${changeToken(row.id)} — landed and live${isForced(row) ? ` (to production with ${forcedList.length} placeholder${forcedList.length === 1 ? "" : "s"}, by your instruction)` : ""}`;
    const text = [
      "Sequoia,", "",
      ...(isForced(row) ? [`Landed to production with ${forcedList.length} placeholder${forcedList.length === 1 ? "" : "s"} by your instruction: ${forcedList.join("; ") || "(none named)"}. Forced by ${row.forced_by} on ${new Date(Number(row.forced_at)).toISOString()}.`, ""] : []),
      `This is Danielle. ${repo} is landed and proven live.`, "",
      `Pull request: ${row.pr_url}`, `Merge commit: ${out.merge_sha}`,
      "", "LIVE PROOF",
      ...Object.entries(proof).map(([k, v]) => `- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`),
      "", "WHAT WAS PROVEN BEFORE THE PR", JSON.stringify(row.proof ?? {}, null, 2),
      "", `Checks: ${row.checks_detail ?? "recorded green"}`,
      "", `Run log on your Mac: ${log}`,
      "", "— Danielle, Technical Program Manager",
    ].join("\n");
    const messageId = await email(subject, text);
    if (!messageId) { say("NAMED STOP [DONE_NOT_SENT] landed, and the DONE email could not be sent; the row stays in land until it can."); await release(row, "landed; DONE email not sent — retry the email next tick", log); writeFileSync(join(dir, "landed-unreported.json"), JSON.stringify(out)); return; }
    const r = await api(`/${row.id}/land`, { device_id: DEVICE, merge_sha: out.merge_sha, live_proof: proof, done_message_id: messageId, run_log: log });
    if (!r.ok) say(`NAMED STOP [LAND_NOT_RECORDED] ${r.status} ${r.error ?? ""} — it landed and she was told; Boss OS was not.`);
    else { markReported(); say(`done: ${out.merge_sha}`); }
  }
}

/**
 * ─── THE PREVIEW, FOUND AND SENT ──────────────────────────────────────────
 *
 * A Cloudflare Pages repo gets a branch deployment per PR; its URL is the `environment_url` on the
 * GitHub deployment the Pages integration creates for the branch. A Workers repo (creator-network's
 * state Worker) has no preview deployment at all — so the email says so in words and carries the
 * PR, the screenshots and the validator output instead. Either way the email goes and the row moves
 * to `previewing`; what never happens is a landing.
 */
function previewUrlFor(repo, branch, prNumber, waitMinutes) {
  const deadline = Date.now() + waitMinutes * 60_000;
  for (;;) {
    const list = spawnSync("gh", ["api", `repos/seq23/${repo}/deployments?ref=${encodeURIComponent(branch)}&per_page=5`], { encoding: "utf8" });
    let deployments = [];
    try { deployments = JSON.parse(list.stdout || "[]"); } catch { deployments = []; }
    for (const d of Array.isArray(deployments) ? deployments : []) {
      const st = spawnSync("gh", ["api", `repos/seq23/${repo}/deployments/${d.id}/statuses?per_page=5`], { encoding: "utf8" });
      let statuses = [];
      try { statuses = JSON.parse(st.stdout || "[]"); } catch { statuses = []; }
      const ok = (Array.isArray(statuses) ? statuses : []).find((x) => x.state === "success" && (x.environment_url || x.target_url));
      if (ok) return { url: ok.environment_url || ok.target_url, how: `GitHub deployment ${d.id} (${d.environment ?? "preview"})` };
    }
    // A PR check whose details link is a *.pages.dev URL is the other shape the Pages app uses.
    const checks = spawnSync("gh", ["pr", "view", String(prNumber), "--repo", `seq23/${repo}`, "--json", "statusCheckRollup"], { encoding: "utf8" });
    try {
      const roll = JSON.parse(checks.stdout || "{}").statusCheckRollup ?? [];
      const hit = roll.find((c) => /pages\.dev/.test(String(c.detailsUrl ?? c.targetUrl ?? "")) && /success|completed/i.test(String(c.conclusion ?? c.state ?? "")));
      if (hit) return { url: hit.detailsUrl ?? hit.targetUrl, how: `PR check "${hit.name ?? hit.context}"` };
    } catch { /* no rollup yet */ }
    if (Date.now() > deadline) return null;
    spawnSync("sleep", ["30"]);
  }
}

async function sendPreview(row, log) {
  const proof = row.proof ?? {};
  const found = previewUrlFor(row.repo, row.branch ?? `refs/pull/${row.pr_number}/head`, row.pr_number, 8);
  const placeholders = Array.isArray(row.placeholders) ? row.placeholders.map(String) : [];
  const subject = `#danielle preview ready: ${row.repo} ${changeToken(row.id)} — reply "approved" to land, or "changes: …"`;
  const text = [
    "Sequoia,", "",
    `This is Danielle. ${row.repo} is built and the pull request is open: ${row.pr_url}`, "",
    found
      ? `PREVIEW: ${found.url}  (from ${found.how})`
      : `NO PREVIEW DEPLOYMENT EXISTS FOR THIS REPO — ${row.repo} is not a Cloudflare Pages site (a Workers repo deploys only on land), so there is no branch URL to open. The PR, the screenshots and the validator output below are the preview.`,
    "",
    ...(placeholders.length ? [`It ships with ${placeholders.length} placeholder${placeholders.length === 1 ? "" : "s"}: ${placeholders.join("; ")}.`, ""] : []),
    "SCREENSHOTS", ...((proof.screenshots ?? []).map((p) => `- ${p}`)), "",
    "VALIDATORS", ...((proof.validators ?? []).map((v) => `- ${v}`)), `- passed: ${proof.validators_passed === true ? "yes" : "NOT RECORDED"}`, "",
    "REPLY \"approved\" TO LAND IT (on green). Reply \"changes: …\" to hold it. Reply exactly \"approved to production\" only if you mean to ship the placeholders as they are — that is recorded as your instruction.",
    "", "— Danielle, Technical Program Manager",
  ].join("\n");
  const messageId = await email(subject, text);
  if (!messageId) { await release(row, "preview ready but the email could not be sent; will retry next tick", log); say("NAMED STOP [PREVIEW_NOT_SENT] Resend refused every sender; the claim is released."); return; }
  const r = await api(`/${row.id}/preview`, { device_id: DEVICE, preview_url: found?.url ?? null, preview_message_id: messageId, run_log: log });
  if (!r.ok) say(`NAMED STOP [PREVIEW_NOT_RECORDED] ${r.status} ${r.error ?? ""} — the preview was emailed and Boss OS was not told.`);
  else say(`previewed: ${found?.url ?? "(no deployment; PR + screenshots)"}; waiting on her second word.`);
}

/** Ask gh about a PR's checks, record the answer, and — on green — claim and run LAND now. */
async function watchChecks(row, log, waitMinutes) {
  const deadline = Date.now() + waitMinutes * 60_000;
  for (;;) {
    let verdict = checksFor(row.repo, row.pr_number);
    if (verdict.state === "none" && row.proof?.validators_passed === true) {
      verdict = { state: "green", detail: `no CI checks on ${row.repo}; the repo's own validators passed on the Mac before the PR (recorded in the proof): ${(row.proof.validators ?? []).join(", ")}` };
    }
    say(`checks on ${row.pr_url}: ${verdict.state} — ${verdict.detail}`);
    if (verdict.state === "green") {
      const r = await api(`/${row.id}/checks`, { state: "green", detail: verdict.detail });
      if (!r.ok) { say(`NAMED STOP [GREEN_NOT_RECORDED] ${r.status} ${r.error ?? ""}`); return; }
      if (r.data?.phase !== "land") { say(`green recorded on ${row.id}; ${r.data?.phase === "previewing" ? "waiting on her second word" : r.data?.phase}.`); return; }
      const claim = await api(`/${row.id}/claim`, { device_id: DEVICE });
      if (!claim.ok) { say(`land not claimed now: ${claim.error ?? claim.status}`); return; }
      await runPhase(claim.data);
      return;
    }
    if (verdict.state === "red") {
      const id = await email(`#danielle stopped on ${row.repo} ${changeToken(row.id)} — CHECKS_RED`, [
        "Sequoia,", "", `This is Danielle. The checks on ${row.pr_url} went red, so I did not land it.`, "", verdict.detail, "",
        "The branch is open for a fix; send a new #danielle instruction and I will start from it.", "", "— Danielle",
      ].join("\n"));
      const r = await api(`/${row.id}/checks`, { state: "red", detail: verdict.detail, notified_message_id: id ?? undefined });
      if (!r.ok) say(`NAMED STOP [RED_NOT_RECORDED] ${r.status} ${r.error ?? ""}`);
      return;
    }
    if (verdict.state === "none") {
      const id = await email(`#danielle stopped on ${row.repo} ${changeToken(row.id)} — NO_CHECKS`, [
        "Sequoia,", "", `This is Danielle. ${row.pr_url} has no CI checks and the build's proof does not record the repo's validators passing, so there is no green to land on.`, "",
        "Land on green needs a green. Add CI to the repo, or have the runbook's validate step run before the PR, and send the instruction again.", "", "— Danielle",
      ].join("\n"));
      await api(`/${row.id}/failed`, { failure: `NAMED STOP [NO_CHECKS] ${verdict.detail}`, notified_message_id: id ?? undefined, run_log: log });
      return;
    }
    await api(`/${row.id}/checks`, { state: "pending", detail: verdict.detail });
    if (Date.now() > deadline) { say(`checks still ${verdict.state}; the next tick will look again.`); return; }
    await new Promise((r) => setTimeout(r, 60_000));
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  DEVICE = resolveDeviceId();
  if (!DEVICE) stop(3, "NO_DEVICE_ID", missingDeviceIdMessage());
  if (!existsSync(PROMPT_FILE)) stop(5, "NO_PROMPT_FILE", PROMPT_FILE);
  await unlock();

  const list = await api("/claimable");
  if (!list.ok) stop(6, "QUEUE_UNREADABLE", `${list.status} reading /repo-changes/claimable`);
  const { claimable, waiting } = list.data;

  // Landing rows: ask gh, record, and land on green in this tick.
  for (const w of waiting.filter((x) => x.phase === "landing" || x.phase === "previewing")) {
    const full = await api(`/${w.id}`);
    if (!full.ok || !full.data?.pr_number) continue;
    await watchChecks(full.data, null, 0);
  }

  const again = await api("/claimable");
  const todo = again.ok ? again.data.claimable : claimable;
  if (todo.length === 0) {
    for (const w of waiting) say(`waiting: ${w.id} (${w.repo ?? "package"}) ${w.phase} — ${w.why}`);
    console.error("NAMED STOP [NOTHING_CLAIMABLE] no repo change is waiting for this Mac. Email boss@sequoiataylor.com with #danielle, a grid repo and/or a Drive folder, and instructions.");
    process.exit(NOTHING_CLAIMABLE);
  }

  say(`${todo.length} claimable: ${todo.map((t) => `${t.id}:${t.phase}`).join(", ")}`);
  for (const item of todo) {
    const claim = await api(`/${item.id}/claim`, { device_id: DEVICE });
    if (!claim.ok) { say(`not claimed ${item.id}: ${claim.error ?? claim.status}`); continue; }
    await runPhase(claim.data);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(`REPO CHANGE LANE FAILED: ${err?.stack ?? err}`); process.exit(1); });
}
