#!/usr/bin/env node
/**
 * THE VALIDATOR MATRIX, READ ON HER MAC (owner, 1 Nov 2026). The pure checks are
 * src/shared/boss/validators/matrix.mjs; this file only reads:
 *   - every ~/.boss-os/reviews/validators-<repo>.json (a new file is picked up by its name),
 *   - each repo's own registry from its `origin/<default>` (package scripts, tracked files, CI step
 *     names), never the working tree, for every git repo under ~/GitHub (worktrees skipped) and
 *     ~/aplayer-mode.
 * The Sunday cohesion check (scripts/brains/cohesion-check.mjs) runs `readMatrix` and posts the result
 * to POST /api/boss/validators; Simone's Monday line carries what is flagged. Never blocking.
 *
 *   node scripts/ops/validator-matrix.mjs            # print the census and what is flagged
 *   node scripts/ops/validator-matrix.mjs --json     # the whole matrix as JSON
 * Exit: 0 nothing flagged · 1 flagged, listed by name · 2 NAMED STOP [VALIDATOR_MATRIX_NOTHING_CHECKED].
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { REVIEW_FILE, buildMatrix, parseReviewFile, registryFrom } from "../../src/shared/boss/validators/matrix.mjs";

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const git = (dir, args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });

/** Every repo this Mac holds: name → dir. A worktree (.git is a file) is skipped. */
export function reposOnMac(home = homedir()) {
  const out = new Map();
  const root = join(home, "GitHub");
  if (isDir(root)) for (const d of readdirSync(root)) {
    const dir = join(root, d);
    if (d.startsWith("_") || !isDir(dir) || !isDir(join(dir, ".git"))) continue;
    out.set(d, dir);
  }
  const apm = join(home, "aplayer-mode");
  if (isDir(join(apm, ".git"))) out.set("aplayer-mode", apm);
  return out;
}

/** One repo's registry from its default branch, or null when it cannot be read. */
export function readRegistry(dir, { fetch = true } = {}) {
  // Weekly, so a fetch is cheap and keeps the comparison on today's main (a stale origin/main
  // invents flags). A failed fetch reads what is there.
  if (fetch) { try { execFileSync("git", ["-C", dir, "fetch", "-q", "origin"], { stdio: "ignore", timeout: 30_000 }); } catch { /* read what is there */ } }
  let ref = "origin/main";
  try { ref = git(dir, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).trim() || ref; } catch { /* origin/main */ }
  let files;
  try { files = git(dir, ["ls-tree", "-r", "--name-only", ref]).split("\n").filter(Boolean); } catch { return null; }
  let scripts = {};
  try { scripts = JSON.parse(git(dir, ["show", `${ref}:package.json`])).scripts ?? {}; } catch { /* no package.json */ }
  const steps = [];
  for (const f of files.filter((x) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(x))) {
    try { for (const m of git(dir, ["show", `${ref}:${f}`]).matchAll(/^\s*(?:-\s*)?name:\s*["']?(.+?)["']?\s*$/gm)) steps.push(m[1]); } catch { /* unreadable workflow */ }
  }
  return registryFrom({ scripts, files, steps });
}

export function readMatrix({ home = homedir(), reviewsDir = process.env.BOSS_REVIEWS_DIR ?? join(home, ".boss-os", "reviews"), repos = reposOnMac(home), read = readRegistry } = {}) {
  const names = existsSync(reviewsDir) ? readdirSync(reviewsDir).filter((f) => REVIEW_FILE.test(f)).sort() : [];
  const reviews = names.map((f) => {
    try { return parseReviewFile(f, JSON.parse(readFileSync(join(reviewsDir, f), "utf8"))); }
    catch (e) { return { repo: REVIEW_FILE.exec(f)?.[1] ?? f, rows: [], problems: [`${f} could not be read (${e.message})`] }; }
  });
  const registries = {};
  const otherRepos = [];
  for (const [name, dir] of repos) {
    const reg = read(dir);
    if (reviews.some((r) => r.repo === name)) registries[name] = reg;
    else if (reg && reg.entries.length) otherRepos.push(name);
  }
  const m = buildMatrix({ reviews, registries, otherRepos });
  return { ...m, files: names.length, repos_read: repos.size };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const m = readMatrix();
  if (process.argv.includes("--json")) { console.log(JSON.stringify(m, null, 2)); }
  else {
    console.log(`${m.rows.length} validators from ${m.files} review files; ${m.repos_read} repos read; ${m.duplicates.length} shared across repos; ${m.not_imported.length} repos not imported yet${m.unread.length ? `; not on this Mac: ${m.unread.join(", ")}` : ""}`);
    for (const u of m.unlisted) console.log(`not in its repo's list: ${u.repo} ${u.name}`);
    for (const u of m.unmatrixed) console.log(`not in the matrix: ${u.repo} ${u.name}`);
    for (const p of m.problems) console.log(`problem: ${p}`);
  }
  if (!m.files) { console.error("NAMED STOP [VALIDATOR_MATRIX_NOTHING_CHECKED] no validators-<repo>.json in the reviews folder"); process.exit(2); }
  process.exit(m.unlisted.length || m.unmatrixed.length || m.problems.length ? 1 : 0);
}
