/** Every installer schedule is Central time, whatever zone the Mac is in (26 Oct 2026). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { centralToLocalOffset, rawOffset, shiftPlist } from "../scripts/ops/plist-central.mjs";

const ARR = '<plist version="1.0"><dict><key>StartCalendarInterval</key><array><dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>40</integer></dict><dict><key>Weekday</key><integer>6</integer><key>Hour</key><integer>23</integer><key>Minute</key><integer>5</integer></dict><dict><key>Minute</key><integer>5</integer></dict></array><key>RunAtLoad</key><false/></dict></plist>';
const ONE = '<plist version="1.0"><dict><key>StartCalendarInterval</key>\n    <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>20</integer></dict>\n  <key>StandardOutPath</key><string>x</string></dict></plist>';

describe("Central schedules on an Eastern Mac", () => {
  it("the offset is +1 from Central to Eastern in both DST states, 0 on a Central Mac", () => {
    expect(centralToLocalOffset(new Date("2026-10-26T12:00:00Z"), "America/New_York")).toBe(1);
    expect(centralToLocalOffset(new Date("2026-12-26T12:00:00Z"), "America/New_York")).toBe(1);
    // 1 Nov 2026, 06:00-07:00 UTC: Eastern has left daylight time and Central has not, so the raw
    // offset reads 0 for that hour. An install then must still shift by one.
    expect(rawOffset(new Date("2026-11-01T06:30:00Z"), "America/New_York")).toBe(0);
    expect(centralToLocalOffset(new Date("2026-11-01T06:30:00Z"), "America/New_York")).toBe(1);
    expect(centralToLocalOffset(new Date("2027-03-14T07:30:00Z"), "America/New_York")).toBe(1);
    expect(centralToLocalOffset(new Date("2026-11-01T06:30:00Z"), "America/Chicago")).toBe(0);
    expect(centralToLocalOffset(new Date("2026-10-26T12:00:00Z"), "America/Chicago")).toBe(0);
  });
  it("moves each Hour, carries Weekday across midnight, leaves an hourly job alone", () => {
    const out = shiftPlist(ARR, 1);
    expect(out).toContain("<key>Hour</key><integer>7</integer><key>Minute</key><integer>40</integer>");
    expect(out).toContain("<key>Weekday</key><integer>0</integer><key>Hour</key><integer>0</integer>");
    expect(out).toContain("<dict><key>Minute</key><integer>5</integer></dict>");
    expect(shiftPlist(ONE, 1)).toContain("<key>Hour</key><integer>7</integer><key>Minute</key><integer>20</integer>");
    expect(shiftPlist(ARR, 0)).toBe(ARR);
  });
  it("the installer runs it on every plist before launchd loads it", () => {
    const sh = readFileSync("scripts/ops/install-agent-launchd.sh", "utf8");
    const lint = sh.slice(sh.indexOf("lint_plist() {"), sh.indexOf("}", sh.indexOf("lint_plist() {")));
    expect(lint).toContain('node "$REPO/scripts/ops/plist-central.mjs" "$1"');
    // Every load is preceded by a lint of the same plist.
    expect((sh.match(/launchctl load/g) ?? []).length).toBeLessThanOrEqual((sh.match(/lint_plist "/g) ?? []).length + 1);
  });
});
