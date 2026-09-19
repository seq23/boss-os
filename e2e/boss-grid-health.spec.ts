import { test, expect, type Page } from "@playwright/test";

/**
 * SYSTEMS → PROPERTIES: every grid property, four readers each, and no blank cell.
 *
 * Her words, 19 September 2026: "Connect all the GSC and whatever else to measure the health and
 * GitHub and all."
 *
 * Journeys:
 *   1 · on a fresh database every property card renders and every cell says one of the four true
 *       things — a reading, BLOCKED with a reason, N/A with a reason, or NOT READ YET naming what
 *       runs it. Never blank.
 *   2 · a reading posted through the Mac's door shows on the card with its evidence link, and a
 *       blocked one shows its sentence.
 *   3 · all of it at phone width, with no horizontal overflow.
 */

const PASSCODE = "local-dev-passcode";

async function unlock(page: Page) {
  await page.goto("/boss");
  const field = page.getByLabel("Passcode");
  await expect(field).toBeVisible();
  await field.fill(PASSCODE);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
}

async function openProperties(page: Page) {
  await page.getByRole("button", { name: "Systems", exact: true }).click();
  await page.getByRole("tab", { name: "Properties" }).click();
  await expect(page.getByTestId("property-health-totals")).toBeVisible({ timeout: 15_000 });
}

test.describe("Boss OS grid health", () => {
  test("every property card renders with four named cells, none blank", async ({ page }) => {
    await unlock(page);
    await openProperties(page);
    const cards = page.locator("article[data-testid^='property-health-']");
    const n = await cards.count();
    expect(n).toBeGreaterThanOrEqual(11);
    for (let i = 0; i < n; i++) {
      const card = cards.nth(i);
      const cells = card.locator("[data-reader]");
      await expect(cells).toHaveCount(4);
      for (let j = 0; j < 4; j++) {
        const cell = cells.nth(j);
        const state = await cell.getAttribute("data-state");
        expect(["ok", "warn", "blocked", "never", "cannot"]).toContain(state);
        // The cell says something a person can read, whatever its state.
        expect((await cell.innerText()).trim().length).toBeGreaterThan(20);
      }
    }
    // The three she named without a domain say so by name rather than showing nothing.
    const yt = page.getByTestId("property-health-youtube");
    await expect(yt.locator("[data-reader='uptime']")).toContainText("YouTube channel");
    await expect(yt.locator("[data-reader='uptime']")).toContainText("N/A");
    // A wired reader that has never run names what runs it.
    await expect(page.getByTestId("property-health-hpc").locator("[data-reader='github']")).toContainText("grid watch");
  });

  test("a reading posted from the Mac shows with its link, and a blocked one shows its reason", async ({ page }) => {
    await unlock(page);
    // `page.request` carries the unlocked session's cookie, as grid-watch carries the passcode's.
    const res = await page.request.post("/api/boss/grid/health/readings", {
      data: { readings: [
        { property_key: "hpc", reader: "github", target: "seq23/sprylabs-hpc-site", state: "ok", summary: "E2E: last run on main green, 0 open PRs.", numbers: { open_prs: 0 }, evidence_url: "https://github.com/seq23/sprylabs-hpc-site/actions" },
        { property_key: "saas_apps", reader: "cloudflare", target: "heygetonmylevel.com", state: "blocked", summary: "E2E: no Pages project on this account serves heygetonmylevel.com.", error: "no project matched" },
      ] },
    });
    expect(res.status()).toBe(201);
    await openProperties(page);
    const gh = page.getByTestId("property-health-hpc").locator("[data-reader='github']");
    await expect(gh).toContainText("E2E: last run on main green");
    await expect(gh).toHaveAttribute("data-state", "ok");
    await expect(gh.getByRole("link", { name: "open" })).toHaveAttribute("href", "https://github.com/seq23/sprylabs-hpc-site/actions");
    const cf = page.getByTestId("property-health-saas_apps").locator("[data-reader='cloudflare']");
    await expect(cf).toHaveAttribute("data-state", "blocked");
    await expect(cf).toContainText("no Pages project on this account serves heygetonmylevel.com");
  });

  test("at phone width the cards are on screen and nothing overflows", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await unlock(page);
    await openProperties(page);
    await expect(page.getByTestId("property-health-guides_generator")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
