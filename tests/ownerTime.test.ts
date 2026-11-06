// Times she reads follow the zone her Mac is on, with Central in brackets when different (6 Nov 2026).
import { describe, expect, it } from "vitest";
import { ownerTime, ownerZone, HOME_TZ } from "../src/shared/boss/ownerTime.mjs";
import { syncOwnerZone, zoneFromLink } from "../scripts/ops/owner-zone.mjs";

const at = Date.parse("2026-11-09T14:00:00Z"); // 8:00 AM Central, 9:00 AM Eastern (both standard time)

describe("ownerTime: her zone, Central in brackets", () => {
  it("New York → ET with CT in brackets", () => expect(ownerTime(at, { tz: "America/New_York" })).toBe("9:00 AM ET (8:00 AM CT)"));
  it("Chicago → CT alone", () => expect(ownerTime(at, { tz: "America/Chicago" })).toBe("8:00 AM CT"));
  it("unset or nonsense → Central, never guessed", () => {
    expect(ownerTime(at, {})).toBe("8:00 AM CT");
    expect(ownerTime(at, { tz: "Mars/Olympus" })).toBe("8:00 AM CT");
    expect(ownerZone(null)).toBe(HOME_TZ);
  });
  it("summer time too (CDT/EDT)", () => expect(ownerTime(Date.parse("2026-07-01T13:30:00Z"), { tz: "America/New_York" })).toBe("9:30 AM ET (8:30 AM CT)"));
});

describe("the Mac tells Boss OS its zone", () => {
  const fake = (have: string | null) => {
    const puts: any[] = [];
    return { puts, api: { get: async () => ({ tz: have }), put: async (_p: string, b: any) => { puts.push(b); return { tz: b.tz }; } } };
  };
  it("reads the zone from the /etc/localtime link", () => {
    expect(zoneFromLink("/var/db/timezone/zoneinfo/America/New_York\n")).toBe("America/New_York");
    expect(zoneFromLink("garbage")).toBeNull();
  });
  it("writes a changed zone once", async () => {
    const f = fake("America/Chicago");
    expect(await syncOwnerZone(f.api, "America/New_York")).toContain("set America/New_York");
    expect(f.puts).toEqual([{ tz: "America/New_York", via: "mac owner-zone.mjs" }]);
  });
  it("writes nothing when Boss OS already has it", async () => {
    const f = fake("America/Chicago");
    await syncOwnerZone(f.api, "America/Chicago");
    expect(f.puts).toHaveLength(0);
  });
  it("an unread Mac zone is a named stop, not a silent pass", async () => {
    await expect(syncOwnerZone(fake("America/Chicago").api, null)).rejects.toThrow(/NAMED STOP \[MAC_ZONE_UNREAD\]/);
  });
  it("a save Boss OS did not keep is a named stop", async () => {
    const api = { get: async () => ({ tz: "America/Chicago" }), put: async () => ({ tz: "America/Chicago" }) };
    await expect(syncOwnerZone(api, "America/New_York")).rejects.toThrow(/OWNER_ZONE_NOT_SAVED/);
  });
});

describe("a repair report's date is her day, not New York's", async () => {
  const { dayWords } = await import("../src/shared/boss/repoChange/repairReport.mjs");
  const lateSunday = Date.parse("2026-11-09T05:30:00Z"); // 11:30 PM Sunday Central, 12:30 AM Monday Eastern
  it("Central when unset (was hard-coded New York)", () => expect(dayWords(lateSunday)).toBe("Sunday 8 November"));
  it("her zone when set", () => expect(dayWords(lateSunday, "America/New_York")).toBe("Monday 9 November"));
});
