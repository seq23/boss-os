/**
 * THE EMAIL MAP'S GUARD (owner, 31 Oct 2026: "one Email Map page inside Boss OS, all businesses").
 * src/shared/boss/emailMap/manifest.json is the one list the page renders. This module is what keeps
 * it true: it finds every file that sends email, in boss-os and in the other repos, and says which
 * ones no manifest row cites. Read by tests/outboundEmailMap.test.ts (boss-os, in CI) and by
 * scripts/ops/email-map-check.mjs (`npm run email-map:check`: the other repos and the Mac's launchd
 * jobs, on her Mac where those checkouts live).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { categoryOf, isParkedRepo } from "../../../src/shared/boss/repos/categories.mjs";
import { readRepoCategories } from "./repo-categories.mjs";

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
  // Python's SMTP client (8 Nov 2026: Horse's approved-content email to Claire sent through it, unseen).
  /\bsmtplib\.SMTP(_SSL)?\(/,
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
  "mail.approvalprep.com", "mail.aplayermode.com", "time-2-read.com", "time2read.com", "time2read.app", "theindustryguides.com", "aplayermode.com", "approvalprep.com",
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
 * REPO CATEGORIES DECIDE, NOT A BAN (owner, 1 Nov 2026: the old "client repos never appear" ban is
 * replaced by the categories in the personal brain, "## Repo categories"; no repo name is copied
 * here). Every repo the map cites or scans must sit in one category, so the brain's list stays the one
 * list; a Friends & clients repo is recognised by its category (`isClientRepo`).
 */
export function isClientRepo(repo, cats = readRepoCategories()) {
  return categoryOf(repo, cats) === "friends";
}

/**
 * Every repo a row cites that sits in no category, by name; unreadable categories are a named stop.
 * Scanned repos are not judged: a scan looks for unregistered jobs in every repo of hers.
 */
export function categoryProblems(manifest, _scannedRepos = [], cats = readRepoCategories()) {
  if (!cats || cats.problem) return [`NAMED STOP [NO_REPO_CATEGORIES] ${cats?.problem ?? "the repo categories were not read"}`];
  const repos = new Set((manifest.rows ?? []).flatMap((r) => (r.code ?? []).map((c) => c.repo)));
  const out = [];
  for (const repo of repos) {
    if (!repo || repo === "external") continue;
    if (!categoryOf(repo, cats)) out.push(`${repo} is in no repo category (add it to the personal brain's "Repo categories")`);
  }
  return out;
}

/** The shape every row must have; a row the page cannot show fully is a problem by name. */
/**
 * A sender that writes FROM her own mailbox speaks as her: "as_her": true on its row, so the Succession
 * Book files it under "Sends as Sequoia: stop on Day 1" (round-11 review, 20 Nov 2026: two such senders
 * sat under "leave on"). A row whose words cannot show it (a tap that sends from her Gmail, a mailbox set
 * inside another service) sets the flag by hand.
 * "plain_stop", when present, is how a non-developer stops it himself, when that is not "ask Claude".
 */
export const HER_OWN_MAILBOX = /^(Your|You)\b|\bsequoia@|^st@time-2-read\.com|^The address the person wrote to|^The inbox the invitation came to|^The Gmail account behind/i;
export const CODE_WORDS = /wrangler|\bdeploy|launchctl|\.toml\b|RESEND_API_KEY|\bsecret\b|\bgh workflow|\bnpm\b/i;
/** A card title fits on one or two lines at 390px. */
export const NAME_MAX = 40;
export function shapeProblems(manifest) {
  const keys = new Set(manifest.businesses.map((b) => b.key));
  const runs = new Set(Object.keys(manifest.runs));
  const ids = new Set();
  const out = [];
  for (const r of manifest.rows) {
    if (ids.has(r.id)) out.push(`${r.id}: duplicate id`);
    ids.add(r.id);
    for (const f of ["id", "business", "name", "what", "sender", "owner", "from", "to", "when", "runs", "trigger", "pause"]) {
      if (typeof r[f] !== "string" || !r[f].trim()) out.push(`${r.id ?? "(no id)"}: ${f} is empty`);
    }
    // The card's title is a short name; the long description sits under it (ship review, 27 Nov 2026:
    // a 7-line title filled the phone before its meta line appeared).
    if (typeof r.name === "string" && r.name.length > NAME_MAX) out.push(`${r.id}: name is ${r.name.length} characters (at most ${NAME_MAX}); put the rest in "what"`);
    if (!keys.has(r.business)) out.push(`${r.id}: business ${r.business} is not one of the map's businesses`);
    if (!runs.has(r.runs)) out.push(`${r.id}: runs ${r.runs} is not a known place`);
    if (!Array.isArray(r.code) || r.code.length === 0) out.push(`${r.id}: no code entry`);
    if (HER_OWN_MAILBOX.test(r.from ?? "") && r.as_her !== true) out.push(`${r.id}: sends from her own mailbox, so it must say "as_her": true (the Succession Book stops it on Day 1)`);
    if (r.as_her != null && typeof r.as_her !== "boolean") out.push(`${r.id}: as_her must be true or absent`);
    if (r.plain_stop != null && (!String(r.plain_stop).trim() || CODE_WORDS.test(r.plain_stop))) out.push(`${r.id}: plain_stop must be words a non-developer can follow (no code, keys or deploys)`);
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
/**
 * Every repo checkout of hers on this Mac (siblings of this checkout and ~/GitHub/*), except worktrees,
 * archives and parked repos. 8 Nov 2026: the scan read only the repos a row already cited, so a sender
 * in a repo with no row at all could never be found. The map now scans them all; a row is what it needs.
 */
export function siblingRepos(root, cats = readRepoCategories()) {
  const out = new Set();
  for (const base of [path.resolve(root, ".."), path.join(homedir(), "GitHub")]) {
    let names = [];
    try { names = readdirSync(base); } catch { continue; }
    for (const n of names) {
      if (/^[._]/.test(n) || n === "boss-os" || !existsSync(path.join(base, n, ".git"))) continue;
      if (cats && !cats.problem && isParkedRepo(n, cats)) continue;
      out.add(n);
    }
  }
  return [...out].sort();
}

/** ~/bin's own files: scripts there often have no extension (`land`), so any file but docs and tests is read. */
export const isScannedBin = (file) => !/\.(md|json|txt|log|plist)$/.test(file) && !/(^|\/)(tests?|docs|node_modules)\//.test(file) && !/\.test\.[a-z]+$/.test(file);

export function checkOtherRepos(manifest, root, { scanSenders = true, alsoScan = [] } = {}) {
  const cited_repos = manifest.rows.flatMap((r) => r.code.map((c) => c.repo));
  const repos = [...new Set([...cited_repos, ...alsoScan])].filter((r) => r !== "boss-os" && r !== "external");
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
      if (!scanSenders) continue;
      let binFiles = [];
      try { binFiles = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 16 << 20 }).split("\n").filter(Boolean); }
      catch { binFiles = readdirSync(dir).filter((f) => { try { return statSync(path.join(dir, f)).isFile(); } catch { return false; } }); }
      for (const f of binFiles.filter(isScannedBin)) {
        if (cited.has(f)) continue;
        let source = "";
        try { source = readFileSync(path.join(dir, f), "utf8"); } catch { continue; }
        if (sends(source)) problems.push(`${repo}: ${f} sends email and no Email Map row cites it`);
      }
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
