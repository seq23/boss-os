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
    // AND THE SCRAPPED ONE IS ACTUALLY GONE, not merely empty. Hiding a tab and deleting it look
    // identical from a list of the tabs that remain.
    await expect(page.getByRole("button", { name: "People", exact: true })).toHaveCount(0);
    /*
     * NINE, NOT TEN. The People tab was scrapped on 9 September 2026 — "i dont like this people tab
     * at all id rather just scrap it" — and replaced by a weekly email from Monique. The list is
     * spelled out rather than derived from LABELS on purpose: a test that reads the same constant
     * the nav reads would still pass if every tab vanished.
     */
    const tabs = ["Today", "Inbox", "Capital", "Spirit", "Team", "Memory", "Trading", "Vault", "Systems"];
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

  /**
   * THE NAV MUST NOT SIT ON TOP OF THE PAGE.
   *
   * `.shell` reserved `--tab-h` (64px) for a nav of ten tabs laid out five to a row - two rows,
   * ~128px - so the last 64px of every scrollable screen was permanently underneath it. It shipped
   * that way and nothing noticed, because no test had ever asked where anything was on screen.
   *
   * Measured rather than asserted about CSS: the check is that the last piece of content ENDS
   * above where the nav BEGINS, which stays true however the nav is built, how many tabs it has,
   * or what the reader's text size is. A test against `padding-bottom: 128px` would pass on the
   * day someone adds an eleventh tab and the bug comes back.
   */
  /*
   * RUN AT PHONE WIDTH AS WELL AS DESKTOP.
   *
   * The first version of this test ran only at Playwright's default 1280x720 and passed while the
   * owner was still looking at a clipped screen. Boss OS is installed to a phone home screen - that
   * is the whole premise of the product - and the nav is at its tallest relative to the viewport
   * exactly there. A layout guard that never opens the layout the owner actually uses is not a
   * guard, it is a reassurance.
   */
  for (const vp of [
    { name: "phone", width: 390, height: 844 },
    { name: "laptop", width: 1280, height: 720 },
  ]) {
  test(`no page hides its last content behind the tab bar (${vp.name})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await unlock(page);

    // Deliberately the tall ones. Today carries thirteen blocks and Vault a snapshot list, which
    // is where the overlap was first visible.
    for (const label of ["Today", "Systems", "Vault", "Capital"]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await page.waitForTimeout(400);

      await page.keyboard.press("End");
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(400);

      const m = await page.evaluate(() => {
        const main = document.querySelector("main.page");
        const nav = document.querySelector("nav.tabs") as HTMLElement | null;
        const shell = document.querySelector(".shell");
        if (!main || !nav || !shell) return null;
        // The end-mark is the page's own terminator and may sit in the reserved gap; everything
        // before it is content and must be clear of the nav.
        const kids = [...main.children].filter((el) => !el.classList.contains("page-end"));
        const last = kids[kids.length - 1];
        return {
          navTop: nav.getBoundingClientRect().top,
          navHeight: nav.offsetHeight,
          reserved: parseFloat(getComputedStyle(shell).paddingBottom),
          lastBottom: last ? last.getBoundingClientRect().bottom : null,
        };
      });

      expect(m, `${label}: expected a shell, a nav and content in main.page`).not.toBeNull();

      /*
       * THE CAUSE. The shell must reserve at least as much room as the nav occupies. This is the
       * assertion that actually catches the original bug - `--tab-h` (64px) reserved against a
       * two-row, 125px nav - and it catches it whatever else is on the page.
       *
       * IT IS HERE BECAUSE THE SYMPTOM ASSERTION BELOW WAS NOT ENOUGH. Restoring the 64px
       * reservation and re-running this spec passed: the end-mark and the page's own bottom
       * padding happen to add ~65px of trailing space, which incidentally covered the shortfall
       * for the last element while the reservation stayed wrong. A guard that only watches the
       * symptom can be satisfied by an accident somewhere else on the page.
       */
      expect(
        m!.reserved,
        `${label} @ ${vp.name}: the shell reserves ${m!.reserved}px for a nav that is ${m!.navHeight}px tall`,
      ).toBeGreaterThanOrEqual(m!.navHeight);

      // THE SYMPTOM. Kept as well as the cause, because the reservation being right is not the
      // only way content can end up underneath a fixed bar.
      expect(m!.lastBottom, `${label}: expected content in main.page`).not.toBeNull();
      expect(
        m!.lastBottom!,
        `${label} @ ${vp.name}: last content ends at ${m!.lastBottom}, nav starts at ${m!.navTop} — the tab bar is covering it`,
      ).toBeLessThanOrEqual(m!.navTop + 1);
    }
  });
  }

  test("all seven Systems panels reach their endpoint and name what they found", async ({ page }) => {
    await unlock(page);
    await page.getByRole("button", { name: "Systems", exact: true }).click();

    for (const label of ["Airlock", "Governance", "Knowledge", "Prompts", "Quant", "Bridge", "Capability", "Runtimes", "Sync"]) {
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
    /*
     * EXACT, BECAUSE THE LOOP APPEARS TWICE AND THAT IS CORRECT BEHAVIOUR.
     *
     * A newly opened loop shows in the list AND raises an alert reading "Close: <title>", so a
     * substring match resolves to two elements and Playwright's strict mode fails the whole journey.
     * This has been red on main since before today's work — verified by running the same test at the
     * previous commit in a scratch worktree, where it fails identically.
     *
     * THE FIX IS THE ASSERTION, NOT THE PRODUCT. Both renders are wanted: the row is the loop and
     * the alert is the nudge to close it. What was wrong was a test that could not say which one it
     * meant, and it would have gone on failing for whichever reason came along next.
     */
    await expect(page.getByText(unique, { exact: true })).toBeVisible({ timeout: 15_000 });

    /*
     * A FULL RELOAD, not a re-render. Client state does not survive one, so if the loop is still
     * there it came back out of the database - which is the only version of "it persisted" worth
     * asserting.
     */
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await openLoops();
    await expect(page.getByText(unique, { exact: true })).toBeVisible({ timeout: 15_000 });
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
