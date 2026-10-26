/**
 * THE SEARCH READINESS RUN WORKS UP TO THREE REPOS AT ONCE (25 Oct 2026) — the guard.
 *
 * One pass at a time was ~45 minutes per 10-brief chunk across ~24 chunks: about 18 hours. Repos do
 * not collide (each pass has its own worktree, and scoped, its own lock and findings file), so the
 * runner now keeps up to SR_PARALLEL (3) repos going, one pass at a time per repo. This runs the real
 * scripts/ops/search-readiness-fix.sh against stubs and fails if it ever runs more than the cap at
 * once, two passes of one repo at once, drops a chunk, or stops being parallel at all.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

type Ev = { kind: "start" | "end"; repo: string; ids: string; t: number };

function runDriver(parallel: string | null, chunks: string[]): Ev[] {
  const home = mkdtempSync(join(tmpdir(), "srpar-"));
  const repo = join(home, "boss-os");
  mkdirSync(join(repo, "scripts/ops"), { recursive: true });
  mkdirSync(join(repo, "src/shared/boss/searchReadiness"), { recursive: true });
  copyFileSync("scripts/ops/search-readiness-fix.sh", join(repo, "scripts/ops/search-readiness-fix.sh"));
  mkdirSync(join(repo, "scripts/ops/lib"), { recursive: true });
  copyFileSync("scripts/ops/lib/net-wait.sh", join(repo, "scripts/ops/lib/net-wait.sh"));
  // The network is faked UP (the runner probes it before every audit): no real request leaves the test.
  const bin = join(home, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "curl"), "#!/bin/bash\nprintf 200\n");
  chmodSync(join(bin, "curl"), 0o755);
  const events = join(home, "events.txt");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "stub", scripts: { "sites:audit": "true" } }));
  // The plan: the given chunks the first time, an empty queue after the round.
  writeFileSync(join(repo, "scripts/ops/search-readiness-audit.mjs"), `
import { existsSync, writeFileSync } from "node:fs";
const f = ${JSON.stringify(join(home, "planned"))};
if (existsSync(f)) { console.log("QUEUE total=0 workable=0 protected=0 no_repo=0"); }
else { writeFileSync(f, "1"); console.log("QUEUE total=${chunks.length} workable=${chunks.length * 2} protected=0 no_repo=0"); for (const c of ${JSON.stringify(chunks)}) console.log("CHUNK " + c); }
`);
  writeFileSync(join(repo, "scripts/ops/ahrefs-audit-fix.sh"), `
echo "start $SR_SCOPE_REPO $SR_SCOPE_BRIEFS $(node -e 'console.log(Date.now())')" >> ${JSON.stringify(events)}
sleep 1
echo "end $SR_SCOPE_REPO $SR_SCOPE_BRIEFS $(node -e 'console.log(Date.now())')" >> ${JSON.stringify(events)}
`);
  writeFileSync(join(repo, "src/shared/boss/searchReadiness/audit.mjs"), "export const queueRunLine = () => 'ok';\n");
  const env: Record<string, string> = { ...process.env as Record<string, string>, HOME: home, BOSS_OS_REPO: repo, PATH: `${bin}:${process.env.PATH}` };
  if (parallel === null) delete env.SR_PARALLEL; else env.SR_PARALLEL = parallel;
  execFileSync("/bin/bash", [join(repo, "scripts/ops/search-readiness-fix.sh")], { env, cwd: repo, stdio: "pipe", timeout: 60000 });
  return readFileSync(events, "utf8").trim().split("\n").map((l) => {
    const [kind, r, ids, t] = l.split(" ");
    return { kind: kind as Ev["kind"], repo: r ?? "", ids: ids ?? "", t: Number(t) };
  });
}

/** The most passes running at one instant, overall and for any one repo. */
function concurrency(evs: Ev[]) {
  const sorted = [...evs].sort((a, b) => a.t - b.t || (a.kind === "end" ? -1 : 1));
  let now = 0, max = 0; const per: Record<string, number> = {}; let perMax = 0;
  for (const e of sorted) {
    const d = e.kind === "start" ? 1 : -1;
    now += d; per[e.repo] = (per[e.repo] ?? 0) + d;
    max = Math.max(max, now); perMax = Math.max(perMax, per[e.repo] ?? 0);
  }
  return { max, perMax };
}

const CHUNKS = ["big 10 sr-1,sr-2", "big 3 sr-3", "b 2 sr-4", "c 1 sr-5", "d 1 sr-6"];

describe("search-readiness-fix.sh runs repos in parallel, one pass per repo at a time", () => {
  it("default: up to 3 at once, never two passes of one repo, every chunk run once, a repo's chunks in order", () => {
    const evs = runDriver(null, CHUNKS);
    const starts = evs.filter((e) => e.kind === "start");
    expect(starts.map((e) => `${e.repo} ${e.ids}`).sort()).toEqual(CHUNKS.map((c) => c.split(" ").filter((_, i) => i !== 1).join(" ")).sort());
    const { max, perMax } = concurrency(evs);
    expect(max).toBe(3);
    expect(perMax).toBe(1);
    const big = starts.filter((e) => e.repo === "big").map((e) => e.ids);
    expect(big).toEqual(["sr-1,sr-2", "sr-3"]);
  }, 60000);

  it("NEGATIVE: SR_PARALLEL=1 is strictly one pass at a time (the old shape)", () => {
    const { max } = concurrency(runDriver("1", CHUNKS));
    expect(max).toBe(1);
  }, 60000);

  it("the body runs as one parsed function, and the fixer scopes its lock and findings per repo", () => {
    const driver = readFileSync("scripts/ops/search-readiness-fix.sh", "utf8");
    expect(driver.trimEnd().endsWith('main "$@"; exit $?')).toBe(true);
    expect(driver).toMatch(/PARALLEL="\$\{SR_PARALLEL:-3\}"/);
    expect(driver).toMatch(/SR_SCOPE_REPO="\$rr" SR_SCOPE_BRIEFS="\$ids" bash scripts\/ops\/ahrefs-audit-fix\.sh/);
    const fixer = readFileSync("scripts/ops/ahrefs-audit-fix.sh", "utf8");
    expect(fixer).toContain('LOCK="$LOG_DIR/.lock${SR_SCOPE_REPO:+-sr-$SR_SCOPE_REPO}"');
    expect(fixer).toContain('OUT_DIR="$OUT_DIR/sr-$SR_SCOPE_REPO"');
    expect(fixer).toContain('export BOSS_OS_SITE_AUDIT_DIR="$OUT_DIR"');
    expect(fixer).toContain("s#~/.boss-os/site-audit/findings.json#$OUT_DIR/findings.json#g");
  });
});
