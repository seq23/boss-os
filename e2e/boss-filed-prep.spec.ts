import { test, expect } from "@playwright/test";
import { provisionLocalD1 } from "./support/provision";
import { unlock, PHONE, expectNoSidewaysScroll } from "./support/boss";

/**
 * A PREP PAST THE DAY'S EMAIL CAP OPENS FROM ITS MEETING (owner, 13 Nov 2026). It is made and filed,
 * never emailed, so Today is its door: the meeting's row shows "Your prep ›", the page shows the
 * whole prep, and Back returns to the same meeting. Driven at phone width; any console error fails.
 */
const CMD = "cmd_e2e_filed_prep";
const MEET = "dry_e2e_filed_prep";
const TITLE = "E2E call with Pat Example";
const WORDS = "Your prep for the call with Pat Example.\n\nWho: Pat Example, Example Capital.\nLast spoke: three weeks ago, about the fund.\nAsk for: a second meeting.\n\nThe last line of the prep.";
const sql = (v: unknown) => `'${String(v).replace(/'/g, "''")}'`;
const clean = () => provisionLocalD1(`DELETE FROM boss_commands WHERE id = '${CMD}'; DELETE FROM diary_entries WHERE id = '${MEET}'`);
const shot = (name: string) => (process.env.PREP_SHOT_DIR ? { path: `${process.env.PREP_SHOT_DIR}/${name}`, fullPage: false } : null);

test.beforeEach(clean);
test.afterEach(clean);

test("Today's meeting opens its filed prep, whole, and Back returns to that meeting", async ({ page }) => {
  const at = Date.now() + 3 * 3_600_000;
  const now = Date.now();
  provisionLocalD1(
    `INSERT INTO diary_entries (id, title, counterpart, scheduled_at, source, created_at, updated_at) VALUES ('${MEET}', ${sql(TITLE)}, 'Pat Example', ${at}, 'manual', ${now}, ${now});
     INSERT INTO boss_commands (id, kind, state, spec, result, created_at, updated_at) VALUES ('${CMD}', 'meeting_prep', 'sent', ${sql(JSON.stringify({ key: `e2e|${at}`, who: "Pat Example", subject: "Prep: Pat Example", event: { title: TITLE, scheduled_at: at }, prep: { subject: "Prep: Pat Example", text: WORDS, emailed: false } }))}, '{}', ${now}, ${now})`,
  );
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.setViewportSize(PHONE);
  await unlock(page);
  const coming = page.getByTestId("coming-up");
  await coming.locator("summary").click();
  const row = coming.locator(".row", { hasText: TITLE });
  await expect(row.getByTestId("your-prep")).toBeVisible();
  await row.scrollIntoViewIfNeeded();
  await expectNoSidewaysScroll(page);
  const s1 = shot("today-your-prep-390.png"); if (s1) await page.screenshot(s1);

  await row.getByTestId("your-prep").click();
  const prep = page.getByTestId("command-page");
  await expect(prep.getByRole("heading", { name: "Your meeting prep" })).toBeVisible();
  await expect(prep.getByTestId("filed-prep")).toContainText("Ask for: a second meeting.");
  await expect(prep.getByTestId("filed-prep")).toContainText("The last line of the prep.");
  // It names the meeting, and shows no empty email thread for a prep that was never emailed.
  await expect(prep).toContainText(TITLE);
  await expect(prep).not.toContainText("No saved emails");
  await expect(prep).not.toContainText("What you asked for");
  await expect(prep.getByRole("button", { name: "← Back", exact: true }).first()).toBeVisible();
  await expectNoSidewaysScroll(page);
  const s2 = shot("prep-page-390.png"); if (s2) await page.screenshot({ ...s2, fullPage: true });

  await prep.getByRole("button", { name: "← Back", exact: true }).first().click();
  // Back on Today, "Coming up" is open again on the same meeting, in view.
  await expect(page.getByTestId("coming-up").locator(".row", { hasText: TITLE }).getByTestId("your-prep")).toBeInViewport();
  expect(errors).toEqual([]);
});
