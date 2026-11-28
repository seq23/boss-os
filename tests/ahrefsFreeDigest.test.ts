/**
 * DANIELLE'S AHREFS DIGEST ON THE FREE READER (27 Nov 2026, #584 Not built). The digest is written by code from
 * the real Gmail listing and one free-reader read per email. A week with no mail is said from the real search;
 * an outage or a spent allowance writes NO digest (never a partial or an empty "nothing this week"); an email the
 * reader cannot decide is named as unread. The runner uses the free digest first and the connector only on
 * NAMED STOP [HER_ACCOUNT] (exit 10).
 */
import { describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { AHREFS_QUERIES, NO_MAIL, buildAhrefsDigest } from "../scripts/ops/ahrefs-digest.mjs";
import { digestSearched } from "../src/shared/boss/siteAudit/evidence.mjs";

const NOW = Date.parse("2026-11-27T18:00:00Z");
const message = (id: string, subject: string) => ({ id, internalDate: NOW - 86_400_000, headers: { subject, from: "Ahrefs <sa@ahrefs.com>" }, body: `${subject}. 2 URLs affected.` });
const audit = (project: string, issue: string, urls: number) => JSON.stringify({ kind: "site_audit", project, site: `${project.toLowerCase()}.example`, crawl_date: "2026-11-26", health_score: 91, issues: [{ name: issue, urls, severity: "warning" }] });

function mailbox(threads: Record<string, ReturnType<typeof message>[]>) {
  const rows = Object.entries(threads).map(([id, msgs]) => [id, new Set(msgs.map((m) => m.id))] as [string, Set<string>]);
  return {
    token: async () => "access",
    list: async (_access: string, query: string) => (query.startsWith("from:sa@") ? rows : rows),
    load: async (threadId: string) => threads[threadId]!,
  };
}

describe("buildAhrefsDigest", () => {
  it("zero messages: the SEARCHED line and NO_MAIL come from the real search, and no model is called", async () => {
    let reads = 0;
    const text = await buildAhrefsDigest({ ...mailbox({}), now: NOW, read: async () => { reads += 1; return { status: "unavailable" }; } });
    expect(reads).toBe(0);
    expect(text).toContain(NO_MAIL);
    expect(digestSearched(text)).toMatchObject({ messages: 0, since: "2026-11-19", until: "2026-11-27", queries: [...AHREFS_QUERIES] });
    for (const q of AHREFS_QUERIES) expect(text).toContain(`- ${q}: 0 email(s)`);
  });

  it("one alert: its project, issue and count are in the digest, read as Danielle with the whole email", async () => {
    const seen: any[] = [];
    const text = await buildAhrefsDigest({ ...mailbox({ t1: [message("m1", "(Spry) 3XX redirect: 2 URLs")] }), now: NOW,
      read: async (input: any) => { seen.push(input); return { status: "ok", provider: "workers-ai", text: audit("Spry", "3XX redirect", 2) }; } });
    expect(seen).toHaveLength(1);
    expect(seen[0].worker).toBe("danielle");
    expect(JSON.parse(seen[0].source).body).toContain("2 URLs affected");
    expect(digestSearched(text)?.messages).toBe(1);
    expect(text).toContain("## Spry — spry.example");
    expect(text).toContain("  - 3XX redirect: 2 URLs (warning)");
    expect(text).not.toContain(NO_MAIL);
    expect(text).not.toContain("UNREAD");
  });

  it("many, one undecided: the rest are digested and the undecided one is named with its Gmail link", async () => {
    const answers = [audit("Spry", "Broken link", 4), "{\"kind\":\"uncertain\",\"project\":\"\",\"site\":\"\",\"crawl_date\":\"\",\"health_score\":-1,\"issues\":[]}", audit("Guides", "Slow page", 7)];
    const text = await buildAhrefsDigest({ ...mailbox({ t1: [message("m1", "(Spry) Broken link: 4 URLs"), message("m2", "Weird one")], t2: [message("m3", "(Guides) Slow page: 7 URLs")] }), now: NOW,
      read: async () => ({ status: "ok", provider: "gemini", text: answers.shift()! }) });
    expect(digestSearched(text)?.messages).toBe(3);
    expect(text).toContain("UNREAD: 1 of 3");
    expect(text).toContain("https://mail.google.com/mail/u/me/#all/m2");
    expect(text).toContain("Broken link: 4 URLs");
    expect(text).toContain("Slow page: 7 URLs");
  });

  it("allowance cut mid-run: it throws a NAMED STOP, so no digest is written from part of the week", async () => {
    let n = 0;
    await expect(buildAhrefsDigest({ ...mailbox({ t1: [message("m1", "(Spry) A: 1 URLs"), message("m2", "(Spry) B: 2 URLs")] }), now: NOW,
      read: async () => (n++ === 0 ? { status: "ok", provider: "workers-ai", text: audit("Spry", "A", 1) } : { status: "allowance-exhausted", provider: "gemini" }) }))
      .rejects.toThrow("FREE_ALLOWANCE_EXHAUSTED");
  });

  it("free reader down: NAMED STOP, never 'nothing found'", async () => {
    await expect(buildAhrefsDigest({ ...mailbox({ t1: [message("m1", "(Spry) A: 1 URLs")] }), now: NOW, read: async () => ({ status: "unavailable" }) }))
      .rejects.toThrow("FREE_READER_UNAVAILABLE");
  });

  it("Gmail down: the error stands, no digest", async () => {
    await expect(buildAhrefsDigest({ token: async () => { throw new Error("Personal Gmail authorization failed (401)"); }, now: NOW, read: async () => ({ status: "unavailable" }) }))
      .rejects.toThrow("401");
  });
});

/** The real runner, unscoped, with the free digest replaced by a stub exiting `rc` (and writing a digest on 0). */
function runPass(rc: number) {
  const home = mkdtempSync(join(tmpdir(), "ahrefs-free-"));
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true });
  const calls = join(home, "ai-run-calls");
  const w = (name: string, body: string) => { writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  w("ai-run", `role=""; while [ $# -gt 0 ]; do case "$1" in --role) role="$2"; shift 2;; --) break;; *) shift;; esac; done
echo "role=$role" >> "${calls}"; exit 1`);
  w("free-digest", `[ "$1" = --out ] || exit 2\n${rc === 0 ? `printf 'SEARCHED: mailbox=personal Gmail since=2026-11-19 until=2026-11-27 messages=0 queries=q\\n' > "$2"` : ""}\nexit ${rc}`);
  w("gh", "exit 0");
  w("curl", "printf 200");
  writeFileSync(join(home, "prompt.md"), "Do the thing.\n");
  const repoRoot = process.cwd();
  const r = spawnSync("/bin/bash", [join(repoRoot, "scripts/ops/ahrefs-audit-fix.sh")], {
    env: { ...(process.env as Record<string, string>), HOME: home, PATH: `${bin}:${process.env.PATH}`, BOSS_OS_REPO: repoRoot,
      AHREFS_AUDIT_PROMPT: join(home, "prompt.md"), BOSS_OS_SITE_AUDIT_DIR: join(home, "sa"), AHREFS_FREE_DIGEST_BIN: join(bin, "free-digest"),
      AHREFS_DIGEST: "", SR_SCOPE_REPO: "" },
    encoding: "utf8", timeout: 60000,
  });
  const roles = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) : [];
  return { rc: r.status, out: `${r.stdout}${r.stderr}`, roles };
}

describe("ahrefs-audit-fix.sh: the free digest first, the connector only without the grant", () => {
  it("rc 0: the free digest is used and the connector (brain) step never runs", () => {
    const run = runPass(0);
    expect(run.out).toContain("digest written by the free reader");
    expect(run.roles.some((r) => r === "role=brain")).toBe(false);
    expect(run.roles).toContain("role=worker");
  });

  it("rc 10 (NAMED STOP [HER_ACCOUNT]): the connector step reads the mail, as before", () => {
    const run = runPass(10);
    expect(run.out).toContain("NAMED STOP [HER_ACCOUNT]");
    expect(run.roles[0]).toBe("role=brain");
  });

  it("rc 3 (free reader down or allowance spent): the pass stops, no connector fallback, no repair", () => {
    const run = runPass(3);
    expect(run.rc).toBe(13);
    expect(run.out).toContain("NAMED STOP [NO_DIGEST] the free reader (rc=3)");
    expect(run.roles).toEqual([]);
  });
});
