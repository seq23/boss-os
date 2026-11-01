/**
 * THE EMAIL MAP'S GUARD (owner, 31 Oct 2026: "one Email Map page inside Boss OS, all businesses").
 * src/shared/boss/emailMap/manifest.json is the one list the page renders. This module is what keeps
 * it true: it finds every file that sends email, in boss-os and in the other repos, and says which
 * ones no manifest row cites. Read by tests/outboundEmailMap.test.ts (boss-os, in CI) and by
 * scripts/ops/email-map-check.mjs (`npm run email-map:check`: the other repos and the Mac's launchd
 * jobs, on her Mac where those checkouts live).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { EXCLUDED, GRID } from "../../../src/shared/boss/grid.mjs";
import { NO_AUTO_FIX } from "../../../src/shared/boss/siteAudit/repoPolicy.mjs";

/**
 * What counts as SENDING an email: a transport call (Resend's endpoint, Gmail's send, a Workers
 * email binding, an SMTP client), or a call to one of the helpers that wrap them (the Mac lanes'
 * notify.mjs and duty-kit, the Worker's Gmail and Resend clients, a calendar invite, the outreach
 * engine's Gmail client, a site's outreach send endpoint). A new sender reaches one of these.
 */
export const SENDING_PATTERNS = [
  /api\.resend\.com\/emails/,
  /["'`/]messages\/send["'`]/,
  /["'`/]drafts\/send["'`]/,
  /\benv\.[A-Z_]*(EMAIL|MAILER)[A-Z_]*\.send\(/,
  /\b(postEmployeeMail|sendAsEmployee|postErrandMail|sendAs|sendOne|sendViaResend|sendViaGmail|createInvite|employeeMail)\(/,
  /\/api\/outreach\/send\b/,
  /\.send\((b|business|biz)\b/,
  /\bresend\.emails\.send\(|\bnew Resend\(|\bcreateTransport\(|\bnodemailer\b/,
];

/** Code files only; tests, fixtures, validators, docs, generated content and type stubs name senders without sending. */
export function isScanned(file) {
  if (!/\.(ts|tsx|mjs|js|cjs|sh|py)$/.test(file)) return false;
  if (/\.d\.m?ts$/.test(file) || /\.test\.[a-z]+$/.test(file) || /(^|\/)node_modules\//.test(file)) return false;
  return !/^(tests?|e2e|docs|content|insights|data|scripts\/validat[a-z]*)\//.test(file) && !/(^|\/)(__tests__|fixtures?|tests?)\//.test(file);
}

export const sends = (source) => SENDING_PATTERNS.some((re) => re.test(source));

/** Every path the manifest cites in one repo. */
export function citedIn(manifest, repo) {
  return new Set(manifest.rows.flatMap((r) => r.code.filter((c) => c.repo === repo).flatMap((c) => c.paths)));
}

/** Files that send and that no row cites, by name. */
export function uncovered(files, manifest, repo) {
  const cited = citedIn(manifest, repo);
  return files.filter(({ file, source }) => isScanned(file) && sends(source) && !cited.has(file)).map(({ file }) => file);
}

/**
 * The repo is public. Every address the manifest names is a business sending address on one of her
 * businesses' domains (or GitHub's); never a personal inbox, never a person outside.
 */
export const BUSINESS_DOMAINS = [
  "sequoiataylor.com", "joinwestpeek.com", "westpeek.ventures", "events.westpeek.live", "porchandparty901.com",
  "time-2-read.com", "time2read.com", "time2read.app", "theindustryguides.com", "aplayermode.com", "approvalprep.com",
  "weddingchecklistpdf.com", "mail.weddingchecklistpdf.com", "github.com",
];
export function addressProblems(manifest) {
  const text = JSON.stringify(manifest.rows);
  const out = [];
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[a-z]{2,})/g)) {
    if (!BUSINESS_DOMAINS.includes(m[1].toLowerCase())) out.push(`${m[0]} is not a business sending address`);
  }
  return out;
}

/**
 * CLIENT REPOS NEVER APPEAR ON THE EMAIL MAP. Owner's standing rule: the client repos (horse, hicks,
 * the client micro-sites) are never listed, scheduled or raised in Boss OS — the only exception is
 * creator-studios work, which Boss OS handles (22 Oct 2026). The client list is not kept here: it is
 * derived from the places the repo already names its clients (grid.mjs `owner: "client"` properties,
 * grid.mjs EXCLUDED client micro-sites, repoPolicy.mjs NO_AUTO_FIX `kind: "client"`), so a client
 * added there is refused here with no second list to fall behind. Matching is by prefix, as grid.mjs does.
 */
export const CREATOR_STUDIO_REPOS = ["creator-studios", "mercedes-creator-dashboard", "sheila-creator-dashboard"];
export const CLIENT_REPO_EXCLUSION = [...new Set([
  ...GRID.filter((p) => p.owner === "client").flatMap((p) => p.repos),
  ...EXCLUDED.filter((e) => /client/i.test(e.why)).map((e) => e.match),
  ...NO_AUTO_FIX.filter((r) => r.kind === "client").map((r) => r.repo),
])].filter((r) => !CREATOR_STUDIO_REPOS.includes(r));

/** Client property domains (grid.mjs), which a row's prose must not name either. */
export const CLIENT_DOMAINS = GRID.filter((p) => p.owner === "client").flatMap((p) => p.domains ?? []);

/** Is this repo name a client repo the map must never carry? Creator-studio repos are allowed. */
export function isClientRepo(repo) {
  const name = String(repo ?? "").trim().replace(/\/+$/, "").split("/").pop()?.toLowerCase() ?? "";
  if (!name || CREATOR_STUDIO_REPOS.includes(name)) return false;
  return CLIENT_REPO_EXCLUSION.some((c) => name.startsWith(c.toLowerCase()));
}

/** Every row or scanned repo that names a client repo, by name. Empty is the only passing answer. */
export function clientRepoProblems(manifest, scannedRepos = []) {
  if (CLIENT_REPO_EXCLUSION.length === 0) return ["the client-repo exclusion list is empty: the guard cannot see anything"];
  const out = [];
  for (const r of manifest.rows ?? []) {
    for (const c of r.code ?? []) if (isClientRepo(c.repo)) out.push(`${r.id}: cites client repo ${c.repo} (client repos never appear in Boss OS)`);
    const text = JSON.stringify({ ...r, code: undefined }).toLowerCase();
    for (const c of [...CLIENT_REPO_EXCLUSION, ...CLIENT_DOMAINS]) if (text.includes(c.toLowerCase())) out.push(`${r.id}: names client ${c} (client repos never appear in Boss OS)`);
  }
  for (const repo of scannedRepos) if (isClientRepo(repo)) out.push(`scanned client repo ${repo} (client repos never appear in Boss OS)`);
  return out;
}

/** The shape every row must have; a row the page cannot show fully is a problem by name. */
export function shapeProblems(manifest) {
  const keys = new Set(manifest.businesses.map((b) => b.key));
  const runs = new Set(Object.keys(manifest.runs));
  const ids = new Set();
  const out = [];
  for (const r of manifest.rows) {
    if (ids.has(r.id)) out.push(`${r.id}: duplicate id`);
    ids.add(r.id);
    for (const f of ["id", "business", "what", "sender", "owner", "from", "to", "when", "runs", "trigger", "pause"]) {
      if (typeof r[f] !== "string" || !r[f].trim()) out.push(`${r.id ?? "(no id)"}: ${f} is empty`);
    }
    if (!keys.has(r.business)) out.push(`${r.id}: business ${r.business} is not one of the map's businesses`);
    if (!runs.has(r.runs)) out.push(`${r.id}: runs ${r.runs} is not a known place`);
    if (!Array.isArray(r.code) || r.code.length === 0) out.push(`${r.id}: no code entry`);
    for (const c of r.code ?? []) if (c.repo !== "external" && (!c.paths || c.paths.length === 0)) out.push(`${r.id}: ${c.repo} cites no path`);
  }
  for (const b of keys) if (!manifest.rows.some((r) => r.business === b)) out.push(`business ${b} has no rows`);
  return out;
}

/** Where a repo's checkout lives on her Mac: a sibling of this checkout, or ~/<repo>, or ~/bin. */
export function repoDir(repo, root) {
  // ~/bin is her Mac's, not a repo: on a CI runner (which has a ~/bin of its own) it is "not on this Mac".
  if (repo === "~/bin") return !process.env.CI && existsSync(path.join(homedir(), "bin")) ? path.join(homedir(), "bin") : null;
  for (const d of [path.resolve(root, "..", repo), path.join(homedir(), "GitHub", repo), path.join(homedir(), repo)]) {
    if (existsSync(path.join(d, ".git"))) return d;
  }
  return null;
}

function defaultRef(dir) {
  try {
    return execFileSync("git", ["-C", dir, "symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "origin/main";
  }
}

/**
 * The other repos, read on their default branch (never a stale working tree): every cited path
 * exists there, and every file there that sends is cited. ~/bin is not a repo: its files must exist.
 */
export function checkOtherRepos(manifest, root, { scanSenders = true } = {}) {
  const repos = [...new Set(manifest.rows.flatMap((r) => r.code.map((c) => c.repo)))].filter((r) => r !== "boss-os" && r !== "external");
  const checked = [];
  const missingRepos = [];
  const problems = [];
  for (const repo of repos) {
    const dir = repoDir(repo, root);
    if (!dir) { missingRepos.push(repo); continue; }
    checked.push(repo);
    const cited = citedIn(manifest, repo);
    if (repo === "~/bin") {
      for (const p of cited) if (!existsSync(path.join(dir, p))) problems.push(`${repo}/${p} does not exist`);
      continue;
    }
    const ref = defaultRef(dir);
    const files = execFileSync("git", ["-C", dir, "ls-tree", "-r", "--name-only", ref], { encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").filter(Boolean);
    const have = new Set(files);
    for (const p of cited) if (!have.has(p)) problems.push(`${repo}: ${p} is not on ${ref}`);
    for (const file of scanSenders ? files.filter(isScanned) : []) {
      if (cited.has(file)) continue;
      let source = "";
      try { source = execFileSync("git", ["-C", dir, "show", `${ref}:${file}`], { encoding: "utf8", maxBuffer: 16 << 20 }); } catch { continue; }
      if (sends(source)) problems.push(`${repo}: ${file} sends email and no Email Map row cites it`);
    }
  }
  return { checked, missingRepos, problems };
}

/** Every launchd label a row names is installed on this Mac. */
export function checkLaunchd(manifest, dir = path.join(homedir(), "Library", "LaunchAgents")) {
  const labels = [...new Set(manifest.rows.flatMap((r) => r.launchd ?? []))];
  return { labels, missing: labels.filter((l) => !existsSync(path.join(dir, `${l}.plist`))) };
}

export function readManifest(root) {
  return JSON.parse(readFileSync(path.join(root, "src/shared/boss/emailMap/manifest.json"), "utf8"));
}
