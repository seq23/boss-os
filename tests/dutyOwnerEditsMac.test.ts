/**
 * THE MAC HALF OF THE OWNER'S DUTY EDITS (Builder U, 23 Oct 2026).
 *
 * A setting no code reads is a defect. The Worker half (tests/boss/dutyOwnerEdits.test.ts) proves the
 * edit reaches the cron's task and /brief; this file proves the Mac job itself receives it: the real
 * duty-run.sh, run against a stub Boss OS, hands her instructions to the command it wraps, and a
 * paused duty's command never runs at all.
 */
import { describe, expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { plan } from "../scripts/ops/duty-brief.mjs";
import { DUTY_PROMPT_FILES, briefDecision, choicesFor, choiceOf, scheduleFromChoice, macDueToday } from "../src/shared/boss/duties/ownerEdits.mjs";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const brief = (over: Record<string, unknown> = {}) => ({
  duty_id: "duty_mailbox_sweep", paused: false, removed: false, owner_schedule: false, due: true,
  reason: "due since 2026-10-23", instructions: null, version: null, ...over,
});

describe("duty-brief: what a Mac job does with the owner's word", () => {
  it("runs with her instructions when she wrote some", () => {
    const p = plan({ ok: true, data: brief({ instructions: "Only flag deals over $20M.", version: 3 }) });
    expect(p.code).toBe(0);
    expect(p.instructions).toBe("Only flag deals over $20M.");
    expect(p.lines[0]).toMatch(/your instructions \(version 3\)/);
  });
  it("runs on the repository's instructions when she wrote none", () => {
    const p = plan({ ok: true, data: brief() });
    expect(p.code).toBe(0);
    expect(p.instructions).toBeNull();
  });
  it("a paused or removed duty does not run, and says so by name", () => {
    expect(plan({ ok: true, data: brief({ paused: true, instructions: "x" }) })).toMatchObject({ code: 10, instructions: null });
    expect(plan({ ok: true, data: brief({ paused: true }) }).lines[0]).toMatch(/^SKIPPED \[PAUSED\]/);
    expect(plan({ ok: true, data: brief({ removed: true }) }).lines[0]).toMatch(/^SKIPPED \[REMOVED\]/);
  });
  it("a duty she rescheduled runs only on her days; one she did not keeps its own calendar", () => {
    expect(plan({ ok: true, data: brief({ owner_schedule: true, due: false }) }).code).toBe(10);
    expect(plan({ ok: true, data: brief({ owner_schedule: false, due: false }) }).code).toBe(0);
    expect(plan({ ok: true, data: brief({ owner_schedule: false, due: false }) }, { onlyIfDue: true }).code).toBe(10);
  });
  it("unreachable is a failure under --only-if-due, and a named note otherwise — never a quiet skip", () => {
    expect(plan({ ok: false, why: "down" }, { onlyIfDue: true }).code).toBe(6);
    const p = plan({ ok: false, why: "down" });
    expect(p.code).toBe(0);
    expect(p.lines[0]).toMatch(/^NOTE \[BRIEF_UNREACHABLE\]/);
  });
});

describe("schedules a Mac tick can honour", () => {
  it("a daily tick takes any choice; a weekly tick keeps its own day", () => {
    expect(choicesFor({ executor: "local_job", cadence: "daily", mac_tick: "daily" }).length).toBe(10);
    expect(choicesFor({ executor: "local_job", cadence: "weekly", weekday: 1, mac_tick: "weekly" }).map((c) => c.key)).toEqual(["weekly:1"]);
    // Narrowed to Mondays from a daily tick, it can still be widened back: the tick, not the row, decides.
    expect(choicesFor({ executor: "local_job", cadence: "weekly", weekday: 1, mac_tick: "daily" }).length).toBe(10);
    expect(choicesFor({ executor: "agent", cadence: "weekly", weekday: 1 }).length).toBe(10);
  });
  it("choices round-trip through the cadence columns", () => {
    for (const key of ["daily", "weekdays", "weekly:0", "weekly:5", "monthly"]) {
      const s = scheduleFromChoice(key)!;
      expect(choiceOf(s)).toBe(key);
    }
    expect(scheduleFromChoice("hourly")).toBeNull();
  });
  it("due by day, so a plist firing a few minutes before the row's time still runs", () => {
    const tz = "America/Chicago";
    const nextDue = Date.parse("2026-10-26T12:30:00Z"); // Mon 07:30 CDT
    expect(macDueToday({ next_due_at: nextDue, timezone: tz }, Date.parse("2026-10-26T12:15:00Z"))).toBe(true);
    expect(macDueToday({ next_due_at: nextDue, timezone: tz }, Date.parse("2026-10-25T23:00:00Z"))).toBe(false);
  });
});

describe("every prompt the page shows is the one the job reads", () => {
  it("the generated prompt module is in step with the files", () => {
    execFileSync("node", ["scripts/seed/generate-duty-prompts.mjs", "--check"], { cwd: ROOT, stdio: "pipe" });
  });
  const SCRIPT: Record<string, string> = {
    duty_inbound_supply: "scripts/ops/interest-extract.mjs",
    duty_mailbox_sweep: "scripts/ops/mailbox-sweep.sh",
    duty_site_audit_repair: "scripts/ops/ahrefs-audit-fix.sh",
    duty_kdp_surface: "scripts/ops/kdp-surface.sh",
  };
  it("every prompt-file duty's script reads BOSS_DUTY_PROMPT_FILE before its repo default", () => {
    expect(Object.keys(DUTY_PROMPT_FILES).sort()).toEqual(Object.keys(SCRIPT).sort());
    for (const [duty, script] of Object.entries(SCRIPT)) {
      const src = read(script);
      const file = path.basename((DUTY_PROMPT_FILES as Record<string, string>)[duty]!);
      const line = src.split("\n").find((l) => l.includes("BOSS_DUTY_PROMPT_FILE"));
      expect(line, `${script} must read BOSS_DUTY_PROMPT_FILE`).toBeTruthy();
      // The default prompt file is the fallback on the same expression, after her edit.
      const at = src.indexOf("BOSS_DUTY_PROMPT_FILE");
      expect(src.slice(at, at + 400)).toContain(file.replace(".md", ""));
    }
  });
});

/**
 * THE REAL WRAPPER, END TO END. A throwaway repo whose `vault:run` injects a fake passcode, the real
 * scripts symlinked in, and a stub Boss OS on localhost answering unlock, brief and ran.
 */
async function runWrapper(briefData: Record<string, unknown>) {
  const ran: unknown[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/api/boss/auth/unlock") { res.setHeader("set-cookie", "boss_session=t; Path=/"); res.end(JSON.stringify({ ok: true, data: {} })); return; }
      if (req.url?.startsWith("/api/boss/duties/brief/")) { res.end(JSON.stringify({ ok: true, data: briefData })); return; }
      if (req.url === "/api/boss/duties/ran") { ran.push(JSON.parse(body)); res.statusCode = 201; res.end(JSON.stringify({ ok: true, data: {} })); return; }
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  const tmp = mkdtempSync(path.join(tmpdir(), "duty-run-"));
  const repo = path.join(tmp, "repo");
  mkdirSync(repo);
  for (const d of ["scripts", "src", "node_modules"]) if (existsSync(path.join(ROOT, d))) symlinkSync(path.join(ROOT, d), path.join(repo, d));
  writeFileSync(path.join(repo, "package.json"), JSON.stringify({ type: "module", scripts: { "vault:run": "env BOSS_PASSCODE=test" } }));
  const out = path.join(tmp, "received.txt");
  // ASYNC, NOT spawnSync: the stub server lives in this process and must answer while the wrapper waits.
  const r = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn("bash", [path.join(ROOT, "scripts/ops/duty-run.sh"), "mailbox-sweep.sh", "--",
      "bash", "-c", `printf '%s' "\${BOSS_DUTY_PROMPT_FILE:+$(cat "$BOSS_DUTY_PROMPT_FILE")}" > "${out}"; echo ran >> "${out}.flag"`], {
      env: { ...process.env, HOME: tmp, BOSS_OS_REPO: repo, BOSS_OS_ORIGIN: `http://127.0.0.1:${port}` },
    });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("close", (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  await new Promise<void>((r) => server.close(() => r()));
  return {
    status: r.status, stdout: r.stdout + r.stderr, ran,
    commandRan: existsSync(`${out}.flag`),
    received: existsSync(out) ? readFileSync(out, "utf8") : null,
  };
}

describe("duty-run.sh hands the owner's edit to the job, and Pause stops it", () => {
  it("her edited instructions reach the wrapped command as BOSS_DUTY_PROMPT_FILE", async () => {
    const r = await runWrapper(brief({ instructions: "OWNER EDIT: only flag buyers at $20M and up.", version: 2 }));
    expect(r.status, r.stdout).toBe(0);
    expect(r.commandRan).toBe(true);
    expect(r.received).toBe("OWNER EDIT: only flag buyers at $20M and up.");
    expect(r.ran).toHaveLength(1);
  }, 90_000);

  it("with no edit, the command gets no prompt file and reads the repo's own", async () => {
    const r = await runWrapper(brief());
    expect(r.status, r.stdout).toBe(0);
    expect(r.commandRan).toBe(true);
    expect(r.received).toBe("");
  }, 90_000);

  it("a paused duty's command never runs and no run is recorded", async () => {
    const r = await runWrapper(brief({ paused: true, instructions: "ignored" }));
    expect(r.status, r.stdout).toBe(0);
    expect(r.commandRan).toBe(false);
    expect(r.ran).toHaveLength(0);
    expect(r.stdout).toMatch(/SKIPPED \[PAUSED\]/);
  }, 90_000);

  it("briefDecision is the one rule both halves share", () => {
    expect(briefDecision(brief({ paused: true }) as any).run).toBe(false);
  });
});
