import { test, expect } from "@playwright/test";

/**
 * The retired West Peek fund screens (22 Nov 2026). An old address must show a page that says
 * where the screens went, at phone width, never a blank frame or the old fund interface.
 */
test.use({ viewport: { width: 390, height: 844 } });

for (const [address, target] of [
  ["/", "https://os.joinwestpeek.com/"],
  ["/#/dealflow", "https://os.joinwestpeek.com/#/dealflow"],
] as const) {
  test(`${address} shows the moved page at 390px`, async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith("/api/")) calls.push(r.url());
    });
    await page.goto(address);
    await expect(page.getByRole("heading", { level: 1, name: "This page has moved" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open it in West Peek OS" })).toHaveAttribute("href", target);
    // Fits the phone: nothing wider than the screen.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // The moved page asks the server for nothing: no sign-in, no fund data.
    expect(calls).toEqual([]);
    await page.screenshot({ path: `test-results/chassis-moved${address === "/" ? "" : "-dealflow"}.png`, fullPage: true });
  });
}

test("/boss still mounts Boss OS, not the moved page", async ({ page }) => {
  await page.goto("/boss");
  await expect(page.getByLabel("Passcode")).toBeVisible();
  await expect(page.getByText("This page has moved")).toHaveCount(0);
});
