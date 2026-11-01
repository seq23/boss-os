import { test, expect } from "@playwright/test";
import { unlock, tab, expectNoSidewaysScroll, PHONE, LAPTOP } from "./support/boss";
import { readFileSync } from "node:fs";

// Read, never imported: Playwright's loader refuses a bare JSON import without `with { type: "json" }`.
const manifest = JSON.parse(readFileSync(new URL("../src/shared/boss/schedule/manifest.json", import.meta.url), "utf8")) as {
  week: Array<{ day: string; items: Array<{ text: string; emails: boolean }> }>; rows: unknown[];
};

/**
 * THE SCHEDULE, AS SHE USES IT (owner approved the rebalanced week, 1 Nov 2026). Phone first: one
 * section per day, each line with its time, whose it is, one sentence and "✉ emails you"; Every day,
 * Not shown, and every scheduled job folded away at the bottom.
 */
for (const vp of [PHONE, LAPTOP]) {
  test.describe(`Schedule (${vp.name})`, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: vp.width, height: vp.height }); });

    test("seven days, her words, the emails marked; every job at the bottom", async ({ page }) => {
      await unlock(page);
      await tab(page, "Schedule");
      const s = page.getByTestId("schedule");
      await expect(s.locator("details.schedule-day")).toHaveCount(7);
      const wed = page.getByTestId("schedule-day-wed");
      if (!(await wed.getAttribute("open"))) await wed.locator("summary").click();
      const spry = manifest.week.find((d) => d.day === "wed")!.items.find((i) => i.text.includes("Spry Labs weekly"))!;
      const line = wed.locator(".schedule-row", { hasText: "Spry Labs weekly" });
      await expect(line).toContainText("8:15");
      await expect(line).toContainText("✉ emails you");
      expect(spry.emails).toBe(true);
      await expect(s.locator(".schedule-row")).toHaveCount(manifest.week.reduce((a, d) => a + d.items.length, 0));
      await page.getByTestId("schedule-all-jobs").locator("summary").first().click();
      await expect(s.locator('[data-testid^="schedule-job-"]')).toHaveCount(manifest.rows.length);
      await expectNoSidewaysScroll(page);
    });
  });
}
