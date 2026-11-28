import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { tab } from "./support/boss";
import { provisionLocalD1, queryLocalD1 } from "./support/provision";
import { OWNER_OK_CROSSINGS, fundCrossings } from "../tests/helpers/fundCrossings";

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
    await expect(camille).toContainText(/Daily at 4:00 AM Central/); // migration 0373, the Mac's day (06:00 before)
    await expect(camille).toContainText(/An AI teammate \(Sonnet\)/);
    // A next run is a future date or a missed one with its date, never "next —" (ship review, 28 Nov 2026).
    await expect(camille.locator(".row-val").first()).toHaveText(/^(next|missed since) (Sun|Mon|Tue|Wed|Thu|Fri|Sat), [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d\d (AM|PM) Central/);
    await expect(page.locator("main.page")).not.toContainText("next —");
    await expect(camille.getByTestId("duty-row").first()).toContainText(/Last ran [^·]+|Hasn’t run yet/);
    // A local job says it runs on her Mac (the Email Map's words) and names its script in the details.
    await expect(page.locator('[data-testid="duty-row"] [data-testid="path-runs"]', { hasText: /^Your Mac$/ }).first()).toBeAttached();
    await expect(page.locator('[data-testid="duty-row"] dd').filter({ hasText: /^[a-z0-9-]+\.(sh|mjs)$/ }).first()).toBeAttached();
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
    await expect(preview).toContainText("Here is the new regular job for Camille, ready to set up");
    await expect(preview).toContainText(/When:\s+Fridays at \d{1,2}(:\d\d)? (am|pm)/);
    // Plain words (owner, 22 Oct 2026): no 24-hour clock, no time-zone string, no table name.
    await expect(preview).not.toContainText("America/Chicago");
    await expect(preview).not.toContainText("executive_reports");
    await expect(preview).toContainText(/Runs on:\s+an AI teammate/);
    await expect(preview).toContainText(/Thinking:\s+the quick model/);
    await expect(preview).toContainText(/Results go to:\s+executive reports/);
    await expect(preview).toContainText("Reply approved to set it up, or reply changes: and what you want different.");
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
    await expect(camille.getByTestId("duty-row").filter({ hasText: /Fridays at \d{1,2}:\d\d (AM|PM) Central/ }).filter({ hasText: "An AI teammate (Haiku)" })).not.toHaveCount(0);
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
    await expect(preview).toContainText(/Runs on:\s+your Mac/);
    await expect(page.getByTestId("create-duty")).toHaveCount(0);
    expect(queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM duty_drafts`)[0]!.n).toBe(0);
    expect(queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM judgement_calls WHERE resume_kind = 'duty_created'`)[0]!.n).toBe(0);
  });

  test("when the schedule cannot be read, the page says so and shows no run times", async ({ page }) => {
    await unlock(page);
    await page.route("**/api/boss/employees/roster", (r) => r.abort());
    await tab(page, "Team");
    await page.getByRole("button", { name: "Duties", exact: true }).click();
    await expect(page.getByTestId("ops-unchecked")).toContainText("Couldn't check the schedule just now");
    await expect(page.getByTestId("duty-row")).toHaveCount(0);
    await expect(page.locator("main.page .row-val", { hasText: /^next / })).toHaveCount(0);
    // It comes back on its own button once the read works again.
    await page.unroute("**/api/boss/employees/roster");
    await page.getByTestId("ops-unchecked").getByRole("button", { name: "Try again ↻" }).click();
    await expect(page.getByTestId("duty-row").first()).toBeVisible();
  });

  test("at phone width the Duties screen does not overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await unlock(page);
    await tab(page, "Team");
    await page.getByRole("button", { name: "Duties", exact: true }).click();
    await expect(page.getByTestId("add-duty")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    const row = page.locator('[data-path-id="simone-your-day"]');
    const copy = (await row.locator(".row-main").boundingBox())!;
    const next = (await row.locator(".row-val").boundingBox())!;
    expect(next.y).toBeGreaterThanOrEqual(copy.y + copy.height);
    const bb = (await page.getByTestId("duty-phrase").boundingBox())!;
    expect(bb.x + bb.width).toBeLessThanOrEqual(390);
  });

  /*
   * THE OPERATIONS VIEW (owner, 12 Oct 2026): Duties is also where every machine-run sending path
   * from docs/OUTBOUND_EMAIL_MAP.md lives, beside the duties, each under the seat that owns it, with
   * a three-line synopsis at the top. Today carries the synopsis in one line and the way there.
   */
  test("the operations synopsis and the map's sending paths sit beside the duties, each under its owner", async ({ page }) => {
    await unlock(page);
    // System health left Today (31 Oct 2026): the synopsis sits on Systems → Alerts and team, and it
    // is NOT on Today any more.
    await expect(page.getByTestId("today-list")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("today-operations")).toHaveCount(0);
    await tab(page, "Systems");
    await page.getByRole("tab", { name: "Alerts and team" }).click();
    await expect(page.getByTestId("today-operations")).toContainText(/Running today: \d+ duties/);
    await page.getByTestId("open-operations").click();
    await expect(page.getByTestId("ops-running")).toContainText(/Running today: \d+ duties · \d+ scheduled email paths · \d+ off/);
    await expect(page.getByTestId("ops-sent")).toContainText(/Sent today: outreach \d+/);
    await expect(page.getByTestId("ops-needs")).toContainText(/Needs you: 0 unassigned · \d+ failed runs · \d+ named stops/);
    await expect(page.getByTestId("ops-unassigned")).toHaveCount(0);
    // Exactly the map's rows: every Id on docs/OUTBOUND_EMAIL_MAP.md once, as its own row or inside the
    // duty that is its job (owners file `duty`), never twice (ship review, 27 Nov 2026: Zora's audit twice).
    const mapIds = readFileSync(path.join(process.cwd(), "docs/OUTBOUND_EMAIL_MAP.md"), "utf8").split("\n").filter((l) => /^\|\s*`[^`]+`\s*\|/.test(l)).length;
    expect(mapIds).toBeGreaterThan(0);
    expect(await page.locator("[data-path-id]").count()).toBe(mapIds);
    await expect(page.locator('[data-path-id="zora-archive-audit"]')).toHaveCount(1);
    await expect(page.locator('[data-duty-id="duty_archive_audit"]')).toHaveAttribute("data-path-id", "zora-archive-audit");
    // Monique's outreach sits in her section, with the one in-app switch that exists.
    const outreach = page.getByRole("region", { name: "Monique's duties" }).locator('[data-path-id="monique-outreach"]');
    await expect(outreach.getByTestId("path-runs")).toHaveText("Cloud, on a schedule"); // the Email Map's words, never "Cloudflare cron"
    await outreach.getByText("Show details", { exact: true }).click();
    await expect(outreach.getByText(/^hello@/)).toBeVisible();
    await expect(outreach).toContainText(/next /);
    // The only owner outside Boss OS is the client; the fund has no row and no seat here (owner, 12 Oct 2026).
    await expect(page.getByTestId("duties-outside")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "The client's paths" }).locator('[data-path-id="client-dashboards-mail"]')).toBeVisible();
    // The fund never crosses onto a rendered row, read with THE SAME term list and the same OK'd
    // crossings as the map's unit test (tests/helpers/fundCrossings.ts): one list, never two.
    const rendered: Array<[string, string]> = [];
    for (const row of await page.locator("[data-path-id]").all()) {
      const id = (await row.getAttribute("data-path-id")) ?? "";
      expect(id, "every path row carries its map Id").not.toBe("");
      rendered.push([`path row ${id}`, `| \`${id}\` | ${await row.innerText()}`]);
    }
    expect(rendered.length).toBe(mapIds);
    expect(fundCrossings(rendered)).toEqual([]);
    // Each crossing she OK'd is a row that renders, so the allowance is never for a row nobody sees.
    for (const id of Object.keys(OWNER_OK_CROSSINGS)) await expect(page.locator(`[data-path-id="${id}"]`)).toHaveCount(1);
    await expect(page.locator('[data-path-id="approvalprep-download-email"]')).toContainText("no switch");
    await outreach.getByTestId("path-pause").click();
    await expect(page.getByRole("button", { name: "Outreach", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
});
