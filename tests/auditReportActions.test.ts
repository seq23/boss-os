import { afterAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DISPOSITIONS } from "../src/shared/boss/siteAudit/repoPolicy.mjs";

const ROOT = process.cwd();
const dirs: string[] = [];
const posts: any[] = [];
let reply: any = { written: 1, refused: [] };
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/boss/auth/unlock") {
      res.setHeader("set-cookie", "boss_session=fixture; Path=/");
      res.end("{}");
      return;
    }
    posts.push(JSON.parse(body));
    res.end(JSON.stringify({ ok: true, data: reply }));
  });
});
afterAll(async () => {
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const finding = {
  project: "checklist:audit-fixture.example", domain: "audit-fixture.example", repo: "fixture-site",
  mapped_by: "repo_identity", disposition: "in_flight", headline: "a6: sitemap date",
  because: "An existing fix covers this finding.", suggested_action: "Confirm the existing fix next week.",
  pr_url: "https://github.com/fixture-owner/fixture-site/pull/7",
};
const searched = { mailbox: "fixture mailbox", queries: ["fixture audit query"], since: "2026-10-23", until: "2026-10-30", messages: 3 };
function summary(findings: unknown[]) { return { run_id: "codex-fixture", searched, findings }; }
function dir() {
  const path = mkdtempSync(join(tmpdir(), "audit-actions-"));
  dirs.push(path);
  return path;
}
async function run(path: string, env: Record<string, string> = {}, fixer = false) {
  if (!server.listening) await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local report server did not start");
  const args = fixer ? [join(ROOT, "scripts/ops/ahrefs-audit-fix.sh")] : [join(ROOT, "scripts/ops/ahrefs-audit-report.mjs")];
  return new Promise<{ code: number | null; out: string }>((resolve, reject) => {
    const child = spawn(fixer ? "/bin/bash" : process.execPath, args, {
      env: { ...process.env, BOSS_OS_ORIGIN: `http://127.0.0.1:${address.port}`, BOSS_PASSCODE: "fixture",
        BOSS_OS_SITE_AUDIT_DIR: path, SR_SCOPE_REPO: "", ...env },
    });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { out += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
  });
}
async function report(rows: unknown[]) {
  const path = dir();
  writeFileSync(join(path, "findings.json"), JSON.stringify(summary(rows)));
  return run(path);
}

const defaults: Record<string, string> = {
  fixed_pr: "A fix was opened; we'll confirm the result next week.",
  off_limits: "This repository is outside the automatic repair scope, so we logged it and will check again next week.",
  no_repo: "No repo is linked to this site, so we logged it and will check again next week.",
  none: "Nothing to change: the audit found no site defect to fix.",
  ahrefs_side: "The site is reachable; we'll check whether Ahrefs can crawl it next week.",
  client_repo: "This client repository is report-only, so we logged the finding without changing the site.",
  in_flight: "A fix is already open; we'll confirm it next week.",
  ahrefs_credits: "Ahrefs ran out of crawl credits; we'll check the next audit without buying more credits.",
};
describe("audit actions match the disposition", () => {
  for (const disposition of DISPOSITIONS) {
    it(`${disposition}: keeps the supplied next action`, async () => {
      reply = { written: 1, refused: [] };
      const before = posts.length;
      const result = await report([{ ...finding, disposition }]);
      expect(result.code, result.out).toBe(0);
      expect(posts).toHaveLength(before + 1);
      expect(posts.at(-1).findings).toEqual([{ ...finding, disposition }]);
    });
    for (const blank of [null, "", " \t\n", undefined]) {
      it(`${disposition}: handles ${JSON.stringify(blank)} action explicitly`, async () => {
        reply = { written: 1, refused: [] };
        const before = posts.length;
        const result = await report([{ ...finding, disposition, suggested_action: blank }]);
        if (disposition === "surfaced") {
          expect(result.code, result.out).toBe(14);
          expect(result.out).toContain("INCOMPLETE_FINDING");
          expect(posts).toHaveLength(before);
        } else {
          expect(result.code, result.out).toBe(0);
          expect(posts).toHaveLength(before + 1);
          expect(posts.at(-1).findings).toEqual([{ ...finding, disposition, suggested_action: defaults[disposition] }]);
          expect(result.out).toContain("1 finding(s) written from 1 sent");
        }
      });
    }
  }
  it.each(["project", "headline", "because"])("still refuses a blank %s", async (field) => {
    const before = posts.length;
    const result = await report([{ ...finding, [field]: " " }]);
    expect(result.code, result.out).toBe(14);
    expect(posts).toHaveLength(before);
  });
  it("refuses an address even when no fix is needed", async () => {
    const before = posts.length;
    const result = await report([{ ...finding, suggested_action: "Ask someone@example.test" }]);
    expect(result.code, result.out).toBe(12);
    expect(posts).toHaveLength(before);
  });
  it("an empty findings array is a named failure, never a quiet success", async () => {
    const before = posts.length;
    const result = await report([]);
    expect(result.code, result.out).toBe(10);
    expect(result.out).toContain("EMPTY_ARRAY_IS_NOT_A_REPORT");
    expect(posts).toHaveLength(before);
  });
});

function codexPass() {
  const home = dir();
  const bin = join(home, "bin");
  mkdirSync(bin);
  const fake = (name: string, body: string) => writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  fake("gh", "exit 0");
  fake("curl", "printf 200");
  fake("claude", "exit 1");
  fake("security", "exit 1");
  fake("npm", 'exec node "$BOSS_OS_REPO/scripts/ops/ahrefs-audit-report.mjs"');
  fake("codex", `if [ "$1" = login ]; then exit 0; fi
printf '%s' "$AUDIT_FIXTURE_SUMMARY" > "$BOSS_OS_SITE_AUDIT_DIR/findings.json"
echo 'AHREFS-AUDIT-COMPLETE: projects=3 fixed=0 surfaced=0 off_limits=0 no_repo=1 ahrefs_side=0 ahrefs_credits=0 client_repo=0 in_flight=1'`);
  writeFileSync(join(home, "digest.txt"), "Fixture audit digest");
  return { home, env: { HOME: home, PATH: `${bin}:${process.env.PATH}`, BOSS_OS_REPO: ROOT,
    BOSS_AI_RUNNER: "codex", AHREFS_DIGEST: join(home, "digest.txt"),
    AUDIT_FIXTURE_SUMMARY: JSON.stringify(summary([
      { ...finding, project: "Fixture audit summary", headline: "Nothing to change", disposition: "none", suggested_action: null, repo: null, pr_url: null },
      { ...finding, project: "Unlinked fixture site", headline: "No linked repository", disposition: "no_repo", suggested_action: "", repo: null, pr_url: null },
      { ...finding, disposition: "in_flight", suggested_action: " \t", notes: null },
    ])) } };
}
describe("Rule 0: a Codex summary becomes a delivered report", () => {
  it("the real fixer and reporter deliver every no-fix row with blank fields", async () => {
    reply = { written: 3, refused: [] };
    const fixture = codexPass();
    const before = posts.length;
    const result = await run(fixture.home, fixture.env, true);
    expect(result.code, result.out).toBe(0);
    expect(posts).toHaveLength(before + 1);
    expect(posts.at(-1).run_id).toBe("codex-fixture");
    expect(posts.at(-1).findings.map((f: any) => [f.disposition, f.suggested_action])).toEqual(
      ["none", "no_repo", "in_flight"].map((d) => [d, defaults[d]]),
    );
    expect(result.out).not.toContain("REPORT_NOT_DELIVERED");
  });
  it.each([{ written: 0, refused: [] }, { written: 2, refused: ["fixture row refused"] }])(
    "a server acknowledgement of $written rows cannot silently pass", async (ack) => {
      reply = ack;
      const fixture = codexPass();
      const before = posts.length;
      const result = await run(fixture.home, fixture.env, true);
      expect(posts).toHaveLength(before + 1);
      expect(result.code, result.out).not.toBe(0);
      expect(result.out).toContain("REPORT_NOT_DELIVERED");
    },
  );
  it("the shared Codex/Claude prompt requests an action on every finding", () => {
    const prompt = readFileSync("scripts/ops/ahrefs-audit-fix-prompt.md", "utf8");
    expect(prompt).toContain("Every finding must include a non-blank `suggested_action`");
    for (const disposition of DISPOSITIONS) expect(prompt).toContain(`\`${disposition}\``);
  });
});
