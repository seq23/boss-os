import { test, expect } from "@playwright/test";
import { provisionLocalD1, queryLocalD1 } from "./support/provision";
import { unlock, tab, expectNoSidewaysScroll, PHONE, LAPTOP } from "./support/boss";

/**
 * YOUR TEAM AND ONE PAGE PER EMPLOYEE — Builder U, approved 23 Oct 2026 (boards 7 + 8).
 *
 *   1 · Team opens on one card per employee, from the real roster, with Handles / Today / Next, and
 *       the six lists Monique keeps, each with a live count and a labelled action.
 *   2 · A Rainmaker entry added on the page lands in D1 and shows on the page; removed the same way.
 *   3 · A card opens her page; a duty opens on a tap and shows what it does, the instructions she
 *       follows and when it runs. Save stores her words in D1 (the job reads them — proven in
 *       tests/boss/dutyOwnerEdits.test.ts); Undo restores the original; Pause and Resume flip the
 *       row; Remove asks first. ← Back returns to the cards. Nothing scrolls sideways at 390 px.
 */

const MARK = "e2e-rainmaker.example";
const SWEEP = "duty_mailbox_sweep";

function cleanSql(): string {
  return [
    `DELETE FROM capital_party_lists WHERE value = '${MARK}'`,
    `DELETE FROM duty_versions WHERE duty_id = '${SWEEP}'`,
    `UPDATE standing_duties SET owner_prompt = NULL, owner_schedule_at = NULL, removed_at = NULL, suspended = 0, suspended_reason = NULL WHERE id = '${SWEEP}'`,
  ].join("; ");
}

for (const vp of [PHONE, LAPTOP]) {
  test.describe(`Your team (${vp.name})`, () => {
    test.beforeEach(async ({ page }) => {
      provisionLocalD1(cleanSql());
      await page.setViewportSize({ width: vp.width, height: vp.height });
    });
    test.afterAll(() => { provisionLocalD1(cleanSql()); });

    test("one card per employee from the roster, and every list Monique keeps with its count", async ({ page }) => {
      await unlock(page);
      await tab(page, "Team");
      await expect(page.getByTestId("back-to-today")).toBeVisible();
      const roster = queryLocalD1<{ name: string }>(`SELECT name FROM employees WHERE lifecycle NOT IN ('retired','merged')`);
      const cards = page.getByTestId("team-card");
      await expect(cards.first()).toBeVisible({ timeout: 15_000 });
      expect(await cards.count()).toBe(roster.length);
      const monique = cards.filter({ hasText: "Monique" });
      await expect(monique).toContainText("Handles:");
      await expect(monique).toContainText("Today:");
      await expect(monique).toContainText("Next:");
      await expect(monique).toContainText("Open Monique's duties");

      const lists = page.getByTestId("monique-list");
      await expect(lists).toHaveCount(6);
      for (const name of ["Rainmaker people", "Don't suggest", "Names to feature", "Prospect email", "LP replies", "8Raise credits"]) {
        const l = page.getByRole("region", { name, exact: true });
        await expect(l).toBeVisible();
        await expect(l.getByTestId("list-count")).not.toHaveText("…");
      }

      // Edit a list on the page; it is the same D1 table the email reply edits.
      const rain = page.getByRole("region", { name: "Rainmaker people", exact: true });
      await rain.getByRole("button", { name: "Add or remove" }).click();
      await rain.getByTestId("list-add-same_firm").fill(MARK);
      await rain.getByRole("button", { name: "Add to this list" }).click();
      await expect(rain.getByRole("button", { name: `Remove ${MARK}` })).toBeVisible();
      expect(queryLocalD1(`SELECT id FROM capital_party_lists WHERE value = '${MARK}' AND removed_at IS NULL`)).toHaveLength(1);
      await rain.getByRole("button", { name: `Remove ${MARK}` }).click();
      await expect(rain.getByRole("button", { name: `Remove ${MARK}` })).toHaveCount(0);
      expect(queryLocalD1(`SELECT id FROM capital_party_lists WHERE value = '${MARK}' AND removed_at IS NULL`)).toHaveLength(0);
      await rain.getByRole("button", { name: "✕ Close Rainmaker people" }).click();

      if (vp.name === "phone") await expectNoSidewaysScroll(page);
    });

    test("her page: a duty opens, Save stores her words, Undo restores them, Pause flips, Remove asks first", async ({ page }) => {
      await unlock(page);
      await tab(page, "Team");
      await page.getByTestId("team-card").filter({ hasText: "Monique" }).click();
      const pageEl = page.getByTestId("employee-page");
      await expect(pageEl).toBeVisible();
      await expect(pageEl).toContainText("Director of Relationships");

      const duty = pageEl.getByRole("region", { name: /Mailbox sweep/ });
      await duty.getByRole("button", { name: /Open ▾/ }).click();
      await expect(duty).toContainText("What it does:");
      const box = duty.getByTestId("duty-instructions");
      await expect(box).toBeVisible();
      const original = await box.inputValue();
      expect(original.length).toBeGreaterThan(200);
      await expect(duty.getByTestId("duty-when")).toBeVisible();

      await box.fill("E2E: only flag buyers who went quiet for 30 days.");
      await duty.getByTestId("duty-save").click();
      await expect(duty.getByRole("status")).toContainText("Saved");
      expect(queryLocalD1<{ owner_prompt: string }>(`SELECT owner_prompt FROM standing_duties WHERE id = '${SWEEP}'`)[0]!.owner_prompt)
        .toBe("E2E: only flag buyers who went quiet for 30 days.");
      // She stays on the same duty, open.
      await expect(box).toHaveValue("E2E: only flag buyers who went quiet for 30 days.");

      await duty.getByRole("button", { name: "Undo to the last version" }).click();
      await expect(duty.getByRole("status")).toContainText("Back to version 0");
      await expect(box).toHaveValue(original);
      expect(queryLocalD1<{ owner_prompt: string | null }>(`SELECT owner_prompt FROM standing_duties WHERE id = '${SWEEP}'`)[0]!.owner_prompt).toBeNull();

      await duty.getByTestId("duty-pause").click();
      await expect(duty).toContainText("Paused");
      expect(queryLocalD1<{ suspended: number }>(`SELECT suspended FROM standing_duties WHERE id = '${SWEEP}'`)[0]!.suspended).toBe(1);
      await duty.getByRole("button", { name: "Resume this duty" }).click();
      expect(queryLocalD1<{ suspended: number }>(`SELECT suspended FROM standing_duties WHERE id = '${SWEEP}'`)[0]!.suspended).toBe(0);

      // Remove sits apart and asks first; "Keep it" changes nothing.
      await duty.getByRole("button", { name: "Remove this duty…" }).click();
      await expect(duty.getByRole("alertdialog")).toBeVisible();
      await duty.getByRole("button", { name: "✕ Keep it" }).click();
      await expect(duty.getByRole("alertdialog")).toHaveCount(0);
      expect(queryLocalD1<{ removed_at: number | null }>(`SELECT removed_at FROM standing_duties WHERE id = '${SWEEP}'`)[0]!.removed_at).toBeNull();

      // A fixed-steps duty shows no instructions box, and says who changes it.
      const fixed = pageEl.getByRole("region", { name: /LP replies: a held reply/ });
      await fixed.getByRole("button", { name: /Open ▾/ }).click();
      await expect(fixed.getByTestId("duty-fixed")).toContainText("Danielle");
      await expect(fixed.getByTestId("duty-instructions")).toHaveCount(0);

      await expect(pageEl.getByTestId("employee-add-duty")).toBeVisible();
      if (vp.name === "phone") await expectNoSidewaysScroll(page);

      await pageEl.getByRole("button", { name: "← Back to Your team", exact: true }).first().click();
      await expect(page.getByTestId("team-card").first()).toBeVisible();
    });
  });
}
