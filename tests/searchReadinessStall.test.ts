/**
 * A ROUND THAT LANDS A FIX IS NOT A STALL (30 Oct 2026) — the guard.
 *
 * CONFIRMED (~/Library/Logs/boss-sr-fix/2026-10-30-073002.log): local-guides-generator's round 3
 * landed PR #139 (`fixed=4 fixed_pr=4`, `LAND ... landed`), but a6's sitemap `lastmod` dates only
 * move when the site rebuilds — five hours after the merge they had not — so the live re-audit found
 * the same four briefs still failing and the run called the round "fixed nothing" and stopped with
 * `SR_QUEUE_STALLED`, 12 briefs left, while four of them were already fixed and on main.
 *
 * This runs the REAL scripts/ops/search-readiness-fix.sh and the REAL scripts/ops/site-audit-lib.mjs
 * (so `landed-ids` really reads a scoped findings.json, deriving the same `sr-<domain>-<item>` id
 * `findingItemId` uses, the way `repo_worker` does it) against a fake planner and a fake per-round
 * fixer, and fails if: a round that landed a fix but could not yet see it live is called a stall; a
 * landed-but-unrepublished brief is ever handed out again as workable; or a round that truly fixed
 * nothing (the negative) stops being called a stall.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Two briefs on one repo: `sr-big.com-a6` and `sr-big.com-b1` — the real fix-queue id shape. */
function buildRepo(home: string, { neverLands = false } = {}) {
  const repo = join(home, "boss-os");
  for (const d of ["scripts/ops/lib", "src/shared/boss/siteAudit", "src/shared/boss/searchReadiness"]) {
    mkdirSync(join(repo, d), { recursive: true });
  }
  copyFileSync("scripts/ops/search-readiness-fix.sh", join(repo, "scripts/ops/search-readiness-fix.sh"));
  copyFileSync("scripts/ops/lib/net-wait.sh", join(repo, "scripts/ops/lib/net-wait.sh"));
  // The real deterministic half: `landed-ids` must really read a scoped findings.json, so the shell
  // orchestration (collect → merge → re-plan) is proven end to end, not just the bash arithmetic.
  copyFileSync("scripts/ops/site-audit-lib.mjs", join(repo, "scripts/ops/site-audit-lib.mjs"));
  copyFileSync("src/shared/boss/siteAudit/repoPolicy.mjs", join(repo, "src/shared/boss/siteAudit/repoPolicy.mjs"));
  copyFileSync("src/shared/boss/siteAudit/evidence.mjs", join(repo, "src/shared/boss/siteAudit/evidence.mjs"));
  copyFileSync("src/shared/boss/siteAudit/domainRepos.mjs", join(repo, "src/shared/boss/siteAudit/domainRepos.mjs"));
  writeFileSync(join(repo, "src/shared/boss/searchReadiness/sites.json"), JSON.stringify({ grid_repos: [] }));
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "stub", scripts: { "sites:audit": "true" } }));

  // The fixer pass: round 1 (first call) lands the a6 brief; every call after reports nothing fixed —
  // unless neverLands, which never lands anything, the NEGATIVE (a genuine stall on round 1).
  writeFileSync(join(repo, "scripts/ops/ahrefs-audit-fix.sh"), `#!/bin/bash
COUNT_FILE="\${HOME}/ahrefs-calls.count"
N=0; [ -f "$COUNT_FILE" ] && N=$(cat "$COUNT_FILE")
N=$((N+1)); echo "$N" > "$COUNT_FILE"
OUT_DIR="\${HOME}/.boss-os/site-audit/sr-\${SR_SCOPE_REPO}"
mkdir -p "$OUT_DIR"
if [ "$N" -eq 1 ] && [ "${neverLands ? 1 : 0}" -eq 0 ]; then
  cat > "$OUT_DIR/findings.json" <<'JSON'
{"findings":[{"disposition":"fixed_pr","land":"landed","project":"checklist:big.com","headline":"a6: stop sitemap index dates following the build clock","repo":"big"}]}
JSON
else
  echo '{"findings":[]}' > "$OUT_DIR/findings.json"
fi
exit 0
`);
  chmodSync(join(repo, "scripts/ops/ahrefs-audit-fix.sh"), 0o755);

  // The planner: two briefs on repo "big", total never changes (the live site has not rebuilt yet),
  // but whatever is in the set-aside file is never handed out again — exactly what
  // search-readiness-audit.mjs itself now does; read here off the same default path (no env export
  // needed) so the test proves the real file's content, not a bash arithmetic fiction.
  writeFileSync(join(repo, "scripts/ops/search-readiness-audit.mjs"), `
import { existsSync, readFileSync } from "node:fs";
const ALL = ["sr-big.com-a6", "sr-big.com-b1"];
const asideFile = process.env.SR_SET_ASIDE_FILE || (process.env.HOME + "/.boss-os/search-readiness/landed-this-run.json");
let aside = [];
if (existsSync(asideFile)) { try { aside = JSON.parse(readFileSync(asideFile, "utf8")); } catch {} }
const workable = ALL.filter((id) => !aside.includes(id));
if (workable.length) console.log("CHUNK big " + workable.length + " " + workable.join(","));
console.log("QUEUE total=" + ALL.length + " workable=" + workable.length + " protected=0 no_repo=0 awaiting_republish=" + aside.length);
`);
  writeFileSync(join(repo, "src/shared/boss/searchReadiness/audit.mjs"), "export const queueRunLine = () => 'ok';\n");
  return repo;
}

function runDriver(home: string, repo: string) {
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "curl"), "#!/bin/bash\nprintf 200\n");
  chmodSync(join(bin, "curl"), 0o755);
  const env: Record<string, string> = { ...(process.env as Record<string, string>), HOME: home, BOSS_OS_REPO: repo, PATH: `${bin}:${process.env.PATH}`, SR_PARALLEL: "1" };
  return spawnSync("/bin/bash", [join(repo, "scripts/ops/search-readiness-fix.sh")], { env, cwd: repo, encoding: "utf8", timeout: 60000 });
}

function mktempHome() {
  return mkdtempSync(join(tmpdir(), "srstall-"));
}

describe("search-readiness-fix.sh: a landed fix is progress, even when the live count cannot move yet", () => {
  it("round 1 lands a6 and sets it aside; round 2 fixes nothing for real → SR_QUEUE_STALLED with the right numbers, not a false stall on round 1", () => {
    const home = mktempHome();
    const repo = buildRepo(home);
    const r = runDriver(home, repo);
    const out = `${r.stdout}${r.stderr}`;

    // Round 1 was NOT called a stall: the run reached round 2 (its own pass ran a second time).
    expect(Number(readFileSync(join(home, "ahrefs-calls.count"), "utf8").trim())).toBe(2);
    expect(out).not.toMatch(/round 1 fixed nothing/);
    expect(out).toMatch(/round 2 fixed nothing; stopping/);

    // The closing numbers separate fixed-and-landed from still-to-do: only b1 is left workable,
    // a6 is landed but not yet live, so fixed (truly live) is 0, not 1.
    expect(out).toMatch(/SR-QUEUE-COMPLETE: started=2 fixed=0 left=1 awaiting_republish=1/);
    expect(out).toMatch(/NAMED STOP \[SR_QUEUE_STALLED\] 1 workable briefs left/);
    expect(out).toMatch(/1 awaiting republish/);
    expect(r.status).toBe(14);

    // The set-aside file is cleared once the run reaches its end, so nothing is excused forever —
    // tomorrow's fresh run measures a6 again from the live site.
    const setAsideAfter = JSON.parse(readFileSync(join(home, ".boss-os/search-readiness/landed-this-run.json"), "utf8"));
    expect(setAsideAfter).toEqual([]);
  }, 60000);

  it("NEGATIVE: a round that truly lands nothing still stalls on round 1", () => {
    const home = mktempHome();
    const repo = buildRepo(home, { neverLands: true });
    const r = runDriver(home, repo);
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toMatch(/round 1 fixed nothing; stopping/);
    expect(r.status).toBe(14);
    expect(out).toMatch(/SR-QUEUE-COMPLETE: started=2 fixed=0 left=2 awaiting_republish=0/);
  }, 60000);
});
