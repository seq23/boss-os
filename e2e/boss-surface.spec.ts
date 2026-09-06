import { test, expect, type Page } from "@playwright/test";

/**
 * Boss OS, driven as a person drives it.
 *
 * WHY THIS EXISTS. Boss OS arrived with 414 unit tests that all pass, and not one of them opens
 * the app. Every one of them calls a route or a module directly, so between them and a usable
 * product sat the entire client: whether a screen mounts, whether it reaches the right endpoint,
 * whether what comes back renders, and whether a thing you type is still there tomorrow. That gap
 * is exactly where "959 tests pass and none of the buttons work" lives, and it is the reason this
 * repo's chassis has 41 of these and its ported half had none.
 *
 * WHAT IT PROVES, in order:
 *   1 · the lock actually locks, and the passcode actually unlocks;
 *   2 · every one of the ten tabs mounts and says something - never a blank frame;
 *   3 · all seven Systems panels render a NAMED state, including "nothing here yet";
 *   4 · a state change persists: an open loop survives a full reload, because it went to D1.
 *
 * It asserts up to the boundary and no further. `wrangler dev --local` has no Workers AI and no
 * network, so nothing here waits on a model.
 */

const PASSCODE = "local-dev-passcode";

async function unlock(page: Page) {
  await page.goto("/boss");
  const field = page.getByLabel("Passcode");
  await expect(field).toBeVisible();
  await field.fill(PASSCODE);
  await page.getByRole("button", { name: "Unlock" }).click();
  // Today is the default operating screen (canon §15), so arriving there IS the unlock assertion.
  await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
}

test.describe("Boss OS surface", () => {
  test("the lock screen refuses a wrong passcode and keeps the app closed", async ({ page }) => {
    await page.goto("/boss");
    const field = page.getByLabel("Passcode");
    await expect(field).toBeVisible();
    await field.fill("not-the-passcode");
    await page.getByRole("button", { name: "Unlock" }).click();
    // Still locked: the tab bar never appears, and the field is still on screen.
    await expect(page.getByRole("navigation", { name: "Sections" })).toHaveCount(0);
    await expect(field).toBeVisible();
  });

  test("every tab mounts and renders something a reader can act on", async ({ page }) => {
    await unlock(page);
    const tabs = ["Today", "Inbox", "People", "Capital", "Spirit", "Team", "Memory", "Trading", "Vault", "Systems"];
    for (const label of tabs) {
      await page.getByRole("button", { name: label, exact: true }).click();
      const main = page.locator("main.page");
      await expect(main).toBeVisible();
      /*
       * The real assertion. A screen that mounted but rendered nothing is the failure this whole
       * spec exists to catch, and it is invisible to a smoke test that only checks the URL.
       */
      await expect
        .poll(async () => (await main.innerText()).trim().length, { timeout: 15_000 })
        .toBeGreaterThan(0);
    }
  });

  test("all seven Systems panels reach their endpoint and name what they found", async ({ page }) => {
    await unlock(page);
    await page.getByRole("button", { name: "Systems", exact: true }).click();

    for (const label of ["Governance", "Knowledge", "Prompts", "Quant", "Bridge", "Capability", "Runtimes", "Sync"]) {
      await page.getByRole("tab", { name: label }).click();
      const main = page.locator("main.page");
      /*
       * Each panel must settle into a NAMED state. "Nothing here yet" is a pass - an empty database
       * is the honest answer on a fresh firm - but a panel still showing its skeleton after 15s has
       * not reached its endpoint, and a panel showing an error has.
       */
      await expect
        .poll(async () => (await main.innerText()).trim().length, { timeout: 15_000 })
        .toBeGreaterThan(0);
      await expect(main.locator(".skel")).toHaveCount(0, { timeout: 15_000 });
      await expect(main.locator(".notice-error")).toHaveCount(0);
    }
  });

  test("an open loop survives a reload, because it was written to D1", async ({ page }) => {
    await unlock(page);
    await page.getByRole("button", { name: "Today", exact: true }).click();

    /*
     * Open loops live inside the day-flow block's <details>, which is closed on arrival. That is
     * the product's own shape - Today leads with the gates, and the block opens on demand - so the
     * journey opens it the way a person does rather than reaching past the interface.
     */
    const unique = `E2E loop ${Date.now()}`;
    const openLoops = async () => {
      const holder = page.locator("details", { has: page.getByLabel("New open loop") });
      await expect(holder).toHaveCount(1, { timeout: 15_000 });
      if (!(await holder.getByLabel("New open loop").isVisible())) {
        await holder.locator("summary").click();
      }
    };
    await openLoops();
    const field = page.getByLabel("New open loop");
    await expect(field).toBeVisible({ timeout: 15_000 });
    await field.fill(unique);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(unique)).toBeVisible({ timeout: 15_000 });

    /*
     * A FULL RELOAD, not a re-render. Client state does not survive one, so if the loop is still
     * there it came back out of the database - which is the only version of "it persisted" worth
     * asserting.
     */
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await openLoops();
    await expect(page.getByText(unique)).toBeVisible({ timeout: 15_000 });
  });

  /**
   * Batch 7, end to end: the only offline promise Boss OS makes.
   *
   * Write with no connection, see that it was KEPT rather than saved or lost, then reconnect and
   * find it in D1. The plan is explicit that this is capture and not offline operation — so the
   * test also proves the other half, that reads do NOT come back from a cache pretending to be
   * synchronized state.
   */
  test("a capture written offline is kept, and lands in D1 when the connection returns", async ({ page, context }) => {
    await unlock(page);
    await page.getByRole("button", { name: "Today", exact: true }).click();
    const openLoops = async () => {
      const holder = page.locator("details", { has: page.getByLabel("New open loop") });
      await expect(holder).toHaveCount(1, { timeout: 15_000 });
      if (!(await holder.getByLabel("New open loop").isVisible())) await holder.locator("summary").click();
    };
    await openLoops();

    const unique = `Offline capture ${Date.now()}`;
    await context.setOffline(true);

    await page.getByLabel("New open loop").fill(unique);
    await page.getByRole("button", { name: "Add", exact: true }).click();

    // It says so. Silence here is the failure: a reader who cannot tell "saved" from "kept" either
    // stops trusting the app or writes the same thing twice.
    const bar = page.getByRole("status");
    await expect(bar).toContainText("Offline", { timeout: 15_000 });
    await expect(bar).toContainText("1 waiting to send", { timeout: 15_000 });

    await context.setOffline(false);
    // The outbox flushes on the browser's own online event; the badge clearing is the evidence.
    await expect(bar).toHaveCount(0, { timeout: 30_000 });

    /*
     * A FULL RELOAD, so nothing in memory can be mistaken for persistence. If it comes back now it
     * came back out of D1, through the sync ledger, from a capture typed with no connection.
     */
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await openLoops();
    await expect(page.getByText(unique)).toBeVisible({ timeout: 15_000 });
  });

  test("offline reads are not served from a cache pretending to be current", async ({ page, context }) => {
    await unlock(page);
    await context.setOffline(true);
    await page.reload();
    // The shell still opens — that part is cached and is allowed to be.
    await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Systems", exact: true }).click();
    await page.getByRole("tab", { name: "Governance" }).click();
    // …and the data says it could not be reached, rather than showing yesterday's answer as today's.
    await expect(page.locator("main.page")).toContainText(/could not be reached/i, { timeout: 20_000 });
    await context.setOffline(false);
  });
});
