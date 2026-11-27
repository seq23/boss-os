import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gridRepoNames } from "../../../src/shared/boss/repoChange/lane.mjs";
import { HER_REPOS } from "../noelle-guard.mjs";
import { requireIsolation } from "../noelle-github.mjs";
import { SIMONE_TRAILER, hasChiefTrailer, protectedChiefPath } from "./chief-signoff.mjs";

const mustRun = promisify(execFile);
const SHA = /^[a-f0-9]{40}$/;
const SAFE_REPOS = new Set(["boss-os", ...HER_REPOS, ...gridRepoNames()]);
const failure = (code) => ({ ok: false, code });

function childOptions() {
  return {
    env: {
      HOME: homedir(),
      PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      GH_PROMPT_DISABLED: "1",
      GH_NO_UPDATE_NOTIFIER: "1",
    },
    encoding: "utf8",
    maxBuffer: 2_000_000,
    timeout: 18_000,
  };
}

async function run(command, args, input, cwd) {
  const process = mustRun(command, args, { ...childOptions(), cwd });
  process.child.stdin.on("error", () => {});
  process.child.stdin.end(input ?? "");
  return (await process).stdout.trim();
}

function verified(repo) {
  const options = { guardDir: join(homedir(), ".boss-os", "simone", "guard") };
  requireIsolation(repo, options, (cmd, args) => {
    try {
      const out = execFileSync(cmd, args, { ...childOptions(), stdio: ["ignore", "pipe", "pipe"] });
      return { ok: true, out };
    } catch {
      return { ok: false };
    }
  });
}

export async function simoneGitHub(call, text, hasCredential, deps = {}) {
  let args;
  try { args = JSON.parse(text); } catch { return failure("GITHUB_REQUEST_REQUIRED"); }
  const { repo, action, path, base, patch, title } = args ?? {};
  if (!SAFE_REPOS.has(repo)) return failure("GITHUB_REPO_NOT_AUTHORIZED");
  const project = "seq23/" + repo;
  const execute = deps.run ?? run;
  const gh = (params) => execute("gh", params);
  if (action === "read") {
    if (path !== undefined && (typeof path !== "string" || path.length > 250 ||
      !path.split("/").every((segment) => /^[\w.-]+$/.test(segment) && segment !== "." && segment !== ".."))) {
      return failure("GITHUB_PATH_REQUIRED");
    }
    try {
      const ref = JSON.parse(await gh(["api", `repos/${project}/git/ref/heads/main`, "--method=GET"]));
      const head = ref?.object?.sha;
      if (!SHA.test(head)) return failure("GITHUB_COULD_NOT_CHECK");
      const endpoint = `repos/${project}/contents${path ? "/" + path : ""}?ref=${head}`;
      const evidence = await gh(["api", endpoint, "--method=GET", "-H", "Accept: application/vnd.github.raw+json"]);
      if (evidence.length > 120_000) return failure("GITHUB_NARROW_THE_READ");
      return { ok: true, receipt: "github", evidence, head };
    } catch {
      return failure("GITHUB_COULD_NOT_CHECK");
    }
  }
  if (action !== "draft" && action !== "resume") return failure("GITHUB_OPERATION_RESTRICTED");
  if (Object.keys(args).some((key) => !["repo", "action", "title", "base", "patch"].includes(key)) || typeof title !== "string" || !title.trim() || title.length > 150 || /[\x00-\x1f\x7f]/.test(title) ||
      /(?:@|Ship-ready\s*:|Launch-ready\s*:|VERDICT\s*:)/i.test(title) || hasCredential(title)) {
    return failure("GITHUB_TITLE_REQUIRED");
  }
  if (action === "draft" && (!SHA.test(base) || typeof patch !== "string" || !patch.trim() ||
      patch.length > 54_000 || hasCredential(patch))) return failure("GITHUB_PATCH_REQUIRED");

  try { await (deps.verified ?? verified)(repo); } catch { return failure("REPO_SETTINGS"); }
  const branch = "simone/" + createHash("sha256").update(call.id).digest("hex").slice(0, 24);
  const scratch = mkdtempSync(join(tmpdir(), "simone-git-"));
  const repoUrl = `https://github.com/${project}.git`;
  const git = (params, input) => execute("git", [
    "-c", "core.hooksPath=/dev/null", "-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential", ...params,
  ], input, scratch);
  const remote = async () => (await git(["ls-remote", repoUrl, "refs/heads/" + branch])).split(/\s+/)[0];
  const view = async () => {
    const pulls = JSON.parse(await gh(["api", `repos/${project}/pulls?state=open&base=main&head=seq23:${branch}`, "--method=GET"]));
    if (!Array.isArray(pulls) || pulls.length > 1) throw new Error("Incomplete pull request read");
    return pulls[0];
  };
  try {
    await git(["init", "--bare", "--quiet"]);
    await git(["fetch", "--no-tags", repoUrl, "refs/heads/main:refs/heads/main"]);
    const main = await git(["rev-parse", "refs/heads/main"]);
    const published = await remote();
    if (published) {
      await git(["fetch", "--no-tags", repoUrl, `refs/heads/${branch}:refs/heads/${branch}`]);
      if (await git(["rev-parse", "refs/heads/" + branch]) !== published) return failure("GITHUB_HEAD_CHANGED");
      const commits = (await git(["rev-list", `refs/heads/main..${published}`])).split("\n");
      if (!commits.length || commits.length > 20 || commits.some((sha) => !SHA.test(sha))) return failure("GITHUB_REFUSED");
      for (const sha of commits) {
        if (!hasChiefTrailer(await git(["show", "-s", "--format=%B", sha]))) return failure("SIMONE_TRAILER_REQUIRED");
      }
    }
    let pr = await view();
    if (pr && (pr.draft !== true || pr.head?.sha !== published)) return failure("GITHUB_PR_UNVERIFIED");
    const head = published || main;
    let result = head;
    if (action === "draft") {
      if (base !== head) return { ...failure("GITHUB_HEAD_CHANGED"), head };
      await git(["read-tree", head]);
      try { await git(["apply", "--cached", "--whitespace=error", "-"], patch); }
      catch { return failure("GITHUB_PATCH_DOES_NOT_APPLY"); }
      const tree = await git(["write-tree"]);
      const paths = (await git(["diff", "--no-renames", "--name-only", "-z", head, tree])).split("\0").filter(Boolean);
      if (!paths.length) return failure("GITHUB_PATCH_EMPTY");
      if (paths.some(protectedChiefPath)) return failure("PROTECTED_PATH");
      const message = `${title.trim()}\n\nCo-Authored-By: ${SIMONE_TRAILER}\n`;
      result = await git(["-c", "user.name=Simone", "-c", "user.email=simone@users.noreply.github.com",
        "commit-tree", tree, "-p", head], message);
      if (!SHA.test(result)) return failure("GITHUB_COULD_NOT_CHECK");
      const aggregate = (await git(["diff", "--no-renames", "--name-only", "-z", main, result])).split("\0").filter(Boolean);
      if (!aggregate.length || aggregate.some(protectedChiefPath)) return failure("PROTECTED_PATH");
      if (await remote() !== published) return failure("GITHUB_HEAD_CHANGED");
      if (deps.recheck && !await deps.recheck()) return failure("STALE_SIMONE_RUN");
      await git(["push", "--no-verify", repoUrl, `${result}:refs/heads/${branch}`]);
    } else if (!published) {
      return failure("GITHUB_BRANCH_MISSING");
    }
    if (await remote() !== result) return failure("GITHUB_HEAD_CHANGED");
    const changes = (await git(["diff", "--no-renames", "--name-only", "-z", main, result])).split("\0").filter(Boolean);
    if (!changes.length || changes.some(protectedChiefPath)) return failure("PROTECTED_PATH");
    pr = await view();
    if (!pr) {
      if (deps.recheck && !await deps.recheck()) return failure("STALE_SIMONE_RUN");
      await gh(["pr", "create", "--draft", `--repo=${project}`, "--base=main", `--head=${branch}`,
        `--title=${title.trim()}`, "--body=Prepared by Simone. Review the branch diff and checks before landing."]);
      pr = await view();
    }
    if (pr?.head?.sha !== result || pr?.head?.ref !== branch || pr?.base?.ref !== "main" || pr?.draft !== true ||
        !Number.isSafeInteger(pr?.number) || pr.number < 1) return failure("GITHUB_PR_UNVERIFIED");
    const url = `https://github.com/${project}/pull/${pr.number}`;
    return { ok: true, receipt: url, head: result };
  } catch {
    return failure("GITHUB_COULD_NOT_CHECK");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
