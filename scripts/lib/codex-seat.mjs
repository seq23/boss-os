/*
 * A DELIBERATE COPY of West Peek OS's scripts/lib/codex-seat.mjs (29 Sep 2026): the two repos share no
 * package, and this file has no dependencies. A change to the rule goes to both.
 */
/**
 * THE CODEX SEAT, AS THE MAC SCRIPTS USE IT — one place, so the answer claimer and the repo-work
 * duty script agree about what "Codex is usable" and "how to run it" mean.
 *
 * Used by scripts/ops/repo-change.mjs — when Claude Code reports its plan is out of usage during a
 * phase, hands the SAME phase to Codex in the SAME worktree (29 Sep 2026).
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It never chooses Codex for a reason other than Claude Code's
 * plan being spent. A Claude failure of any other kind — a bad prompt, a crash, a red validator — is
 * the phase's failure, reported as it always was; handing it to a second model would hide the fault
 * and spend a second subscription on the same mistake.
 *
 * PROVEN ON THE OWNER'S MAC (29 Oct 2026, rc_m62y71yasdwmdp7k, codex-cli 0.163.0): the flag set below
 * runs, edits the worktree and reaches the network — and CANNOT write git metadata, whatever folder
 * is named writable. So the runner does the git steps (`finishCodexBuild`). `codexLacks` asks the
 * installed binary before relying on a flag; one that lacks it makes the fallback UNAVAILABLE WITH A
 * SENTENCE, not a silent failure.
 *
 * West Peek OS keeps its own copy of this file; its Codex lane has the same sandbox (SUSPECTED, not
 * checked from this repo).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** True only when the CLI is signed in through the ChatGPT subscription, never an API key (which bills per token). */
export function codexOnSubscription(authJsonText) {
  try {
    const parsed = JSON.parse(authJsonText);
    return parsed.auth_mode === "chatgpt";
  } catch {
    return false;
  }
}

/**
 * Is the Codex seat safe to use on this machine? A boolean with a reason, read from ~/.codex/auth.json.
 * `home` is injectable so a test can point it at a temporary directory.
 */
export function codexSeatUsable(home = homedir()) {
  const p = path.join(home, ".codex", "auth.json");
  if (!existsSync(p)) return { ok: false, why: "~/.codex/auth.json does not exist — the Codex CLI is not signed in" };
  let text = "";
  try {
    text = readFileSync(p, "utf8");
  } catch {
    return { ok: false, why: "~/.codex/auth.json could not be read" };
  }
  if (!codexOnSubscription(text)) {
    return {
      ok: false,
      why:
        "~/.codex/auth.json no longer records auth_mode=chatgpt, so this seat would bill the API per token " +
        "while the firm records it at $0. Refusing to use it until it is back on the subscription.",
    };
  }
  return { ok: true, why: "auth_mode=chatgpt" };
}

/**
 * The arguments for a Codex run that may EDIT the worktree it is started in (repo work), as opposed to the
 * seat claimer's read-only answer. The prompt goes on stdin (`-`), because a phase prompt is tens of
 * kilobytes and an argument that size is how a command line silently truncates.
 *
 *   --sandbox workspace-write   may write inside the working directory and the --add-dir folders only
 *   -c ...network_access=true   the model runs the repo's validators and package installs; the sandbox
 *                               default blocks the network, which would fail every BUILD
 *   --add-dir <d>               the job directory (where the phase writes its result file), outside the worktree
 *
 * NO GIT DIRECTORY IS EVER NAMED HERE (31 Oct 2026). Until then the runner added each worktree's
 * `--git-common-dir` so Codex could commit. It never worked: Codex's workspace-write sandbox keeps git
 * metadata read-only even inside a named writable root, so rc_m62y71yasdwmdp7k's finished repair
 * (29 Oct) died on "Unable to create …/.git/worktrees/<wt>/index.lock: Operation not permitted" and was
 * reported as GIT_METADATA_READ_ONLY with no PR. Reproduced with codex-cli 0.163.0 the same way on a
 * scratch repository. So Codex only EDITS; the runner, outside the sandbox, commits, pushes and opens
 * the pull request (`finishCodexBuild`), and `~/bin/land` stays the only way anything reaches main.
 */
export function codexExecArgs(addDirs = []) {
  return [
    "exec",
    "--sandbox", "workspace-write",
    "-c", "sandbox_workspace_write.network_access=true",
    "--skip-git-repo-check",
    ...addDirs.flatMap((d) => ["--add-dir", d]),
    "-",
  ];
}

/**
 * Phases Codex cannot run at all: LAND runs `~/bin/land`, which fetches and fast-forwards the main
 * checkout — git writes the sandbox refuses. A spent Claude seat on a land phase WAITS for its reset
 * (her seat order: Claude, then Codex, then wait), rather than handing Codex a phase that cannot finish.
 */
export const CODEX_CANNOT_RUN_PHASES = Object.freeze(["land"]);

/** Appended to a BUILD prompt handed to Codex: edit, validate, write the result; the runner does git. */
export const CODEX_BUILD_NOTE = `

## YOU ARE RUNNING IN CODEX'S SANDBOX — THE RUNNER DOES THE GIT STEPS

Git metadata is read-only in this sandbox, so \`git add\`, \`git commit\`, \`git push\` and \`gh pr create\`
cannot work here. Do not run them and do not report that as a block. Make the change and run the
validation exactly as above, leave every change UNCOMMITTED in this worktree, and write the result file
with \`branch\`, \`proof\` (validators and \`validators_passed\`) and \`pr_title\` / \`pr_body\` (the body
names the change, the steps you ran and every validator with what it said). Leave \`pr_url\` and
\`pr_number\` out. After you exit, the runner commits, pushes this branch and opens the pull request;
it never merges — \`~/bin/land\` does that on green, as always.
`;

/** A block Codex wrote only because the sandbox would not let it commit — the runner can finish that. */
export function isGitSandboxBlock(blocked) {
  if (!blocked || typeof blocked !== "object") return false;
  return /index\.lock|GIT_METADATA|git (metadata|write)|cannot commit|commit, push|read-only.*git|git.*read-only/i.test(`${blocked.tag ?? ""} ${blocked.why ?? ""}`);
}

const PROTECTED_BRANCHES = new Set(["main", "master", "HEAD", ""]);

/**
 * THE RUNNER FINISHES A BUILD CODEX EDITED (31 Oct 2026). Runs OUTSIDE the sandbox, after Codex exits.
 * Commits what Codex left in the worktree, pushes the work branch (never main), and opens — or reuses —
 * the pull request. It never merges: landing is `~/bin/land`'s, through the lane's own LAND phase.
 *
 * `run(cmd, args)` is injected (spawnSync-shaped: { status, stdout, stderr }) so the validator can drive
 * real git on a scratch repository with a fake `gh`. Returns
 *   { ok: true, result }   the build result with branch, pr_url and pr_number filled in
 *   { ok: false, tag, why } a NAMED reason nothing was opened (no change, a real block, a git error)
 */
export function finishCodexBuild({ cwd, repo, branch, out, run, base = "main" }) {
  const o = out && typeof out === "object" ? { ...out } : null;
  if (!o) return { ok: false, tag: "NO_RESULT_FILE", why: "Codex wrote no build result, so there is nothing the runner may commit for it." };
  if (o.blocked && !isGitSandboxBlock(o.blocked)) return { ok: false, tag: "CODEX_BLOCKED", why: "Codex reported its own block; the runner does not commit over it." };
  if (o.pr_url && o.pr_number) return { ok: true, result: o };
  const g = (...args) => run("git", args, { cwd });
  const head = String(g("rev-parse", "--abbrev-ref", "HEAD").stdout ?? "").trim();
  const want = String(branch ?? o.branch ?? head).trim();
  if (PROTECTED_BRANCHES.has(want) || PROTECTED_BRANCHES.has(head) || want === base || head === base) {
    return { ok: false, tag: "REFUSED_PROTECTED_BRANCH", why: `the worktree is on "${head}" (wanted "${want}"); the runner commits only on a work branch, never on ${base}.` };
  }
  if (head !== want) return { ok: false, tag: "WRONG_BRANCH", why: `the worktree is on "${head}", not the lane's branch "${want}".` };
  const dirty = String(g("status", "--porcelain").stdout ?? "").trim();
  const title = String(o.pr_title ?? "").trim().split("\n")[0].slice(0, 120) || `Boss OS repo change on ${want}`;
  if (dirty) {
    for (const args of [["add", "-A"], ["rm", "-r", "-q", "--cached", "--ignore-unmatch", "node_modules"]]) {
      const r = g(...args);
      if (r.status !== 0) return { ok: false, tag: "COMMIT_FAILED", why: `git ${args[0]} failed: ${String(r.stderr ?? "").trim().slice(0, 300)}` };
    }
    const c = g("commit", "-q", "-m", `${title}\n\nEdited by Codex (her ChatGPT seat); committed by the Boss OS runner outside Codex's sandbox.`);
    if (c.status !== 0) return { ok: false, tag: "COMMIT_FAILED", why: `git commit failed: ${String(c.stderr ?? c.stdout ?? "").trim().slice(0, 300)}` };
  }
  const ahead = Number(String(g("rev-list", "--count", `origin/${base}..HEAD`).stdout ?? "0").trim() || 0);
  if (!ahead) return { ok: false, tag: "NO_CHANGES", why: `Codex left nothing to commit and ${want} has no commits ahead of origin/${base}.` };
  const push = g("push", "-q", "-u", "origin", `HEAD:refs/heads/${want}`);
  if (push.status !== 0) return { ok: false, tag: "PUSH_FAILED", why: `git push of ${want} failed: ${String(push.stderr ?? "").trim().slice(0, 300)}` };
  const view = run("gh", ["pr", "view", want, "--repo", `seq23/${repo}`, "--json", "url,number,state"], { cwd });
  let pr = null;
  try { const j = JSON.parse(view.stdout || "null"); if (view.status === 0 && j?.url && j.state === "OPEN") pr = { url: j.url, number: Number(j.number) }; } catch { pr = null; }
  if (!pr) {
    const body = String(o.pr_body ?? "").trim() || `${title}\n\nEdited by Codex on her ChatGPT seat; committed and opened by the Boss OS runner. Lands only through ~/bin/land on green.`;
    const made = run("gh", ["pr", "create", "--repo", `seq23/${repo}`, "--base", base, "--head", want, "--title", title, "--body", body], { cwd });
    const url = String(made.stdout ?? "").match(/https:\/\/github\.com\/\S+\/pull\/(\d+)/);
    if (made.status !== 0 || !url) return { ok: false, tag: "PR_NOT_OPENED", why: `gh pr create failed: ${String(made.stderr ?? made.stdout ?? "").trim().slice(0, 300)}` };
    pr = { url: url[0], number: Number(url[1]) };
  }
  delete o.blocked;
  delete o.pr_title;
  delete o.pr_body;
  return {
    ok: true,
    result: { ...o, branch: want, pr_url: pr.url, pr_number: pr.number, proof: { ...(o.proof ?? {}), committed_by: "the Boss OS runner, outside Codex's sandbox (Codex edited; git metadata is read-only to it)" } },
  };
}

/** Does the installed `codex exec --help` mention this flag? Injected `help` text keeps the test offline. */
export function helpMentions(helpText, flag) {
  return typeof helpText === "string" && helpText.includes(flag);
}

/**
 * The orchestration, with every side effect injected so it is tested without a CLI.
 *
 *   1. Run Claude Code.
 *   2. If it did not report a spent plan, that result IS the result — unchanged, including a failure.
 *   3. If it did, and Codex is usable and supports what the phase needs, run the same prompt on Codex.
 *   4. Otherwise return Claude's result with a sentence appended saying why nothing stood in for it.
 *
 * The returned object is the runner's usual `{ code, out, err }` plus `servedBy` ("claude" | "codex")
 * and `handedOver`, so the job log and the phase's failure reason can say which model did the work.
 */
export async function runWithCodexFallback({ runClaude, runCodex, limited, usable, supports, addDirs = [], onLine, phase = null }) {
  const first = await runClaude();
  const limit = limited(first);
  if (!limit) return { ...first, servedBy: "claude", handedOver: false };
  if (phase && CODEX_CANNOT_RUN_PHASES.includes(phase)) {
    return {
      ...first,
      err: `${first.err}\n[Claude Code is out of usage (${limit}) and the ${phase} phase waits for it: Codex's sandbox cannot write the git metadata ~/bin/land needs.]`,
      servedBy: "claude",
      handedOver: false,
      waitForSeat: true,
    };
  }

  const seat = usable();
  if (!seat.ok) {
    return {
      ...first,
      err: `${first.err}\n[Claude Code is out of usage (${limit}) and Codex cannot stand in: ${seat.why}]`,
      servedBy: "claude",
      handedOver: false,
    };
  }
  const missing = await supports(addDirs.length > 0 ? ["--sandbox", "--add-dir"] : ["--sandbox"]);
  if (missing) {
    return {
      ...first,
      err: `${first.err}\n[Claude Code is out of usage (${limit}) and the installed Codex CLI does not support ${missing}, so it cannot take the phase. Update Codex.]`,
      servedBy: "claude",
      handedOver: false,
    };
  }
  onLine?.(`Claude Code is out of usage (${limit}); handing this phase to Codex on the ChatGPT Plus seat, same worktree, same prompt`);
  const second = await runCodex();
  return {
    ...second,
    out: `[served by Codex after Claude Code reported: ${limit}]\n${second.out}`,
    servedBy: "codex",
    handedOver: true,
  };
}
