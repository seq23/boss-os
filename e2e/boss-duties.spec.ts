import { test, expect, type Page } from "@playwright/test";
import { provisionLocalD1, queryLocalD1 } from "./support/provision";

/**
 * TEAM → DUTIES — the screen door of the duty lane, 21 September 2026.
 *
 *   "is there a lane for me to ask for a new duty to my Boss OS agents? i still dont know how to
 *    create a job for them — if it's not user-friendly then make it so."
 *
 *   1 · Every employee is listed with every duty: cadence, executor, last run, next run, outcome.
 *   2 · "Add a duty": her phrase previews as the full draft BEFORE anything exists; Create files it
 *       as a card in the Inbox; Approve there creates exactly one duty row; the screen shows it.
 *   3 · A duty that cannot run is a NAMED STOP beside the field, with no Create button and no row.
 *   4 · At phone width nothing overflows.
 */

const PASSCODE = "local-dev-passcode";
const PHRASE = "every friday, write me a short report on what changed in the private markets this week";
const LOCAL_PHRASE = "every friday, read my inbox and tell me which LPs went quiet";

async function unlock(page: Page) {
  await page.goto("/boss");
  const field = page.getByLabel("Passcode");
  await expect(field).toBeVisible();
  await field.fill(PASSCODE);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
}

async function tab(page: Page, label: string) {
  const nav = page.getByRole("navigation", { name: "Sections" });
  const toggle = page.getByTestId("nav-toggle");
  if (await toggle.isVisible().catch(() => false)) await toggle.click();
  await nav.getByRole("button", { name: label, exact: true }).click();
  await expect(page.locator("main.page")).toBeVisible();
}

function cleanSql(): string {
  return [
    `DELETE FROM standing_duties WHERE json_extract(task_input, '$.provenance') IS NOT NULL`,
    `DELETE FROM approvals WHERE id IN (SELECT approval_id FROM duty_drafts WHERE approval_id IS NOT NULL)`,
    `DELETE FROM judgement_calls WHERE id IN (SELECT judgement_id FROM duty_drafts WHERE judgement_id IS NOT NULL)`,
    `DELETE FROM duty_drafts`,
  ].join("; ");
}

test.describe("Team → Duties", () => {
  test.beforeEach(() => { provisionLocalD1(cleanSql()); });
  test.afterAll(() => { provisionLocalD1(cleanSql()); });

  test("every seat with every duty — cadence, executor, last run, next run, outcome", async ({ page }) => {
    await unlock(page);
    await tab(page, "Team");
    await page.getByRole("button", { name: "Duties", exact: true }).click();
    await expect(page.getByTestId("add-duty")).toBeVisible();
    const seats = page.getByTestId("duties-employee");
    await expect(seats.first()).toBeVisible();
    expect(await seats.count()).toBeGreaterThanOrEqual(5);
    const rows = page.getByTestId("duty-row");
    expect(await rows.count()).toBeGreaterThanOrEqual(5);
    // Camille's morning report: daily, an agent on Sonnet, next run stated.
    const camille = page.getByRole("region", { name: "Camille's duties" });
    await expect(camille).toContainText(/daily at 06:00/);
    await expect(camille).toContainText(/agent · Sonnet/);
    await expect(camille).toContainText(/next /);
    await expect(camille).toContainText(/last run/);
    // A local job says it runs on her Mac and names the script.
    await expect(page.locator("main.page")).toContainText(/your Mac · [a-z-]+\.(sh|mjs)/);
  });

  test("Add a duty: preview in full, Create files a card, Approve in the Inbox creates exactly one duty", async ({ page }) => {
    await unlock(page);
    await tab(page, "Team");
    await page.getByRole("button", { name: "Duties", exact: true }).click();
    await page.getByTestId("duty-owner").selectOption({ label: "Camille — Director of Research" });
    await page.getByTestId("duty-phrase").fill(PHRASE);
    await page.getByTestId("preview-duty").click();

    const preview = page.getByTestId("duty-preview");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Here is the duty as I would create it for Camille");
    await expect(preview).toContainText(/Cadence:\s+every Friday at \d\d:\d\d America\/Chicago/);
    await expect(preview).toContainText(/Executor:\s+an agent/);
    await expect(preview).toContainText(/Model:\s+Haiku/);
    await expect(preview).toContainText(/Delivery:\s+executive_reports/);
    await expect(preview).toContainText("Reply `approved` to create it, `changes: …` to redraft.");
    // A preview files nothing.
    expect(queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM duty_drafts`)[0]!.n).toBe(0);

    await page.getByTestId("create-duty").click();
    await expect(page.getByTestId("duty-filed")).toContainText("It is in your Inbox as a card");
    const drafts = queryLocalD1<{ id: string; state: string; door: string; approval_id: string; judgement_id: string }>(`SELECT id, state, door, approval_id, judgement_id FROM duty_drafts`);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.state).toBe("drafted");
    expect(drafts[0]!.door).toBe("screen");
    expect(queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM standing_duties WHERE json_extract(task_input, '$.provenance') IS NOT NULL`)[0]!.n).toBe(0);
    await expect(page.getByTestId("duty-draft").first()).toContainText("waiting on you");

    // The card, in the Inbox, is the same judgement call; Approve creates the duty.
    await tab(page, "Inbox");
    const card = page.locator("article.docket", { hasText: "New duty for Camille" });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole("button", { name: "Approve — put it on the schedule" }).click();
    await expect(page.locator("main.page")).toContainText(/Created\. Camille runs it weekly/, { timeout: 15_000 });

    const duties = queryLocalD1<{ id: string; employee_id: string; executor: string; cadence: string; weekday: number; task_input: string }>(
      `SELECT id, employee_id, executor, cadence, weekday, task_input FROM standing_duties WHERE json_extract(task_input, '$.provenance') IS NOT NULL`,
    );
    expect(duties).toHaveLength(1);
    expect(duties[0]!.employee_id).toBe("emp_research");
    expect(duties[0]!.executor).toBe("agent");
    expect(duties[0]!.cadence).toBe("weekly");
    expect(duties[0]!.weekday).toBe(5);
    expect(JSON.parse(duties[0]!.task_input).provenance.via).toBe("inbox");
    expect(queryLocalD1<{ state: string; duty_id: string }>(`SELECT state, duty_id FROM duty_drafts`)[0]).toMatchObject({ state: "created", duty_id: duties[0]!.id });

    // And the screen shows it under Camille.
    await tab(page, "Team");
    await page.getByRole("button", { name: "Duties", exact: true }).click();
    const camille = page.getByRole("region", { name: "Camille's duties" });
    await expect(camille).toContainText(/Fri at \d\d:\d\d · agent · Haiku/);
    await expect(page.getByTestId("duty-draft").first()).toContainText("created");
  });

  test("a duty that cannot run is a NAMED STOP beside the field: no Create button, no row", async ({ page }) => {
    await unlock(page);
    await tab(page, "Team");
    await page.getByRole("button", { name: "Duties", exact: true }).click();
    await page.getByTestId("duty-owner").selectOption({ label: "Monique — Director of Relationships" });
    await page.getByTestId("duty-phrase").fill(LOCAL_PHRASE);
    await page.getByTestId("preview-duty").click();
    const preview = page.getByTestId("duty-preview");
    await expect(preview).toContainText("NAMED STOP [NO_SUCH_SCRIPT]");
    await expect(preview).toContainText(/Executor:\s+a job on your Mac/);
    await expect(page.getByTestId("create-duty")).toHaveCount(0);
    expect(queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM duty_drafts`)[0]!.n).toBe(0);
    expect(queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM judgement_calls WHERE resume_kind = 'duty_created'`)[0]!.n).toBe(0);
  });

  test("at phone width the Duties screen does not overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await unlock(page);
    await tab(page, "Team");
    await page.getByRole("button", { name: "Duties", exact: true }).click();
    await expect(page.getByTestId("add-duty")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    const bb = (await page.getByTestId("duty-phrase").boundingBox())!;
    expect(bb.x + bb.width).toBeLessThanOrEqual(390);
  });
});
