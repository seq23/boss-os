/**
 * NOELLE'S SANDBOX, READ AND SEND SIDE (the #574 review, 27 Nov 2026: S1 her run could send private data to any
 * host; S2 her sandbox could read other sessions' temp files; N1 a usage limit reran her on the API credit with the
 * key in her session). Safety by taking access away: an exact host list, temp reads denied, no credit rerun.
 * Each test is red without its fix (the PR's Mutation proof).
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error plain .mjs
import { JOBS, jobProblems, noelleHosts, hostAllowed, webFetchHosts, noelleLaunchProblems, NOELLE_TEMP_ROOTS, SHARED_HOSTS } from "../scripts/validate/claude-runs-locked.mjs";

const ROOT = join(__dirname, "..");
const job = JOBS.find((j: { name: string }) => j.name === "noelle");
/** Her settings exactly as noelle_prepare writes them for a run. */
function rendered() {
  const home = mkdtempSync(join(tmpdir(), "noelle-sbx-"));
  const work = join(home, ".boss-os/noelle/runs/2026-11-28-1000");
  const r = spawnSync("bash", ["-c", `source "${join(ROOT, "scripts/ops/lib/noelle-sandbox.sh")}"; noelle_prepare "$1" "$HOME/Work/noelle" "$2" noelle-test-1`, "x", ROOT, work],
    { encoding: "utf8", env: { ...process.env, HOME: home } });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(readFileSync(r.stdout, "utf8"));
}
const both = (s: { sandbox: { network: { allowedDomains: string[] } } }) => [s.sandbox.network.allowedDomains, webFetchHosts(s)] as string[][];

describe("S1: her commands and WebFetch reach only her named hosts", () => {
  it("the rendered settings refuse an unlisted domain, a random *.workers.dev and a stranger's *.pages.dev, by curl and by WebFetch", () => {
    const s = rendered();
    expect(s.permissions.allow).not.toContain("WebFetch");
    for (const list of both(s)) {
      expect(list.length).toBeGreaterThan(10); // a real list, never an empty one that "refuses" by having nothing
      for (const host of ["evil.example", "attacker.workers.dev", "x.attacker.workers.dev", "noelle-test.pages.dev", "abc.stranger.pages.dev", "api.anthropic.com", "api.buffer.com", "west-peek-os.seq-taylor.workers.dev"]) {
        expect(hostAllowed(list, host), host).toBe(false);
      }
      for (const host of ["porchandparty901.com", "www.porchandparty901.com", "abc123.p-n-p.pages.dev", "github.com", "registry.npmjs.org", "boss.sequoiataylor.com"]) {
        expect(hostAllowed(list, host), host).toBe(true);
      }
    }
  });
  it("the list is derived from the sites map for her repos: no public wildcard, and a site of another business never enters", () => {
    const hosts = noelleHosts();
    expect(JSON.parse(readFileSync(join(ROOT, "scripts/ops/noelle-permissions.json"), "utf8")).sandbox.network.allowedDomains.slice().sort()).toEqual(hosts);
    for (const h of hosts) for (const shared of SHARED_HOSTS) expect(h === `*.${shared}` || h === shared, h).toBe(false);
    expect(hosts).not.toContain("*.sequoiataylor.com");
    expect(hosts).not.toContain("wpp-llm.pages.dev"); // did not resolve on 27 Nov 2026: not proven hers
    const map = { rows: [
      { repo: "p-n-p", domain: "porchandparty901.com", host: "cloudflare-pages", project: "p-n-p", status: "live" },
      { repo: "west-peek-os", domain: "joinwestpeek.com", host: "cloudflare-worker", project: "west-peek-os", status: "live" },
      { repo: "keepmyproof", domain: "keepmyproof.com", host: "wordpress-com", project: "keepmyproof.wordpress.com", status: "live" },
      { repo: "approvalprep", domain: "old.example", host: "cloudflare-pages", project: "old", status: "parked" },
    ] };
    const d = noelleHosts(map);
    expect(d).toEqual(expect.arrayContaining(["porchandparty901.com", "*.porchandparty901.com", "p-n-p.pages.dev", "*.p-n-p.pages.dev", "keepmyproof.wordpress.com"]));
    for (const h of ["joinwestpeek.com", "west-peek-os.seq-taylor.workers.dev", "old.example", "*.wordpress.com"]) expect(d).not.toContain(h);
  });
  it("a bare WebFetch, a public wildcard or an unlisted host in either list fails the build", () => {
    const real = JSON.parse(readFileSync(join(ROOT, "scripts/ops/noelle-permissions.json"), "utf8"));
    expect(jobProblems(real, job)).toEqual([]);
    const breaks: [string, (s: any) => void, RegExp][] = [
      ["bare WebFetch", (s) => s.permissions.allow.push("WebFetch"), /bare WebFetch/],
      ["WebFetch *.workers.dev", (s) => s.permissions.allow.push("WebFetch(domain:*.workers.dev)"), /anyone can register/],
      ["WebFetch unlisted", (s) => s.permissions.allow.push("WebFetch(domain:evil.example)"), /WebFetch's domains are not exactly her hosts \(extra: evil\.example/],
      ["WebFetch a path rule", (s) => s.permissions.allow.push("WebFetch(https://evil.example/*)"), /allowed only as WebFetch\(domain:/],
      ["curl *.pages.dev", (s) => s.sandbox.network.allowedDomains.push("*.pages.dev"), /anyone can register/],
      ["curl a stranger's workers.dev", (s) => s.sandbox.network.allowedDomains.push("x.attacker.workers.dev"), /allowedDomains is not exactly her hosts \(extra: x\.attacker\.workers\.dev/],
      ["a host of hers dropped", (s) => s.sandbox.network.allowedDomains.pop(), /missing: /],
    ];
    for (const [name, f, re] of breaks) {
      const s = structuredClone(real);
      f(s);
      expect(jobProblems(s, job).join("\n"), name).toMatch(re);
    }
  });
});

describe("S2: her sandbox cannot read the shared temp folders, and her temp is her own", () => {
  it("the rendered settings deny reads in every temp path, and re-open none of them", () => {
    const s = rendered();
    expect(NOELLE_TEMP_ROOTS).toEqual(["/tmp", "/private/tmp", "/var/folders", "/private/var/folders", "/Volumes"]);
    for (const p of NOELLE_TEMP_ROOTS) {
      expect(s.sandbox.filesystem.denyRead, p).toContain(p);
      for (const a of s.sandbox.filesystem.allowRead) expect(a === p || a.startsWith(`${p}/`), a).toBe(false);
      const t = structuredClone(s);
      t.sandbox.filesystem.denyRead = t.sandbox.filesystem.denyRead.filter((d: string) => d !== p);
      expect(jobProblems(t, { ...job, sandbox: { ...job.sandbox, allowWrite: s.sandbox.filesystem.allowWrite, allowRead: s.sandbox.filesystem.allowRead, excluded: s.sandbox.excludedCommands } }).join("\n"), p)
        .toMatch(new RegExp(`denyRead does not hold ${p.replace(/\//g, "\\/")} `));
    }
  });
  it("her launcher puts TMPDIR in her run folder and Claude Code's temp root in her home, short enough to hold", () => {
    const sh = readFileSync(join(ROOT, "scripts/ops/noelle.sh"), "utf8");
    expect(noelleLaunchProblems(sh)).toEqual([]);
    const run = sh.split("\n").find((l) => /AI_RUN_CLAUDE_MODEL=/.test(l)) ?? "";
    expect(run).toMatch(/(^|\s)TMPDIR="\$NTMP"\s/);
    expect(run).toMatch(/(^|\s)CLAUDE_CODE_TMPDIR="\$NHOME"\s/);
    expect(sh).toMatch(/^NTMP="\$WORK\/tmp"$/m);
    // the 44-byte stop runs before her session starts
    expect(sh.indexOf("NAMED STOP [TMPDIR_TOO_LONG]")).toBeGreaterThan(0);
    expect(sh.indexOf("NAMED STOP [TMPDIR_TOO_LONG]")).toBeLessThan(sh.indexOf(run));
    expect(noelleLaunchProblems(sh.replaceAll('TMPDIR="$NTMP" ', "")).join("\n")).toMatch(/TMPDIR to her run folder/);
    // her run log names what her rendered settings hold (the PR's Outcome reads this line)
    const line = sh.split("\n").find((l) => l.startsWith('say "$(node -e') && l.includes("her sandbox:")) ?? "";
    const home = mkdtempSync(join(tmpdir(), "noelle-line-"));
    const r = spawnSync("bash", ["-c", `say() { echo "$*"; }\nSETTINGS="$1"\n${line}`, "x", join(ROOT, "scripts/ops/noelle-permissions.json")], { encoding: "utf8", env: { ...process.env, HOME: home } });
    expect(r.stdout).toMatch(/^her sandbox: \d+ named hosts, WebFetch \d+ named hosts, temp reads denied: true$/m);
    expect(noelleLaunchProblems(sh.replaceAll('CLAUDE_CODE_TMPDIR="$NHOME" ', "")).join("\n")).toMatch(/CLAUDE_CODE_TMPDIR/);
  });
  it("the 44-byte check stops a long temp root before her session, with its name", () => {
    const sh = readFileSync(join(ROOT, "scripts/ops/noelle.sh"), "utf8");
    const check = sh.split("\n").filter((l) => /CC_TMP_ROOT/.test(l)).join("\n");
    const go = (nhome: string) => spawnSync("bash", ["-c", `stopped() { echo "$2"; exit "$3"; }\nNHOME="$1"\n${check}\necho PASSED`, "x", nhome], { encoding: "utf8" });
    expect(go("/Users/ab/Work/noelle").stdout).toMatch(/PASSED/);
    const long = go("/Users/someone-with-a-long-name/Work/noelle");
    expect(long.status).toBe(6);
    expect(long.stdout).toMatch(/NAMED STOP \[TMPDIR_TOO_LONG\]/);
  });
});

describe("N1: a usage limit is the named stop, never a rerun on the API credit", () => {
  it("her ai-run line sets AI_RUN_NO_CREDIT=1, and taking it out fails the build", () => {
    const sh = readFileSync(join(ROOT, "scripts/ops/noelle.sh"), "utf8");
    const run = sh.split("\n").find((l) => /AI_RUN_CLAUDE_MODEL=/.test(l)) ?? "";
    expect(run).toMatch(/(^|\s)AI_RUN_NO_CREDIT=1\s/);
    expect(noelleLaunchProblems(sh.replaceAll("AI_RUN_NO_CREDIT=1 ", "")).join("\n")).toMatch(/AI_RUN_NO_CREDIT=1/);
    expect(noelleLaunchProblems("#!/bin/bash\n")).toEqual(["noelle.sh: her ai-run line is gone (nothing checked is not a pass)"]);
  });
});

describe("the persona says what is true", () => {
  it("names the host list, sends other sites to WebSearch and says 'couldn't read', never a guess", () => {
    const p = readFileSync(join(ROOT, "scripts/ops/noelle/persona.md"), "utf8");
    expect(p).not.toMatch(/preview sites and Buffer/);
    expect(p).toMatch(/scripts\/ops\/noelle-permissions\.json`; WebFetch, where your session has it, is held to the same named\s+hosts/);
    expect(p).toMatch(/say you couldn't read it[\s\S]{0,40}never guess/);
  });
});
