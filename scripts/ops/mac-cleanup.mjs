#!/usr/bin/env node
/**
 * KENDRA: KEEP THE MAC'S DISK FROM FILLING UP (owner-approved 26 Oct 2026). Daily 09:00 Central
 * (weekly until 3 Nov 2026, when the Mac hit a watchdog panic on low swap with 15 GB free, 11 GB of it
 * How We Know render working folders), launchd com.seq.boss-mac-cleanup through duty-run.sh →
 * duty_mac_cleanup.
 *
 * What it removes, and only this:
 *   · git worktrees under ~/GitHub older than 24 h, with no uncommitted tracked change, whose HEAD is
 *     on a remote branch (`git worktree remove`). A worktree anything touched in the last 24 h is
 *     never touched; one with unpushed commits is LISTED, never removed.
 *   · `npm cache clean --force`, `pip3 cache purge`, `brew cleanup -s`.
 *   · how-we-know renders/*.mp4 older than 14 days, ONLY for an episode the repo's own publish record
 *     (research/published.json) lists; the .json sidecars stay.
 *   · old ms-playwright browser versions, keeping the newest of each.
 *   · how-we-know render WORKING folders (3 Nov 2026): every `*.work` dir in renders/ and
 *     renders/food/<ep>/, and every 12-hex script-sha dir in renders/food/<ep>/ (loop/food_lane.py's
 *     work dir), ONLY when its newest file is over 48 h old, the episode's renders/<ep>-final.mp4
 *     exists (stitch is the lane's last stage, so nothing resumes from it after that), and no running
 *     ffmpeg / batch-session / food-session / assemble process names its path or episode.
 * Never ~/.Trash: that is hers. Over 2 GB in the Trash or under 20 GB free → one macOS notification
 * ("Mac space"), at most once a day. Every run logs a census line: free disk, swap, Trash.
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
export const TRASH_GB = 2;
const WORK_AGE = 2 * DAY;
const HEX_DIR = /^[0-9a-f]{12}$/;

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

/**
 * Which render working folders go (pure). Each: { path, rel, kind: "work"|"hash", episode, final,
 * newest } where `final` says renders/<episode>-final.mp4 exists and `newest` is the newest mtime
 * inside it. `procs` is the pgrep -fl lines of every render process; null means they were not read,
 * and then nothing goes. Kept: no final, anything touched in the last 48 h, anything a process names.
 */
export function pickRenderWork(dirs, procs, now = Date.now()) {
  if (!Array.isArray(procs)) return [];
  return dirs.filter((d) => {
    if (!d.final || forbidden(d.path)) return false;
    if (!Number.isFinite(d.newest) || now - d.newest < WORK_AGE) return false;
    if (d.kind === "hash" && !HEX_DIR.test(path.basename(d.path))) return false;
    if (d.kind === "work" && !/\.work$/.test(d.path)) return false;
    return !procs.some((l) => [d.path, d.rel, d.episode].some((n) => n && l.includes(n)));
  });
}

/** The episode a top-level renders/<x>.work belongs to: assemble.py writes <out>.mp4 → <out>.mp4.work. */
export const workEpisode = (name) => name.replace(/\.work$/, "").replace(/\.mp4$/i, "").replace(/-final$/, "");

/** The macOS notification for her (pure), or null. Trash over 2 GB, or under 20 GB free. */
export function spaceNotice(freeGb, trashGb) {
  const trashBig = Number.isFinite(trashGb) && trashGb > TRASH_GB;
  const low = Number.isFinite(freeGb) && freeGb < LOW_GB;
  if (!trashBig && !low) return null;
  if (!low) return `Empty the Trash to get back ${trashGb.toFixed(1)} GB`;
  if (trashBig) return `Mac disk: ${Math.round(freeGb)} GB free — empty the Trash to get back ${trashGb.toFixed(1)} GB`;
  if (Number.isFinite(trashGb) && trashGb < 0.1) return `Mac disk: ${Math.round(freeGb)} GB free (the Trash is already empty)`;
  return `Mac disk: ${Math.round(freeGb)} GB free — empty the Trash`;
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
export function lowDiskLine(freeGb, cleanedGb, biggest, trashGb) {
  if (freeGb >= LOW_GB) return null;
  // In words (6 Nov 2026 live read: "Trash not read; biggest: GitHub 63 gb, Downloads 0 gb").
  const trash = Number.isFinite(trashGb) ? ` Your Trash holds ${trashGb.toFixed(1)} GB; emptying it frees that.` : "";
  const big = biggest.filter((b) => !/\b0 GB$/.test(b));
  return `Mac disk: ${Math.round(freeGb)} GB free after today's clean-up, which cleared ${cleanedGb.toFixed(1)} GB.${trash} Biggest folders: ${big.join(", ") || "nothing stood out"}.`;
}

// ─── Reading the Mac ─────────────────────────────────────────────────────────

const git = (cwd, ...a) => spawnSync("git", ["-C", cwd, ...a], { encoding: "utf8" });
const sizeOf = (p) => { try { return Number(execFileSync("du", ["-sk", p], { encoding: "utf8" }).split("\t")[0]) * 1024; } catch { return 0; } };
const freeGb = () => { try { const l = execFileSync("df", ["-k", "/System/Volumes/Data"], { encoding: "utf8" }).trim().split("\n").pop().split(/\s+/); return Number(l[3]) / 1024 / 1024; } catch { return NaN; } };

/** Newest mtime anywhere under p (the dir itself included, so an empty dir has its own age). */
function newestUnder(p) {
  let newest = 0;
  const stack = [p];
  while (stack.length) {
    const d = stack.pop();
    let st; try { st = fs.lstatSync(d); } catch { continue; }
    newest = Math.max(newest, st.mtimeMs);
    if (st.isDirectory()) { try { for (const e of fs.readdirSync(d)) stack.push(path.join(d, e)); } catch { /* gone */ } }
  }
  return newest;
}

/** Every render working folder, with what pickRenderWork needs. */
function renderWorkDirs(rdir) {
  const out = [];
  const isDir = (p) => { try { return fs.lstatSync(p).isDirectory(); } catch { return false; } };
  const add = (p, kind, episode) => out.push({ path: p, rel: path.relative(path.dirname(rdir), p), kind, episode, final: fs.existsSync(path.join(rdir, `${episode}-final.mp4`)), newest: newestUnder(p) });
  if (!isDir(rdir)) return out;
  for (const n of fs.readdirSync(rdir)) if (n.endsWith(".work") && isDir(path.join(rdir, n))) add(path.join(rdir, n), "work", workEpisode(n));
  const food = path.join(rdir, "food");
  if (isDir(food)) for (const ep of fs.readdirSync(food)) {
    const e = path.join(food, ep);
    if (!isDir(e)) continue;
    for (const n of fs.readdirSync(e)) {
      const p = path.join(e, n);
      if (!isDir(p)) continue;
      if (n.endsWith(".work")) add(p, "work", ep);
      else if (HEX_DIR.test(n)) add(p, "hash", ep);
    }
  }
  return out;
}

/** Command lines of every render process; null when pgrep itself failed (then nothing is removed). */
function renderProcs() {
  const r = spawnSync("pgrep", ["-fl", "ffmpeg|batch-session|food-session|food_lane|food_episode|assemble"], { encoding: "utf8" });
  if (r.status === 1) return [];
  if (r.status !== 0) return null;
  return r.stdout.split("\n").filter(Boolean);
}

/** Bytes in ~/.Trash, read only. du first; macOS privacy can refuse that, then Finder is asked. */
function trashBytes() {
  try { return Number(execFileSync("du", ["-sk", path.join(HOME, ".Trash")], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\t")[0]) * 1024; } catch { /* privacy */ }
  const script = 'tell application "Finder"\nset s to 0\nrepeat with i in (items of trash)\ntry\nset s to s + (size of i)\nend try\nend repeat\nreturn s as text\nend tell';
  const r = spawnSync("osascript", ["-e", script], { encoding: "utf8", timeout: 60_000 });
  const n = Number(String(r.stdout).trim().replace(/,/g, ""));
  return r.status === 0 && Number.isFinite(n) ? n : NaN;
}

function swapLine() {
  try { return execFileSync("sysctl", ["-n", "vm.swapusage"], { encoding: "utf8" }).trim().replace(/\s+/g, " "); } catch { return "not read"; }
}

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

  const procs = renderProcs();
  if (procs === null) log.push("render processes not read (pgrep failed); no render working folder removed");
  for (const d of pickRenderWork(renderWorkDirs(rdir), procs, now)) {
    const bytes = sizeOf(d.path);
    if (!DRY) fs.rmSync(d.path, { recursive: true, force: true });
    freed += bytes; log.push(`${DRY ? "would remove" : "removed"} render working folder ${d.rel} (${(bytes / 1e9).toFixed(2)} GB)`);
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
  const trashGb = trashBytes() / 1e9;
  log.push(`census: free ${after.toFixed(1)} GB; swap ${swapLine()}; Trash ${Number.isFinite(trashGb) ? `${trashGb.toFixed(1)} GB` : "not read"}`);
  const logDir = path.join(HOME, ".boss-os", "mac-cleanup");
  fs.mkdirSync(logDir, { recursive: true });
  const notice = spaceNotice(after, trashGb);
  const today = new Date(now).toISOString().slice(0, 10);
  const stamp = path.join(logDir, "notified-on");
  if (notice && !DRY) {
    let last = ""; try { last = fs.readFileSync(stamp, "utf8").trim(); } catch { /* never */ }
    if (last === today) log.push(`notification already shown today: ${notice}`);
    else {
      const r = spawnSync("osascript", ["-e", `display notification ${JSON.stringify(notice)} with title "Mac space"`], { encoding: "utf8", timeout: 30_000 });
      if (r.status === 0) { fs.writeFileSync(stamp, `${today}\n`); log.push(`notified: ${notice}`); }
      else log.push(`notification NOT shown (${String(r.stderr || r.status).trim().slice(0, 100)}): ${notice}`);
    }
  }
  fs.writeFileSync(path.join(logDir, `${new Date(now).toISOString().slice(0, 10)}.log`), `${log.join("\n")}\n`);
  for (const l of log) console.log(l);

  const big = ["Library/Caches", "GitHub", "Library/Developer", "Downloads"].map((d) => ({ d, b: sizeOf(path.join(HOME, d)) })).sort((a, b) => b.b - a.b).slice(0, 3).map((x) => `${x.d.split("/").pop()} ${Math.round(x.b / 1e9)} GB`);
  const line = lowDiskLine(after, cleaned, big, trashGb);
  if (line && !DRY) {
    const { sendAsEmployee } = await import("./notify.mjs");
    const r = await sendAsEmployee("Simone", { to: process.env.BOSS_NOTIFY_TO ?? "seq.taylor@gmail.com", subject: `Mac disk: ${Math.round(after)} GB free`, text: line });
    if (!r.ok) { console.error(`NAMED STOP [SEND_REFUSED] the low-disk line was not sent: ${r.error}`); process.exit(9); }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
