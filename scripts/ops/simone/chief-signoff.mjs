import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SIMONE_TRAILER = "Simone <simone@sequoiataylor.com>";
const MANAGED_BRANCH = /^(?:noelle|danielle)\/|^work\/rc-/;
const PROTECTED_PATHS = [
  /^(?:\.github\/|(?:docs\/)?CODEOWNERS$)/,
  /^scripts\/(?:validate\/no-unauthorized-effects\.mjs|vault\/cloudflare-mapping\.json)$/,
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

export function chiefSignoff({ head, branch, messages, paths, ownerText }) {
  if (!/^[0-9a-f]{40}$/.test(head) || !messages.length || !paths.length) return "INCOMPLETE_PR_METADATA";
  const simoneBranch = branch.startsWith("simone/");
  const stamps = messages.map(hasChiefTrailer);
  const commissioned = simoneBranch || stamps.some(Boolean);
  if (simoneBranch && !stamps.every(Boolean)) return "SIMONE_TRAILER_REQUIRED";
  if ((commissioned || MANAGED_BRANCH.test(branch)) && paths.some(protectedChiefPath)) {
    return "PROTECTED_PATH";
  }
  const pass = ownerText.flatMap((body) => [...body.matchAll(PASS_LINE)].map(([line]) => line));
  // `land` receives author names as text from the shared owner account. Until an independently
  // authenticated review can be checked, none of that account's prose can verify provenance.
  if (commissioned && pass.length) return "INDEPENDENT_REVIEW_REQUIRED";
  if (pass.some((line) => /^(?:.*?PASS\s*(?:—|–|-{1,2}|:)\s*)simone\b/i.test(line))) {
    return "SIMONE_APPROVAL_RECORD_REQUIRED";
  }
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
    ownerText: [pr.body ?? "", ...comments.filter((comment) => comment.author_association === "OWNER").map(({ body }) => body)],
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
    console.error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "PR_METADATA_UNAVAILABLE");
    process.exitCode = 1;
  }
}
