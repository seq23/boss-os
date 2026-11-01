/**
 * THE MONDAY COHESION CHECK (owner's Company Brains plan, step 10). The Mac half
 * (scripts/brains/cohesion-check.mjs) on a synthetic home directory, and the one line Simone's
 * Monday email reads (cohesionCheckLine). Rule 0: no Mac record this week never reads "all clear".
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMemory, checkRepos, checkSkills, checkCopy, checkRestating, runChecks, MEMORY_INDEX_MAX_LINES } from "../scripts/brains/cohesion-check.mjs";
import { cohesionCheckLine, cohesionLine } from "../src/shared/boss/brains/brain.mjs";

const NOW = Date.parse("2026-11-02T12:05:00Z");
const DAY = 86_400_000;
const put = (p: string, text = "x\n") => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, text); };

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), "cohesion-"));
  const mem = join(home, ".claude", "projects", "-Users-sequoiataylor", "memory");
  put(join(mem, "MEMORY.md"), "# index\n- a\n");
  put(join(mem, "stray_fact.md"), "a fact with no home\n");
  put(join(home, ".claude", "projects", "-Users-other", "memory", "sub", "old.md"));
  // Repos: one with a pointer, one without, one quiet, one worktree, one client.
  for (const r of ["has-pointer", "no-pointer", "quiet-repo", "horse-legal-guide-velocity"]) mkdirSync(join(home, "GitHub", r, ".git"), { recursive: true });
  put(join(home, "GitHub", "has-pointer", "CLAUDE.md"), "# x\n\n## Company brain\nRead ~/Brains/spry.md first.\n");
  put(join(home, "GitHub", "no-pointer", "CLAUDE.md"), "# x\n");
  put(join(home, "GitHub", "a-worktree", ".git"), "gitdir: elsewhere\n");
  // Skills: one clean, one carrying a phrase that contradicts the house rules.
  put(join(home, ".claude", "skills", "clean", "SKILL.md"), "Merge on green.\n");
  put(join(home, ".claude", "skills", "old-gate", "SKILL.md"), "A Human merge gate applies.\n");
  put(join(home, "Brains", "team.md"));
  put(join(home, "Brains", "personal.md"), "# Personal\n## Repo categories\n**Mine**\n- Biz: has-pointer, no-pointer, quiet-repo\n**Friends & clients**\n- Friends: horse-legal-guide-velocity (Claire)\n**The system**\n- boss-os\n");
  return home;
}
const lastCommit = (dir: string) => (dir.endsWith("quiet-repo") ? NOW - 400 * DAY : NOW - DAY);

describe("the Mac half", () => {
  it("moves every memory stray into the dated archive, never deletes, and leaves MEMORY.md", () => {
    const home = fakeHome();
    const r = checkMemory({ home, today: "2026-11-02" });
    expect(r.strays_moved).toHaveLength(2);
    const archived = join(home, ".claude", "memory-archive", "2026-11-02", "-Users-sequoiataylor", "stray_fact.md");
    expect(readFileSync(archived, "utf8")).toBe("a fact with no home\n");
    expect(existsSync(join(home, ".claude", "projects", "-Users-other", "memory", "sub", "old.md"))).toBe(false);
    expect(existsSync(join(home, ".claude", "memory-archive", "2026-11-02", "-Users-other", "sub", "old.md"))).toBe(true);
    expect(existsSync(join(home, ".claude", "projects", "-Users-sequoiataylor", "memory", "MEMORY.md"))).toBe(true);
    expect(r.memory_index_too_big).toBe(false);
    put(join(home, ".claude", "projects", "-Users-sequoiataylor", "memory", "MEMORY.md"), Array.from({ length: MEMORY_INDEX_MAX_LINES + 1 }, (_, i) => `- ${i}`).join("\n"));
    expect(checkMemory({ home, today: "2026-11-02" }).memory_index_too_big).toBe(true);
  });

  it("dry run moves nothing", () => {
    const home = fakeHome();
    expect(checkMemory({ home, today: "2026-11-02", dryRun: true }).strays_moved).toHaveLength(2);
    expect(existsSync(join(home, ".claude", "projects", "-Users-sequoiataylor", "memory", "stray_fact.md"))).toBe(true);
  });

  it("names active repos missing the pointer; skips quiet repos, worktrees and client repos", () => {
    const r = checkRepos({ home: fakeHome(), now: NOW, lastCommit });
    expect(r.repos_missing_pointer).toEqual(["no-pointer"]);
    expect(r.repos_checked).toBe(2);
    expect(r.unchecked).toEqual([]);
  });

  it("flags a skill carrying a known-bad phrase, case-insensitively", () => {
    const r = checkSkills({ home: fakeHome() });
    expect(r.skills_checked).toBe(2);
    expect(r.skills_flagged).toEqual([{ skill: "old-gate", phrase: "human merge gate" }]);
  });

  it("flags a skill line that copies a house rule or a brain's settled decision, never one that points to it", () => {
    const home = fakeHome();
    put(join(home, ".claude", "CLAUDE.md"), "# rules\n- **Agents never spend money**: prepare everything up to checkout and let her or Scooter pay for it.\n");
    put(join(home, "Brains", "spry.md"), "# Spry\n## Settled decisions\n- Outreach is signed by S.L. Taylor on every local guide and every follow up email.\n## Open questions\n- the colour of the new studio logo and the domain to buy next\n");
    put(join(home, ".claude", "skills", "copier", "SKILL.md"), "intro\nRemember: agents never spend money, prepare everything up to checkout and let her or Scooter pay.\nOutreach is signed by S.L. Taylor on every local guide and every follow up.\nThe colour of the new studio logo and the domain to buy next matter here a lot.\n");
    put(join(home, ".claude", "skills", "pointer", "SKILL.md"), "Rules: follow ~/.claude/CLAUDE.md (Do it yourself) and the brain's Settled decisions; this skill is only the how-to.\n");
    const r = checkRestating({ home });
    expect(r.unchecked).toEqual([]);
    expect(r.skills_restating).toEqual([
      { skill: "copier", line: 2, source: "CLAUDE.md" },
      { skill: "copier", line: 3, source: "the spry brain" },
    ]);
    // Rule 0: with no rules to compare against it is "could not be checked", never clean.
    const bare = mkdtempSync(join(tmpdir(), "cohesion-"));
    expect(checkRestating({ home: bare }).unchecked).toHaveLength(1);
  });

  it("restarts a stale brain copy and re-measures it", async () => {
    const home = fakeHome();
    const f = join(home, "Brains", "team.md");
    for (const g of [f, join(home, "Brains", "personal.md")]) utimesSync(g, new Date(Date.now() - 5 * 3_600_000), new Date(Date.now() - 5 * 3_600_000));
    let kicked = 0;
    const r = await checkCopy({ home, restart: () => { kicked++; utimesSync(f, new Date(), new Date()); }, wait: async () => 0 });
    expect(kicked).toBe(1);
    expect(r).toMatchObject({ copy_restarted: true, copy_fresh_after: true });
    expect(r.copy_age_hours).toBeGreaterThan(4);
    const fresh = await checkCopy({ home, restart: () => { throw new Error("must not restart a fresh copy"); } });
    expect(fresh.copy_restarted).toBe(false);
  });

  it("Rule 0: an empty home is 'could not be checked', never clean", async () => {
    const home = mkdtempSync(join(tmpdir(), "cohesion-empty-"));
    const r = await runChecks({ home, now: NOW, restart: () => {}, wait: async () => null });
    expect(r.unchecked).toEqual(["memory", "the repos", "the skills", "the house rules"]);
    expect(cohesionCheckLine([], r, NOW)).not.toMatch(/all clear/);
  });
});

describe("the one line in Simone's Monday email", () => {
  const brain = (slug: string, title: string, age: number) => ({ slug, title, body_md: "# x", updated_at: NOW - age * DAY });
  const fresh = [brain("spry", "Spry", 1)];
  const clean = { strays_moved: [], repos_missing_pointer: [], skills_flagged: [], copy_restarted: false, copy_fresh_after: true, unchecked: [] };

  it("all clear only when the Mac ran this week and nothing is wrong", () => {
    expect(cohesionCheckLine(fresh, clean, NOW)).toBe("Cohesion: all clear");
  });

  it("Rule 0 (negative proof): no Mac record this week says so and never says all clear", () => {
    const line = cohesionCheckLine(fresh, null, NOW);
    expect(line).toMatch(/^Cohesion: the Mac's weekly check did not run this week/);
    expect(line).not.toMatch(/all clear/);
  });

  it("says what it fixed and what it could not, in plain words", () => {
    const mac = { ...clean, strays_moved: [{ from: "a", to: "b" }, { from: "c", to: "d" }], repos_missing_pointer: ["dream-wedding-builder"] };
    expect(cohesionCheckLine(fresh, mac, NOW)).toBe("Cohesion: moved 2 stray memory notes to the archive; the dream-wedding-builder repo is missing its brain pointer");
    expect(cohesionCheckLine(fresh, { ...clean, strays_moved: [{ from: "a", to: "b" }], copy_restarted: true, copy_fresh_after: true }, NOW))
      .toBe("Cohesion: all clear (moved 1 stray memory note to the archive and restarted the hourly brain copy)");
    expect(cohesionCheckLine(fresh, { ...clean, skills_flagged: [{ skill: "old-gate", phrase: "human merge gate" }] }, NOW)).toBe("Cohesion: the old-gate skill has a rule that contradicts the house rules");
    expect(cohesionCheckLine(fresh, { ...clean, repos_missing_pointer: ["a", "b", "c", "d", "e"] }, NOW)).toBe("Cohesion: 5 repos are missing their brain pointer (a, b, c and 2 more)");
    expect(cohesionCheckLine(fresh, { ...clean, copy_restarted: true, copy_fresh_after: false, copy_age_hours: 7 }, NOW)).toBe("Cohesion: the brain copy on the Mac is 7 hours old and a restart did not bring it back");
  });

  it("says skill lines that copy a rule in the same one line, without blocking anything else", () => {
    const line = cohesionCheckLine(fresh, { ...clean, skills_restating: [{ skill: "a", line: 3, source: "CLAUDE.md" }, { skill: "b", line: 9, source: "the spry brain" }] }, NOW);
    expect(line).not.toMatch(/all clear/);
    expect(line).toMatch(/2 skill lines/);
    expect(line).toMatch(/\(a and b\)|a, b/);
    expect(line.split("\n")).toHaveLength(1);
  });

  it("reuses the brains line's staleness words", () => {
    const stale = [brain("porch-and-party", "Porch & Party", 94)];
    expect(cohesionLine(stale, NOW)).toBe("Brains: P&P brain not updated in 94 days");
    expect(cohesionCheckLine(stale, clean, NOW)).toBe("Cohesion: P&P brain not updated in 94 days");
  });

  it("carries no jargon a non-technical reader would trip on", () => {
    const worst = cohesionCheckLine([brain("spry", "Spry", 200)], { ...clean, strays_moved: [{ from: "a", to: "b" }], memory_index_too_big: true, memory_index_lines: 90, repos_missing_pointer: ["x"], skills_flagged: [{ skill: "y", phrase: "z" }], unchecked: ["the skills"] }, NOW);
    expect(worst).not.toMatch(/launchd|plist|\.md|SKILL|CLAUDE|~\/|null|undefined|NaN|\[object/);
  });
});

describe("the schedule and the rule are the code's", () => {
  const sh = readFileSync(join(__dirname, "..", "scripts", "ops", "install-agent-launchd.sh"), "utf8");
  const claude = readFileSync(join(__dirname, "..", "CLAUDE.md"), "utf8");
  it("the installer writes the Sunday 18:45 Central job (rebalanced week, 1 Nov 2026) and verifies it", () => {
    const stanza = sh.slice(sh.indexOf('COHESION_LABEL="com.seq.boss-cohesion"'), sh.indexOf("COHEOF\nlaunchctl"));
    expect(stanza).toContain("npm run --silent brains:cohesion");
    // Hours in the installer are CENTRAL (lint_plist moves them to the Mac's zone): Sunday 18:45.
    expect(stanza).toMatch(/<key>Weekday<\/key><integer>0<\/integer><key>Hour<\/key><integer>18<\/integer><key>Minute<\/key><integer>45<\/integer>/);
    expect(stanza).not.toMatch(/<key>Weekday<\/key><integer>1<\/integer>/);
    expect(sh).toContain('require_loaded "$COHESION_LABEL"');
    expect(sh).toContain('require_loaded "$BRAINS_PULL_LABEL"');
  });
  it("CLAUDE.md's Brains rule 8 names the job, the endpoint and the Rule 0 words the code says", () => {
    expect(claude).toContain("`com.seq.boss-cohesion`");
    expect(claude).toContain("POST /api/boss/brains/cohesion/mac");
    expect(cohesionCheckLine([], null, NOW)).toContain("the Mac's weekly check did not run this week");
    expect(claude).toContain("the Mac's weekly check did not run this week");
  });
});
