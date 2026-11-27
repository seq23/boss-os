/**
 * THE SR-FIX ALLOW LIST, AS THE REAL CLI READS IT (27 Nov 2026). The 24-25 Nov passes were refused 28+ ordinary
 * commands (jq on their own crawl files in /tmp, a push to their own branch, `git reset --hard` onto it, `npm test`,
 * `git rm`) and landed nothing, while the old test's hand-built prefix matcher called `git push origin HEAD:<branch>`
 * allowed. Claude Code decides what a rule lets through, so this reads the result of a REAL dontAsk session with the
 * worker's exact flags (scripts/ops/sr-fix-permissions-probe.mjs, run locally; its fixture is committed):
 *   - the fixture was made against THIS settings file (sha256), so any change to the list is red until re-probed;
 *   - every case behaved as expected (the in-scope refusals now allowed; rm outside the worktree, a force push to
 *     main, an R2 write, ~/.ssh still refused), every canary survived, her checkout's unsaved work was kept;
 *   - the fixture's cases are the probe's cases (none dropped to make it pass);
 *   - the runner hands the worker its scratch folder (prompt and TMPDIR), emptied, and the prompt names no /tmp.
 */
import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
// @ts-expect-error plain .mjs
import { cases } from "../scripts/ops/sr-fix-permissions-probe.mjs";
// @ts-expect-error plain .mjs
import { permissionDenials } from "../scripts/ops/lib/permission-denials.mjs";

const SETTINGS = "scripts/ops/sr-fix-permissions.json";
const FIXTURE = "tests/fixtures/sr-fix-permissions-probe.json";
type Case = { cmd: string; expect: "allow" | "refuse"; saw?: string; tool?: string; why: string };
const probe = JSON.parse(readFileSync(FIXTURE, "utf8")) as { settings_sha256: string; cases: Case[]; canaries: { file: string; intact: boolean }[]; own_checkout_unsaved_work_kept: boolean; claude_version: string };

it("the probe ran against this exact allow list (change the list → run `node scripts/ops/sr-fix-permissions-probe.mjs`)", () => {
  const sha = createHash("sha256").update(readFileSync(SETTINGS)).digest("hex");
  expect(probe.settings_sha256, "stale probe: the allow list changed after the probe ran").toBe(sha);
  expect(probe.claude_version).toMatch(/Claude Code/);
});

it("the real dontAsk session: every case as expected, every canary kept, her unsaved work kept", () => {
  const off = probe.cases.filter((c) => c.saw !== c.expect).map((c) => `${c.expect} saw=${c.saw}: ${c.tool ?? "Bash"} ${c.cmd}`);
  expect(off).toEqual([]);
  expect(probe.canaries.length).toBeGreaterThanOrEqual(4);
  expect(probe.canaries.filter((c) => !c.intact)).toEqual([]);
  expect(probe.own_checkout_unsaved_work_kept).toBe(true);
});

it("the fixture holds every probe case, unchanged (none dropped or flipped)", () => {
  const key = (c: Case) => `${c.tool ?? "Bash"}|${c.expect}|${c.cmd}`;
  expect(probe.cases.map(key)).toEqual((cases() as Case[]).map(key));
});

it("the cases cover each refusal of the 24-25 Nov passes and each abuse the brief names", () => {
  const has = (expectWant: string, re: RegExp) => probe.cases.some((c) => c.expect === expectWant && c.saw === expectWant && re.test(c.cmd));
  for (const re of [/^jq .*\/tmp\/crawl-/, /^grep .*\/tmp\//, /^rg .*\/tmp\//, /^head .*\/tmp\//, /^git show --output=.*origin\/main:/, /^npm test$/, /^npx vitest run /,
    /^git rm -q -- /, /^rm ~\/GitHub\/\.wt-danielle-/, /^git mv /, /^git reset --hard origin\/danielle\/site-audit-/, /^git reset --hard FETCH_HEAD$/,
    /^git push origin HEAD:danielle\/site-audit-/, /^git push -q -u origin HEAD$/, /^gh pr create .*--body-file /, /^gh issue list /, /^gh pr close /]) {
    expect(has("allow", re), `allowed: ${re}`).toBe(true);
  }
  for (const re of [/^rm ~\/\.boss-os\/srprobe-canary-/, /^rm .*\/\.\.\//, /^rm -r /, /^git push --force origin HEAD:main$/, /^git push .* main$/, /wrangler r2 object put/, /~\/\.ssh\//, /^git -C /]) {
    expect(has("refuse", re), `refused: ${re}`).toBe(true);
  }
});

it("a Read/Edit deny rule's refusal counts as a refusal (the pass reads it as PERMISSION_DENIED, not clean)", () => {
  const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "r1", name: "Read", input: { file_path: "/h/.ssh/known_hosts" } }] } }) + "\n"
    + JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "r1", is_error: true, content: "<tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>" }] } }) + "\n";
  expect(permissionDenials(line)).toEqual([{ tool: "Read", command: "/h/.ssh/known_hosts" }]);
  // NEGATIVE: an ordinary tool error is not a refusal.
  expect(permissionDenials(line.replace(/File is in a directory[^<]*/, "File does not exist."))).toEqual([]);
});

/** The REAL runner with a recording ai-run: what TMPDIR and prompt the worker is handed. */
function runFixer() {
  const home = mkdtempSync(join(tmpdir(), "sr-scratch-"));
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  const seen = join(home, "seen");
  const w = (name: string, body: string) => { writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  w("ai-run", `role=""; while [ $# -gt 0 ]; do case "$1" in --role) role="$2"; shift 2;; --) shift; break;; *) shift;; esac; done
[ "$role" = worker ] || exit 1
{ printf 'TMPDIR=%s\\n' "$TMPDIR"; printf 'FILES=%s\\n' "$(ls -A "$TMPDIR" 2>&1 | tr '\\n' ' ')"; printf '%s' "$1"; } > "${seen}"; exit 1`);
  w("gh", "exit 0");
  w("curl", "printf 200");
  mkdirSync(join(home, ".boss-os/search-readiness"), { recursive: true });
  writeFileSync(join(home, ".boss-os/search-readiness/fix-queue.json"), JSON.stringify({ written_at: "2026-11-27T00:00:00Z", briefs: [{ id: "sr-test.example-b1", repo: "test-repo", domain: "test.example", item_id: "b1", failure: "a title is 81 chars" }] }));
  const stale = join(home, ".boss-os/site-audit/sr-test-repo/tmp");
  mkdirSync(stale, { recursive: true });
  writeFileSync(join(stale, "crawl-last-pass.json"), "{}");
  const repoRoot = process.cwd();
  const r = spawnSync("/bin/bash", [join(repoRoot, "scripts/ops/ahrefs-audit-fix.sh")], {
    env: { ...(process.env as Record<string, string>), HOME: home, PATH: `${bin}:${process.env.PATH}`, BOSS_OS_REPO: repoRoot, SR_SCOPE_REPO: "test-repo", BOSS_OS_SITE_AUDIT_DIR: "" },
    encoding: "utf8",
    timeout: 60000,
  });
  return { home, out: `${r.stdout}${r.stderr}`, seen: existsSync(seen) ? readFileSync(seen, "utf8") : "" };
}

it("the runner hands the worker its own emptied scratch folder, in the prompt and as TMPDIR, and the prompt names no /tmp", () => {
  const r = runFixer();
  expect(r.seen, r.out).not.toBe("");
  const scratch = join(r.home, ".boss-os/site-audit/sr-test-repo/tmp");
  expect(r.seen).toContain(`TMPDIR=${scratch}\n`);
  expect(r.seen).toContain("FILES=\n"); // the last pass's crawl file is gone
  expect(existsSync(scratch) && readdirSync(scratch)).toEqual([]);
  expect(r.seen).toContain("--out ~/.boss-os/site-audit/sr-test-repo/tmp/crawl-<domain>.json");
  expect(r.seen).toContain(`git show --output=${scratch}/<name> origin/main:<path>`);
  expect(r.seen).not.toMatch(/<scratch/);
  // No path that starts at the shared /tmp (the test's own HOME is under /tmp on Linux CI, so it is taken out first).
  expect(r.seen.split(r.home).join("<HOME>")).not.toMatch(/[\s`(=]\/tmp\//);
});

it("OUTAGE: a scratch folder that cannot be made is a named stop, and the worker never runs", () => {
  const home = mkdtempSync(join(tmpdir(), "sr-noscratch-"));
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  const ran = join(home, "ran");
  writeFileSync(join(bin, "ai-run"), `#!/bin/bash\ntouch "${ran}"; exit 1\n`); chmodSync(join(bin, "ai-run"), 0o755);
  writeFileSync(join(bin, "gh"), "#!/bin/bash\nexit 0\n"); chmodSync(join(bin, "gh"), 0o755);
  writeFileSync(join(bin, "curl"), "#!/bin/bash\nprintf 200\n"); chmodSync(join(bin, "curl"), 0o755);
  const out = join(home, "sa", "sr-test-repo");
  mkdirSync(out, { recursive: true });
  chmodSync(out, 0o555); // the pass folder is there but nothing can be made in it
  const r = spawnSync("/bin/bash", [join(process.cwd(), "scripts/ops/ahrefs-audit-fix.sh")], {
    env: { ...(process.env as Record<string, string>), HOME: home, PATH: `${bin}:${process.env.PATH}`, BOSS_OS_REPO: process.cwd(), SR_SCOPE_REPO: "test-repo", BOSS_OS_SITE_AUDIT_DIR: join(home, "sa") },
    encoding: "utf8",
    timeout: 60000,
  });
  chmodSync(out, 0o755);
  expect(`${r.stdout}${r.stderr}`).toMatch(/NAMED STOP \[NO_SCRATCH\]/);
  expect(r.status).toBe(8);
  expect(existsSync(ran)).toBe(false);
});
