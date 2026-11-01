import { expect, type Page } from "@playwright/test";

/**
 * Boss OS journey helpers — the two things every journey does first.
 *
 * The passcode is the local fixture published in `wrangler.toml`; it cannot reach production.
 * Boss OS's nav is a bottom tab bar that is always on screen at every width, so a tab is reached by
 * its label directly — there is no sheet to open, unlike the chassis (`e2e/support/nav.ts`).
 */
export const PASSCODE = "local-dev-passcode";

export const PHONE = { name: "phone", width: 390, height: 844 } as const;
export const LAPTOP = { name: "laptop", width: 1280, height: 720 } as const;

export async function unlock(page: Page) {
  await page.goto("/boss");
  const field = page.getByLabel("Passcode");
  await expect(field).toBeVisible();
  await field.fill(PASSCODE);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
}

/**
 * FIVE TABS AND "☰ MORE" (owner approved the new Today, 31 Oct 2026). Today, Inbox, Capital and
 * Spirit are in the bar; Team, Brains, Memory, Trading, Vault and Systems sit in "☰ More". This walks the way
 * she does: straight to a bar tab, or More first. A tab that is in neither fails here.
 */
export const BAR_TABS = ["Today", "Inbox", "Capital", "Spirit"] as const;
export const MORE_TABS = ["Team", "Brains", "Email Map", "Schedule", "Validators", "Memory", "Trading", "Vault", "Systems"] as const;

export async function tab(page: Page, label: string) {
  const nav = page.getByRole("navigation", { name: "Sections" });
  if ((MORE_TABS as readonly string[]).includes(label)) {
    await nav.getByRole("button", { name: "☰ More", exact: true }).click();
    await expect(page.getByTestId("more-panel")).toBeVisible();
  }
  await nav.getByRole("button", { name: label, exact: true }).click();
  await expect(page.locator("main.page")).toBeVisible();
  await expect(page.getByTestId("more-panel")).toHaveCount(0);
}

/** Settings (the old "Operations" chip) lives in "☰ More" → Operations. */
export async function openSettings(page: Page) {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "☰ More", exact: true }).click();
  await page.getByRole("button", { name: "Open settings" }).click();
}

export async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal overflow in px").toBe(0);
}

/**
 * A failure or confirmation must sit where the reader is looking. PR #27 measured an error box at
 * y = −2980 with the input at y = 627: the message rendered at the top of a page she had scrolled
 * past. So: the message's box must be within `within` px of the element she acted on.
 */
export async function expectNear(page: Page, actedOn: ReturnType<Page["locator"]>, message: ReturnType<Page["locator"]>, within = 400) {
  const a = (await actedOn.boundingBox())!;
  const m = (await message.boundingBox())!;
  expect(a, "acted-on element has a box").toBeTruthy();
  expect(m, "message has a box").toBeTruthy();
  expect(Math.abs(m.y - a.y), "message distance from the element (px)").toBeLessThan(within);
}
