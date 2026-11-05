import { test, expect } from "@playwright/test";
import { provisionLocalD1, queryLocalD1 } from "./support/provision";
import { unlock, expectNoSidewaysScroll, PHONE } from "./support/boss";

test("bulk dismissal confirms in place at 390 px and keeps fresh pairs", async ({ page }) => {
  const rows = [
    { key: "bulk-old", pair: "example|old", sig: "order-old", company: "Example Company", oldest_days: 31 },
    { key: "bulk-fresh", pair: "example|fresh", sig: "order-fresh", company: "Example Company", oldest_days: 1 },
  ].map((m) => ({ ...m, gap: null, seller: { who: "Example Seller", size: "—", price: "—" }, buyer: { who: "Example Buyer", size: "—", price: "—" }, drafts: [] }));
  provisionLocalD1(`DELETE FROM capital_matches; DELETE FROM capital_dismissed; ${rows.map((m, i) => `INSERT INTO capital_matches (key,company,rank,payload,updated_at) VALUES ('${m.key}','Example Company',${i},'${JSON.stringify(m)}',${Date.now()});`).join(" ")}`);
  await page.setViewportSize({ width: PHONE.width, height: PHONE.height });
  await unlock(page);
  await page.goto("/boss?tab=capital&view=matches");
  await page.getByRole("button", { name: "Dismiss all older than 30 days", exact: true }).click();
  await expect(page.getByRole("button", { name: "Yes, dismiss 1", exact: true })).toBeVisible();
  await expectNoSidewaysScroll(page);
  await page.getByRole("button", { name: "Keep", exact: true }).click();
  expect(queryLocalD1("SELECT * FROM capital_dismissed")).toHaveLength(0);
  await page.getByRole("button", { name: "Dismiss all older than 30 days", exact: true }).click();
  await page.getByRole("button", { name: "Yes, dismiss 1", exact: true }).click();
  await expect(page.locator(".duty-card.mi-comment")).toHaveCount(1);
  expect(queryLocalD1<{ pair: string }>("SELECT pair FROM capital_dismissed").map((r) => r.pair)).toEqual(["example|old"]);
  await expectNoSidewaysScroll(page);
});
