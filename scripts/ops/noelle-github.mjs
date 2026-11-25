#!/usr/bin/env node
/**
 * NOELLE'S GITHUB BROKER (24 Nov 2026, the owner's words: "u do it why do u need me for any of this?"). Noelle's run
 * holds no GitHub credential at all: inside her sandbox git and gh are logged out. Her two GitHub verbs run here,
 * outside the sandbox, through ~/.boss-os/noelle/bin/noelle-tool (env -i, so nothing of hers reaches this process),
 * on the Mac's own gh login:
 *
 *   push-branch <repo> <branch>                  her branch noelle/<...> to seq23/<repo>, never forced
 *   open-pr <repo> <branch> <title> <bodyfile>   a PR from that branch, never a draft
 *
 * Nothing else: no merge, approve, API passthrough, secret, settings or delete verb. Landing stays land-after only.
 *
 * What it refuses (exit 2, a NAMED STOP she reads): a repo that is not exactly one of HER_REPOS (a URL, an owner,
 * another business's repo); a branch that is not noelle/<safe segments> (main, master, refs/…, a refspec with ":",
 * a "+" force, "..", "@{", a ".lock" end); a push that changes .github/ (a workflow she pushed would run on GitHub
 * with the repo's secrets, outside her sandbox); a body file outside ~/Work/noelle and her run folder; a 4th PR in
 * one run. What it never reports as done (exit 3): gh logged out, the network down, a rejected push, a push whose
 * sha GitHub does not show, a PR whose URL or state it cannot read back.
 *
 * How the push stays hers: her clone's config and hooks are never run. The branch is fetched (git upload-pack, which
 * git keeps safe to run on an untrusted repository) into a mirror this broker owns, ~/.boss-os/noelle/push/<repo>.git,
 * and pushed from there to a fixed https URL with only gh's credential helper and no other config (system, global
 * and hooks are all off). gh and git get their arguments as an array (execFile), never through a shell, and every
 * value she gives goes in after a flag's "=", so a title like "--base main" is a title.
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HER_REPOS, MAX_PRS } from "./noelle-guard.mjs";

export const BODY_MAX = 60000;
export const LAND_REPOS = Object.freeze([
  "p-n-p", "approvalprep", "aplayer-mode", "sprylabs-hpc-site", "peace-be-still",
  "creator-studios", "dream-wedding-builder", "keepmyproof",
]);
export const TITLE_MAX = 256; // GitHub's own limit

class Stop extends Error {
  constructor(code, why, exit) { super(`NAMED STOP [${code}] ${why}`); this.code = code; this.exit = exit; }
}
const refuse = (code, why) => { throw new Stop(code, why, 2); };
const unsure = (code, why) => { throw new Stop(code, why, 3); };

/** The repo she names must be exactly one of hers: no owner, no URL, no path. */
export function checkRepo(repo) {
  const r = String(repo ?? "");
  if (!HER_REPOS.includes(r)) refuse("OTHER_BUSINESS_REPO", `"${r.slice(0, 80)}" is not one of your businesses' repos (give the bare name: ${HER_REPOS.join(", ")})`);
  return r;
}

/** noelle/<segments>, each segment letters, digits, ".", "_" or "-", never "." first or ".lock" last. */
export function checkBranch(branch) {
  const b = String(branch ?? "");
  const segs = b.split("/");
  const ok = b.length <= 100 && segs.length >= 2 && segs[0] === "noelle"
    && segs.slice(1).every((s) => /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(s) && !s.endsWith(".lock") && !s.endsWith(".") && !s.includes(".."));
  if (!ok) refuse("BRANCH_SHAPE", `"${b.slice(0, 80)}" is not a branch of yours: noelle/<name>, letters, digits, ".", "_" and "-" only (never main, master, refs/, ":", "+" or "..")`);
  return b;
}

const realOr = (p) => { try { return realpathSync(p); } catch { return p; } };

/** A file she names, resolved through every link, lies in her home or a run folder; read once, here. */
export function readHerFile(file, env = process.env) {
  const real = (() => { try { return realpathSync(resolve(env.NOELLE_CALLER_CWD ?? process.cwd(), String(file ?? ""))); } catch { return null; } })();
  const roots = [env.NOELLE_HOME ?? join(homedir(), "Work", "noelle"), env.NOELLE_RUNS ?? join(homedir(), ".boss-os", "noelle", "runs")].map(realOr);
  if (!real || !roots.some((r) => real.startsWith(`${r}/`))) refuse("BODY_PATH", "the PR body file must be in ~/Work/noelle or your run folder");
  const st = statSync(real);
  if (!st.isFile() || st.size > BODY_MAX) refuse("BODY_SHAPE", `the PR body file must be a file of at most ${BODY_MAX} bytes`);
  return readFileSync(real, "utf8");
}

function runner(opts) {
  const env = {
    PATH: opts.env?.PATH ?? process.env.PATH ?? "/opt/homebrew/bin:/usr/bin:/bin",
    HOME: opts.env?.HOME ?? process.env.HOME ?? homedir(),
    TMPDIR: opts.env?.TMPDIR ?? process.env.TMPDIR ?? "/tmp",
    ...(opts.env?.HTTPS_PROXY ? { HTTPS_PROXY: opts.env.HTTPS_PROXY } : {}),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1",
  };
  if (process.env.USER) env.USER = process.env.USER;
  const run = (cmd, args, { input, cwd } = {}) => {
    try {
      return { ok: true, out: execFileSync(cmd, args, { env, cwd: cwd ?? env.TMPDIR, input: input ?? "", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 120000 }) };
    } catch (e) {
      return { ok: false, out: String(e.stdout ?? ""), err: String(e.stderr ?? e.message ?? "").trim().split("\n").slice(-2).join(" ").slice(0, 300) };
    }
  };
  return run;
}

function ghLoggedIn(run) {
  const r = run("gh", ["auth", "status", "--hostname", "github.com"]);
  if (!r.ok) unsure("NOELLE_GH_LOGGED_OUT", `the Mac's gh login could not be confirmed (${r.err || "no answer"}); nothing was pushed or opened`);
}

/**
 * Push her branch. opts (tests only; the wrapper never sets them): base, the GitHub URL root; mirrors, the mirror
 * folder; env, the PATH/HOME/proxy the child processes see. Returns the sha GitHub now shows.
 */
export function pushBranch(repo, branch, opts = {}) {
  const r = checkRepo(repo), b = checkBranch(branch);
  const env = opts.env ?? process.env;
  const run = runner(opts);
  ghLoggedIn(run);

  const home = env.NOELLE_HOME ?? join(homedir(), "Work", "noelle");
  const reposRoot = realOr(join(home, "repos"));
  const clone = join(home, "repos", r);
  const realClone = realOr(clone);
  if (!existsSync(clone) || !realClone.startsWith(`${reposRoot}/`)) refuse("CLONE_PATH", `your clone must be ~/Work/noelle/repos/${r} (git clone https://github.com/seq23/${r}.git there)`);
  const dotgit = join(realClone, ".git");
  let gst = null;
  try { gst = lstatSync(dotgit); } catch { gst = null; }
  if (!gst?.isDirectory()) refuse("CLONE_PATH", `~/Work/noelle/repos/${r}/.git must be the clone's own folder, not a link or a pointer file`);
  if (existsSync(join(dotgit, "objects", "info", "alternates"))) refuse("CLONE_PATH", "your clone borrows objects from another repository (objects/info/alternates); clone it fresh");

  const mirror = join(opts.mirrors ?? join(homedir(), ".boss-os", "noelle", "push"), `${r}.git`);
  const git = (args, more) => run("git", ["--git-dir", mirror, "-c", "core.hooksPath=/dev/null", ...args], more);
  if (!existsSync(join(mirror, "HEAD"))) {
    mkdirSync(mirror, { recursive: true });
    const i = run("git", ["init", "--quiet", "--bare", mirror]);
    if (!i.ok) unsure("NOELLE_PUSH_FAILED", `the push mirror could not be made (${i.err})`);
  }
  const url = `${opts.base ?? "https://github.com"}/seq23/${r}.git`;
  const head = git(["fetch", "--quiet", "--no-tags", url, "+HEAD:refs/noelle/base"]);
  if (!head.ok) unsure("NOELLE_PUSH_FAILED", `GitHub could not be reached for seq23/${r} (${head.err}); nothing was pushed`);
  const mine = git(["fetch", "--quiet", "--no-tags", `file://${realClone}`, `+refs/heads/${b}:refs/heads/${b}`]);
  if (!mine.ok) refuse("BRANCH_MISSING", `your clone has no branch ${b} to push (${mine.err})`);
  const sha = git(["rev-parse", "--verify", `refs/heads/${b}^{commit}`]).out.trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) unsure("NOELLE_PUSH_FAILED", `the branch ${b} could not be read back`);
  const mb = git(["merge-base", "refs/noelle/base", sha]);
  if (!mb.ok) refuse("UNRELATED_HISTORY", `${b} does not share history with seq23/${r}`);
  const gh = git(["diff", "--name-only", mb.out.trim(), sha, "--", ".github"]);
  if (!gh.ok) unsure("NOELLE_PUSH_FAILED", `the change could not be read (${gh.err})`);
  if (gh.out.trim()) refuse("WORKFLOW_CHANGE", `${b} changes .github/ (${gh.out.trim().split("\n").slice(0, 3).join(", ")}): workflows run on GitHub with the repo's secrets, so Sequoia's builder changes them, not you`);

  const push = git(["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", "push", "--quiet", "--no-verify", "--porcelain", url, `refs/heads/${b}:refs/heads/${b}`]);
  if (!push.ok) unsure("NOELLE_PUSH_FAILED", `GitHub refused or did not answer the push of ${b} (${push.err}); a branch that moved on GitHub is never forced`);
  const seen = run("git", ["ls-remote", url, `refs/heads/${b}`]);
  const there = seen.ok ? seen.out.split(/\s+/)[0] : "";
  if (there !== sha) unsure("NOELLE_PUSH_UNPROVEN", `GitHub shows ${there || "nothing"} for ${b}, not ${sha.slice(0, 12)}; treat it as not pushed`);
  return sha;
}

function guardState(dir) {
  try { return JSON.parse(readFileSync(join(dir, "run.json"), "utf8")); } catch { return null; }
}

/** Open her PR. opts as pushBranch, plus guardDir. Returns the PR's URL. */
export function openPr(repo, branch, title, bodyFile, opts = {}) {
  const r = checkRepo(repo), b = checkBranch(branch);
  const env = opts.env ?? process.env;
  const t = String(title ?? "");
  if (!t.trim() || t.length > TITLE_MAX || /[\0-\x1f\x7f]/.test(t)) refuse("TITLE_SHAPE", `a PR title is one line of 1 to ${TITLE_MAX} characters`);
  const body = readHerFile(bodyFile, env).split(/\r?\n/)
    .filter((line) => !/^[\s>*_-]*(?:ship-ready|launch-ready|owner override)\s*:/i.test(line)).join("\n");
  const gdir = opts.guardDir ?? env.NOELLE_GUARD_DIR ?? join(homedir(), ".boss-os", "noelle", "guard");
  const lock = join(gdir, "open-pr.lock");
  try { writeFileSync(lock, "", { flag: "wx" }); }
  catch { unsure("GUARD_BUSY", "the broker cannot reserve a PR slot; try once the current request finishes"); }
  try {
    const st = guardState(gdir);
    if (!st) unsure("GUARD_UNREAD", "her run's PR count could not be read; no PR was opened");
    if ((st.prs ?? 0) >= MAX_PRS) refuse("PR_CAP", `${MAX_PRS} PRs is the most in one run; write the rest into your handoff`);
    const run = runner(opts);
    ghLoggedIn(run);

    const made = run("gh", ["pr", "create", `--repo=seq23/${r}`, "--base=main", `--head=${b}`, `--title=${t}`, "--label=review-required", "--body-file=-"], { input: body });
    const url = made.ok ? (made.out.match(/https:\/\/github\.com\/\S+/)?.[0] ?? "") : "";
    const prefix = `https://github.com/seq23/${r}/pull/`;
    const number = url.startsWith(prefix) ? url.slice(prefix.length) : "";
    if (!/^[1-9]\d*$/.test(number)) unsure("NOELLE_PR_FAILED", `the PR from ${b} was not opened (${made.err || "no URL came back"})`);
    // Count an acknowledged creation even when the read-back fails. A retry cannot open a fourth PR.
    writeFileSync(join(gdir, "run.json"), JSON.stringify({ ...st, prs: (st.prs ?? 0) + 1 }));
    const view = run("gh", ["pr", "view", url, "--json", "isDraft,headRefName,baseRefName,state,labels"]);
    let pr = null;
    try { pr = JSON.parse(view.out); } catch { pr = null; }
    if (!view.ok || !pr || pr.isDraft !== false || pr.headRefName !== b || pr.baseRefName !== "main"
      || pr.state !== "OPEN" || !pr.labels?.some((label) => label.name === "review-required")) {
      unsure("NOELLE_PR_UNPROVEN", `${url} could not be confirmed open, targeting main, and labeled review-required`);
    }
    const owned = join(gdir, "opened", r);
    mkdirSync(owned, { recursive: true });
    writeFileSync(join(owned, number), b, { flag: "wx" });
    return url;
  } finally {
    unlinkSync(lock);
  }
}

/** Internal to the land-after wrapper. Only persistent broker receipts grant merge eligibility. */
export function checkLand(repo, number, opts = {}) {
  const r = checkRepo(repo);
  if (!LAND_REPOS.includes(r)) refuse("PROPOSAL_ONLY_REPO", `seq23/${r} accepts proposals only`);
  if (!/^[1-9][0-9]{0,5}$/.test(number ?? "")) refuse("LAND_SHAPE", "give the pull request number");
  const env = opts.env ?? process.env;
  const gdir = opts.guardDir ?? env.NOELLE_GUARD_DIR ?? join(homedir(), ".boss-os", "noelle", "guard");
  let branch;
  try { branch = readFileSync(join(gdir, "opened", r, number), "utf8"); }
  catch { refuse("PR_NOT_OWNED", `the broker has no opening receipt for seq23/${r}#${number}`); }
  const result = runner(opts)("gh", ["pr", "view", number, `--repo=seq23/${r}`, "--json", "headRefName,baseRefName,isCrossRepository,state"]);
  let pr;
  try { pr = JSON.parse(result.out); } catch { pr = null; }
  if (!result.ok || !pr) unsure("NOELLE_PR_UNPROVEN", "could not confirm the pull request on GitHub");
  if (pr.headRefName !== checkBranch(branch) || pr.baseRefName !== "main" || pr.isCrossRepository !== false || pr.state !== "OPEN") {
    refuse("PR_NOT_OWNED", "the open PR no longer matches the broker receipt");
  }
}

export const USAGE = "usage: noelle-tool push-branch <repo> <noelle/branch> | open-pr <repo> <noelle/branch> <title> <bodyfile>";

/** The CLI: exactly the two verbs and their exact argument counts. Returns the exit code. */
export function cli(argv, opts = {}) {
  const [verb, ...a] = argv;
  try {
    if (verb === "check-land" && a.length === 2) {
      checkLand(a[0], a[1], opts);
      console.log(`OUTPUT verified proposal seq23/${a[0]}#${a[1]}`);
      return 0;
    }
    if (verb === "push-branch" && a.length === 2) {
      const sha = pushBranch(a[0], a[1], opts);
      console.log(`OUTPUT push-branch seq23/${a[0]} ${a[1]} ${sha}`);
      return 0;
    }
    if (verb === "open-pr" && a.length === 4) {
      console.log(`OUTPUT open-pr ${openPr(a[0], a[1], a[2], a[3], opts)}`);
      return 0;
    }
    console.error(USAGE);
    return 2;
  } catch (e) {
    console.log(e instanceof Stop ? e.message : `NAMED STOP [NOELLE_GITHUB_FAILED] ${String(e?.message ?? e).slice(0, 300)}`);
    console.log("OUTPUT 0");
    return e instanceof Stop ? e.exit : 3;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(cli(process.argv.slice(2)));
