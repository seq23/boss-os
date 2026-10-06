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
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PHASE_MODELS, PHASE_MAX_TURNS, PHASE_TIMEOUT_MIN, ASK_POLICY, TASK_KIND, EXECUTOR_SCRIPT,
  canEnterBuild, canLand, canPreview, needsPreview, isForced, changeToken, gridRepoNames, APPROVED_DEFAULTS_TEXT, PREVIEW_DEFAULTS_TEXT, FORCED_TEXT, MAX_REWORKS,
} from "../../src/shared/boss/repoChange/lane.mjs";
import { GRID_OWNER } from "../../src/shared/boss/grid.mjs";
import { sendersFor, employeeMail, filesAt } from "./notify.mjs";
import { generateRunbook, readWranglerToml, readWranglerJson, mayRunFromRunbook, runbookSecretNames, secretNamesInSource, vendorPageFor } from "./lib/runbook.mjs";
import { vaultLookup, envForRepoRun } from "../lib/vault-env.mjs";
import { servicePracticesBlock } from "../../src/shared/boss/service/practices.mjs";
import { waitDetail, threeParts, missingSecretLine } from "../../src/shared/boss/service/waits.mjs";
import { seatEnv } from "./lib/seat-env.mjs";
import { detectUsageLimit } from "../lib/seat-usage-limit.mjs";
import { codexExecArgs, codexSeatUsable, gitCommonDirs, helpMentions, runWithCodexFallback } from "../lib/codex-seat.mjs";
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

async function email(subject, text, files = []) {
  if (DRY) { say(`DRY RUN — would email "${subject}"`); return "dry_run"; }
  const senders = sendersFor("Danielle");
  if (senders.length === 0) return null;
  for (const sender of senders) {
    const { from, key } = sender;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(employeeMail(sender, { to: TO, subject, text, files })),
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

function spawnClaude({ phase, prompt, cwd, log, model, maxTurns, timeoutMin }) {
  return new Promise((resolve) => {
    appendFileSync(log, `\n=== ${phase} starting ${new Date().toISOString()} model=${model} max-turns=${maxTurns} timeout=${timeoutMin}m cwd=${cwd}\n`);
    if (DRY) { appendFileSync(log, "DRY RUN — claude not invoked\n"); return resolve({ rc: 0, timedOut: false, code: 0, out: "", err: "", isError: false }); }
    /*
     * ON HER SEAT, NEVER ON AN API KEY. This process runs under `vault:run`, so `process.env` carries
     * ANTHROPIC_API_KEY; handed to the CLI it overrides her login, disables the claude.ai connectors,
     * and bills an account with no credit ("Credit balance is too low", 21 Sep 2026 — both of her
     * first jobs died in 3 s). `seatEnv` strips every ANTHROPIC_* / CLAUDE_* auth override.
     */
    /*
     * THE LOG CARRIES THE TRANSCRIPT. 21 Sep 2026: a build that had committed, pushed and opened
     * how-we-know #103 died on "Reached max turns (150)" and its log was five lines, so nobody
     * could see she was done. stream-json in, one readable line per assistant paragraph, tool call
     * and tool result tail out.
     */
    const child = spawn(CLAUDE, ["-p", prompt, "--model", model, "--max-turns", String(maxTurns), "--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose"], {
      cwd, env: seatEnv(process.env), stdio: ["ignore", "pipe", "pipe"],
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 10_000); }, timeoutMin * 60_000);
    let buf = "";
    // What a spent plan needs to be recognised: the final `result` event's text and the stderr tail.
    let resultText = "";
    let isError = false;
    let errTail = "";
    const noteResult = (line) => { try { const ev = JSON.parse(line); if (ev.type === "result") { resultText = String(ev.result ?? ""); isError = Boolean(ev.is_error); } } catch { /* not JSON */ } };
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        noteResult(line);
        for (const t of transcriptLines(line)) appendFileSync(log, t + "\n");
      }
    });
    child.stderr.on("data", (d) => { appendFileSync(log, d); errTail = (errTail + d.toString()).slice(-4000); });
    child.on("close", (rc) => { clearTimeout(timer); noteResult(buf); for (const t of transcriptLines(buf)) appendFileSync(log, t + "\n"); appendFileSync(log, `\n=== ${phase} exited rc=${rc} timedOut=${timedOut}\n`); resolve({ rc, timedOut, code: rc, out: resultText, err: errTail, isError }); });
  });
}

/**
 * Did Claude Code stop because her plan's usage is spent? Returns the notice's own words, or null.
 * A run that finished without error is never inspected, and `detectUsageLimit` never reads long
 * output, so a build that merely DISCUSSES limits is not mistaken for one.
 */
export function claudeSpentUsage(r) {
  if (!r || r.timedOut) return null;
  if (r.code === 0 && !r.isError) return null;
  const hit = detectUsageLimit({ stdout: r.out ?? "", stderr: r.err ?? "" });
  return hit.limited ? hit.snippet : null;
}

/** The first flag the installed `codex exec --help` does not mention, or null when it supports them all. */
async function codexLacks(flags) {
  const r = spawnSync("codex", ["exec", "--help"], { encoding: "utf8", timeout: 20_000, env: seatEnv(process.env) });
  const help = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  if (!help.trim()) return "`codex exec` (the codex command could not be run)";
  return flags.find((f) => !helpMentions(help, f)) ?? null;
}

/** Run `codex exec` in the same working directory with the same prompt on stdin. */
function spawnCodex({ phase, prompt, cwd, log, timeoutMin, addDirs }) {
  // The worktree's commits are written into the ORIGINAL repository's .git, outside every folder the
  // sandbox would otherwise let Codex write — so each repository's git directory is named too.
  const dirs = [cwd, ...(addDirs ?? [])];
  const found = new Map(dirs.map((d) => [d, spawnSync("git", ["-C", d, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).stdout?.trim() || null]));
  const writable = [...new Set([...(addDirs ?? []), ...gitCommonDirs(dirs, (d) => found.get(d) ?? null)])];
  return new Promise((resolve) => {
    appendFileSync(log, `\n=== ${phase} handed to Codex ${new Date().toISOString()} cwd=${cwd} writable=${writable.join(",")}\n`);
    // No OPENAI_* either: Codex must use the ChatGPT Plus login in ~/.codex, never bill an API key.
    const env = Object.fromEntries(Object.entries(seatEnv(process.env)).filter(([k]) => !/^OPENAI_/i.test(k)));
    const child = spawn("codex", codexExecArgs(writable), { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 10_000); }, timeoutMin * 60_000);
    let out = ""; let err = "";
    child.stdout.on("data", (d) => { out += d.toString(); appendFileSync(log, d); });
    child.stderr.on("data", (d) => { err += d.toString(); appendFileSync(log, d); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, rc: -1, timedOut, out, err: `${err}\n${e.message}`, isError: true }); });
    child.on("close", (code) => { clearTimeout(timer); appendFileSync(log, `\n=== ${phase} (Codex) exited rc=${code} timedOut=${timedOut}\n`); resolve({ code, rc: code, timedOut, out, err, isError: code !== 0 }); });
    child.stdin.end(prompt);
  });
}

/**
 * Run the phase's model: Claude Code, and — ONLY when it reports her plan is out of usage — Codex on
 * her ChatGPT Plus seat, same worktree, same prompt (29 Sep 2026). The phase reads its result from a
 * FILE the model writes, so which model wrote it does not change how the phase is judged. Any other
 * Claude failure is the phase's failure, unchanged; a hand-over is written to the job log.
 * UNPROVEN against the live CLI until she runs a repo change with Claude Code out of usage.
 */
function runClaude(opts) {
  if (DRY) return spawnClaude(opts);
  return runWithCodexFallback({
    runClaude: () => spawnClaude(opts),
    runCodex: () => spawnCodex(opts),
    limited: claudeSpentUsage,
    usable: () => codexSeatUsable(homedir()),
    supports: codexLacks,
    addDirs: opts.addDirs ?? [],
    onLine: (line) => appendFileSync(opts.log, `${line}\n`),
  });
}

/** One stream-json event → the readable lines it deserves. Exported for the validator's self-test. */
export function transcriptLines(line) {
  let ev; try { ev = JSON.parse(line); } catch { return line.trim() ? [line] : []; }
  const out = [];
  const stamp = new Date().toISOString().slice(11, 19);
  if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
    for (const c of ev.message.content) {
      if (c.type === "text" && c.text?.trim()) out.push(`[${stamp}] ${c.text.trim().replace(/\n+/g, " ").slice(0, 600)}`);
      if (c.type === "tool_use") out.push(`[${stamp}] → ${c.name} ${JSON.stringify(c.input ?? {}).slice(0, 220)}`);
    }
  } else if (ev.type === "user" && Array.isArray(ev.message?.content)) {
    for (const c of ev.message.content) {
      if (c.type === "tool_result") {
        const body = typeof c.content === "string" ? c.content : Array.isArray(c.content) ? c.content.map((x) => x.text ?? "").join(" ") : "";
        const tail = body.trim().split("\n").filter(Boolean).slice(-2).join(" | ");
        out.push(`[${stamp}] ← ${c.is_error ? "ERROR " : ""}${tail.slice(0, 300)}`);
      }
    }
  } else if (ev.type === "result") {
    out.push(`[${stamp}] === result: ${ev.subtype ?? ""} turns=${ev.num_turns ?? "?"} cost=$${Number(ev.total_cost_usd ?? 0).toFixed(2)} ${ev.is_error ? "ERROR" : ""} ${String(ev.result ?? "").replace(/\n+/g, " ").slice(0, 300)}`);
  }
  return out;
}

/**
 * ─── A RECOVERABLE STOP RESUMES ITSELF ──────────────────────────────────────
 *
 * What a phase leaves behind decides whether its death is a stop for her or a continuation for
 * the lane. A commit on the branch, a pushed branch, an open PR, a plan draft: state. Max-turns
 * exhaustion, a timeout with state behind it, a missing result file — all resume the SAME phase
 * on the next tick with a continuation note, up to three times; only then, or with no state at
 * all, is she emailed a stop, and it says what she can do. Detected from the worktree and gh,
 * never from the exit code.
 */
export const MAX_CONTINUATIONS = 3;

function stateBehind({ phase, dir, repo, repoPath, buildPath, branch }) {
  const facts = [];
  if (phase === "build" && buildPath && existsSync(buildPath)) {
    const ahead = spawnSync("git", ["log", "--oneline", "origin/main..HEAD"], { cwd: buildPath, encoding: "utf8" }).stdout.trim();
    if (ahead) facts.push(`commits on ${branch}: ${ahead.split("\n").length} (${ahead.split("\n")[0].slice(0, 80)})`);
    const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: buildPath, encoding: "utf8" }).stdout.trim();
    if (dirty) facts.push(`uncommitted changes in the worktree: ${dirty.split("\n").length} file(s)`);
    const pushed = branch ? spawnSync("git", ["ls-remote", "--heads", "origin", branch], { cwd: buildPath, encoding: "utf8" }).stdout.trim() : "";
    if (pushed) facts.push(`branch ${branch} is pushed`);
    const pr = prForBranch(repo, branch);
    if (pr) facts.push(`PR #${pr.number} is ${pr.state} (${pr.url})`);
    return { facts, pr };
  }
  if (phase === "land") {
    const landed = readJson(join(dir, "landed-post-land-failed.json"));
    if (landed?.merge_sha) facts.push(`already merged as ${landed.merge_sha}; only the post-land step is outstanding`);
    return { facts, pr: null };
  }
  if (phase === "plan") {
    if (existsSync(join(dir, "plan-draft.md"))) facts.push("a plan draft exists (plan-draft.md)");
    return { facts, pr: null };
  }
  return { facts, pr: null };
}

function prForBranch(repo, branch) {
  if (!repo || !branch) return null;
  const r = spawnSync("gh", ["pr", "view", branch, "--repo", `seq23/${repo}`, "--json", "url,number,state,headRefName"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  try { const j = JSON.parse(r.stdout); return j?.url ? { url: j.url, number: Number(j.number), state: j.state } : null; } catch { return null; }
}

function continuationCount(dir, phase) {
  const f = join(dir, `continuations-${phase}.json`);
  const j = readJson(f) ?? { count: 0, notes: [] };
  return { file: f, ...j };
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

// ─── The service rules, for this lane (docs/SERVICE_RULES.md) ──────────────────

async function serviceApi(path, body) {
  const res = await fetch(`${ORIGIN}/api/boss/service${path}`, {
    method: body ? "POST" : "GET",
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  return { ok: Boolean(res?.ok), status: res?.status ?? 0 };
}

/** R24/R25 — a repo with no checkout on this Mac is cloned from GitHub, never a stop for her. */
export function cloneRepo(githubRepo, name, log, run = spawnSync) {
  if (!githubRepo || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(githubRepo)) return null;
  const target = join(GITHUB_DIR, name);
  const r = run("gh", ["repo", "clone", githubRepo, target], { encoding: "utf8", timeout: 300_000 });
  if (log) appendFileSync(log, `=== gh repo clone ${githubRepo} rc=${r.status}\n${(r.stderr ?? "").slice(0, 2000)}\n`);
  return r.status === 0 && existsSync(join(target, ".git")) ? target : null;
}

/**
 * R25/R26/R28 — THE REPO'S RUNBOOK, OR ONE GENERATED FROM ITS OWN FILES. Until 6 Oct 2026 a repo with
 * no RUNBOOK.md was a NO_RUNBOOK stop only she could clear; now the lane reads package.json and the
 * wrangler config (the deploy route is read, never guessed), writes RUNBOOK.generated.md into the
 * change's work dir, and the build commits it. Returns what the lane needs from it.
 */
export function runbookFor(repo, githubRepo, repoPath, workDir) {
  const own = join(repoPath, "RUNBOOK.md");
  let text;
  let generated = false;
  let path = own;
  if (existsSync(own)) {
    text = readFileSync(own, "utf8");
  } else {
    const pkg = readJson(join(repoPath, "package.json"));
    const toml = existsSync(join(repoPath, "wrangler.toml")) ? readWranglerToml(readFileSync(join(repoPath, "wrangler.toml"), "utf8")) : null;
    const jsonc = ["wrangler.jsonc", "wrangler.json"].map((f) => join(repoPath, f)).find((f) => existsSync(f));
    const wrangler = toml ?? (jsonc ? readWranglerJson(readFileSync(jsonc, "utf8")) : null);
    const sources = ["src/index.ts", "src/index.js", "src/worker.ts", "worker.js", "functions/_middleware.ts"].map((f) => join(repoPath, f)).filter((f) => existsSync(f)).map((f) => readFileSync(f, "utf8"));
    text = generateRunbook({ repo, githubRepo, pkg, wrangler, sourceNames: sources }).text;
    path = join(workDir, "RUNBOOK.generated.md");
    writeFileSync(path, text);
    generated = true;
  }
  const secrets = [...new Set([...runbookSecretNames(text)])];
  return { text, path, generated, mayRun: mayRunFromRunbook(text), secrets };
}

/**
 * R26 — THE MODEL ASKS, THE RUNNER RUNS. `needs_runs: [{ script, env, args }]` in a phase's result is
 * run here as `npm run <script> -- <args>`, only for a script the runbook names under
 * `## Danielle may run`, with exactly the vault names the lookup allowed (`envForRepoRun`) — the
 * model never sees a value. Each run is recorded: script, env, exit, one line.
 */
export function runRequested(needs, { mayRun, allowed, cwd, log, run = spawnSync }) {
  const out = [];
  for (const n of (Array.isArray(needs) ? needs : []).slice(0, 10)) {
    const script = String(n?.script ?? "");
    const env = n?.env === "production" ? "production" : "preview";
    if (!mayRun.includes(script)) { out.push({ script, env, exit: null, line: "refused: not under ## Danielle may run in the runbook" }); continue; }
    const args = Array.isArray(n?.args) ? n.args.map(String).slice(0, 20) : [];
    const r = run("npm", ["run", script, "--", ...args], { cwd, encoding: "utf8", timeout: 600_000, env: { ...envForRepoRun(process.env, allowed), BOSS_RUN_ENV: env } });
    const line = `${(r.stdout ?? "").trim().split("\n").pop() ?? ""}`.slice(0, 300) || `${(r.stderr ?? "").trim().split("\n").pop() ?? ""}`.slice(0, 300);
    if (log) appendFileSync(log, `=== may-run ${script} (${env}) rc=${r.status}\n${(r.stdout ?? "").slice(-4000)}${(r.stderr ?? "").slice(-2000)}\n`);
    out.push({ script, env, exit: r.status, line });
  }
  return out;
}

/** R27 — the record Cloudflare asked for, recorded and emailed ONCE in three parts; her Mac re-checks it. */
async function askForDns(row, repo, records, log) {
  const r = await serviceApi("/dns-waits", { change_id: row.id, repo, records });
  if (!r.ok) { say(`dns waits not recorded (${r.status})`); return; }
  for (const rec of records.slice(0, 5)) {
    await email(`#danielle needs a DNS record for ${rec.host} ${changeToken(row.id)}`, [
      "Sequoia,", "",
      `This is Danielle. ${repo} is built; one thing at your DNS provider makes ${rec.host} reach it.`, "",
      waitDetail("DNS_RECORD", { record: { host: rec.host, type: rec.type, name: rec.name, target: rec.target, txtName: rec.txt_name ?? null, txtValue: rec.txt_value ?? null, liveAt: rec.live_at ?? null } }),
      "", `Run log on your Mac: ${log}`, "", "— Danielle, Technical Program Manager",
    ].join("\n"));
  }
}

/** Screenshot paths from a proof, made absolute against the change's worktree or work dir. */
export function screenshotPaths(proof, row) {
  const list = Array.isArray(proof?.screenshots) ? proof.screenshots : [];
  return list.map(String).filter((p) => /\.(png|jpe?g|webp|gif|pdf)$/i.test(p)).slice(0, 12)
    .map((p) => (p.startsWith("/") ? p : join(WORK_ROOT, `wt-${row.id}`, p)));
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
    // R7/R8 (docs/SERVICE_RULES.md): every stop ends in three parts, and the clearing step is a reply
    // that `repoChange/answer.ts` acts on — "try again" retries the same change, "drop it" closes it.
    "", waitDetail(tag === "DRIVE_EMPTY" ? "DRIVE_EMPTY" : "TRIED_AND_STOPPED", { what: tag === "DRIVE_EMPTY" ? row.drive_url : "once", why }),
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
    if (pull.status === 3) {
      // R21: an empty folder is watched, not a dead end — the Mac's pass sends this change back to PLAN when files land.
      await serviceApi("/drive-watches", { change_id: row.id, text: row.drive_url ?? `https://drive.google.com/drive/folders/${row.drive_folder}` });
      await fail(row, "DRIVE_EMPTY", `the Drive folder is still empty, or not yet shared with the account your Mac reads (${row.drive_url ?? row.drive_folder})`, log);
      return;
    }
    if (pull.status !== 0) { await fail(row, "PACKAGE_UNREADABLE", `drive-pull.mjs exited ${pull.status}: ${(pull.stderr ?? "").trim().split("\n").pop() ?? ""}`, log); return; }
  }

  // The repo and its RUNBOOK. At PLAN time the package may name the repo; the phase output says which.
  let repo = row.repo;
  let repoPath = repoPathFor(repo) ?? (repo ? cloneRepo(row.github_repo ?? `${GRID_OWNER}/${repo}`, repo, log) : null);
  if (repo && !repoPath) { await fail(row, "REPO_UNREACHABLE", `${GITHUB_DIR}/${repo} is not on this Mac and \`gh repo clone ${row.github_repo ?? `${GRID_OWNER}/${repo}`}\` failed — the address may be wrong or the repo private to another account.`, log); return; }
  const runbook = repoPath ? runbookFor(repo, row.github_repo ?? `${GRID_OWNER}/${repo}`, repoPath, dir) : null;
  /*
   * ─── THE LANE BUILDS IN ITS OWN WORKTREE, SO A DIRTY MAIN CHECKOUT IS NEVER HER PROBLEM ──
   *
   * 21 Sep 2026, rc_m32h946mv0eybxhj: stopped REPO_HAS_UNCOMMITTED_CHANGES because how-we-know's
   * main checkout carries loop/state/*.json that the repo's own Mac lanes rewrite continuously —
   * that checkout will never be reliably clean, and "somebody is working in there" was the wrong
   * reading. Porter's lane in west-peek-os never had this stop: it builds in
   * `git worktree add <path> -b <branch> origin/main`, with node_modules symlinked. So does this
   * one now. PLAN only reads. LAND runs from the main checkout (`~/bin/land` needs it) and the
   * post-land step after it; if main cannot fast-forward, `land` says so as its own named stop.
   */
  let buildPath = repoPath;
  let branch = row.branch ?? null;
  if (phase === "build" && repoPath) {
    // A rework builds on a fresh branch off origin/main: the first one is merged, and a worktree
    // re-made on it would start from a tip that main already contains.
    const fix = Number(row.rework_count ?? 0) > 0 ? `-fix${row.rework_count}` : "";
    branch = branch ?? `work/rc-${row.id.replace(/^rc_/, "").slice(-8)}${fix}`;
    const wt = join(WORK_ROOT, `wt-${row.id}`);
    const fetch = spawnSync("git", ["fetch", "origin", "--prune", "-q"], { cwd: repoPath, encoding: "utf8" });
    if (fetch.status !== 0) { await fail(row, "REPO_UNREACHABLE", `git fetch in ${repo} failed: ${(fetch.stderr ?? "").trim().slice(0, 300)}`, log); return; }
    if (!existsSync(wt)) {
      const remote = spawnSync("git", ["ls-remote", "--heads", "origin", branch], { cwd: repoPath, encoding: "utf8" }).stdout.trim();
      const add = remote
        ? spawnSync("git", ["worktree", "add", wt, "-B", branch, `origin/${branch}`], { cwd: repoPath, encoding: "utf8" })
        : spawnSync("git", ["worktree", "add", wt, "-b", branch, "origin/main"], { cwd: repoPath, encoding: "utf8" });
      if (add.status !== 0) { await fail(row, "WORKTREE_NOT_MADE", `git worktree add ${wt} failed: ${(add.stderr ?? "").trim().slice(0, 300)}`, log); return; }
      appendFileSync(log, `=== worktree ${wt} on ${branch}\n`);
    }
    const nm = join(repoPath, "node_modules");
    if (existsSync(nm) && !existsSync(join(wt, "node_modules"))) { try { symlinkSync(nm, join(wt, "node_modules"), "dir"); } catch { /* the model can npm ci */ } }
    buildPath = wt;
  }

  /*
   * A RESULT THAT WAS NEVER REPORTED IS REUSED, NOT REDONE. A build that opened a PR and then could
   * not reach Boss OS must not run again and open a second PR; a plan that was written and could
   * not be emailed must not cost another Opus run. The result file stays until its report lands
   * (`.reported` marker); a fresh run starts only when there is nothing unreported on disk.
   */
  const outFile = join(dir, `${phase}.json`);
  const reportedMark = outFile + ".reported";
  const markReported = () => writeFileSync(reportedMark, new Date().toISOString());
  if (phase === "land" && existsSync(join(dir, "landed-post-land-failed.json")) && existsSync(outFile) && !existsSync(reportedMark)) markReported();
  const unreported = existsSync(outFile) && !existsSync(reportedMark);
  if (existsSync(outFile) && !unreported) { writeFileSync(outFile + ".previous", readFileSync(outFile)); spawnSync("rm", ["-f", outFile, reportedMark]); }
  /*
   * A FAILED PHASE'S OUTPUT IS CONSUMED. 21 Sep 2026, rc_m32h8ze2a4hk37pc retried after
   * POST_LAND_STEP_FAILED: the previous land.json (post_land not_invoked) was still on disk with
   * no .reported marker, so "never reported is reused" reused it, claude never ran, and the row
   * failed again on the same stale file. A named stop IS the report of that output.
   */
  const failOut = async (tag, why) => { await fail(row, tag, why, log); markReported(); };
  /*
   * R5/R6/R28 — THE VAULT FIRST. The runbook's `## Secrets` (and the names the source reads) are
   * looked up by exact name, then by vendor prefix. Found → injected by NAME into the repo's own
   * runs below, never into the model. Missing → recorded as a wait (the key's arrival resumes this
   * change) and named once, with the SECRET line that sends it; everything else goes ahead.
   */
  const lookup = vaultLookup(runbook?.secrets ?? []);
  if (lookup.missing.length) await serviceApi("/secret-waits", { change_id: row.id, names: lookup.missing });
  const missingLines = lookup.missing.map((n) => missingSecretLine(n, vendorPageFor(n), lookup.searched.join(", ")));
  const vars = {
    PRACTICES: servicePracticesBlock(Array.isArray(claim.constraints) ? claim.constraints : []),
    RUNBOOK_NOTE: runbook?.generated ? `GENERATED — the repo had no RUNBOOK.md, so the lane read one out of its package.json and wrangler config: ${runbook.path}. Read it; in BUILD, copy it to the repo root and commit it on the change's branch.` : "the repo's own RUNBOOK.md.",
    MAY_RUN: (runbook?.mayRun ?? []).map((k) => `\`${k}\``).join(", ") || "(none declared)",
    SECRETS: [
      lookup.found.length ? `In the vault and injected by name into the repo's own runs: ${lookup.found.join(", ")}.` : null,
      Object.keys(lookup.by_vendor).length ? `Found by vendor prefix: ${Object.entries(lookup.by_vendor).map(([w, h]) => `${w} → ${h.join(" / ")}`).join("; ")}.` : null,
      missingLines.length ? `MISSING — copy each line below verbatim into plan_text (and into the done email), and build everything that does not need it:\n${missingLines.join("\n")}` : null,
    ].filter(Boolean).join("\n") || "none needed (the runbook names no secrets).",
    CHANGE_ID: row.id, TOKEN: changeToken(row.id), REPO: repo ?? "(not named — read the package)", REPO_PATH: (phase === "build" ? buildPath : repoPath) ?? "(none yet)",
    MAIN_CHECKOUT: repoPath ?? "(none yet)",
    POST_LAND_COMMAND: row.post_land_command ?? "(none — the plan named no post-land step; post_land MUST be null)",
    POST_LAND_PROOF: row.post_land_proof ?? "(none)",
    ALREADY_LANDED: (() => { const f = join(dir, "landed-post-land-failed.json"); if (phase !== "land" || !existsSync(f)) return "no"; const j = readJson(f); return j?.merge_sha ? `YES — merged as ${j.merge_sha} on a previous tick. Do NOT run ${LAND} again; write that merge_sha, re-check the live proof, and run ONLY the post-land step.` : "no"; })(),
    GRID_REPOS: gridRepoNames().join(", "), GITHUB_DIR,
    PACKAGE_DIR: row.drive_folder ? packageDir : "(no Drive package was linked)", DRIVE_URL: row.drive_url ?? "",
    INSTRUCTION: row.instruction, PLAN: row.plan_text ?? "",
    ANSWERS: ["approved", "preview", "forced"].includes(row.answers_mode) || [APPROVED_DEFAULTS_TEXT, PREVIEW_DEFAULTS_TEXT, FORCED_TEXT].includes(row.answers_text)
      ? `${row.answers_text}. She replied with a single word of approval: take the recommended default on EVERY question below, exactly as written in its "default" field.`
      : row.answers_text ?? "",
    ASKS: (row.asks ?? []).map((a, i) => `${i + 1}. ${typeof a === "string" ? a : `${a.question ?? JSON.stringify(a)} — default: ${a.default ?? "(none)"}`}`).join("\n") || "(none)",
    DECIDED: (row.decided ?? []).map((d) => `- ${typeof d === "string" ? d : JSON.stringify(d)}`).join("\n") || "(none)",
    PR_URL: row.pr_url ?? "", PR_NUMBER: row.pr_number ?? "", BRANCH: branch ?? "", OUT_FILE: outFile, WORK_DIR: dir,
    ASK_LIST: ASK_POLICY.ask.map((a) => `- ${a}`).join("\n"), DECIDE_LIST: ASK_POLICY.decide.map((d) => `- ${d}`).join("\n"),
    LAND: LAND, PROOF: row.proof ? JSON.stringify(row.proof, null, 2) : "{}",
    REWORK: Number(row.rework_count ?? 0) > 0
      ? `YES — rework ${row.rework_count}/${MAX_REWORKS}. Your previous PR for this change LANDED (merge ${(() => { try { return JSON.parse(row.reworked_merge_shas ?? "[]").join(", "); } catch { return "?"; } })()}) and then the recorded post-land step \`${row.post_land_command ?? "?"}\` FAILED: ${String(row.rework_note ?? "").slice(0, 1500)}. That failure is yours to fix, in this repo, now: read the step's own output, find the cause in the script or the content it pushes (a limit, a format, a missing field — not a credential unless the output names one), fix it at source, add a guard that would have caught it before the request left the Mac, and open a NEW pull request on this branch. The step runs again after this PR lands; it must exit 0 then. Do not ask the owner anything the output already answers.`
      : "no — a first build.",
    CONTINUATION: (() => { const c = continuationCount(dir, phase); if (!c.count) return "no — a fresh start."; const b = stateBehind({ phase, dir, repo, repoPath, buildPath, branch }); return `YES — continuation ${c.count}/${MAX_CONTINUATIONS}. The previous attempt: ${c.notes?.at(-1)?.note ?? "(no note)"}. What is already there: ${b.facts.join("; ") || "(nothing readable)"}. Do not redo it; verify it and FINISH — write ${outFile} first if the result already exists.`; })(),
    PRE_APPROVED: row.pre_approved_phrase
      ? `YES — she wrote "${row.pre_approved_phrase}" in the request. Every decision is yours: put what you would have asked under "decided" with your recommended default AS the decision and the reason. "asks" MUST be an empty list; the Worker refuses a pre-approved plan that asks.`
      : "no — ask what policy says to ask.",
  };
  const prompt = phasePrompt(phase, vars);
  const { rc, timedOut } = unreported
    ? (say(`reusing the unreported ${phase}.json from the previous tick; claude is not run again`), { rc: 0, timedOut: false })
    : await runClaude({
      phase, prompt, cwd: (phase === "build" ? buildPath : repoPath) ?? dir, log,
      model: claim.model ?? PHASE_MODELS[phase], maxTurns: claim.max_turns ?? PHASE_MAX_TURNS[phase], timeoutMin: PHASE_TIMEOUT_MIN[phase],
      addDirs: [dir],
    });
  let out = readJson(outFile);
  if (!out) {
    const why = timedOut ? `the ${phase} phase hit its ${PHASE_TIMEOUT_MIN[phase]}-minute wall and was stopped` : `claude exited ${rc} and wrote no ${phase}.json`;
    const behind = stateBehind({ phase, dir, repo, repoPath, buildPath, branch });
    // A build whose PR already exists needs no more model turns: the result is on GitHub.
    if (phase === "build" && behind.pr && behind.pr.state === "OPEN") {
      out = { branch, pr_url: behind.pr.url, pr_number: behind.pr.number, proof: { continuation: `build.json written by the runner from GitHub's state after ${why}: ${behind.facts.join("; ")}` } };
      writeFileSync(outFile, JSON.stringify(out, null, 2));
      appendFileSync(log, `=== build.json synthesised from state: ${behind.facts.join("; ")}\n`);
    } else if (behind.facts.length) {
      const c = continuationCount(dir, phase);
      if (c.count < MAX_CONTINUATIONS) {
        const note = `${why}; state behind it: ${behind.facts.join("; ")}`;
        writeFileSync(c.file, JSON.stringify({ count: c.count + 1, notes: [...(c.notes ?? []), { at: new Date().toISOString(), note }] }, null, 2));
        await release(row, `continuation ${c.count + 1}/${MAX_CONTINUATIONS}: ${note}`, log);
        say(`continuation ${c.count + 1}/${MAX_CONTINUATIONS} for ${row.id} ${phase}: ${note.slice(0, 200)} — the next tick finishes it.`);
        return;
      }
      await fail(row, "PHASE_STUCK", `${why}, after ${MAX_CONTINUATIONS} continuations. State behind it: ${behind.facts.join("; ")}. What you can do: open the log (${log}) — the transcript shows the last step; reply "try again" to give it three more, or finish the last step by hand and reply "try again".`, log);
      return;
    } else {
      await fail(row, "PHASE_DID_NOT_COMPLETE", `${why}, and nothing was left behind — no commit, no branch, no PR, no draft. Its silence is not a result. What you can do: read the log (${log}); reply "try again" to run it once more, or send the instruction again with more detail.`, log);
      return;
    }
  }
  /*
   * A BLOCK AFTER THE MERGE IS THE POST-LAND STEP FAILING, NOT A STOP TO HER (21 Sep 2026,
   * rc_m33avf9cd0njg79t). The land prompt once said a failed step "is a block"; Danielle merged
   * cleanly, her step failed, she wrote {blocked: {tag: "POST_LAND_PROOF_FAILED"}}, and that
   * block-shaped result walked past the rework branch below straight to the owner's inbox — the
   * rework guard could not reach what it governed. A land-phase block that carries a merge_sha on
   * a row with a recorded post-land step IS that step's failure: it is reshaped into `post_land`
   * here, and the rework branch (MAX_REWORKS, /rework) decides, exactly as for an honest rc.
   */
  if (phase === "land" && out.blocked && out.merge_sha && row.post_land_command && !out.post_land) {
    const tag = String(out.blocked.tag ?? "BLOCKED").replace(/[^A-Z_]/g, "_");
    out.post_land = { command: String(row.post_land_command).trim(), rc: 1, output_tail: `NAMED STOP [${tag}] ${String(out.blocked.why ?? "")}`.slice(0, 1500), proof: null };
    delete out.blocked;
    say(`land reported a block (${tag}) after merging ${out.merge_sha}: that is the post-land step failing, and it is routed as one.`);
  }
  if (out.blocked) { await fail(row, String(out.blocked.tag ?? "BLOCKED").replace(/[^A-Z_]/g, "_"), String(out.blocked.why ?? "the phase named a block without a reason"), log); markReported(); return; }

  // R26 — the repo's own `## Danielle may run` scripts, run here on the model's request, each recorded.
  const runs = runRequested(out.needs_runs, { mayRun: runbook?.mayRun ?? [], allowed: lookup.allowed, cwd: (phase === "build" ? buildPath : repoPath) ?? dir, log });
  if (runs.length) out.proof = { ...(out.proof ?? {}), runs };
  // R27 — a record she must add at a registrar: recorded (read back, never guessed) and emailed once in three parts.
  if (Array.isArray(out.dns_records) && out.dns_records.length) await askForDns(row, repo, out.dns_records, log);

  if (phase === "plan") {
    const chosen = out.repo ?? repo;
    // R24: the grid, or the repo she named by its GitHub address (registered at the door, row.repo).
    if (!chosen || (!gridRepoNames().includes(chosen) && chosen !== row.repo)) { await failOut("NOT_HER_REPO", `the plan names "${chosen ?? "nothing"}" as the repository; that is neither on the grid nor the repo your email named. Grid: ${gridRepoNames().join(", ")}. Reply with the GitHub address (github.com/owner/name) and it is registered and planned.`, log); return; }
    const chosenPath = repoPathFor(chosen) ?? cloneRepo(row.github_repo && chosen === row.repo ? row.github_repo : `${GRID_OWNER}/${chosen}`, chosen, log);
    if (!chosenPath) { await fail(row, "REPO_UNREACHABLE", `${GITHUB_DIR}/${chosen} is not on this Mac and could not be cloned from GitHub.`, log); return; }
    runbookFor(chosen, `${GRID_OWNER}/${chosen}`, chosenPath, dir);
    const asks = Array.isArray(out.asks) ? out.asks : [];
    const decided = Array.isArray(out.decided) ? out.decided : [];
    /*
     * A POST-LAND STEP IS A RECORDED COMMAND, RESOLVED HERE OR REFUSED HERE. rc_m32h8ze2a4hk37pc
     * (21 Sep 2026) planned "After land: loop/channel_about.py pushed from the Mac", recorded no
     * command, landed, and then failed on `undefined exited undefined`. A plan whose text names a
     * step to run after landing and carries no `post_land_step.command` stops NOW — before a build,
     * long before a merge — and says what is missing.
     */
    const step = out.post_land_step && typeof out.post_land_step === "object" ? out.post_land_step : null;
    const namesStep = /(after (the )?land(ing)?|post[- ]land|once (it|this) (is )?(landed|merged)|after (it|this) (is )?(landed|merged))\b/i.test(`${out.plan_text ?? ""}\n${row.instruction}`);
    if (namesStep && !(step && typeof step.command === "string" && step.command.trim())) {
      await failOut("POST_LAND_STEP_UNRESOLVED", `the plan (or her instruction) names a step to run after landing and resolves no command for it. Name it exactly in plan.json as post_land_step: { command, proof } — or state in the plan that nothing runs after land. Nothing was built.`, log);
      return;
    }
    if (step && !namesStep) { await failOut("POST_LAND_STEP_UNNAMED", `plan.json carries a post_land_step (\`${String(step.command).slice(0, 120)}\`) that neither her instruction nor the plan text names. Only a step she or the plan named runs after land.`, log); return; }
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
    const pre = Boolean(row.pre_approved_phrase);
    const subject = pre
      ? `#danielle FYI — building ${chosen} ${changeToken(row.id)} (you pre-approved: "${row.pre_approved_phrase}")${ready ? "" : ` — NOT publish-ready, ${row.force_phrase ? "landing by your force" : "preview before landing"}`}`
      : `#danielle plan for ${chosen} ${changeToken(row.id)} — ${ready ? 'reply "approved"' : `NOT publish-ready (${placeholders.length} placeholder${placeholders.length === 1 ? "" : "s"}) — reply "approved" for a preview`} ${asks.length ? `(${asks.length} question${asks.length === 1 ? "" : "s"}, each with a default)` : ""}`.trim();
    const text = [
      "Sequoia,", "",
      ...(pre ? [
        `FYI — you pre-approved this ("${row.pre_approved_phrase}"); no reply needed. Reply \`stop\` within the build to hold it.`,
        ready ? "" : (row.force_phrase ? `It is NOT publish-ready and your request also said "${row.force_phrase}", so it lands on green with the placeholders below, recorded as your instruction.` : "It is NOT publish-ready, so it stops at the preview: you will get the preview email and it lands only after you reply \"approved\" to that."),
        "",
      ].filter((l) => l !== "") : []),
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
      ...(asks.length ? ["", waitDetail("PLAN_APPROVAL")] : []),
      `(Keep ${changeToken(row.id)} in the subject; replying keeps it.)`,
      "",
      asks.length ? "QUESTIONS, EACH WITH MY RECOMMENDED DEFAULT" : "NOTHING TO ASK — \"approved\" starts it.",
      ...asks.map(askLine),
      "",
      ...(step ? [`AFTER LANDING I RUN: \`${String(step.command).trim()}\`${step.proof ? ` — proof: ${String(step.proof)}` : ""}`, ""] : []),
      "WHAT I DECIDED (recorded, no reply needed)",
      ...(decided.length ? decided.map((d) => `- ${typeof d === "string" ? d : d.decision ?? JSON.stringify(d)}`) : ["- nothing beyond the plan itself"]),
      "",
      "THE PLAN", "", String(out.plan_text ?? "").trim(),
      "", `Run log on your Mac: ${log}`,
      "", "— Danielle, Technical Program Manager",
    ].join("\n");
    const messageId = await email(subject, text);
    if (!messageId) { await release(row, "plan written but the email could not be sent; will retry next tick", log); say("NAMED STOP [PLAN_NOT_SENT] Resend refused every sender; the plan is on disk and the claim is released."); return; }
    const r = await api(`/${row.id}/plan`, { device_id: DEVICE, plan_text: String(out.plan_text ?? ""), decided, asks, publish_ready: ready, placeholders, ask_message_id: messageId, written_by: claim.model ?? PHASE_MODELS.plan, run_log: log, repo: chosen, ...(step ? { post_land_step: { command: String(step.command).trim(), proof: step.proof ? String(step.proof) : null } } : {}) });
    if (!r.ok) say(`NAMED STOP [PLAN_NOT_RECORDED] ${r.status} ${r.error ?? ""} — the plan was emailed and Boss OS was not told.`);
    else { markReported(); say(`planned: ${asks.length} ask(s), ${decided.length} decided; waiting on her reply.`); }
    return;
  }

  if (phase === "build") {
    if (!out.pr_url || !out.pr_number) { await failOut("NO_PULL_REQUEST", "the build phase ended without a pull request; a build with no PR is not a build.", log); return; }
    const r = await api(`/${row.id}/build`, { device_id: DEVICE, branch: out.branch ?? branch ?? null, pr_url: out.pr_url, pr_number: Number(out.pr_number), proof: out.proof ?? null, written_by: claim.model ?? PHASE_MODELS.build, run_log: log });
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
    if (!out.merge_sha) { await failOut("NO_MERGE_COMMIT", `the land phase wrote no merge_sha; ${LAND} did not report a merge.`, log); return; }
    const proof = out.live_proof ?? {};
    const forcedList = Array.isArray(row.forced_placeholders) ? row.forced_placeholders.map(String) : [];
    /*
     * THE POST-LAND STEP SHE ASKED FOR (21 Sep 2026: "after landing, run bin/<script> and attach
     * the proof"). The LAND phase runs only a step the instruction or the plan named, after
     * ~/bin/land, and reports it under `post_land`. A step that failed is a named stop: the land
     * stands, the proof does not, and the DONE email does not go until the proof exists.
     */
    const wanted = row.post_land_command ? String(row.post_land_command).trim() : null;
    const postLand = wanted && out.post_land && typeof out.post_land === "object" && typeof out.post_land.command === "string" ? out.post_land : null;
    if (wanted && (!postLand || !Number.isInteger(Number(postLand.rc)))) {
      writeFileSync(join(dir, "landed-post-land-failed.json"), JSON.stringify(out));
      await failOut("POST_LAND_STEP_NOT_RUN", `${repo} landed as ${out.merge_sha}, and the recorded post-land step \`${wanted}\` was not run (the land phase reported ${out.post_land ? JSON.stringify(out.post_land).slice(0, 200) : "no post_land"}). The merge stands; reply "try again" and only the step runs.`, log);
      return;
    }
    if (postLand && postLand.command.trim() !== wanted) {
      writeFileSync(join(dir, "landed-post-land-failed.json"), JSON.stringify(out));
      await failOut("POST_LAND_STEP_DIFFERS", `${repo} landed as ${out.merge_sha}; the post-land step run was \`${postLand.command}\` and the recorded one is \`${wanted}\`. Only the recorded step counts.`, log);
      return;
    }
    if (postLand && Number(postLand.rc) !== 0) {
      /*
       * HER EMPLOYEE'S REWORK, NOT HER EMAIL (21 Sep 2026, rc_m32h8ze2a4hk37pc). The step that
       * failed is the employee's own script against the change she just landed: the fix is hers to
       * make. The merge stands; the row goes back to BUILD with the failure as its brief, the next
       * tick opens a fix PR on a fresh branch, lands it and runs the step again. Only past
       * MAX_REWORKS is the owner written to, and that stop lists every attempt.
       */
      const tail = String(postLand.output_tail ?? "").slice(0, 1500);
      const attempt = `\`${postLand.command}\` exited ${postLand.rc} after ${repo} landed as ${out.merge_sha}. Output: ${tail}`;
      const reworks = Number(row.rework_count ?? 0);
      if (reworks < MAX_REWORKS) {
        const r = await api(`/${row.id}/rework`, { device_id: DEVICE, merge_sha: out.merge_sha, reason: attempt, run_log: log });
        if (r.ok) {
          markReported();
          // The next build starts clean: the old worktree (on the merged branch) and this land's
          // outputs would otherwise be reused as if they were the fix.
          for (const f of ["build.json", "build.json.reported", "land.json", "land.json.reported", "landed-post-land-failed.json", "continuations-build.json", "continuations-land.json"]) spawnSync("rm", ["-f", join(dir, f)]);
          if (repoPath) spawnSync("git", ["worktree", "remove", "--force", join(WORK_ROOT, `wt-${row.id}`)], { cwd: repoPath, encoding: "utf8" });
          say(`REWORK ${reworks + 1}/${MAX_REWORKS} for ${row.id}: the post-land step failed and the fix is Danielle's — back to build with the output as the brief. ${attempt.slice(0, 200)}`);
          return;
        }
        say(`rework not recorded (${r.status} ${r.error ?? ""}); stopping to the owner instead.`);
      }
      writeFileSync(join(dir, "landed-post-land-failed.json"), JSON.stringify(out));
      let shas = []; try { shas = JSON.parse(row.reworked_merge_shas ?? "[]"); } catch { shas = []; }
      await failOut("POST_LAND_STEP_FAILED", `${repo} landed as ${out.merge_sha}, and the post-land step you asked for failed: \`${postLand.command}\` exited ${postLand.rc}. ${tail.slice(0, 600)}${reworks ? ` Danielle reworked it ${reworks} time(s) already (${shas.join(", ")}) and the step still fails; the budget of ${MAX_REWORKS} is spent. Her note from the last rework: ${String(row.rework_note ?? "").slice(0, 400)}` : ""}`, log);
      return;
    }
    const subject = `#danielle DONE: ${repo} ${changeToken(row.id)} — landed and live${isForced(row) ? ` (to production with ${forcedList.length} placeholder${forcedList.length === 1 ? "" : "s"}, by your instruction)` : ""}${postLand ? " · post-land step done" : ""}`;
    const text = [
      "Sequoia,", "",
      ...(isForced(row) ? [`Landed to production with ${forcedList.length} placeholder${forcedList.length === 1 ? "" : "s"} by your instruction: ${forcedList.join("; ") || "(none named)"}. Forced by ${row.forced_by} on ${new Date(Number(row.forced_at)).toISOString()}.`, ""] : []),
      `This is Danielle. ${repo} is landed and proven live.`, "",
      `Pull request: ${row.pr_url}`, `Merge commit: ${out.merge_sha}`,
      "", "LIVE PROOF",
      ...Object.entries(proof).map(([k, v]) => `- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`),
      ...(postLand ? ["", "POST-LAND STEP (as you asked)", `- ran: ${postLand.command} (exit ${postLand.rc})`, `- proof: ${postLand.proof ?? "(none recorded)"}`, `- output: ${String(postLand.output_tail ?? "").slice(0, 1200)}`] : []),
      "", "WHAT WAS PROVEN BEFORE THE PR", JSON.stringify(row.proof ?? {}, null, 2),
      ...(Number(row.rework_count ?? 0) > 0 ? ["", `REWORKED ${row.rework_count} time(s) before this landed clean: the post-land step failed on ${(() => { try { return JSON.parse(row.reworked_merge_shas ?? "[]").join(", "); } catch { return "?"; } })()} and I fixed my own script rather than write to you.`] : []),
      "", `Checks: ${row.checks_detail ?? "recorded green"}`,
      ...(missingLines.length ? ["", ...missingLines] : []),
      "", `Run log on your Mac: ${log}`,
      "", "— Danielle, Technical Program Manager",
    ].join("\n");
    const messageId = await email(subject, text, filesAt(screenshotPaths(row.proof ?? {}, row)));
    if (!messageId) { say("NAMED STOP [DONE_NOT_SENT] landed, and the DONE email could not be sent; the row stays in land until it can."); await release(row, "landed; DONE email not sent — retry the email next tick", log); writeFileSync(join(dir, "landed-unreported.json"), JSON.stringify(out)); return; }
    const r = await api(`/${row.id}/land`, { device_id: DEVICE, merge_sha: out.merge_sha, live_proof: postLand ? { ...proof, post_land: postLand } : proof, done_message_id: messageId, run_log: log });
    if (!r.ok) say(`NAMED STOP [LAND_NOT_RECORDED] ${r.status} ${r.error ?? ""} — it landed and she was told; Boss OS was not.`);
    else {
      markReported(); say(`done: ${out.merge_sha}`);
      const wt = join(WORK_ROOT, `wt-${row.id}`);
      if (existsSync(wt) && repoPath) spawnSync("git", ["worktree", "remove", "--force", wt], { cwd: repoPath, encoding: "utf8" });
    }
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
    "", waitDetail("PREVIEW_APPROVAL", { what: found?.url ?? row.pr_url }),
    "", "— Danielle, Technical Program Manager",
  ].join("\n");
  // R18: the screenshots ride on the email (attached up to 10 MB, the rest named with where they are).
  const messageId = await email(subject, text, filesAt(screenshotPaths(proof, row)));
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
