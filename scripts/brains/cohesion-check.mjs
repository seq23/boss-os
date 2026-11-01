#!/usr/bin/env node
/**
 * THE MONDAY COHESION CHECK ON THE MAC (owner's Company Brains plan, step 10, 31 Oct 2026).
 *
 * Facts live in three homes: the brains (Boss OS, copied to ~/Brains), each repo's docs, and
 * ~/.claude/CLAUDE.md. Every Monday this checks the whole setup, fixes what it can, and posts what it
 * found to Boss OS (POST /api/boss/brains/cohesion/mac). Simone's Monday email then carries ONE
 * plain line (`cohesionCheckLine`, brain.mjs). It checks:
 *
 *   1. Memory strays: any *.md under ~/.claude/projects/<p>/memory/ other than MEMORY.md is MOVED
 *      (never deleted) into ~/.claude/memory-archive/<date>/<p>/, and said. The home MEMORY.md
 *      growing past an index (MEMORY_INDEX_MAX_LINES) is said, not touched.
 *   2. Repo pointers: an active repo under ~/GitHub (a commit in the last ACTIVE_DAYS days) whose
 *      CLAUDE.md has no "## Company brain" section. Client repos are never named (isClientRepo,
 *      the Email Map's derived list; creator-studios is allowed); git worktrees are skipped.
 *   3. Skills: a ~/.claude/skills/<name>/SKILL.md carrying a phrase that contradicts
 *      ~/.claude/CLAUDE.md (BAD_SKILL_PHRASES). Cheap by design: phrases, not judgement.
 *   4. The local brain copy: ~/Brains older than COPY_MAX_HOURS means com.seq.boss-brains-pull is
 *      broken; it is restarted (launchctl kickstart) and re-measured.
 *
 * Brain staleness (90+ days) is the Worker's half and is folded into the same line there.
 *
 * RULE 0: a part that could not be read is named in `unchecked`, never counted as clean; zero repos
 * or zero skills examined is "could not be checked". If the post fails the script exits non-zero,
 * and the email's line says the Mac check did not run this week (the Worker never fakes all clear).
 *
 *   npm run --silent vault:run -- npm run --silent brains:cohesion          # what launchd runs
 *   node scripts/brains/cohesion-check.mjs --dry-run                         # look only: no moves, no post
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { isClientRepo } from "../ops/lib/email-map.mjs";

const ORIGIN = process.env.BOSS_ORIGIN ?? "https://boss.sequoiataylor.com";
export const HOME_PROJECT = "-Users-sequoiataylor";
export const MEMORY_INDEX_MAX_LINES = 40;
export const ACTIVE_DAYS = 60;
export const COPY_MAX_HOURS = 2;
export const POINTER = /^##\s+Company brain\b/m;
export const PULL_LABEL = "com.seq.boss-brains-pull";

/** Phrases a skill must not carry, each contradicting a rule in ~/.claude/CLAUDE.md. */
export const BAD_SKILL_PHRASES = Object.freeze([
  { phrase: "human merge gate", why: "approval covers the whole arc; merge on green" },
  { phrase: "human approval is still required before merge", why: "approval covers the whole arc; merge on green" },
  { phrase: "ZIP deliverable", why: "deliverables are landed, not zipped" },
  { phrase: "deliver a ZIP", why: "deliverables are landed, not zipped" },
  { phrase: "as a ZIP", why: "deliverables are landed, not zipped" },
  { phrase: "Fable agent", why: "agents run on Opus unless she names Fable" },
  { phrase: "Fable for every agent", why: "agents run on Opus unless she names Fable" },
]);

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const mdUnder = (dir) => {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...mdUnder(p));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
};

/** 1. Memory strays, moved into the archive (unless dryRun). */
export function checkMemory({ home, today, dryRun = false }) {
  const projects = join(home, ".claude", "projects");
  const strays_moved = [];
  if (!isDir(projects)) return { strays_moved, memory_index_lines: 0, memory_index_too_big: false, unchecked: ["memory"] };
  for (const p of readdirSync(projects)) {
    const mem = join(projects, p, "memory");
    if (!isDir(mem)) continue;
    for (const f of mdUnder(mem)) {
      if (f === join(mem, "MEMORY.md")) continue;
      const rel = f.slice(mem.length + 1);
      let to = join(home, ".claude", "memory-archive", today, p, rel);
      if (existsSync(to)) to = to.replace(/\.md$/, `.${Date.now()}.md`);
      if (!dryRun) {
        mkdirSync(join(to, ".."), { recursive: true });
        renameSync(f, to);
      }
      strays_moved.push({ from: f.replace(home, "~"), to: to.replace(home, "~") });
    }
  }
  const index = join(projects, HOME_PROJECT, "memory", "MEMORY.md");
  const memory_index_lines = existsSync(index) ? readFileSync(index, "utf8").split("\n").filter((l) => l.trim()).length : 0;
  return { strays_moved, memory_index_lines, memory_index_too_big: memory_index_lines > MEMORY_INDEX_MAX_LINES, unchecked: [] };
}

/** 2. Active repos without a "## Company brain" section. `lastCommit(dir)` → epoch ms or null. */
export function checkRepos({ home, now = Date.now(), lastCommit = gitLastCommit }) {
  const root = join(home, "GitHub");
  if (!isDir(root)) return { repos_checked: 0, repos_missing_pointer: [], unchecked: ["the repos"] };
  const missing = [];
  let checked = 0;
  for (const name of readdirSync(root).sort()) {
    const dir = join(root, name);
    if (!isDir(join(dir, ".git"))) continue; // not a repo, or a worktree (its .git is a file)
    if (isClientRepo(name)) continue; // never named in Boss OS
    const at = lastCommit(dir);
    if (!at || now - at > ACTIVE_DAYS * 86_400_000) continue;
    checked++;
    const claude = join(dir, "CLAUDE.md");
    if (!existsSync(claude) || !POINTER.test(readFileSync(claude, "utf8"))) missing.push(name);
  }
  return { repos_checked: checked, repos_missing_pointer: missing, unchecked: checked ? [] : ["the repos"] };
}

function gitLastCommit(dir) {
  try { return Number(execFileSync("git", ["-C", dir, "log", "-1", "--format=%ct"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()) * 1000 || null; } catch { return null; }
}

/** 3. Skills carrying a phrase that contradicts the house rules. */
export function checkSkills({ home }) {
  const root = join(home, ".claude", "skills");
  const flagged = [];
  let checked = 0;
  if (isDir(root)) {
    for (const name of readdirSync(root).sort()) {
      const f = join(root, name, "SKILL.md");
      if (!existsSync(f)) continue;
      checked++;
      const text = readFileSync(f, "utf8").toLowerCase();
      for (const b of BAD_SKILL_PHRASES) if (text.includes(b.phrase.toLowerCase())) flagged.push({ skill: name, phrase: b.phrase });
    }
  }
  return { skills_checked: checked, skills_flagged: flagged, unchecked: checked ? [] : ["the skills"] };
}

/** Age in hours of the newest file in ~/Brains, or null when there is none. */
export function copyAgeHours(home, now = Date.now()) {
  const dir = join(home, "Brains");
  if (!isDir(dir)) return null;
  const times = readdirSync(dir).filter((n) => n.endsWith(".md")).map((n) => statSync(join(dir, n)).mtimeMs);
  return times.length ? (now - Math.max(...times)) / 3_600_000 : null;
}

/** 4. The local copy: stale → restart the pull job and re-measure (`restart` and `wait` injectable). */
export async function checkCopy({ home, restart = kickstart, wait = waitForCopy }) {
  const age = copyAgeHours(home);
  if (age != null && age <= COPY_MAX_HOURS) return { copy_age_hours: round(age), copy_restarted: false, copy_fresh_after: true };
  restart();
  const after = await wait(home);
  return { copy_age_hours: age == null ? null : round(age), copy_restarted: true, copy_fresh_after: after != null && after <= COPY_MAX_HOURS };
}
const round = (n) => Math.round(n * 10) / 10;

function kickstart() {
  try { execFileSync("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/${PULL_LABEL}`], { stdio: "ignore" }); } catch { /* re-measured below */ }
}

/** One bounded wait (up to 3 minutes) for the pull to write. */
async function waitForCopy(home) {
  for (let i = 0; i < 36; i++) {
    const age = copyAgeHours(home);
    if (age != null && age <= COPY_MAX_HOURS) return age;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return copyAgeHours(home);
}

/** Every check, merged into the record the Worker keeps. */
export async function runChecks({ home = homedir(), now = Date.now(), dryRun = false, lastCommit, restart, wait } = {}) {
  const today = new Date(now).toISOString().slice(0, 10);
  const m = checkMemory({ home, today, dryRun });
  const r = checkRepos({ home, now, ...(lastCommit ? { lastCommit } : {}) });
  const s = checkSkills({ home });
  const age = copyAgeHours(home);
  const c = dryRun ? { copy_age_hours: age == null ? null : round(age), copy_restarted: false, copy_fresh_after: age != null && age <= COPY_MAX_HOURS }
    : await checkCopy({ home, ...(restart ? { restart } : {}), ...(wait ? { wait } : {}) });
  return { ...m, ...r, ...s, ...c, unchecked: [...m.unchecked, ...r.unchecked, ...s.unchecked] };
}

export async function post(record, { passcode = process.env.BOSS_PASSCODE, fetchImpl = fetch, origin = ORIGIN } = {}) {
  if (!passcode) throw Object.assign(new Error("NAMED STOP [NO_PASSCODE] BOSS_PASSCODE is not set; the caller injects it from the vault."), { code: 3 });
  const u = await fetchImpl(`${origin}/api/boss/auth/unlock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode }) });
  if (!u.ok) throw Object.assign(new Error(`NAMED STOP [UNLOCK_REFUSED] Boss OS refused the passcode (${u.status}).`), { code: 3 });
  const cookie = (u.headers.get("set-cookie") ?? "").split(";")[0];
  const r = await fetchImpl(`${origin}/api/boss/brains/cohesion/mac`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(record) });
  if (!r.ok) throw Object.assign(new Error(`NAMED STOP [NOT_RECORDED] Boss OS did not keep the check (${r.status}).`), { code: 2 });
  return (await r.json()).data;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dryRun = process.argv.includes("--dry-run");
  runChecks({ dryRun })
    .then(async (rec) => {
      for (const s of rec.strays_moved) console.log(`memory: ${dryRun ? "would move" : "moved"} ${s.from} → ${s.to}`);
      console.log(`memory: ${rec.strays_moved.length} strays; index ${rec.memory_index_lines} lines${rec.memory_index_too_big ? " (too big)" : ""}`);
      console.log(`repos: ${rec.repos_checked} active checked; missing pointer: ${rec.repos_missing_pointer.join(", ") || "none"}`);
      console.log(`skills: ${rec.skills_checked} checked; flagged: ${rec.skills_flagged.map((f) => `${f.skill} ("${f.phrase}")`).join(", ") || "none"}`);
      console.log(`brains copy: ${rec.copy_age_hours ?? "none"} h old${rec.copy_restarted ? `; restarted, ${rec.copy_fresh_after ? "fresh now" : "still stale"}` : ""}`);
      if (rec.unchecked.length) console.log(`unchecked: ${rec.unchecked.join(", ")}`);
      if (dryRun) return;
      const out = await post(rec);
      console.log(`cohesion: ${out.line}`);
    })
    .catch((e) => { console.error(e.message); process.exit(e.code ?? 1); });
}

