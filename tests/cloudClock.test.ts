import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dueJobs, cronFiresAt, clockRows, clockRowProblems, CATCH_UP_MINUTES } from "../src/shared/boss/schedule/clock.mjs";

/**
 * BOSS OS'S OWN CLOCK (21 Nov 2026, Kendra's alarm mail:morning-email). GitHub's schedule event fired
 * this account's workflows once every 6-9 hours from 17 Nov, and the 21 Nov morning email was never
 * built. The Worker's five-minute cron now reads the Schedule rows marked `trigger.clock: "worker"`
 * and starts each due job once. These are the matcher's rules, each proven against its negative.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const M = JSON.parse(readFileSync(path.join(ROOT, "src/shared/boss/schedule/manifest.json"), "utf8"));
const at = (iso: string) => Date.parse(iso);
const ids = (now: number) => dueJobs(M, now).map((j: any) => j.id).sort();

describe("Boss OS's clock", () => {
  it("fires the eight boss-os GitHub jobs, and the Schedule says so (rule 0: never zero rows)", () => {
    expect(clockRows(M).map((r: any) => r.id).sort()).toEqual(["catchups", "errand-reminders", "growth-scoreboard", "preseed-watch", "properties", "t2r-numbers", "waiting-on", "your-day"]);
    expect(clockRowProblems(M)).toEqual([]);
    // NEGATIVE: a row with no event, or a cron the clock cannot read, is named.
    const bad = { rows: [{ id: "x", trigger: { clock: "worker", repo: "boss-os", file: "f.yml", crons: ["CRON_TZ=Europe/Paris 0 7 * * *"] } }] };
    expect(clockRowProblems(bad).join()).toMatch(/x: a worker-clocked row needs trigger.event/);
    expect(clockRowProblems(bad).join()).toMatch(/cannot be read by Boss OS's clock/);
  });

  it("starts the morning email at 06:40 Central in winter AND summer (DST)", () => {
    // 21 Nov 2026 is CST (UTC-6): 06:40 Central is 12:40Z.
    const winter = dueJobs(M, at("2026-11-21T12:40:20Z")).find((j: any) => j.id === "your-day");
    expect(winter).toMatchObject({ event: "job-your-day", key: "your-day:2026-11-21:06:40" });
    // 21 Jul 2026 is CDT (UTC-5): 06:40 Central is 11:40Z.
    expect(dueJobs(M, at("2026-07-21T11:40:00Z")).find((j: any) => j.id === "your-day")?.key).toBe("your-day:2026-07-21:06:40");
    // NEGATIVE: 06:40 UTC-offset-wrong (11:40Z in winter is 05:40 Central): nothing due for the morning.
    expect(dueJobs(M, at("2026-11-21T11:40:00Z")).find((j: any) => j.id === "your-day")).toBeUndefined();
  });

  it("an outage costs ONE catch-up per job, the latest slot inside the window, never a replay", () => {
    // The Worker was down 06:30-07:34 Central: at 07:35 only 07:30 counts for the morning email (not 06:40, 07:10).
    const late = dueJobs(M, at("2026-11-21T13:35:00Z"));
    const day = late.filter((j: any) => j.id === "your-day");
    expect(day.map((j: any) => j.key)).toEqual(["your-day:2026-11-21:07:30"]);
    expect(late.filter((j: any) => j.id === "errand-reminders").map((j: any) => j.key)).toEqual(["errand-reminders:2026-11-21:07:30"]);
    // Each job appears at most once per tick.
    expect(new Set(late.map((j: any) => j.id)).size).toBe(late.length);
    // NEGATIVE: past the window, a missed slot is gone (09:30 is not refired at 10:01; 12:30 is still ahead).
    expect(dueJobs(M, at("2026-11-21T16:01:00Z")).find((j: any) => j.id === "your-day")).toBeUndefined();
    expect(CATCH_UP_MINUTES).toBe(30);
  });

  it("the same slot carries the same key on two ticks, so D1 starts it once", () => {
    const a = dueJobs(M, at("2026-11-21T15:30:05Z")).find((j: any) => j.id === "your-day");
    const b = dueJobs(M, at("2026-11-21T15:35:02Z")).find((j: any) => j.id === "your-day");
    expect(a?.key).toBe("your-day:2026-11-21:09:30");
    expect(b?.key).toBe(a?.key);
  });

  it("weekly jobs fire on their day only", () => {
    // Tuesday 24 Nov 2026 07:30 Central = 13:30Z: the pre-seed watch; Wednesday's two do not.
    expect(ids(at("2026-11-24T13:30:00Z"))).toContain("preseed-watch");
    expect(ids(at("2026-11-24T13:30:00Z"))).not.toContain("t2r-numbers");
    expect(ids(at("2026-11-25T13:30:00Z"))).toContain("t2r-numbers");
    expect(ids(at("2026-11-25T13:30:00Z"))).not.toContain("preseed-watch");
  });

  it("reads plain crons in UTC and CRON_TZ crons on the Central wall clock", () => {
    expect(cronFiresAt("*/10 * * * *", at("2026-11-21T03:20:00Z"))).toBe(true);
    expect(cronFiresAt("*/10 * * * *", at("2026-11-21T03:25:00Z"))).toBe(false);
    expect(cronFiresAt("CRON_TZ=America/Chicago 30 7 * * 2", at("2026-11-24T13:30:00Z"))).toBe(true);
    expect(cronFiresAt("30 7 * * 2", at("2026-11-24T13:30:00Z"))).toBe(false);
    expect(cronFiresAt("CRON_TZ=Europe/Paris 30 7 * * 2", at("2026-11-24T06:30:00Z"))).toBe(false);
  });
});
