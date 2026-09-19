import { test, expect, type Page } from "@playwright/test";
import { provisionLocalD1, queryLocalD1 } from "./support/provision";

/**
 * HER FIVE JOBS, 19 SEPTEMBER 2026 — the two new doors, driven as she drives them.
 *
 *   1 · "Find firms that did X and draft the ask" from the Capital desk and from Team → New task:
 *       the same sentence becomes the same scan, owned by Camille, with one sentence of progress
 *       from rows. `wrangler dev --local` has no rung, so the scan stops by name and the desk says
 *       so — the honest boundary; the live run is `tests/fixtures/firm-scan/live-run-2026-09-19.json`.
 *   2 · A sentence that is not both a find and an ask is refused beside the field, and nothing is
 *       created.
 *   3 · At phone width the rewrite line, the scan door and the letters do not overflow.
 */

const PASSCODE = "local-dev-passcode";
const INSTRUCTION = "find me a list of firms that reported participation in the Anthropic IPO, and draft an email to ask if I can send investors to them";

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
    `DELETE FROM ask_scan_findings WHERE scan_id IN (SELECT id FROM ask_scans WHERE instruction LIKE '%Anthropic IPO%')`,
    `DELETE FROM boss_task_queue WHERE task_id IN (SELECT task_id FROM ask_scans WHERE instruction LIKE '%Anthropic IPO%')`,
    `DELETE FROM task_events WHERE task_id IN (SELECT task_id FROM ask_scans WHERE instruction LIKE '%Anthropic IPO%')`,
    `DELETE FROM tasks WHERE id IN (SELECT task_id FROM ask_scans WHERE instruction LIKE '%Anthropic IPO%')`,
    `DELETE FROM ask_scans WHERE instruction LIKE '%Anthropic IPO%'`,
  ].join("; ");
}

test.describe("Her jobs — find firms and draft the ask", () => {
  test.beforeEach(() => { provisionLocalD1(cleanSql()); });
  test.afterAll(() => { provisionLocalD1(cleanSql()); });

  test("the desk door: one sentence in, a scan owned by Camille, progress from rows, and a named stop here", async ({ page }) => {
    await unlock(page);
    await tab(page, "Capital");
    const panel = page.getByTestId("firm-scans");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("No instruction has started a scan yet");

    // A sentence with no ask is refused BESIDE the field, and nothing is created.
    const box = page.getByLabel("What to find and what to ask");
    await box.fill("find me a list of firms that reported participation in the Anthropic IPO");
    await page.getByTestId("start-firm-scan").click();
    await expect(panel).toContainText("does not say both what to find and what to ask");
    expect(queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM ask_scans WHERE instruction LIKE '%Anthropic IPO%'`)[0]!.n).toBe(0);

    // Her sentence.
    await box.fill(INSTRUCTION);
    await page.getByTestId("start-firm-scan").click();
    await expect(panel).toContainText("Camille has it");
    await expect(panel).toContainText('Find: "reported participation in the Anthropic IPO"');
    await expect(panel).toContainText('Ask: "if I can send investors to them"');

    const row = page.getByTestId("firm-scan").filter({ hasText: INSTRUCTION });
    await expect(row).toHaveCount(1);
    const scans = queryLocalD1<{ id: string; task_id: string; state: string; find_text: string }>(
      `SELECT id, task_id, state, find_text FROM ask_scans WHERE instruction LIKE '%Anthropic IPO%'`,
    );
    expect(scans).toHaveLength(1);
    expect(scans[0]!.find_text).toBe("reported participation in the Anthropic IPO");
    const task = queryLocalD1<{ employee_id: string; input: string }>(`SELECT employee_id, input FROM tasks WHERE id = '${scans[0]!.task_id}'`)[0]!;
    expect(task.employee_id).toBe("emp_research");
    expect(JSON.parse(task.input).firm_scan.scan_id).toBe(scans[0]!.id);

    // The drain ran after the POST. No rung here may take the work, so the scan stopped BY NAME —
    // on the row, on the sentence, and on the task — rather than reading "queued" for ever.
    const sentence = row.getByTestId("firm-scan-sentence");
    await expect(sentence).toContainText("Stopped: The router refused the scan", { timeout: 60_000 });
    await expect(row.locator(".field-error")).toContainText("refused");
    const after = queryLocalD1<{ state: string; failure: string; status: string }>(
      `SELECT s.state, s.failure, t.status FROM ask_scans s JOIN tasks t ON t.id = s.task_id WHERE s.id = '${scans[0]!.id}'`,
    )[0]!;
    expect(after.state).toBe("failed");
    expect(after.failure).toContain("router refused");
    expect(after.status).toBe("failed");
    // A stop drafted nothing.
    expect(queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM sourcing_candidates WHERE kind = 'ask'`)[0]!.n).toBe(0);

    // The list opens and says so honestly.
    await row.getByRole("button", { name: /Show the list/ }).click();
    await expect(row).toContainText("No firm has been named yet");
  });

  test("Team → New task with the same sentence becomes the same scan, and says who has it", async ({ page }) => {
    await unlock(page);
    await tab(page, "Team");
    await page.getByRole("button", { name: "Give the team something to do" }).click();
    await page.getByLabel("What needs doing").fill(INSTRUCTION);
    await page.getByRole("button", { name: "Send it in" }).click();
    await expect(page.locator("main.page")).toContainText("Camille has it", { timeout: 15_000 });
    await expect(page.locator("main.page")).toContainText("find firms that reported participation in the Anthropic IPO");
    const scans = queryLocalD1<{ ask_text: string }>(`SELECT ask_text FROM ask_scans WHERE instruction LIKE '%Anthropic IPO%'`);
    expect(scans).toHaveLength(1);
    expect(scans[0]!.ask_text).toBe("if I can send investors to them");
  });

  test("at phone width the scan door and the desk do not overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await unlock(page);
    await tab(page, "Capital");
    await expect(page.getByTestId("firm-scans")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    const box = page.getByLabel("What to find and what to ask");
    const bb = (await box.boundingBox())!;
    expect(bb.x + bb.width).toBeLessThanOrEqual(390);
  });
});
