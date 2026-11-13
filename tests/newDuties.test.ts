/**
 * ZORA'S AND TONI'S NEW STANDING DUTIES (owner, 22 Oct 2026).
 *
 * Each duty has an executor (a local job the installer wraps in duty-run.sh), Toni's stay out of her
 * trading lane, and the pure judgements behind "quiet unless something moves" and "a source it cannot
 * read is named, never faked" hold.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INSTALLED_LOCAL_JOBS } from "../src/shared/boss/duties/lane.mjs";
import { askClaudeJson, movedReadings, PERSONAL_GMAIL, readClaudeStream, readNothingStop, stateMap } from "../scripts/ops/lib/duty-kit.mjs";
import { existsSync, readFileSync as readAbs } from "node:fs";
import { hasDkim, openrouterReading, rdapExpiry, rdapUrl, renewalReading, senderPauseReason } from "../scripts/ops/risk-watch.mjs";
import { lockReading } from "../scripts/ops/outside-locks.mjs";
import { citedBossFiles, dateIn, handoffTodayDate, kindOf, NOT_OURS_RE, readGalleryExport } from "../scripts/ops/archive-audit.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");
const MIG = read("migrations/0288_boss_creator_studios_research_pages_and_new_duties.sql");
const INSTALLER = read("scripts/ops/install-agent-launchd.sh");

const DUTIES = [
  { id: "duty_archive_audit", seat: "emp_knowledge", job: "archive-audit.mjs", npm: "archive:audit" },
  { id: "duty_risk_watch", seat: "emp_risk", job: "risk-watch.mjs", npm: "risk:watch" },
  { id: "duty_outside_locks", seat: "emp_risk", job: "outside-locks.mjs", npm: "risk:locks" },
];

describe("every new duty has an executor (rule 0)", () => {
  for (const d of DUTIES) {
    it(`${d.id}: row, script, installer, npm`, () => {
      const at = MIG.indexOf(`('${d.id}'`);
      expect(at).toBeGreaterThan(-1);
      const row = MIG.slice(at, MIG.indexOf("\n   0)", at));
      expect(row).toContain(`'${d.seat}', 'ops'`);
      expect(row).toContain("'local_job'");
      expect(row).toContain(`'local_job', '${d.job}'`);
      expect(INSTALLED_LOCAL_JOBS).toContain(d.job);
      expect(INSTALLER).toContain(`duty-run.sh ${d.job} -- npm run --silent ${d.npm}`);
      expect(JSON.parse(read("package.json")).scripts[d.npm]).toContain(`scripts/ops/${d.job}`);
    });
  }
  it("Toni's trading lane is untouched: both her duties are ops-lane local jobs", () => {
    const toni = DUTIES.filter((d) => d.seat === "emp_risk");
    expect(toni.length).toBe(2);
    expect(MIG).not.toMatch(/'emp_risk', 'trading'/);
    expect(MIG).not.toMatch(/trading_authority\s+SET|UPDATE employees/);
  });
});

describe("quiet unless something moves", () => {
  it("a first-day ok is not news; a new alert, a stop and a cleared alert are", () => {
    const r = [{ key: "a", state: "ok", line: "" }, { key: "b", state: "alert", line: "" }, { key: "c", state: "stop", line: "" }];
    expect(movedReadings(r, {}).map((m) => m.key)).toEqual(["b", "c"]);
    expect(movedReadings(r, stateMap(r))).toEqual([]);
    expect(movedReadings([{ key: "b", state: "ok", line: "" }], { b: "alert" }).map((m) => m.state)).toEqual(["ok"]);
    expect(movedReadings([], { gone: "alert", note: "notice" }).map((m) => m.key)).toEqual(["gone"]);
  });
  it("every source unreadable is a named stop, not a quiet day", () => {
    expect(readNothingStop([{ key: "x", state: "stop", line: "" }], "X")).toMatch(/^NAMED STOP \[X\]/);
    expect(readNothingStop([], "X")).toMatch(/NAMED STOP/);
    expect(readNothingStop([{ key: "x", state: "ok", line: "" }], "X")).toBeNull();
  });
});

describe("Toni's judgements", () => {
  it("OpenRouter: below $0 and any new spend alert", () => {
    expect(openrouterReading({ total_credits: 10, total_usage: 10.5 }, 10.5).state).toBe("alert");
    expect(openrouterReading({ total_credits: 10, total_usage: 2.01 }, 2).state).toBe("alert");
    expect(openrouterReading({ total_credits: 10, total_usage: 2 }, 2).state).toBe("ok");
    expect(openrouterReading({}, 0).state).toBe("stop");
  });
  it("renewals inside 30 days alert, with the date", () => {
    const now = Date.parse("2026-10-22T00:00:00Z");
    const exp = rdapExpiry({ events: [{ eventAction: "expiration", eventDate: "2026-11-10T00:00:00Z" }] });
    expect(renewalReading("x.com", exp, now)).toMatchObject({ state: "alert" });
    expect(renewalReading("x.com", Date.parse("2027-06-01T00:00:00Z"), now).state).toBe("ok");
    expect(renewalReading("x.com", null, now).state).toBe("stop");
  });
  it("a sender over complaint, bounce or unsubscribe thresholds is paused", () => {
    expect(senderPauseReason({ health_14d: { sent: 50, bounced: 0, complaints: 1 } })).toMatch(/complaint/);
    expect(senderPauseReason({ health_14d: { sent: 100, bounced: 4, complaints: 0 } })).toMatch(/bounce rate 4\.0%/);
    expect(senderPauseReason({ health_14d: { sent: 100, bounced: 0, complaints: 0 }, replies: { unsubscribe: 3 } })).toMatch(/unsubscribe rate 3\.0%/);
    expect(senderPauseReason({ health_14d: { sent: 100, bounced: 3, complaints: 0 }, replies: { unsubscribe: 2 } })).toBeNull();
  });
  it("DKIM: an empty p= is not a key", () => {
    expect(hasDkim(['"v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA"'])).toBe(true);
    expect(hasDkim(['"v=DKIM1; k=rsa; p="'])).toBe(false);
    expect(hasDkim([])).toBe(false);
  });
  it("a lock is a lock-sender with lock words; anything else is not", () => {
    expect(lockReading({ from: "LinkedIn <security@linkedin.com>", subject: "Your account has been restricted", date: "2026-10-20" }, "spry.vc")?.state).toBe("alert");
    expect(lockReading({ from_domain: "kdp.amazon.com", subject: "Your book is under review", date: "2026-10-20" }, "personal Gmail")).not.toBeNull();
    expect(lockReading({ from: "x@linkedin.com", subject: "You appeared in 9 searches" }, "spry.vc")).toBeNull();
    expect(lockReading({ from: "x@randomshop.com", subject: "Account suspended" }, "spry.vc")).toBeNull();
  });
});

describe("Zora's judgements", () => {
  it("reads the dates the documents use", () => {
    expect(dateIn("Last verified 12 Oct 2026.")).toBe(Date.UTC(2026, 9, 12));
    expect(dateIn("2026-09-30")).toBe(Date.UTC(2026, 8, 30));
    expect(dateIn("October 3, 2026")).toBe(Date.UTC(2026, 9, 3));
    expect(dateIn("no date")).toBeNull();
    expect(handoffTodayDate("# PINNED\n...\n## Today — 21 Oct 2026\n- x")).toBe(Date.UTC(2026, 9, 21));
  });
  it("finds the boss-os files the email map cites (hard fail on zero)", () => {
    const files = citedBossFiles(read("docs/OUTBOUND_EMAIL_MAP.md"));
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("scripts/ops/notify.mjs");
  });
  it("files Boss OS pieces and leaves the fund's to the fund", () => {
    expect(kindOf("Guide Homepage Preview")).toBe("mockup");
    expect(kindOf("The Learning Club Playbook")).toBe("playbook");
    expect(NOT_OURS_RE.test("West Peek OS — Deals section")).toBe(true);
    expect(NOT_OURS_RE.test("Porch & Party Rentals Mock")).toBe(false);
  });
});

describe("after the first live run (22 Oct 2026)", () => {
  const ev = (o: unknown) => JSON.stringify(o);
  const stream = (toolName: string | null, isError: boolean, result: string) => [
    ev({ type: "system", subtype: "init", tools: [] }),
    ...(toolName ? [
      ev({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: toolName, input: {} }] } }),
      ev({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: isError }] } }),
    ] : []),
    ev({ type: "result", result }),
  ].join("\n");

  it("a model that never reached the mailbox is a stop, not an empty mailbox", () => {
    expect(readClaudeStream(stream(null, false, "[]"), /gmail/i).ok).toBe(false);
    expect(readClaudeStream(stream("mcp__claude_ai_Gmail__search_threads", true, "[]"), /gmail/i).ok).toBe(false);
    expect(readClaudeStream(stream("ToolSearch", false, "[]"), /gmail/i).ok).toBe(false);
    const good = readClaudeStream(stream("mcp__claude_ai_Gmail__search_threads", false, "```json\n[]\n```"), /gmail/i);
    expect(good).toEqual({ ok: true, json: [] });
  });

  it("both Toni scripts require the Gmail tool to have answered, named exactly, through the one shared read", () => {
    expect(PERSONAL_GMAIL.requireTool.test("mcp__claude_ai_Gmail__search_threads")).toBe(true);
    expect(PERSONAL_GMAIL.requireTool.test("ToolSearch")).toBe(false);
    expect(PERSONAL_GMAIL.toolSearch).toBe("select:mcp__claude_ai_Gmail__search_threads");
    expect(PERSONAL_GMAIL.toolSearchFallback).toBe("gmail");
    expect(PERSONAL_GMAIL.attempts).toBeGreaterThanOrEqual(2);
    for (const f of ["scripts/ops/risk-watch.mjs", "scripts/ops/outside-locks.mjs"]) expect(read(f)).toMatch(/askClaudeJson\([\s\S]*?\.\.\.PERSONAL_GMAIL, evidence: "[a-z-]+"/);
  });

  describe("one bad attempt is not a lost week (13 Nov 2026: Toni's locks check never reached Gmail once)", () => {
  const ev = (o: unknown) => JSON.stringify(o);
  const reached = (result = "```json\n[]\n```") => [
    ev({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "ToolSearch", input: {} }] } }),
    ev({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false }] } }),
    ev({ type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "mcp__claude_ai_Gmail__search_threads", input: {} }] } }),
    ev({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", is_error: false, content: "MAIL" }] } }),
    ev({ type: "result", subtype: "success", result }),
  ].join("\n");
  const missed = [
    ev({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "ToolSearch", input: {} }] } }),
    ev({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false }] } }),
    ev({ type: "result", subtype: "success", result: "[]" }),
  ].join("\n");
  const runner = (outs: Array<{ stdout?: string; status?: number; error?: { code: string } }>) => {
    const prompts: string[] = [];
    const run = (_bin: string, args: string[]) => { prompts.push(String(args[1])); return outs[Math.min(prompts.length - 1, outs.length - 1)]; };
    return { run, prompts };
  };
  const dir = () => mkdtempSync(join(tmpdir(), "seat-runs-"));

  it("a run that never reached the tool is retried, and the next attempt's answer is accepted", () => {
    const r = runner([{ stdout: missed, status: 0 }, { stdout: reached(), status: 0 }]);
    const out = askClaudeJson("q", { ...PERSONAL_GMAIL, run: r.run, evidenceDir: dir(), evidence: "t" });
    expect(out).toEqual({ ok: true, json: [] });
    expect(r.prompts).toHaveLength(2);
    expect(r.prompts[0]).toContain('ToolSearch with query "select:mcp__claude_ai_Gmail__search_threads"');
    expect(r.prompts[0]).toContain('again with query "gmail"');
    expect(r.prompts[0]).toContain("Never answer from memory");
  });

  it("a run that reaches the tool first time is run once", () => {
    const r = runner([{ stdout: reached(), status: 0 }]);
    expect(askClaudeJson("q", { ...PERSONAL_GMAIL, run: r.run, evidenceDir: dir() }).ok).toBe(true);
    expect(r.prompts).toHaveLength(1);
  });

  it("a CLI that cannot start is not retried", () => {
    const r = runner([{ error: { code: "ENOENT" } }]);
    const out = askClaudeJson("q", { ...PERSONAL_GMAIL, run: r.run, evidenceDir: dir() });
    expect(out.ok).toBe(false);
    expect(r.prompts).toHaveLength(1);
  });

  it("every attempt missing is still a stop, and the why names the tools called and the attempts", () => {
    const r = runner([{ stdout: missed, status: 0 }]);
    const out = askClaudeJson("q", { ...PERSONAL_GMAIL, run: r.run, evidenceDir: dir() });
    expect(out.ok).toBe(false);
    expect(r.prompts).toHaveLength(PERSONAL_GMAIL.attempts);
    if (!out.ok) {
      expect(out.why).toContain("never reached the tool");
      expect(out.why).toContain("ToolSearch (ok)");
      expect(out.why).toContain(`${PERSONAL_GMAIL.attempts} attempts`);
    }
    const exited = askClaudeJson("q", { ...PERSONAL_GMAIL, attempts: 1, evidenceDir: dir(), run: runner([{ stdout: [ev({ type: "result", subtype: "error_max_turns", result: "" })].join("\n"), status: 1 }]).run });
    expect(exited.ok ? "" : exited.why).toMatch(/exited 1 \(error_max_turns\); it called no tool/);
  });

  it("evidence is kept for a run that never reached the tool, and never after the tool answered (no mail on disk)", () => {
    const d1 = dir();
    askClaudeJson("q", { ...PERSONAL_GMAIL, attempts: 1, run: runner([{ stdout: missed, status: 0 }]).run, evidenceDir: d1, evidence: "outside-locks-personal" });
    expect(readAbs(join(d1, "outside-locks-personal.jsonl"), "utf8")).toBe(missed);
    const d2 = dir();
    const out = askClaudeJson("q", { ...PERSONAL_GMAIL, attempts: 1, run: runner([{ stdout: reached("not json"), status: 0 }]).run, evidenceDir: d2, evidence: "outside-locks-personal" });
    expect(out.ok).toBe(false);
    expect(existsSync(join(d2, "outside-locks-personal.jsonl"))).toBe(false);
  });

  it("an existing caller with no attempts runs once, as before", () => {
    const r = runner([{ stdout: missed, status: 0 }]);
    expect(askClaudeJson("q", { requireTool: /gmail/i, run: r.run, evidenceDir: dir() }).ok).toBe(false);
    expect(r.prompts).toHaveLength(1);
  });
  });

  it("RDAP goes to the registry for .com and .org", () => {
    expect(rdapUrl("approvalprep.com")).toBe("https://rdap.verisign.com/com/v1/domain/approvalprep.com");
    expect(rdapUrl("hicksconsulting.org")).toBe("https://rdap.publicinterestregistry.org/rdap/domain/hicksconsulting.org");
    expect(rdapUrl("x.io")).toBe("https://rdap.org/domain/x.io");
    expect(read("scripts/ops/risk-watch.mjs")).toMatch(/"user-agent": "boss-os-risk-watch/);
  });

  it("Zora reads the gallery from an export, and a missing or stale one is a named stop", () => {
    const dir = mkdtempSync(join(tmpdir(), "zora-"));
    const now = Date.parse("2026-10-23T14:00:00Z");
    expect(readGalleryExport(join(dir, "none.json"), now)).toMatchObject({ ok: false });
    writeFileSync(join(dir, "old.json"), JSON.stringify({ exported_at: "2026-10-01T00:00:00Z", artifacts: [], open_loops: [] }));
    expect(readGalleryExport(join(dir, "old.json"), now)).toMatchObject({ ok: false });
    writeFileSync(join(dir, "ok.json"), JSON.stringify({ exported_at: "2026-10-22T00:00:00Z", artifacts: [{ title: "T", url: "https://claude.ai/artifact/x", updated: "2026-10-22" }], open_loops: [] }));
    expect(readGalleryExport(join(dir, "ok.json"), now)).toMatchObject({ ok: true });
    expect(read("scripts/ops/archive-audit.mjs")).not.toMatch(/askClaudeJson\(/);
  });
});
