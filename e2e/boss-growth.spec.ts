import { test, expect } from "@playwright/test";
import { unlock, tab, expectNoSidewaysScroll, PHONE } from "./support/boss";

/**
 * THE GROWTH PAGE, AS SHE USES IT (21 Nov 2026). Phone first (Boss OS has one light theme): line 1 says what needs
 * her, one section per business in scoreboard order with Upcoming / Happening / Happened, numbers that
 * were not read say so (never 0), and nothing scrolls sideways. A day's readings are posted first so
 * the page shows real numbers.
 */
for (const scheme of ["light"] as const) {
  test(`Growth page at 390 px (${scheme})`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: PHONE.width, height: PHONE.height });
    await unlock(page);
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const posted = await page.request.post("/api/boss/growth/readings", { data: { day, readings: [
      { measure: "pnp-requests", business: "porch-and-party", kind: "requests", channel: "all", language: "en", value: 2 },
      { measure: "pnp-money", business: "porch-and-party", kind: "money", channel: "all", language: "en", value: 730 },
      { measure: "pnp-search", business: "porch-and-party", kind: "visits", channel: "google-search", language: "en", value: null, unread: "not read: Search Console refused the key" },
    ] } });
    expect(posted.status()).toBe(201);
    await tab(page, "Growth");
    const g = page.getByTestId("growth");
    await expect(g.getByTestId("growth-summary")).toBeVisible();
    const pnp = g.getByTestId("growth-business-porch-and-party");
    await expect(pnp).toContainText("Upcoming");
    await expect(pnp).toContainText("Happening");
    await expect(pnp).toContainText("Happened");
    await expect(pnp).toContainText("$730");
    await pnp.getByText(/number.* not read ▾/).click();
    await expect(pnp).toContainText("Search Console refused the key");
    await expect(g.getByTestId("growth-business-how-we-know")).toContainText("Paused");
    await expect(g).not.toContainText("NAMED STOP");
    await expectNoSidewaysScroll(page);
    await page.screenshot({ path: info.outputPath(`growth-390-${scheme}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}
