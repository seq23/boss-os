import { test, expect } from "@playwright/test";
import { unlock, tab, expectNoSidewaysScroll, PHONE, LAPTOP } from "./support/boss";
import manifest from "../src/shared/boss/emailMap/manifest.json";

/**
 * THE EMAIL MAP, AS SHE USES IT (owner, 31 Oct 2026: "one Email Map page inside Boss OS, all
 * businesses"). Phone first: the summary, a pull-down for one business, one labelled expander per
 * business, each email readable without opening it, "Show details ▾" with how to pause it.
 */
for (const vp of [PHONE, LAPTOP]) {
  test.describe(`Email Map (${vp.name})`, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: vp.width, height: vp.height }); });

    test("every business, every email; pick one, open a row, read how to pause it", async ({ page }) => {
      await unlock(page);
      await tab(page, "Email Map");
      const map = page.getByTestId("email-map");
      await expect(map.getByText(/automated emails across 7 businesses/)).toBeVisible();
      await expect(map.locator("details.email-map-business")).toHaveCount(manifest.businesses.length);
      await expect(map.locator(".email-map-card")).toHaveCount(manifest.rows.length);
      await expectNoSidewaysScroll(page);

      await map.getByRole("combobox", { name: "Show: choose a business" }).selectOption("porch-and-party");
      await expect(map.locator("details.email-map-business")).toHaveCount(1);
      const card = page.getByTestId("email-pnp-corporate-outreach");
      await expect(card).toBeVisible();
      await expect(card).toContainText("From Camille");
      await card.getByText("Show details ▾").click();
      await expect(card).toContainText("How to pause it");
      await expect(card).toContainText("sequoia@porchandparty901.com");
      await expectNoSidewaysScroll(page);
    });
  });
}
