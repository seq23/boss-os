/**
 * DANIELLE'S AUDIT PASS ACTUALLY FIXES THINGS (owner, 16 Oct 2026: "fix danielle's job so she can
 * actually fix things").
 *
 * The passes of 15 and 16 Oct read every Ahrefs mail and fixed nothing (fixed=0 surfaced=10, then
 * fixed=0 surfaced=9 off_limits=1) and exited clean. Each behaviour that changed is pinned here on
 * the real scripts, not on copies of their logic:
 *
 *   - a dirty owner checkout → a fresh worktree off origin, the checkout untouched (was: refused)
 *   - a client repo → no branch, no worktree, no land (CLIENT_REPO)
 *   - a crawl failure on a reachable site → AHREFS_SIDE_CRAWL_FAILURE, not an unfixed defect
 *   - fixable defects surfaced with fixed=0 → RED, named (was: exit 0)
 *   - a green fix → checks watched, then ~/bin/land; a red check → never landed
 *   - her own crawl finds the URLs the mail never carries
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readdirSync, rmSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs with no types; the functions under test are the ones the runner calls.
import { runVerdict, landAll, matchInFlight } from "../scripts/ops/site-audit-lib.mjs";

const ROOT = join(__dirname, "..");
const WORKTREE = join(ROOT, "scripts/ops/audit-worktree.sh");
const CRAWLER = join(ROOT, "scripts/ops/site-crawl.py");
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { env: GIT_ENV, encoding: "utf8" }).trim();

/** A GitHub root holding one repo cloned from a bare origin, with a commit on main. */
function fakeRoot(name: string) {
  const root = mkdtempSync(join(tmpdir(), "danielle-"));
  const origin = join(root, `${name}.origin.git`);
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env: GIT_ENV });
  const repo = join(root, name);
  execFileSync("git", ["clone", "-q", origin, repo], { env: GIT_ENV });
  writeFileSync(join(repo, "index.html"), "<a href='/x'>x</a>\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "push", "-q", "origin", "HEAD:main");
  git(repo, "remote", "set-head", "origin", "main");
  return { root, repo };
}

describe("dirty owner checkout → fresh worktree (was: refused)", () => {
  it("cuts a worktree off origin/main and leaves the owner's checkout exactly as it was", () => {
    const { root, repo } = fakeRoot("p-n-p");
    git(repo, "checkout", "-q", "-b", "owner-wip");
    writeFileSync(join(repo, "index.html"), "owner's uncommitted edit\n");
    writeFileSync(join(repo, "reports.json"), "{\"ts\": 1}\n");
    const before = { status: git(repo, "status", "--porcelain"), branch: git(repo, "branch", "--show-current"),
      body: readFileSync(join(repo, "index.html"), "utf8") };

    const r = spawnSync("bash", [WORKTREE, "p-n-p"], { env: { ...GIT_ENV, AUDIT_GITHUB_ROOT: root }, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const wt = r.stdout.trim().split("\n").pop()!;
    expect(wt.startsWith(join(root, ".wt-danielle-p-n-p-"))).toBe(true);
    expect(git(wt, "status", "--porcelain")).toBe("");
    expect(git(wt, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "origin/main"));
    expect(git(wt, "branch", "--show-current")).toMatch(/^danielle\/site-audit-/);
    expect(readFileSync(join(wt, "index.html"), "utf8")).toBe("<a href='/x'>x</a>\n");

    expect(git(repo, "status", "--porcelain")).toBe(before.status);
    expect(git(repo, "branch", "--show-current")).toBe(before.branch);
    expect(readFileSync(join(repo, "index.html"), "utf8")).toBe(before.body);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("client repo → report only, never a branch or a land", () => {
  it("audit-worktree refuses with CLIENT_REPO and cuts nothing", () => {
    const { root } = fakeRoot("hicks-consulting-canonical");
    const r = spawnSync("bash", [WORKTREE, "hicks-consulting-canonical"], { env: { ...GIT_ENV, AUDIT_GITHUB_ROOT: root }, encoding: "utf8" });
    expect(r.status).toBe(20);
    expect(r.stderr).toMatch(/NAMED STOP \[CLIENT_REPO\]/);
    expect(readdirSync(root).filter((d) => d.startsWith(".wt-danielle"))).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it("landAll never runs checks or land for a client repo, and a client_repo row is not red", () => {
    const calls: string[][] = [];
    const payload = { findings: [{ disposition: "fixed_pr", repo: "hicks-consulting-canonical", pr_url: "https://github.com/x/y/pull/1" }] };
    landAll(payload, { run: (c: string, a: string[]) => { calls.push([c, ...a]); return { status: 0, out: "" }; } });
    expect(calls).toEqual([]);
    expect((payload.findings[0] as any).land).toBe("refused_policy");

    const v = runVerdict({ findings: [{ disposition: "client_repo", repo: "hicks-consulting-canonical", project: "Hicks", headline: "CLIENT_REPO: 4 broken links" }] });
    expect(v.red).toBe(false);
  });
});

describe("crawl failed on a reachable site → AHREFS_SIDE_CRAWL_FAILURE", () => {
  const verdict = (ev: object) =>
    JSON.parse(execFileSync("python3", [CRAWLER, "verdict", JSON.stringify(ev)], { encoding: "utf8" })).verdict;
  const reachable = {
    dns_ok: true, tls_ok: true, start: { status: 200, challenge: false },
    robots_allows: { AhrefsBot: true, AhrefsSiteAudit: true },
    as_ahrefs: { AhrefsBot: { status: 200 }, AhrefsSiteAudit: { status: 403 } },
  };

  it("names the reachable case, and only the reachable case", () => {
    expect(verdict(reachable)).toBe("AHREFS_SIDE_CRAWL_FAILURE");
    expect(verdict({ ...reachable, dns_ok: false, dns_error: "gaierror" })).toBe("SITE_UNREACHABLE");
    expect(verdict({ ...reachable, tls_ok: false, tls_error: "cert expired" })).toBe("SITE_UNREACHABLE");
    expect(verdict({ ...reachable, start: { status: 522 } })).toBe("SITE_UNREACHABLE");
    expect(verdict({ ...reachable, start: { status: 200, challenge: true } })).toBe("SITE_UNREACHABLE");
    expect(verdict({ ...reachable, robots_allows: { AhrefsBot: false, AhrefsSiteAudit: true } })).toBe("ROBOTS_BLOCKS_AHREFS");
  });

  it("an ahrefs_side row is not a red defect when probed, and is red (NOT_PROBED) when asserted bare", () => {
    const row = { disposition: "ahrefs_side", project: "Theaccidentguides", headline: "AHREFS_SIDE_CRAWL_FAILURE: crawl failed" };
    expect(runVerdict({ findings: [{ ...row, probe: { verdict: "AHREFS_SIDE_CRAWL_FAILURE" } }] }).red).toBe(false);
    const bare = runVerdict({ findings: [row] });
    expect(bare.red).toBe(true);
    expect(bare.reasons.join("\n")).toMatch(/^NOT_PROBED/m);
  });

  it("an out-of-credits crawl is a named row, not a defect", () => {
    expect(runVerdict({ findings: [{ disposition: "ahrefs_credits", project: "Uscisexam", headline: "AHREFS_CRAWL_CREDITS: crawl could not start" }] }).red).toBe(false);
  });
});

describe("RULE 0: fixable defects surfaced with fixed=0 → RED", () => {
  const crawl = { pages_crawled: 117, sitemap_total: 117, counts: { broken_internal_link: 3 } };
  const surfaced = { disposition: "surfaced", repo: "p-n-p", project: "Porchandparty901", headline: "3 broken links", because: "x", crawl };

  it("the 15/16 Oct shape is red, with the reason named", () => {
    const v = runVerdict({ findings: [surfaced] });
    expect(v.red).toBe(true);
    expect(v.reasons[0]).toMatch(/^FIXABLE_LEFT_UNFIXED: Porchandparty901/);
  });

  it("a landed fix makes it green; an unlanded PR is red; a row with no crawl is red", () => {
    const landed = { disposition: "fixed_pr", repo: "WPP-llm", project: "Virtualagency-os", headline: "h", pr_url: "u", land: "landed", crawl };
    expect(runVerdict({ findings: [surfaced, landed] }).red).toBe(false);
    const open = runVerdict({ findings: [{ ...landed, land: "checks_red" }] });
    expect(open.red).toBe(true);
    expect(open.reasons[0]).toMatch(/^NOT_LANDED/);
    const uncrawled = runVerdict({ findings: [{ ...landed, crawl: undefined }] });
    expect(uncrawled.reasons.join("\n")).toMatch(/^NOT_CRAWLED/m);
  });

  it("an empty findings file is red", () => {
    expect(runVerdict({ findings: [] }).red).toBe(true);
  });
});

describe("landing: checks to green, then ~/bin/land", () => {
  const row = () => ({ disposition: "fixed_pr", repo: "WPP-llm", pr_url: "https://github.com/seq23/WPP-llm/pull/42", worktree: "/nonexistent" });

  it("watches checks with --watch --fail-fast, then lands that PR number", () => {
    const calls: string[][] = [];
    const p = { findings: [row()] };
    landAll(p, { landBin: "/bin/land-stub", run: (c: string, a: string[]) => { calls.push([c, ...a]); return { status: 0, out: "landed\n" }; } });
    expect(calls[0]).toEqual(["timeout", "1800", "gh", "pr", "checks", "https://github.com/seq23/WPP-llm/pull/42", "--watch", "--fail-fast"]);
    expect(calls[1]).toEqual(["timeout", "3600", "/bin/land-stub", "42"]);
    expect((p.findings[0] as any).land).toBe("landed");
  });

  it("a red check is never landed, and the row says so", () => {
    const calls: string[][] = [];
    const p = { findings: [row()] };
    landAll(p, { run: (c: string, a: string[]) => { calls.push([c, ...a]); return { status: 1, out: "build fail\n" }; } });
    expect(calls).toHaveLength(1);
    expect((p.findings[0] as any).land).toBe("checks_red");
    expect(runVerdict(p).reasons.join("\n")).toMatch(/NOT_LANDED/);
  });
});

describe("IN_FLIGHT: an open PR or branch already touching it is skipped", () => {
  it("matches a PR by title, body, branch or file, and a bare branch", () => {
    const prs = [{ number: 7, title: "Fix dead outbound links", body: "", headRefName: "fix/outbound", files: [{ path: "src/footer.html" }] }];
    expect(matchInFlight(prs, [], ["email-protection"])).toBeNull();
    expect(matchInFlight(prs, [], ["outbound"])?.kind).toBe("pr");
    expect(matchInFlight(prs, [], ["footer.html"])?.kind).toBe("pr");
    expect(matchInFlight([], ["main", "fix/email-protection-links"], ["email-protection"])).toEqual({ kind: "branch", ref: "fix/email-protection-links" });
    expect(matchInFlight(prs, ["main"], [])).toBeNull();
  });
});

describe("her own crawl supplies the URLs the Ahrefs mail never carries", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const pages: Record<string, string> = {
      "/": `<html><head><title>Home</title><meta name="description" content="d1"></head><body>
            <a href="/a">a</a><a href="/missing">gone</a><a href="/cdn-cgi/l/email-protection#abc">mail</a></body></html>`,
      "/a": `<html><head><title>Home</title><meta name="description" content="d2"><link rel="canonical" href="/old"></head><body><a href="/">h</a></body></html>`,
      "/orphan": `<html><head><title>Orphan</title><meta name="robots" content="noindex"></head><body></body></html>`,
    };
    server = createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0] ?? "/";
      if (path === "/sitemap.xml") {
        res.writeHead(200, { "content-type": "application/xml" });
        res.end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["/", "/a", "/orphan"].map((p) => `<url><loc>${base}${p}</loc></url>`).join("")}</urlset>`);
      } else if (path === "/old") {
        res.writeHead(301, { location: "/a" }); res.end();
      } else if (pages[path]) {
        res.writeHead(200, { "content-type": "text/html" }); res.end(pages[path]);
      } else {
        res.writeHead(404); res.end("nope");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterAll(() => server.close());

  it("finds the broken link, the email-protection link, the bad canonical, the orphan, noindex and the duplicate title", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "crawl-")), "c.json");
    await new Promise<void>((resolve, reject) => {
      // ASYNC, not spawnSync: the server under test lives on this event loop.
      const p = spawn("python3", [CRAWLER, "crawl", "example.test", "--base", base, "--out", out]);
      let err = "";
      p.stderr.on("data", (d) => { err += d; });
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err))));
    });
    const res = JSON.parse(readFileSync(out, "utf8"));
    expect(res.pages_crawled).toBe(3);
    const urls = (k: string) => (res.issues[k] ?? []).map((i: { url: string }) => i.url.replace(base, ""));
    expect(urls("broken_internal_link")).toEqual(["/missing"]);
    expect(res.issues.broken_internal_link[0].sources.map((s: string) => s.replace(base, ""))).toEqual(["/"]);
    expect(urls("cloudflare_email_protection_link")).toEqual(["/cdn-cgi/l/email-protection"]);
    expect(urls("canonical_not_200")).toEqual(["/old"]);
    expect(urls("orphan_sitemap_page")).toEqual(["/orphan"]);
    expect(urls("noindex_on_sitemap_page")).toEqual(["/orphan"]);
    expect(urls("duplicate_title").sort()).toEqual(["/", "/a"]);
    expect(existsSync(out)).toBe(true);
  }, 60000);
});
