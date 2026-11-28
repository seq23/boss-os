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
import { LOCK_MAIL, lockReading } from "../scripts/ops/outside-locks.mjs";
import { scanToniMailbox, scanToniConnector, reconcileToniReadings, personalToken, personalGrantPresent, nameToniHeld } from "../scripts/ops/lib/toni-mail.mjs";
import { BILLING_MAIL, unreadKeys } from "../scripts/ops/risk-watch.mjs";
import { citedBossFiles, dateIn, handoffTodayDate, kindOf, NOT_OURS_RE, readGalleryExport, sideBusinessReading } from "../scripts/ops/archive-audit.mjs";
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
    expect(openrouterReading({ total_credits: 10, total_usage: 2.01 }, 2).state).toBe("ok"); // inside her prepaid credit: quiet (25 Nov 2026)
    // 23 Nov 2026 live read: the spend reads in cents as a sentence, never "$0.5225".
    expect(openrouterReading({ total_credits: 10, total_usage: 2.5225 }, 2).line).toMatch(/^OpenRouter used \$0\.52 of the prepaid credit since the last check; \$7\.48 is left/);
    expect(openrouterReading({ total_credits: 10, total_usage: 2.004 }, 2).line).toMatch(/used under 1 cent/);
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
  it("a model-read lock from an unlisted sender reaches Toni even with an opaque subject", async () => {
    const message = { id: "m1", internalDate: Date.parse("2026-11-20T13:00:00Z"), headers: { from: "notices@small-platform.example", subject: "Your access changed" }, body: "Until you appeal, you cannot use your account." };
    const scan = await scanToniMailbox({ token: async () => "fixture", rule: LOCK_MAIL, now: message.internalDate + 1000,
      list: async () => [["t1", new Set(["m1"])]], load: async () => [message], read: async (input) => {
        expect(JSON.parse(input.source).thread).toEqual([message]);
        return { status: "ok", provider: "workers-ai", text: JSON.stringify({ notices: [{ id: "m1", kind: "lock", vendor: "", detail: "" }] }), inTokens: 1, outTokens: 1 };
      } });
    expect(scan.why).toBeNull();
    expect(lockReading(scan.notices[0]!, "fixture", "spry")).toMatchObject({ state: "alert", domain: "small-platform.example" });
  });
  it("Toni's personal mailbox requires an explicit read-only grant", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ access_token: "fixture", scope: "https://www.googleapis.com/auth/gmail.modify" }), { status: 200 });
    await expect(personalToken({ env: {}, fetchImpl })).rejects.toThrow("TONI_PERSONAL_GMAIL_GRANT");
    await expect(personalToken({ env: { TONI_GMAIL_CLIENT_ID: "fixture", TONI_GMAIL_CLIENT_SECRET: "fixture", TONI_GMAIL_REFRESH_TOKEN: "fixture" }, fetchImpl })).rejects.toThrow("requires a Gmail read-only grant");
  });
  it("an uncertain old thread never stalls the mailbox: the new failed payment alerts on run 1, the old one is held and named by run 3 (#584 review F1)", async () => {
    const now = Date.parse("2026-11-27T18:00:00Z");
    const old = { id: "m-old", internalDate: now - 5 * 86_400_000, headers: { from: "x@vendor.example", subject: "Re: account" }, body: "?" };
    const fresh = { id: "m-new", internalDate: now - 3_600_000, headers: { from: "billing@host.example", subject: "Payment failed" }, body: "We could not charge your card." };
    const threads: Record<string, typeof old> = { "t-old": old, "t-new": fresh };
    const run = (previous = {}) => scanToniMailbox({ token: async () => "fixture", rule: BILLING_MAIL, now, previous, mailbox: "staylor@spry.vc",
      // Gmail lists newest first.
      list: async () => [["t-new", new Set(["m-new"])], ["t-old", new Set(["m-old"])]], load: async (id: string) => [threads[id]!],
      read: async (input: { source: string }) => {
        const id = JSON.parse(input.source).targets[0];
        const kind = id === "m-old" ? "uncertain" : "payment_failed";
        return { status: "ok", provider: "workers-ai", text: JSON.stringify({ notices: [{ id, kind, vendor: id === "m-new" ? "Host" : "", detail: "" }] }), inTokens: 1, outTokens: 1 };
      } });
    const r1 = await run();
    expect(r1.notices.map((n) => n.id)).toEqual(["m-new"]);
    expect(r1.why).toMatch(/could not decide/);
    expect(r1.held).toEqual([]);
    const r2 = await run(r1.checkpoint);
    expect(r2.held).toEqual([]);
    const r3 = await run(r2.checkpoint);
    expect(r3.held).toEqual([{ id: "m-old", link: "https://mail.google.com/mail/u/staylor%40spry.vc/#all/m-old" }]);
    expect(r3.why).toBeNull();
    expect(r3.notices.map((n) => n.id)).not.toContain("m-old");
    const r4 = await run(r3.checkpoint);
    expect(r4.held).toEqual([]);
    expect(r4.why).toBeNull();
    const lines: unknown[] = [];
    expect(await nameToniHeld([{ held: r3.held }], "charge or billing emails", { add: (_s: string, x: { lines: unknown[] }) => lines.push(...x.lines) })).toBe(1);
    expect(JSON.stringify(lines)).toContain("held for you");
  });
  it("a reader answer in the wrong shape counts as uncertain and is held by run 3, never a stall (#584 recheck R2)", async () => {
    const now = Date.parse("2026-11-27T18:00:00Z");
    const msg = { id: "m9", internalDate: now - 86_400_000, headers: { from: "x@y.example", subject: "Notice" }, body: "?" };
    const run = (previous = {}) => scanToniMailbox({ token: async () => "fixture", rule: BILLING_MAIL, now, previous, mailbox: "staylor@spry.vc",
      list: async () => [["t9", new Set(["m9"])]], load: async () => [msg],
      read: async () => ({ status: "uncertain", provider: "workers-ai", text: "", inTokens: 1, outTokens: 1 }) });
    const r1 = await run(); const r2 = await run(r1.checkpoint); const r3 = await run(r2.checkpoint);
    expect(r1.why).toMatch(/could not decide/);
    expect(r3.held.map((h) => h.id)).toEqual(["m9"]);
    expect(r3.why).toBeNull();
  });
  it("one thread that fails to load never hides the threads after it", async () => {
    const now = Date.parse("2026-11-27T18:00:00Z");
    const fresh = { id: "m2", internalDate: now - 1000, headers: { from: "a@b.example", subject: "Account suspended" }, body: "Suspended." };
    const scan = await scanToniMailbox({ token: async () => "fixture", rule: LOCK_MAIL, now,
      list: async () => [["t1", new Set(["m1"])], ["t2", new Set(["m2"])]],
      load: async (id: string) => { if (id === "t1") throw new Error("Gmail API read failed (500)"); return [fresh]; },
      read: async () => ({ status: "ok", provider: "workers-ai", text: JSON.stringify({ notices: [{ id: "m2", kind: "lock", vendor: "", detail: "" }] }), inTokens: 1, outTokens: 1 }) });
    expect(scan.notices.map((n) => n.id)).toEqual(["m2"]);
    expect(scan.why).toMatch(/500/);
  });
  it("her personal Gmail stays on the connector until the read-only grant exists, so the check never goes dark (#584 review F2)", () => {
    expect(personalGrantPresent({})).toBe(false);
    expect(personalGrantPresent({ TONI_GMAIL_CLIENT_ID: "x", TONI_GMAIL_CLIENT_SECRET: "x", TONI_GMAIL_REFRESH_TOKEN: "x" })).toBe(true);
    let asked = "";
    const scan = scanToniConnector({ rule: BILLING_MAIL, now: Date.parse("2026-11-27T18:00:00Z"), ask: (prompt: string) => { asked = prompt; return { ok: true, json: [
      { id: "p1", from_domain: "stripe.com", subject: "Payment failed", date: "2026-11-27", kind: "payment_failed", vendor: "Acme", detail: "Card declined." },
      { id: "p2", from_domain: "att.com", subject: "Your bill", date: "2026-11-27", kind: "personal", vendor: "", detail: "" },
    ] }; } });
    expect(asked).toContain("Use the Gmail tool");
    expect(asked).toContain("payment failed");
    expect(scan.why).toBeNull();
    expect(scan.notices.find((n) => n.id === "p1")).toMatchObject({ kind: "payment_failed", vendor: "Acme" });
    const down = scanToniConnector({ rule: BILLING_MAIL, ask: () => ({ ok: false, why: "connector offline" }) });
    expect(down.why).toMatch(/connector offline/);
    expect(down.notices).toEqual([]);
  });
  it("only the unread mailbox holds its saved charge alerts; spry.vc still clears when it was read", () => {
    const states = { "billing-problem:host.example:m1": "alert", "charge:p9": "notice", "billing-problem:old.example:m0": "alert", "renewal:x.com": "ok" };
    const owners = { "billing-problem:host.example:m1": "spry", "charge:p9": "personal" };
    expect(unreadKeys(states, owners, new Set(["personal"]))).toEqual(["charge:p9", "billing-problem:old.example:m0"]);
    expect(unreadKeys(states, owners, new Set())).toEqual([]);
  });
  it("an unread lock window does not clear a previous lock", async () => {
    const scan = await scanToniMailbox({ token: async () => { throw new Error("fixture outage"); }, rule: LOCK_MAIL });
    expect(scan.why).toBe("fixture outage");
    const previous = { "lock:spry:small-platform.example:m1": "alert" };
    expect(reconcileToniReadings([], previous, ["lock:spry:"])).toEqual({ states: previous, moved: [] });
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
  it("ages the Side Business Review by its date line, never by a commit that left the date alone (20 Nov 2026)", () => {
    const now = Date.UTC(2026, 10, 20, 12);
    const doc = (d: string) => `Source: x\n\n# Side Business Review\n\n*as of ${d}*\n`;
    expect(sideBusinessReading(doc("Friday 20 November 2026"), null, now)).toMatchObject({ state: "ok", line: "Side Business Review refreshed 0 days ago." });
    const stale = sideBusinessReading(doc("Friday 16 October 2026"), now - 3_600_000, now);
    expect(stale).toMatchObject({ state: "alert", owner: "Danielle", fix: "boss-os docs/SIDE_BUSINESS_REVIEW.md" });
    expect(stale.line).toBe("Side Business Review last refreshed 35 days ago.");
    const undated = sideBusinessReading("Source: x\n# Side Business Review\n", now - 2 * 86_400_000, now);
    expect(undated).toMatchObject({ state: "ok" });
    expect(undated.line).toMatch(/no date line; read from its last commit/);
    expect(sideBusinessReading("no date", null, now)).toMatchObject({ state: "alert", owner: "Zora" });
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

  it("the legacy personal Gmail connector still requires the named Gmail tool", () => {
    expect(PERSONAL_GMAIL.requireTool.test("mcp__claude_ai_Gmail__search_threads")).toBe(true);
    expect(PERSONAL_GMAIL.requireTool.test("ToolSearch")).toBe(false);
    expect(PERSONAL_GMAIL.toolSearch).toBe("select:mcp__claude_ai_Gmail__search_threads");
    expect(PERSONAL_GMAIL.toolSearchFallback).toBe("gmail");
    expect(PERSONAL_GMAIL.attempts).toBeGreaterThanOrEqual(2);
  });

  describe("the legacy connector retries when a seat never reaches Gmail", () => {
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
