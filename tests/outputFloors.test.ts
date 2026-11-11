import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  parseOutputLine, outputLine, floorVerdict, floorAlarmText, firstRunLoop, firstRunMet,
  staleTaskVerdict, staleTaskText, usualDuration, pollingHoursMs, NEVER_CLAIMED_POLLING_MS, ownerMailVerdicts, ownerMailText, errorClass,
} from "../src/shared/boss/alarms/rules.mjs";
import { outputProblems, migrationFloors, dutyFloorProblems } from "../scripts/ops/lib/schedule.mjs";

/**
 * STOP "GREEN BUT DID NOTHING" (owner, 5 Nov 2026). The rules Kendra's alarms run on:
 * src/shared/boss/alarms/rules.mjs, read by the Worker (alarms/kendra.ts) and her Mac
 * (scripts/ops/owner-mail-watch.mjs).
 */

const DUTY = { name: "Office Christmas outreach", output_metric: "emails sent", output_floor: 1, output_runs: 2 };
const day = (d: string, hm = "16:30") => Date.parse(`2026-11-${d}T${hm}:00Z`);
const run = (outcome: "ok" | "failed", output_count: number | null, at: number) => ({ outcome, output_count, finished_at: at });

describe("the census line", () => {
  it("records the prospect census even on early returns or throws, and permits a day with nobody due", () => {
    const script = readFileSync("scripts/ops/lp-prospects.mjs", "utf8");
    expect(script).toMatch(/finally\s*\{\s*console\.log\(outputLine\(sent, "emails sent"\)\)/);
    expect(readFileSync("scripts/validate/every-job-names-its-output.mjs", "utf8")).not.toMatch(/"lp-prospects\.mjs":/);
    const manifest = JSON.parse(readFileSync("src/shared/boss/schedule/manifest.json", "utf8"));
    expect(manifest.rows.find((r: any) => r.id === "prospects").output).toEqual({ floor: 0, reason: "Sends only the touches the cadence makes due; a day with nobody due sends none, and a due-but-held day is its own named stop." });
    expect(floorVerdict({ ...DUTY, output_floor: 0 }, [run("ok", null, 1), run("ok", null, 2)])).toMatchObject({ alarm: false, low: 0 });
  });
  it("reads the last OUTPUT line a job printed", () => {
    expect(parseOutputLine("LIVE: 8 sent\nOUTPUT 3 emails sent\nOUTPUT 8 emails sent\nRecorded")).toEqual({ count: 8, metric: "emails sent" });
    expect(outputLine(8, "emails sent")).toBe("OUTPUT 8 emails sent");
  });
  it("finds none in a job that only printed its old census, so the output is unknown", () => {
    expect(parseOutputLine("LIVE: 0 sent, 0 planned.\nRecorded against duty_pnp_corporate_outreach")).toBeNull();
    expect(parseOutputLine("  OUTPUT x emails")).toBeNull();
  });
});

describe("the floor check (A)", () => {
  it("alarms after two green runs that each produced 0", () => {
    const v = floorVerdict(DUTY, [run("ok", 0, day("05")), run("ok", 0, day("04"))]);
    expect(v.alarm).toBe(true);
    expect(floorAlarmText(DUTY, v)).toBe("Office Christmas outreach ran but produced 0 emails sent (needs 1), 2 runs in a row.");
  });
  it("stays quiet on one low run: a quiet day is not a fault", () => {
    expect(floorVerdict(DUTY, [run("ok", 0, day("05")), run("ok", 8, day("04"))]).alarm).toBe(false);
    expect(floorVerdict(DUTY, [run("ok", 0, day("05"))]).alarm).toBe(false);
  });
  it("counts a run with no OUTPUT line, and a failed run, as below the floor", () => {
    const v = floorVerdict(DUTY, [run("ok", null, day("05")), run("failed", null, day("04"))]);
    expect(v.alarm).toBe(true);
    expect(floorAlarmText(DUTY, v)).toContain("an unknown number of emails sent (it printed no OUTPUT line)");
  });
  it("never alarms a job that only checks (floor 0)", () => {
    expect(floorVerdict({ ...DUTY, output_floor: 0 }, [run("ok", 0, 1), run("ok", 0, 2), run("ok", 0, 3)]).alarm).toBe(false);
  });

  /*
   * THE REPLAY: P&P corporate outreach's real runs, production duty_runs + its run logs
   * (~/Library/Logs/boss-duty/pnp-corporate-outreach.mjs-2026-11-0*.log):
   *   Mon 2 Nov  failed  "Outreach stopped safely"
   *   Tue 3 Nov  ok      "LIVE: 0 sent, 0 planned."
   *   Wed 4 Nov  not recorded ("fetch failed" — Boss OS unreachable)
   *   Thu 5 Nov  ok      "LIVE: 0 sent, 0 planned."
   *   Fri 6 Nov  ok      "LIVE: 8 sent, 8 planned."
   */
  it("replays P&P outreach 2-6 Nov: the alarm fires on Tue 3 Nov and clears on Fri 6 Nov", () => {
    const history = [
      run("failed", null, day("02")),
      run("ok", 0, day("03", "16:27")),
      run("ok", 0, day("05", "15:26")),
      run("ok", 8, day("06", "15:33")),
    ];
    const firstAlarm = history.findIndex((_, i) => floorVerdict(DUTY, history.slice(0, i + 1).reverse()).alarm);
    expect(new Date(history[firstAlarm]!.finished_at).toISOString().slice(0, 10)).toBe("2026-11-03");
    expect(floorVerdict(DUTY, history.slice(0, 3).reverse()).low).toBe(3);
    expect(floorVerdict(DUTY, [...history].reverse()).alarm).toBe(false);
  });
});

describe("the first-run check (B)", () => {
  it("names the job, its metric and a date two days after it was created, owned by Kendra", () => {
    const loop = firstRunLoop({ id: "duty_x", name: "New job", created_at: Date.parse("2026-11-06T15:00:00Z"), output_metric: "emails sent", output_floor: 1 });
    expect(loop).toMatchObject({ source_key: "first-run#duty_x", title: "Check New job produced emails sent by 2026-11-08", owner: "emp_continuity", next_date: "2026-11-08" });
  });
  it("closes only on a run at or above the floor", () => {
    expect(firstRunMet(run("ok", 0, 1), 1)).toBe(false);
    expect(firstRunMet(run("ok", null, 1), 1)).toBe(false);
    expect(firstRunMet(run("ok", 1, 1), 1)).toBe(true);
    expect(firstRunMet(run("ok", 0, 1), 0)).toBe(true);
    expect(firstRunMet(run("failed", 5, 1), 0)).toBe(false);
  });
});

describe("a task that sits running (G2)", () => {
  const now = Date.parse("2026-11-06T15:40:00Z");
  // The DNA research task: started 13:00 UTC, one claim event, still running.
  const dna = { started_at: Date.parse("2026-11-06T13:00:01Z"), last_progress_at: Date.parse("2026-11-06T13:00:01Z") };
  it("alarms past two hours with no progress, naming the title and the seat", () => {
    const v = staleTaskVerdict(dna, null, now);
    expect(v.stale).toBe(true);
    expect(staleTaskText({ title: "Deep research: a mobile DNA collection business", seat: "bk_codex" }, v))
      .toBe('"Deep research: a mobile DNA collection business" has been running 2 h 40 min on bk_codex, with no recorded progress for 2 h 40 min.');
  });
  it("alarms at twice its usual duration, and not before", () => {
    const usual = usualDuration([10, 12, 15, 20, 25].map((m) => m * 60_000))!;
    expect(usual).toBe(15 * 60_000);
    expect(staleTaskVerdict({ started_at: now - 29 * 60_000, last_progress_at: now }, usual, now).stale).toBe(false);
    expect(staleTaskVerdict({ started_at: now - 31 * 60_000, last_progress_at: now }, usual, now)).toMatchObject({ stale: true, why: "twice_usual" });
  });
  it("leaves a long task alone while it keeps reporting progress", () => {
    expect(staleTaskVerdict({ started_at: now - 3 * 3_600_000, last_progress_at: now - 10 * 60_000 }, null, now).stale).toBe(false);
  });
  it("trusts a usual duration only from five finished runs", () => {
    expect(usualDuration([1, 2, 3, 4])).toBeNull();
  });

  // 9 Nov 2026, the recorded instants: "Executive Intelligence Report" entered the cloud at 12:07:09Z,
  // its run was parked on bk_claude_code at 12:07:10Z, and her Mac was off until ~13:36Z.
  const eir = {
    started_at: Date.parse("2026-11-09T12:07:09.298Z"),
    parked_at: Date.parse("2026-11-09T12:07:10.370Z"),
    last_progress_at: Date.parse("2026-11-09T12:07:10.653Z"),
  };
  const alarmAt = Date.parse("2026-11-09T13:00:31.538Z");
  const nineMin = 9 * 60_000;
  it("never calls work parked on a seat that no machine claimed 'running'", () => {
    const v = staleTaskVerdict({ ...eir, claimed_at: null, parked: true }, nineMin, alarmAt);
    expect(v).toMatchObject({ stale: false, why: "waiting_for_seat" });
  });
  it("measures a claimed run from its claim, and still alarms on it", () => {
    const claimed = Date.parse("2026-11-09T12:08:00Z");
    const v = staleTaskVerdict({ ...eir, claimed_at: claimed, parked: false, last_progress_at: claimed }, nineMin, Date.parse("2026-11-09T13:01:00Z"));
    expect(v).toMatchObject({ stale: true, why: "twice_usual" });
    expect(v.age).toBe(53 * 60_000);
    // Claimed 12:50, so 11 minutes of work at 13:01 is not twice nine with the 30-minute floor.
    expect(staleTaskVerdict({ ...eir, claimed_at: Date.parse("2026-11-09T12:50:00Z"), parked: false }, nineMin, Date.parse("2026-11-09T13:01:00Z")).stale).toBe(false);
  });
  it("says a run nobody claims through four polling hours, in the words of waiting", () => {
    const later = eir.parked_at + 4 * 3_600_000 + 60_000; // 16:08Z = 10:08 Central, all inside the window
    const v = staleTaskVerdict({ ...eir, claimed_at: null, parked: true }, nineMin, later);
    expect(v).toMatchObject({ stale: true, why: "never_claimed" });
    const text = staleTaskText({ title: "Executive Intelligence Report", seat: null, parked_on: "bk_claude_code" }, v);
    expect(text).toBe('"Executive Intelligence Report" has been waiting 4 h 01 min for bk_claude_code to pick it up; no machine ever claimed it.');
    expect(text).not.toMatch(/running/);
  });
  it("counts only the hours her Mac polls (06:00-22:00 Central)", () => {
    // 21:00 CST (03:00Z) to 06:05 CST next day (12:05Z): one hour before 22:00, five minutes after 06:00.
    expect(pollingHoursMs(Date.parse("2026-11-10T03:00:00Z"), Date.parse("2026-11-10T12:05:00Z"))).toBe(65 * 60_000);
    // A Mac off from 22:00 to 06:00 never makes a parked run stale.
    const night = { started_at: Date.parse("2026-11-10T04:00:00Z"), parked: true, claimed_at: null };
    expect(staleTaskVerdict(night, nineMin, Date.parse("2026-11-10T12:00:00Z")).stale).toBe(false);
    expect(NEVER_CLAIMED_POLLING_MS).toBe(4 * 3_600_000);
  });
});

describe("owner emails that fail (G1)", () => {
  const wynn = (at: string, ok: boolean) => ({ app: "West Peek OS", subject: "Wynn: TLC: this week's brands, 0 to approve · TLC-Z8N66X", ok, detail: ok ? null : "resend rejected the send (HTTP 401)", at });
  it("alarms on two failures in a row with app, subject kind and error class, and no body or address", () => {
    const [v, ...rest] = ownerMailVerdicts([wynn("2026-11-02T06:34:19Z", false), wynn("2026-11-02T07:34:19Z", false)]);
    expect(rest).toEqual([]);
    expect(v).toMatchObject({ app: "West Peek OS", subject: "Wynn: TLC: this week's brands, N to approve", errorClass: "auth (HTTP 401)", fails: 2, hers: true });
    expect(ownerMailText(v!)).toBe(`West Peek OS: owner emails "Wynn: TLC: this week's brands, N to approve" failed 2 times in a row (auth (HTTP 401)). The sending key was refused, which only you can renew.`);
    expect(ownerMailText(v!)).not.toMatch(/@/);
  });
  it("stays quiet on one failure, and once the newest send went", () => {
    expect(ownerMailVerdicts([wynn("2026-11-02T06:00:00Z", false)])).toEqual([]);
    expect(ownerMailVerdicts([wynn("2026-11-02T06:00:00Z", false), wynn("2026-11-02T07:00:00Z", false), wynn("2026-11-06T15:05:00Z", true)])).toEqual([]);
  });
  it("treats an auth failure as the app's key: any later send of that app clears it", () => {
    const roundup = { app: "West Peek OS", subject: "Wynn: TLC roundup, week of Mon 2 Nov 2026", ok: false, detail: "HTTP 401", at: "2026-11-02T23:00:00Z" };
    expect(ownerMailVerdicts([roundup, { ...roundup, at: "2026-11-02T23:30:00Z" }])).toHaveLength(1);
    expect(ownerMailVerdicts([roundup, { ...roundup, at: "2026-11-02T23:30:00Z" }, wynn("2026-11-06T15:05:00Z", true)])).toEqual([]);
  });
  it("names the error by class", () => {
    expect(errorClass("422 {\"held\":true,\"problems\":[\"longer than 9000 characters\"]}")).toBe("refused (HTTP 422)");
    expect(errorClass("fetch failed")).toBe("network");
  });
});

describe("the registry: every Schedule row names its output", () => {
  const manifest = JSON.parse(readFileSync("src/shared/boss/schedule/manifest.json", "utf8"));
  const sql = readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(`migrations/${f}`, "utf8")).join("\n");
  it("the real manifest is clean and agrees with the duties' floors", () => {
    expect(outputProblems(manifest)).toEqual([]);
    expect(dutyFloorProblems(manifest, migrationFloors(sql))).toEqual([]);
    expect(manifest.rows.find((r: any) => r.trigger?.duty === "duty_pnp_corporate_outreach").output).toEqual({ metric: "emails sent", floor: 1, runs: 2 });
  });
  it("catches a producing job with no metric, and a check with no reason", () => {
    const bad = { rows: [{ id: "a", output: { floor: 1, runs: 2 } }, { id: "b", output: { floor: 0 } }, { id: "c" }] };
    expect(outputProblems(bad)).toHaveLength(3);
    expect(outputProblems({ rows: [] })).toHaveLength(1);
  });
});
