import { test, expect } from "@playwright/test";
import { provisionLocalD1, queryLocalD1 } from "./support/provision";
import { unlock, tab, expectNoSidewaysScroll, PHONE, LAPTOP } from "./support/boss";

/**
 * BRAINS, AS SHE USES THEM (owner, 31 Oct 2026). Phone first: the summary, one card per brain with
 * "N gaps to fill", tap one, a gap is yellow with "Fill this in", save, land back on the same
 * section, the history says what changed, "← Back" returns to the list. Writes D1 and reads it back.
 */
const WORDS = "E2E company words";
const clean = () => provisionLocalD1([
  `UPDATE brains SET body_md = replace(body_md, '${WORDS}', '[MISSING]') WHERE slug = 'friends'`,
  `DELETE FROM brain_revisions WHERE slug = 'friends' AND body_md LIKE '%${WORDS}%'`,
].join("; "));

for (const vp of [PHONE, LAPTOP]) {
  test.describe(`Brains (${vp.name})`, () => {
    test.beforeEach(async ({ page }) => { clean(); await page.setViewportSize({ width: vp.width, height: vp.height }); });
    test.afterAll(() => { clean(); });

    test("nine cards with their gaps; fill a gap, save, history, back", async ({ page }) => {
      await unlock(page);
      await tab(page, "Brains");
      await expect(page.getByText(/^9 brains · /)).toBeVisible({ timeout: 15_000 });
      await expect(page.locator(".brain-card")).toHaveCount(9);
      const card = page.getByTestId("brain-friends");
      await expect(card).toContainText("gaps to fill");
      await expect(card).toContainText("Tap to open ›");
      await expectNoSidewaysScroll(page);

      await card.click();
      await expect(page.getByRole("heading", { name: "Friends' businesses" })).toBeVisible();
      await expect(page.getByRole("button", { name: "← Back to all brains" }).first()).toBeVisible();
      const company = page.getByTestId("section-Company");
      await expect(company.locator(".brain-gap")).toHaveText("Not written yet");
      await company.getByRole("button", { name: "Fill this in" }).click();
      const box = company.locator("textarea");
      await expect(box).toBeFocused();
      await box.fill(WORDS);
      await company.getByRole("button", { name: "Save this section" }).click();
      await expect(company.getByText("Saved. Your team reads this from now on.")).toBeVisible();
      await expect(company).toContainText(WORDS);
      await expect(page.getByTestId("brain-history")).toContainText("1 change");

      const row = queryLocalD1<{ body_md: string }>(`SELECT body_md FROM brains WHERE slug = 'friends'`)[0]!;
      expect(row.body_md).toContain(`## Company\n${WORDS}`);
      const rev = queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM brain_revisions WHERE slug = 'friends' AND note = 'Company edited'`)[0]!;
      expect(rev.n).toBe(1);

      await page.getByRole("button", { name: "← Back to all brains" }).first().click();
      await expect(page.locator(".brain-card")).toHaveCount(9);
    });

    test("the scoreboard says 'not tracked yet' and never invents a number", async ({ page }) => {
      await unlock(page);
      await page.goto("/boss?tab=brains&view=scoreboard");
      const board = page.getByTestId("scoreboard");
      await expect(board).toHaveAttribute("open", "");
      await expect(board.locator("tbody tr")).toHaveCount(7);
      await expect(board.locator("tbody")).toContainText("not tracked yet");
      await expect(board.locator("tbody")).not.toContainText("Personal");
      await expect(board.locator("tbody")).not.toContainText("Who");
    });
  });
}
