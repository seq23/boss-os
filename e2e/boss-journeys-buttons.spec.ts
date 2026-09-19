import { test, expect } from "@playwright/test";
import { provisionLocalD1, queryLocalD1 } from "./support/provision";
import { unlock, tab, expectNoSidewaysScroll, PHONE, LAPTOP } from "./support/boss";

/**
 * THE REMAINING BUTTONS — every one she can press that has not had its own journey yet.
 *
 * Each press must answer with words on the same screen (a notice, a result, or a refusal that
 * names its cause) and, where it writes, the write must be readable from the table. A press that
 * changes nothing on the screen is the defect this file exists to catch.
 */

function cleanSql(): string {
  return [
    `DELETE FROM firm_notices WHERE title = 'E2E: a standing notice'`,
    `DELETE FROM prompt_packets WHERE request LIKE 'E2E %'`,
    `DELETE FROM sovereignty_packages WHERE id LIKE 'sov_%' AND built_at > ${Date.now() - 3_600_000}`,
  ].join("; ");
}

for (const vp of [PHONE, LAPTOP]) {
  test.describe(`Buttons (${vp.name})`, () => {
    test.beforeEach(async ({ page }) => {
      try { provisionLocalD1(cleanSql()); } catch { /* a table above may not exist in this build; each journey asserts its own */ }
      await page.setViewportSize({ width: vp.width, height: vp.height });
    });

    test("Team › Prompts compiles a packet from a rough request and says what it applied", async ({ page }) => {
      await unlock(page);
      await tab(page, "Team");
      await page.locator("main.page .btn-row").first().getByRole("button", { name: "Prompts" }).click();
      const compile = page.getByRole("button", { name: "Compile the packet" });
      await expect(compile).toBeDisabled();
      await page.locator("main.page textarea").first().fill("E2E — write the note to a buyer who went quiet after asking for terms");
      await expect(compile).toBeEnabled();
      await compile.click();
      // The packet, on screen: what was applied, what argues with it, and a score — or a named refusal.
      const main = page.locator("main.page");
      await expect(main.locator(".notice, .panel, .row").filter({ hasText: /applied|lens|score|packet|could not|refus/i }).first()).toBeVisible({ timeout: 15_000 });
      if (vp.name === "phone") await expectNoSidewaysScroll(page);
    });

    test("Memory › Knowledge generates the manual and exports, each saying what it did", async ({ page }) => {
      await unlock(page);
      await tab(page, "Memory");
      await page.locator("main.page .btn-row").first().getByRole("button", { name: "Knowledge" }).click();
      await page.getByRole("button", { name: "Generate the Manual" }).click();
      const said = page.locator("main.page .notice").first();
      await expect(said).toBeVisible({ timeout: 15_000 });
      await expect(said).toContainText(/Version \d+|Nothing changed|could not|no promoted/i);
      await page.getByRole("button", { name: "Export knowledge" }).click();
      await expect(page.locator("main.page .notice").first()).toContainText(/Exported \d+ item|could not/i, { timeout: 15_000 });
      // A surface opens and closes.
      await page.locator("button.row-title", { hasText: "Decision Vault" }).click();
      await expect(page.locator("main.page")).toContainText(/Decision Vault/);
      await page.getByRole("button", { name: "Back" }).click();
      await expect(page.getByRole("button", { name: "Generate the Manual" })).toBeVisible();
    });

    test("Vault › Sovereignty builds a package and runs the offline drill, and Documents compiles a hashed file", async ({ page }) => {
      test.setTimeout(90_000);
      await unlock(page);
      await tab(page, "Vault");
      await page.locator("main.page .btn-row").first().getByRole("button", { name: "Sovereignty" }).click();
      // Nothing to drill until a package exists — asserted only on a build with none yet.
      await expect(page.getByRole("button", { name: "Build a package" })).toBeEnabled({ timeout: 15_000 });
      if ((await page.locator("main.page .eyebrow", { hasText: /^Packages$/ }).count()) === 0) {
        await expect(page.getByRole("button", { name: "Run the offline drill" })).toBeDisabled();
      }
      await page.getByRole("button", { name: "Build a package" }).click();
      await expect(page.locator("main.page .notice").first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: "Run the offline drill" })).toBeEnabled({ timeout: 15_000 });
      await page.getByRole("button", { name: "Run the offline drill" }).click();
      await expect(page.locator("main.page .notice").first()).toBeVisible({ timeout: 30_000 });
      expect((await page.locator("main.page .notice").first().innerText()).trim().length).toBeGreaterThan(20);

      await page.locator("main.page .btn-row").first().getByRole("button", { name: "Documents" }).click();
      const compile = page.getByRole("button", { name: "Compile it" });
      await expect(compile).toBeDisabled();
      await page.locator("main.page input").first().fill("E2E: the September buyer note");
      await page.locator("main.page textarea").first().fill("Three buyers answered. Two want terms. One went quiet.");
      await compile.click();
      await expect(page.locator("main.page")).toContainText(/E2E: the September buyer note/, { timeout: 15_000 });
      await expect(page.locator("main.page")).not.toContainText("Nothing compiled yet");
      if (vp.name === "phone") await expectNoSidewaysScroll(page);
    });

    test("Settings › Governance records a state, posts a notice to the firm, and runs the sentinel", async ({ page }) => {
      await unlock(page);
      await page.getByRole("button", { name: "Open settings" }).click();
      const gov = page.locator("main.page .seg-btn", { hasText: /^governance$/i });
      test.skip(!(await gov.count()), "no governance panel on Settings in this build");
      await gov.click();
      await page.getByRole("button", { name: "STRETCHED", exact: true }).click();
      await expect(page.locator("main.page")).toContainText(/stretched/i, { timeout: 15_000 });
      await page.getByRole("button", { name: "Run the sentinel" }).click();
      await expect.poll(async () => page.locator("main.page .skel").count(), { timeout: 15_000 }).toBe(0);
      const post = page.getByRole("button", { name: "Post it to the firm" });
      await expect(post).toBeDisabled();
      const fields = page.locator("main.page .field");
      await fields.filter({ hasText: /title/i }).locator("input").fill("E2E: a standing notice");
      await fields.filter({ hasText: /body|what/i }).locator("textarea").fill("Nothing is sent to a counterparty from this system.");
      await fields.filter({ hasText: /author|from|who/i }).locator("input").fill("E2E");
      await expect(post).toBeEnabled();
      await post.click();
      await expect(page.locator("main.page")).toContainText("E2E: a standing notice", { timeout: 15_000 });
      await expect.poll(() => queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM firm_notices WHERE title = 'E2E: a standing notice'`)[0]!.n).toBe(1);
    });

    test("Systems › Airlock switches between the sovereign set and everything, and Backends opens a card", async ({ page }) => {
      await unlock(page);
      await tab(page, "Systems");
      await page.getByRole("tab", { name: "Airlock", exact: true }).click();
      const all = page.getByRole("button", { name: /^All \d+/ });
      await expect(all).toBeVisible({ timeout: 15_000 });
      const sovereignRows = await page.locator("main.page .row").count();
      await all.click();
      await expect.poll(async () => page.locator("main.page .row").count()).toBeGreaterThan(sovereignRows);
      await page.getByRole("button", { name: "Sovereign only" }).click();
      await expect.poll(async () => page.locator("main.page .row").count()).toBe(sovereignRows);
      await page.getByRole("tab", { name: "Backends", exact: true }).click();
      await page.locator("main.page button", { hasText: /Claude Code/ }).first().click();
      await expect(page.locator("main.page")).toContainText(/ceiling|allowed|kinds|commission/i);
      if (vp.name === "phone") await expectNoSidewaysScroll(page);
    });
  });
}
