#!/usr/bin/env node
/**
 * KENDRA: KEEP THE MAC'S DISK FROM FILLING UP (owner-approved 26 Oct 2026). Sundays, launchd
 * com.seq.boss-mac-cleanup through duty-run.sh → duty_mac_cleanup.
 *
 * What it removes, and only this:
 *   · git worktrees under ~/GitHub older than 24 h, with no uncommitted tracked change, whose HEAD is
 *     on a remote branch (`git worktree remove`). A worktree anything touched in the last 24 h is
 *     never touched; one with unpushed commits is LISTED, never removed.
 *   · `npm cache clean --force`, `pip3 cache purge`, `brew cleanup -s`.
 *   · how-we-know renders/*.mp4 older than 14 days, ONLY for an episode the repo's own publish record
 *     (research/published.json) lists; the .json sidecars stay.
 *   · old ms-playwright browser versions, keeping the newest of each.
 * Never anything in ~/Documents, ~/Pictures, ~/Movies or ~/Desktop, and never a repo's tracked file.
 * Under 20 GB free on /System/Volumes/Data after the clean: one line to Simone's email.
 *
 *   npm run mac:cleanup              # clean, log, and email if the disk is still low
 *   npm run mac:cleanup -- --dry-run # say what it would remove, remove nothing
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const HOME = os.homedir();
const GITHUB = path.join(HOME, "GitHub");
const DAY = 86_400_000;
export const NEVER = ["Documents", "Pictures", "Movies", "Desktop"].map((d) => path.join(HOME, d));
export const LOW_GB = 20;

/** Never a path inside her own folders. */
export const forbidden = (p) => NEVER.some((n) => path.resolve(p) === n || path.resolve(p).startsWith(`${n}${path.sep}`));

/**
 * Which worktrees go (pure). Each: { path, main, touched_at, dirty, on_remote, unpushed }.
 * `remove`: older than 24 h, clean, HEAD on a remote branch, nothing unpushed. `list`: unpushed work.
 */
export function pickWorktrees(trees, now = Date.now()) {
  const remove = [];
  const list = [];
  for (const t of trees) {
    if (t.main || forbidden(t.path)) continue;
    if (now - Number(t.touched_at ?? now) < DAY) continue; // an agent may be in it
    if (t.unpushed > 0) { list.push(t); continue; }
    if (t.dirty || !t.on_remote) continue;
    remove.push(t);
  }
  return { remove, list };
}

/** Which renders go (pure): .mp4 only, older than 14 days, and the episode is published. */
export function pickRenders(files, published, now = Date.now()) {
  const slugs = new Set((published ?? []).map((s) => String(s).toLowerCase()));
  return files.filter((f) => {
    if (!/\.mp4$/i.test(f.name) || now - f.mtime < 14 * DAY) return false;
    const slug = f.name.toLowerCase().replace(/\.mp4$/, "").replace(/-final$/, "").replace(/^\d+-/, "");
    return slugs.has(slug);
  });
}

/** Old Playwright browsers (pure): every version but the newest of each family. */
export function pickPlaywright(dirs) {
  const fam = new Map();
  for (const d of dirs) {
    const m = /^(.*)-(\d+)$/.exec(d);
    if (!m) continue;
    const list = fam.get(m[1]) ?? [];
    list.push({ d, v: Number(m[2]) });
    fam.set(m[1], list);
  }
  return [...fam.values()].flatMap((l) => l.sort((a, b) => b.v - a.v).slice(1).map((x) => x.d));
}

/** The one line for her, only when the disk is still low. */
export function lowDiskLine(freeGb, cleanedGb, biggest) {
  if (freeGb >= LOW_GB) return null;
  return `Mac disk: ${Math.round(freeGb)} GB free; cleaned ${cleanedGb.toFixed(1)} GB; biggest: ${biggest.join(", ") || "nothing stood out"}.`;
}

// ─── Reading the Mac ─────────────────────────────────────────────────────────

const git = (cwd, ...a) => spawnSync("git", ["-C", cwd, ...a], { encoding: "utf8" });
const sizeOf = (p) => { try { return Number(execFileSync("du", ["-sk", p], { encoding: "utf8" }).split("\t")[0]) * 1024; } catch { return 0; } };
const freeGb = () => { try { const l = execFileSync("df", ["-k", "/System/Volumes/Data"], { encoding: "utf8" }).trim().split("\n").pop().split(/\s+/); return Number(l[3]) / 1024 / 1024; } catch { return NaN; } };

function newestMtime(p) {
  let newest = 0;
  for (const name of ["", ".git", "index"].map((n) => path.join(p, n))) { try { newest = Math.max(newest, fs.statSync(name).mtimeMs); } catch { /* none */ } }
  try { for (const e of fs.readdirSync(p).slice(0, 200)) { try { newest = Math.max(newest, fs.statSync(path.join(p, e)).mtimeMs); } catch { /* gone */ } } } catch { /* gone */ }
  const gitFile = path.join(p, ".git");
  try { const gd = fs.readFileSync(gitFile, "utf8").match(/gitdir: (.*)/)?.[1]; if (gd) for (const n of ["index", "HEAD", "logs/HEAD"]) { try { newest = Math.max(newest, fs.statSync(path.join(gd.trim(), n)).mtimeMs); } catch { /* none */ } } } catch { /* main */ }
  return newest;
}

function worktrees() {
  const out = [];
  for (const repo of fs.readdirSync(GITHUB)) {
    const dir = path.join(GITHUB, repo);
    if (!fs.existsSync(path.join(dir, ".git")) || !fs.statSync(path.join(dir, ".git")).isDirectory()) continue;
    const r = git(dir, "worktree", "list", "--porcelain");
    if (r.status !== 0) continue;
    const blocks = r.stdout.trim().split("\n\n");
    blocks.forEach((b, i) => {
      const wt = /^worktree (.*)$/m.exec(b)?.[1];
      if (!wt || !fs.existsSync(wt)) return;
      const dirty = git(wt, "status", "--porcelain", "--untracked-files=no").stdout.trim() !== "";
      const onRemote = git(wt, "branch", "-r", "--contains", "HEAD").stdout.trim() !== "";
      const unpushed = git(wt, "rev-list", "--count", "HEAD", "--not", "--remotes").stdout.trim();
      out.push({ repo, path: wt, main: i === 0, touched_at: newestMtime(wt), dirty, on_remote: onRemote, unpushed: Number(unpushed) || 0 });
    });
  }
  return out;
}

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 900_000 });
  return r.status === 0 ? "ok" : `failed (${String(r.stderr || r.error?.message || r.status).trim().slice(0, 120)})`;
}

async function main() {
  const DRY = process.argv.includes("--dry-run");
  const now = Date.now();
  const before = freeGb();
  const log = [];
  let freed = 0;

  const { remove, list } = pickWorktrees(worktrees(), now);
  for (const t of remove) {
    const bytes = sizeOf(t.path);
    if (!DRY) { const r = git(path.join(GITHUB, t.repo), "worktree", "remove", t.path); if (r.status !== 0) { log.push(`kept ${t.path}: ${r.stderr.trim().slice(0, 100)}`); continue; } }
    freed += bytes; log.push(`${DRY ? "would remove" : "removed"} worktree ${t.path} (${(bytes / 1e9).toFixed(2)} GB)`);
  }
  for (const t of list) log.push(`left alone (unpushed commits: ${t.unpushed}): ${t.path}`);

  const hwk = path.join(GITHUB, "how-we-know");
  let published = [];
  try { published = JSON.parse(fs.readFileSync(path.join(hwk, "research", "published.json"), "utf8")).published ?? []; } catch { log.push("how-we-know publish record not read; no render removed"); }
  const rdir = path.join(hwk, "renders");
  const files = fs.existsSync(rdir) ? fs.readdirSync(rdir).map((name) => ({ name, mtime: fs.statSync(path.join(rdir, name)).mtimeMs })) : [];
  for (const f of pickRenders(files, published, now)) {
    const p = path.join(rdir, f.name);
    if (git(hwk, "ls-files", "--error-unmatch", `renders/${f.name}`).status === 0) continue; // tracked: never
    const bytes = fs.statSync(p).size;
    if (!DRY) fs.rmSync(p);
    freed += bytes; log.push(`${DRY ? "would remove" : "removed"} render ${f.name} (${(bytes / 1e9).toFixed(2)} GB)`);
  }

  const pw = path.join(HOME, "Library", "Caches", "ms-playwright");
  if (fs.existsSync(pw)) for (const d of pickPlaywright(fs.readdirSync(pw))) {
    const p = path.join(pw, d); const bytes = sizeOf(p);
    if (!DRY) fs.rmSync(p, { recursive: true, force: true });
    freed += bytes; log.push(`${DRY ? "would remove" : "removed"} Playwright ${d} (${(bytes / 1e9).toFixed(2)} GB)`);
  }

  if (!DRY) {
    log.push(`npm cache: ${sh("npm", ["cache", "clean", "--force"])}`);
    log.push(`pip cache: ${sh("pip3", ["cache", "purge"])}`);
    log.push(`brew cleanup: ${sh("/opt/homebrew/bin/brew", ["cleanup", "-s"])}`);
  }
  const after = freeGb();
  const cleaned = Number.isFinite(after - before) ? Math.max(after - before, freed / 1e9) : freed / 1e9;
  log.push(`free space: ${before.toFixed(1)} GB before, ${after.toFixed(1)} GB after; cleaned ${cleaned.toFixed(1)} GB`);
  const logDir = path.join(HOME, ".boss-os", "mac-cleanup");
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, `${new Date(now).toISOString().slice(0, 10)}.log`), `${log.join("\n")}\n`);
  for (const l of log) console.log(l);

  const big = ["Library/Caches", "GitHub", "Library/Developer", "Downloads"].map((d) => ({ d, b: sizeOf(path.join(HOME, d)) })).sort((a, b) => b.b - a.b).slice(0, 3).map((x) => `${x.d.split("/").pop()} ${Math.round(x.b / 1e9)} GB`);
  const line = lowDiskLine(after, cleaned, big);
  if (line && !DRY) {
    const { sendAsEmployee } = await import("./notify.mjs");
    const r = await sendAsEmployee("Simone", { to: process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com", subject: `Mac disk: ${Math.round(after)} GB free`, text: line });
    if (!r.ok) { console.error(`NAMED STOP [SEND_REFUSED] the low-disk line was not sent: ${r.error}`); process.exit(9); }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
