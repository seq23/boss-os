/**
 * THE EMAIL MAP AND TEAM → DUTIES SAY THE SAME THING THE SAME WAY (ship review, 27 Nov 2026).
 * The reviewer found the summary's numbers did not add up (85, then "11 more", then "4 switched off"),
 * the morning email read as six sends, the two pages used different words for where an email runs,
 * and Team printed a 12-hour clock with no zone beside the map's 24-hour Central. These pin the fixes
 * on the real manifest and the real page code.
 */
import { describe, expect, it } from "vitest";
import { EMAIL_MAP, RUNS_SHORT, centralClock, countLine, summaryLine, summaryParts } from "../src/client/boss/pages/EmailMap";
import { plainWhere } from "../src/client/boss/pages/Team";

describe("the Email Map's numbers add up", () => {
  it("every row is in exactly one part, and the parts make the one total", () => {
    const p = summaryParts(EMAIL_MAP.rows);
    expect(p.total).toBe(EMAIL_MAP.rows.length);
    expect(p.total).toBeGreaterThan(50);
    expect(p.sends + p.folded + p.off).toBe(p.total);
    expect(p.cloud + p.mac).toBe(p.sends);
    const line = summaryLine();
    expect(line).toContain(`${p.total} automated emails listed`);
    expect(line).toContain(`${p.sends} go out on their own: ${p.cloud} from the cloud`);
    expect(line).toContain(`${p.folded} are sections inside another email`);
  });

  it("a business's count names each part (no bare \"more listed\")", () => {
    const personal = EMAIL_MAP.rows.filter((r) => r.business === "personal");
    const line = countLine(personal);
    expect(line).not.toMatch(/more listed/);
    const p = summaryParts(personal);
    expect(line).toContain(`${p.sends} emails`);
    if (p.folded) expect(line).toContain(`${p.folded} section`);
    if (p.off) expect(line).toContain(`${p.off} switched off`);
    // A planted row of each kind moves the right number.
    const planted = [...personal, { ...personal[0]!, runs: "inert" }, { ...personal[0]!, runs: "spry-weekly" }];
    expect(summaryParts(planted).off).toBe(p.off + 1);
    expect(summaryParts(planted).folded).toBe(p.folded + 1);
  });
});

describe("one email, one description, on both pages", () => {
  it("the morning email says it sends once, and its later times are catch-ups", () => {
    const morning = EMAIL_MAP.rows.find((r) => r.id === "simone-your-day")!;
    expect(morning.name).toBe("Morning email");
    expect(morning.when).toMatch(/^Once each morning/);
    expect(morning.when).toMatch(/catch-up/);
  });

  it("every card title is a short name and every runs place has plain words", () => {
    for (const r of EMAIL_MAP.rows) expect(r.name.length, r.id).toBeLessThanOrEqual(40);
    for (const key of Object.keys(EMAIL_MAP.runs)) expect(RUNS_SHORT[key], key).toBeTruthy();
  });

  it("Team's run-place words are the Email Map's, never the engine's names", () => {
    for (const where of ["Mac launchd", "Cloudflare cron", "Pages function", "GitHub Actions", "Folded into morning email"]) {
      const plain = plainWhere(where);
      expect(Object.values(RUNS_SHORT)).toContain(plain);
      expect(plain).not.toMatch(/launchd|Actions|Pages function|cron/i);
    }
  });

  it("one 12-hour clock", () => {
    expect(centralClock(4, 0)).toBe("4:00 AM");
    expect(centralClock(0, 5)).toBe("12:05 AM");
    expect(centralClock(12, 30)).toBe("12:30 PM");
    expect(centralClock(18, 35)).toBe("6:35 PM");
  });
});
