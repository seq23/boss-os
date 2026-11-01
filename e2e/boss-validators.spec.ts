import { test, expect } from "@playwright/test";
import { unlock, tab, expectNoSidewaysScroll, PHONE, LAPTOP } from "./support/boss";

/**
 * THE VALIDATOR MATRIX, AS SHE USES IT (owner, 1 Nov 2026). Before the Mac has posted, the page says
 * so (never an empty all clear); after, line 1 is one count, the repo pull-down narrows to one repo,
 * and each card says what it protects, why, and when it runs.
 */
for (const vp of [PHONE, LAPTOP]) {
  test.describe(`Validators (${vp.name})`, () => {
    test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: vp.width, height: vp.height }); });

    test("not read yet is said; a posted matrix reads as one count and cards", async ({ page }) => {
      await unlock(page);
      await page.route("**/api/boss/validators", (route) => route.fulfill({
        json: { ok: true, data: { summary: null, flagged: null, matrix: {
          at: Date.parse("2026-11-01T23:45:00Z"), repos: ["alpha", "beta"],
          rows: [
            { repo: "alpha", name: "validate:no-secrets", key: "no-secrets", protects: "no key is ever committed", why: "a key in a public repo is public", kind: "safety", runs: "pr", listed: true, also: ["beta"] },
            { repo: "beta", name: "check-no-secrets", key: "no-secrets", protects: "no key is ever committed", why: "same", kind: "safety", runs: "scheduled", listed: false, also: ["alpha"] },
          ],
          unlisted: [{ repo: "beta", name: "check-no-secrets" }], unmatrixed: [], unread: [], not_imported: ["gamma"],
          duplicates: [{ key: "no-secrets", repos: ["alpha", "beta"] }], problems: [],
        } } },
      }));
      await tab(page, "Validators");
      await expect(page.getByTestId("validators-summary")).toHaveText("2 validators across 2 repos · 1 to tidy");
      await page.getByTestId("validators-repo").selectOption("beta");
      const beta = page.getByTestId("validators-repo-beta");
      await expect(beta).toContainText("Why: same");
      await expect(beta).toContainText("Safety · on a schedule · also in alpha");
      await expect(beta).toContainText("Not in its repo's own list yet");
      await expect(page.getByTestId("validators-repo-alpha")).toHaveCount(0);
      await expect(page.getByTestId("validators-shared")).toContainText("no-secrets: alpha, beta");
      await expectNoSidewaysScroll(page);
    });
  });
}
