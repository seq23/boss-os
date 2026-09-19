import { test, expect } from "@playwright/test";
import { provisionLocalD1, queryLocalD1 } from "./support/provision";
import { unlock, tab, expectNoSidewaysScroll, expectNear, PHONE, LAPTOP } from "./support/boss";

/**
 * THE SPIRIT TAB — the day, the month, contribution, the ancestors' hour, manifestations.
 *
 * Everything here is written by her own hand and must be read back from the table: a
 * contribution needs a note (the September 2026 defect was four wordless "help" rows in 23
 * seconds), the ancestors' hour records who and how long, and a manifestation closes only on three
 * actions and one checkable result — a sign is kept and never counted.
 */

function cleanSql(): string {
  return [
    `DELETE FROM contributions WHERE note LIKE 'E2E %'`,
    `DELETE FROM ancestor_entries WHERE note LIKE 'E2E %'`,
    `DELETE FROM manifestation_evidence WHERE manifestation_id IN (SELECT id FROM manifestations WHERE title LIKE 'E2E%')`,
    `DELETE FROM manifestations WHERE title LIKE 'E2E%'`,
  ].join("; ");
}

for (const vp of [PHONE, LAPTOP]) {
  test.describe(`Spirit (${vp.name})`, () => {
    test.beforeEach(async ({ page }) => {
      provisionLocalD1(cleanSql());
      await page.setViewportSize({ width: vp.width, height: vp.height });
    });
    test.afterAll(() => { provisionLocalD1(cleanSql()); });

    test("the tab says something true about the sky, the practice, and the week — never a blank", async ({ page }) => {
      await unlock(page);
      await tab(page, "Spirit");
      const main = page.locator("main.page");
      await expect(main).toContainText("Practice today");
      await expect(main).toContainText(/Contribution — /);
      await expect(main).toContainText(/Ancestors — /);
      await expect(main).toContainText("Manifestations");
      await expect(main).toContainText("The week ahead");
      // Every empty slot names what would fill it.
      for (const e of await main.locator(".empty").all()) {
        expect((await e.innerText()).trim().length).toBeGreaterThan(20);
      }
      if (vp.name === "phone") await expectNoSidewaysScroll(page);
    });

    test("a contribution is recorded with its note, and removed again", async ({ page }) => {
      await unlock(page);
      await tab(page, "Spirit");
      await page.getByRole("button", { name: /record something you gave or helped with/i }).click();
      const record = page.getByRole("button", { name: /^record$|record it|^add$/i }).last();
      const note = page.getByPlaceholder("Covered Dee's deposit · an hour on the phone with Ray");
      await expect(record).toBeDisabled();
      await note.fill("E2E");
      await expect(record).toBeDisabled(); // under four characters is not a note
      await note.fill("E2E — an hour on the phone with Ray");
      await expect(record).toBeEnabled();
      await record.click();
      await expect.poll(() => queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM contributions WHERE note LIKE 'E2E %'`)[0]!.n).toBe(1);
      await expect(page.locator("main.page")).toContainText("E2E — an hour on the phone with Ray");
      // A wordless one is refused by the route as well.
      const bare = await page.request.post("/api/boss/spirit/contributions", { data: { kind: "help" } });
      expect(bare.status()).toBe(400);
      // And it can be taken back.
      const row = page.locator("main.page .row", { hasText: "E2E — an hour on the phone with Ray" });
      await row.getByRole("button", { name: /remove|undo|take it back/i }).click();
      await expect.poll(() => queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM contributions WHERE note LIKE 'E2E %'`)[0]!.n).toBe(0);
    });

    test("the ancestors' hour records who and how long", async ({ page }) => {
      await unlock(page);
      await tab(page, "Spirit");
      await expect(page.locator("main.page")).toContainText(/Ancestors — /);
      const open = page.getByRole("button", { name: "I did this" });
      test.skip(!(await open.count()), "the hour is already recorded for this month in this build");
      await open.click();
      await page.getByPlaceholder("A name, or the line").fill("Grandmother Lou");
      await page.getByLabel("Minutes").fill("20");
      await page.getByLabel("Anything worth keeping (optional)").fill("E2E — sat with the photographs");
      await page.getByRole("button", { name: /record|save|done|keep/i }).last().click();
      await expect.poll(() => queryLocalD1<{ who: string; minutes: number }>(`SELECT who, minutes FROM ancestor_entries WHERE who = 'Grandmother Lou'`)[0]).toEqual({ who: "Grandmother Lou", minutes: 20 });
      provisionLocalD1(`DELETE FROM ancestor_entries WHERE who = 'Grandmother Lou'`);
    });

    test("a manifestation opens with a first action, takes evidence, refuses to close on signs, and closes on deeds", async ({ page }) => {
      await unlock(page);
      await tab(page, "Spirit");
      await page.getByRole("button", { name: "Open one" }).click();
      await page.getByLabel("What").fill("E2E: the Anthropic block placed");
      await page.getByLabel("Stated plainly").fill("Two investors take the block by October.");
      await page.getByLabel("The first concrete action").fill("Write to the two.");
      await page.getByRole("button", { name: /hold it|open it|add it|create/i }).click();
      const m = queryLocalD1<{ id: string }>(`SELECT id FROM manifestations WHERE title = 'E2E: the Anthropic block placed'`);
      expect(m).toHaveLength(1);

      // The detail opens on creation. The close button names why it cannot close yet.
      const close = page.getByRole("button", { name: /not closeable yet|mark it manifested/i });
      await expect(close).toBeDisabled();
      await expect(close).toHaveText("Not closeable yet");

      const desc = page.getByLabel("Describe it");
      const kind = page.getByLabel("What happened");
      const record = page.getByRole("button", { name: "Record it" });
      // A sign is kept and counts for nothing.
      await kind.selectOption("sign");
      await desc.fill("E2E — saw the name twice today");
      await record.click();
      await expect(desc).toHaveValue(""); // the form clears once the row is written
      await expect(page.locator("main.page")).toContainText("0/3");
      await expect(close).toBeDisabled();
      for (const d of ["wrote to the first", "wrote to the second", "sent the terms"]) {
        await kind.selectOption("action");
        await desc.fill(`E2E — ${d}`);
        await record.click();
        await expect(desc).toHaveValue("");
      }
      await expect(page.locator("main.page")).toContainText("3/3");
      await expect(close).toBeDisabled(); // still needs one checkable result
      // A checkable result without a reference is refused, beside the form.
      await kind.selectOption("result");
      await desc.fill("E2E — the first said yes");
      await record.click();
      const err = page.locator("main.page .notice").first();
      await expect(err).toContainText(/reference/i);
      await expectNear(page, record, err, 1200);
      await desc.fill("E2E — the first said yes");
      await page.getByLabel("Where can it be checked?").fill("mail thread 2026-09-19");
      await record.click();
      await expect(desc).toHaveValue("");
      await expect(page.locator("main.page")).toContainText("1/1");
      await expect(close).toBeEnabled();
      await close.click();
      await expect.poll(() => queryLocalD1<{ status: string }>(`SELECT status FROM manifestations WHERE id = '${m[0]!.id}'`)[0]!.status).toBe("manifested");
      if (vp.name === "phone") await expectNoSidewaysScroll(page);
    });
  });
}
