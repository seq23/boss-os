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

export async function tab(page: Page, label: string) {
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: label, exact: true }).click();
  await expect(page.locator("main.page")).toBeVisible();
}

/** Boss OS's page must never scroll sideways at phone width — that is content falling off the edge. */
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
