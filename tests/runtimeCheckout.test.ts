/**
 * HER SCHEDULED JOBS RUN FROM A CHECKOUT NOBODY WORKS IN (1 Nov 2026) — the guard.
 *
 * ~45 launchd jobs ran from ~/GitHub/boss-os, her working checkout, and sessions kept branching it in
 * place (four times that day; the last by a subagent of the Boss OS mail tail, whose cwd it was), so
 * her jobs ran feature branches and half-edited files. Now launchd runs ~/.boss-os/runtime, which
 * scripts/ops/runtime-sync.sh holds at origin/main every 10 minutes. Fails if the sync stops putting a
 * switched/dirty/behind runtime back on origin/main, stops saving what it found there, stops naming a
 * plist that still runs the working checkout; or if a launchd script defaults to the working checkout
 * again.
 */
import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SYNC = join(__dirname, "../scripts/ops/runtime-sync.sh");
const OPS = join(__dirname, "../scripts/ops");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function world() {
  const base = mkdtempSync(join(tmpdir(), "runtime-"));
  const origin = join(base, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  const seed = join(base, "seed");
  execFileSync("git", ["clone", "-q", origin, seed]);
  git(seed, "config", "user.email", "t@example.com"); git(seed, "config", "user.name", "t");
  writeFileSync(join(seed, "job.sh"), "echo v1\n");
  git(seed, "add", "."); git(seed, "commit", "-qm", "v1"); git(seed, "push", "-q", "origin", "main");
  const env = {
    ...process.env,
    BOSS_OS_RUNTIME: join(base, "runtime"),
    BOSS_OS_WORKING: join(base, "working"),
    BOSS_OS_RUNTIME_ORIGIN: origin,
    BOSS_OS_RUNTIME_SALVAGE: join(base, "salvage"),
    BOSS_OS_LAUNCH_AGENTS: join(base, "agents"),
    BOSS_OS_RUNTIME_NO_NPM: "1",
    BOSS_OS_RUNTIME_NO_LAUNCHCTL: "1",
  };
  const sync = () => {
    const r = spawnSync("bash", [SYNC], { env, encoding: "utf8" });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const push = (text: string) => {
    writeFileSync(join(seed, "job.sh"), text);
    git(seed, "commit", "-qam", text.trim()); git(seed, "push", "-q", "origin", "main");
    return git(seed, "rev-parse", "HEAD");
  };
  return { base, rt: env.BOSS_OS_RUNTIME, working: env.BOSS_OS_WORKING, sync, push, seed };
}

describe("runtime-sync: the jobs' checkout is always origin/main", () => {
  it("clones a missing runtime and follows origin/main forward", () => {
    const w = world();
    expect(w.sync().code).toBe(0);
    expect(readFileSync(join(w.rt, "job.sh"), "utf8")).toBe("echo v1\n");
    const v2 = w.push("echo v2\n");
    expect(w.sync().code).toBe(0);
    expect(git(w.rt, "rev-parse", "HEAD")).toBe(v2);
    expect(readFileSync(join(w.rt, "job.sh"), "utf8")).toBe("echo v2\n");
  });

  it("a runtime someone branched and edited is saved, then put back on main", () => {
    const w = world();
    w.sync();
    git(w.rt, "config", "user.email", "t@example.com"); git(w.rt, "config", "user.name", "t");
    git(w.rt, "checkout", "-q", "-b", "fix/someones-work");
    writeFileSync(join(w.rt, "job.sh"), "echo committed-on-a-branch\n");
    git(w.rt, "commit", "-qam", "stray commit");
    writeFileSync(join(w.rt, "job.sh"), "echo half-edited\n");
    writeFileSync(join(w.rt, "new-file.mjs"), "stray\n");
    const v2 = w.push("echo v2\n");

    const r = w.sync();
    expect(r.code).toBe(0);
    expect(r.out).toContain("NAMED STOP [RUNTIME_WAS_DIRTY]");
    expect(git(w.rt, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(w.rt, "rev-parse", "HEAD")).toBe(v2);
    expect(git(w.rt, "status", "--porcelain", "--untracked-files=all")).toBe("");
    expect(readFileSync(join(w.rt, "job.sh"), "utf8")).toBe("echo v2\n");

    const saved = readdirSync(join(w.base, "salvage"));
    expect(saved).toHaveLength(1);
    const s = join(w.base, "salvage", saved[0] ?? "");
    expect(readFileSync(join(s, "where.txt"), "utf8")).toContain("branch: fix/someones-work");
    expect(readFileSync(join(s, "changes.diff"), "utf8")).toContain("+echo half-edited");
    expect(existsSync(join(s, "untracked.tar"))).toBe(true);
    expect(existsSync(join(s, "commits.bundle"))).toBe(true);
  });

  it("a clean runtime on main saves nothing", () => {
    const w = world();
    w.sync(); w.push("echo v2\n");
    expect(w.sync().out).not.toContain("RUNTIME_WAS_DIRTY");
    expect(existsSync(join(w.base, "salvage"))).toBe(false);
  });

  it("repoints every launchd plist that still runs the working checkout, and leaves the rest alone", () => {
    const w = world();
    mkdirSync(join(w.base, "agents"));
    const old = join(w.base, "agents", "com.seq.boss-old.plist");
    const near = join(w.base, "agents", "com.seq.boss-near.plist");
    writeFileSync(old, `<string>cd ${w.working} &amp;&amp; bash ${w.working}/scripts/x.sh</string>`);
    writeFileSync(near, `<string>cd ${w.working}-other &amp;&amp; npm run x</string>`);
    const out = w.sync().out;
    expect(out).toContain("repointed com.seq.boss-old to");
    expect(readFileSync(old, "utf8")).toBe(`<string>cd ${w.rt} &amp;&amp; bash ${w.rt}/scripts/x.sh</string>`);
    expect(readFileSync(near, "utf8")).toContain(`${w.working}-other`);
    expect(out).not.toContain("com.seq.boss-near");
  });
});

describe("nothing launchd runs points at her working checkout", () => {
  it("no ops script defaults to ~/GitHub/boss-os, and the installer writes the runtime path", () => {
    const offenders = readdirSync(OPS).filter((f) => /\.(sh|mjs)$/.test(f))
      .filter((f) => /^\s*(?:REPO=|const REPO\b).*GitHub\/boss-os/m.test(readFileSync(join(OPS, f), "utf8")));
    expect(offenders).toEqual([]);
    expect(readFileSync(join(OPS, "install-agent-launchd.sh"), "utf8")).toMatch(/^REPO="\$\{BOSS_OS_RUNTIME:-\$HOME\/\.boss-os\/runtime\}"/m);
  });
});
