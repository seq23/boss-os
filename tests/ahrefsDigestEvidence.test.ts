/**
 * A MAIL PASS'S REPORT CARRIES THE DIGEST'S SEARCH RECORD (24 Nov 2026). The worker repairs from
 * ahrefs-digest.md and never opens Gmail, so its `searched` was empty and every report from 12 Nov
 * on stopped at NO_SEARCH_EVIDENCE ("the pass ran; Boss OS was not told"). This runs the REAL
 * reporter against a local server: with a fresh digest whose first line is the SEARCHED record the
 * rows are delivered; with no digest, a malformed line or a stale digest it still refuses.
 */
import { afterAll, expect, it } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestSearched } from "../src/shared/boss/siteAudit/evidence.mjs";

const posts: any[] = [];
const dirs: string[] = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/boss/auth/unlock") { res.setHeader("set-cookie", "boss_session=f; Path=/"); res.end("{}"); return; }
    posts.push(JSON.parse(body));
    res.end(JSON.stringify({ ok: true, data: { written: 1, refused: [] } }));
  });
});
afterAll(async () => {
  if (server.listening) await new Promise<void>((r) => server.close(() => r()));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const LINE = "SEARCHED: mailbox=fixture-mailbox since=2026-11-16 until=2026-11-24 messages=33 queries=from:sa@ahrefs.com newer_than:8d in:anywhere | from:ahrefs.com newer_than:8d in:anywhere";
const row = { built_today: { answer: "yes", different: "nothing; the existing check is used" },
  project: "Spry", domain: "audit-fixture.example", repo: "fixture-site", mapped_by: "repo_identity",
  disposition: "none", headline: "3XX redirect: 2 URLs", because: "The redirects are intended.",
  suggested_action: "Re-check next week." };

async function report(digest: string | null, ageHours = 0) {
  if (!server.listening) await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address(); if (!a || typeof a === "string") throw new Error("no server");
  const dir = mkdtempSync(join(tmpdir(), "digest-ev-")); dirs.push(dir);
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ run_id: "fixture", findings: [row] }));
  if (digest !== null) {
    const p = join(dir, "ahrefs-digest.md");
    writeFileSync(p, digest);
    if (ageHours) { const t = (Date.now() - ageHours * 3_600_000) / 1000; utimesSync(p, t, t); }
  }
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const c = spawn(process.execPath, ["scripts/ops/ahrefs-audit-report.mjs"], { env: { ...process.env,
      BOSS_OS_ORIGIN: `http://127.0.0.1:${a.port}`, BOSS_PASSCODE: "f", BOSS_OS_SITE_AUDIT_DIR: dir, SR_SCOPE_REPO: "" } });
    let out = ""; c.stdout.on("data", (d) => { out += d; }); c.stderr.on("data", (d) => { out += d; });
    c.on("close", (code) => resolve({ code, out }));
  });
}

it("parses the digest's SEARCHED line into a full search record", () => {
  expect(digestSearched(`${LINE}\n\n## Spry\n- 3XX redirect: 2 URLs`)).toEqual({ mailbox: "fixture-mailbox", since: "2026-11-16",
    until: "2026-11-24", messages: 33, queries: ["from:sa@ahrefs.com newer_than:8d in:anywhere", "from:ahrefs.com newer_than:8d in:anywhere"], source: "digest" });
});
it("reads the line when a model dresses it as markdown or adds a unit", () => {
  for (const dressed of [`**${LINE.replace("SEARCHED:", "SEARCHED:**")}`, "`" + LINE + "`", `- ${LINE}`, `> ${LINE}`, LINE.replace("messages=33", "messages=33 emails")]) {
    expect(digestSearched(dressed)?.messages, dressed).toBe(33);
  }
});
it("a missing or half line is no record (never invented)", () => {
  expect(digestSearched("## Spry\n- 3XX")).toBeNull();
  expect(digestSearched("SEARCHED: mailbox=x since=2026-11-16 until=2026-11-24 queries=a")).toBeNull();
});
it("a mail pass with a fresh digest is delivered with the digest's search record", async () => {
  const before = posts.length;
  const r = await report(`${LINE}\n## Spry\n- 3XX redirect: 2 URLs\n`);
  expect(r.code, r.out).toBe(0);
  expect(posts.length).toBe(before + 1);
  expect(JSON.stringify(posts.at(-1))).toContain("fixture-mailbox");
});
it("no digest still stops at NO_SEARCH_EVIDENCE", async () => {
  const r = await report(null);
  expect(r.code).toBe(11);
  expect(r.out).toContain("NO_SEARCH_EVIDENCE");
});
it("a stale digest (last week's) is never used as this week's evidence", async () => {
  const r = await report(`${LINE}\n`, 30);
  expect(r.code).toBe(11);
});
