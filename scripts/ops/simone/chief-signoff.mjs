import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SIMONE_TRAILER = "Simone <simone@sequoiataylor.com>";
const MANAGED_BRANCH = /^(?:noelle|danielle)\/|^work\/rc-/;
const PROTECTED_PATHS = [
  /^(?:\.github\/|(?:docs\/)?CODEOWNERS$)/,
  /^scripts\/(?:validate\/(?:gmail-metadata-only|no-direct-provider-calls|no-unauthorized-effects)\.mjs|vault\/cloudflare-mapping\.json)$/,
  /^scripts\/ops\/(?:simone\/|simone(?:-permissions\.json|\.mjs)$|lib\/simone-|noelle-github\.mjs$|duty-(?:run\.sh|brief\.mjs)$)/,
  /^src\/shared\/boss\/(?:intake\/(?:mail|messageBody)\.|commands\/parse\.|duties\/ownerEdits\.|invitations\/invitations\.)/,
  /^src\/worker\/(?:index|bossMount|env)\.ts$/,
  /^src\/worker\/boss\/(?:(?:index|env)\.ts$|agents\/simone|intake\/(?:inboundMail|readFiles)\.ts$|invitations\/run\.ts$|lib\/operatingStop\.ts$)/,
  /^src\/worker\/boss\/(?:commands\/(?:google|routes)|duties\/ownerEdits|routes\/(?:simone|system|backends|repoChanges|growth))\.ts$/,
  /^src\/client\/boss\/(?:api\.ts|components\/TellSimone\.tsx|pages\/EmployeePage\.tsx)$/,
  /^tests\/(?:boss\/)?(?:simone|chief)/,
];
const PASS_LINE = /^[\s>*-]*(?:Ship-ready|Launch-ready):\s*PASS\b.*$/gim;

export function hasChiefTrailer(message) {
  // Match the parsed Git trailer block. A mention in the commit body cannot satisfy this check.
  const trailers = execFileSync("git", ["interpret-trailers", "--parse"], { input: message, encoding: "utf8" });
  return trailers.split("\n").some((line) => line.toLowerCase() === `co-authored-by: ${SIMONE_TRAILER}`.toLowerCase());
}

/*
 * WHAT EACH REFUSAL NEEDS (#582 review finding 5, 27 Nov 2026): once required, this check must say how a
 * refused PR passes, and a Simone PR must be able to pass. Printed beside the code by the workflow step.
 */
export const SIGNOFF_NEEDS = Object.freeze({
  INCOMPLETE_PR_METADATA: "GitHub returned this PR's head, commits or files only in part. Run the check again.",
  SIMONE_TRAILER_REQUIRED: "Every commit on a simone/ branch carries Simone's Co-Authored-By trailer. Push the commits again through her dispatcher.",
  PROTECTED_PATH: "This PR changes an owner-only path. Only the owner lands it (land --owner).",
  INDEPENDENT_REVIEW_REQUIRED: "Simone wrote or commissioned this PR. Only a PASS line posted as a PR comment by a reviewer other than Simone, naming the current head commit, counts; a PASS in the PR body, at an older commit or naming Simone does not.",
  SIMONE_APPROVAL_RECORD_REQUIRED: "A PASS naming Simone needs the approval record her dispatcher writes for this head, which is not built yet. A reviewer other than Simone signs it instead.",
});

const namesSimone = (line) => /PASS\s*(?:—|–|-{1,2}|:)\s*simone\b/i.test(line);
/** The line names the head it looked at: `at <sha>`, seven or more hex characters of the current head. */
const atHead = (line, head) => {
  const named = /\bat\s+([0-9a-f]{7,40})\b/i.exec(line)?.[1]?.toLowerCase();
  return Boolean(named) && head.startsWith(named);
};
const passLines = (texts) => texts.flatMap((text) => [...String(text ?? "").matchAll(PASS_LINE)].map(([line]) => line));

/**
 * `body` is the PR description (Simone's broker writes it); `comments` are the OWNER account's comments,
 * which only the owner's sessions can post: Simone and the workers she commissions hold no GitHub
 * credential that comments (the broker opens PRs with a fixed body and posts nothing else).
 */
export function chiefSignoff({ head, branch, messages, paths, body = "", comments = [] }) {
  if (!/^[0-9a-f]{40}$/.test(head) || !messages.length || !paths.length) return "INCOMPLETE_PR_METADATA";
  const simoneBranch = branch.startsWith("simone/");
  const stamps = messages.map(hasChiefTrailer);
  const commissioned = simoneBranch || stamps.some(Boolean);
  if (simoneBranch && !stamps.every(Boolean)) return "SIMONE_TRAILER_REQUIRED";
  if ((commissioned || MANAGED_BRANCH.test(branch)) && paths.some(protectedChiefPath)) {
    return "PROTECTED_PATH";
  }
  const inBody = passLines([body]);
  const inComments = passLines(comments);
  if (commissioned) {
    // No PASS yet: nothing to refuse (land itself asks for one where the PR's class needs it). `land`
    // reads the LAST PASS line, from the body or a comment, so the last comment's must be an
    // independent reviewer's at this head.
    if (!inBody.length && !inComments.length) return null;
    // A PASS in the body never counts on its own: the last comment must carry it.
    if (inComments.some(namesSimone) || !atHead(inComments.at(-1), head)) return "INDEPENDENT_REVIEW_REQUIRED";
    return null;
  }
  if ([...inBody, ...inComments].some(namesSimone)) return "SIMONE_APPROVAL_RECORD_REQUIRED";
  return null;
}

export function protectedChiefPath(path) {
  return PROTECTED_PATHS.some((rule) => rule.test(path));
}

function inspectPull(number, repo, base) {
  if (!Number.isSafeInteger(number) || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Invalid PR identity");
  const path = `repos/${repo}/pulls/${number}`;
  const read = (endpoint, pages = false) => JSON.parse(execFileSync("gh", ["api", endpoint,
    ...(pages ? ["--paginate", "--slurp"] : [])], { encoding: "utf8", timeout: 120_000, maxBuffer: 30 * 1024 * 1024 }));
  const pr = read(path);
  if (pr.state !== "open" || pr.base.ref !== "main") return null;
  if (base && pr.head.sha !== base) return "PR_REF_CHANGED";
  const commits = read(`${path}/commits?per_page=100`, true).flat();
  const files = read(`${path}/files?per_page=100`, true).flat();
  const comments = read(`repos/${repo}/issues/${number}/comments?per_page=100`, true).flat();
  if (commits.length !== pr.commits || files.length !== pr.changed_files || commits.at(-1)?.sha !== pr.head.sha ||
      read(path).head.sha !== pr.head.sha) return "INCOMPLETE_PR_METADATA";
  return chiefSignoff({
    head: pr.head.sha, branch: pr.head.ref, messages: commits.map(({ commit }) => commit.message),
    paths: files.flatMap(({ filename, previous_filename }) => previous_filename ? [filename, previous_filename] : [filename]),
    body: pr.body ?? "",
    comments: comments.filter((comment) => comment.author_association === "OWNER").map(({ body }) => body),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const pr = event.pull_request;
    const result = inspectPull(pr?.number ?? event.issue?.number, process.env.GITHUB_REPOSITORY, pr?.head.sha);
    if (result) throw new Error(result);
    console.log("Chief sign-off metadata passed.");
  } catch (error) {
    const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "PR_METADATA_UNAVAILABLE";
    console.error(`${code}: ${SIGNOFF_NEEDS[code] ?? "GitHub could not be read for this PR. Run the check again."}`);
    process.exitCode = 1;
  }
}
