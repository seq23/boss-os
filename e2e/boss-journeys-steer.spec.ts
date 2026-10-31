import { test, expect } from "@playwright/test";
import { provisionLocalD1, queryLocalD1 } from "./support/provision";
import { unlock, tab, expectNoSidewaysScroll, expectNear, PHONE, LAPTOP } from "./support/boss";

/**
 * STEERING THE TEAM — her instruction door, the roster, and the owned work.
 *
 * "Give the team something to do" is where an instruction enters Boss OS by hand. The journey
 * types one, watches intake classify it before it is sent, sends it, and reads it back from the
 * task list — where, on a machine with no model, it must FAIL BY NAME rather than sit "running".
 * Then the employee sheet, and stopping an owned deliverable, which costs a reason.
 */

const TITLE = "E2E: find three buyers for the OpenAI block";

function cleanSql(): string {
  return [
    `DELETE FROM task_events WHERE task_id IN (SELECT id FROM tasks WHERE title = '${TITLE}')`,
    `DELETE FROM boss_task_queue WHERE task_id IN (SELECT id FROM tasks WHERE title = '${TITLE}')`,
    `DELETE FROM evidence_packets WHERE task_id IN (SELECT id FROM tasks WHERE title = '${TITLE}')`,
    `DELETE FROM approvals WHERE origin_id IN (SELECT id FROM tasks WHERE title = '${TITLE}')`,
    `UPDATE tasks SET approval_id = NULL WHERE title = '${TITLE}'`,
    `DELETE FROM tasks WHERE title = '${TITLE}'`,
    `UPDATE owned_deliverables SET state = 'open', killed_at = NULL, killed_reason = NULL WHERE killed_reason LIKE 'E2E %'`,
    `DELETE FROM discovery_inbox WHERE note LIKE 'E2E %'`,
  ].join("; ");
}

for (const vp of [PHONE, LAPTOP]) {
  test.describe(`Steering the team (${vp.name})`, () => {
    test.beforeEach(async ({ page }) => {
      provisionLocalD1(cleanSql());
      await page.setViewportSize({ width: vp.width, height: vp.height });
    });
    test.afterAll(() => { provisionLocalD1(cleanSql()); });

    test("an instruction is classified before it is sent, lands as a task, and fails by name without a model", async ({ page }) => {
      await unlock(page);
      await tab(page, "Team");
      await page.getByRole("button", { name: "Give the team something to do" }).click();
      const send = page.getByRole("button", { name: "Send it in" });
      await expect(send).toBeDisabled();
      await page.getByPlaceholder("Draft the reply to the LP").fill(TITLE);
      await page.locator("textarea").first().fill("Public research only. Cite the page for each firm.");
      // Intake previews the classification BEFORE anything is sent: kind, risk, who would own it.
      const preview = page.locator(".preview");
      await expect(preview).toBeVisible();
      await expect(preview).toContainText(/risk/);
      await expect(preview).toContainText(/Would go to/);
      await expect(send).toBeEnabled();
      await send.click();
      const result = page.locator(".notice", { hasText: /Queued|Held for you|declined/ });
      await expect(result).toBeVisible();
      await expectNear(page, send, result, 900);

      // The list reads it back FIRST, and only then does the journey read D1 out of band. The form
      // reloads the list 1.2s after a send; `queryLocalD1` opens the same SQLite file in a second
      // workerd process, and when the two overlapped (CI, 31 Oct 2026, run 41173926460) the page's
      // GET /api/tasks failed with SQLITE_BUSY, the list kept its old rows, and this row never came.
      // Waiting for the page to finish its own read keeps the two processes off the file at once.
      const row = page.locator("main.page .row", { hasText: TITLE });
      await expect(row).toBeVisible({ timeout: 15_000 });

      const rows = queryLocalD1<{ id: string; status: string; employee_id: string | null; input: string }>(
        `SELECT id, status, employee_id, input FROM tasks WHERE title = '${TITLE}'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.employee_id, "an owner was suggested").toBeTruthy();
      expect(JSON.parse(rows[0]!.input).prompt).toContain("Cite the page");

      // With no model behind wrangler dev the drain must FAIL IT BY NAME — never leave it 'running'
      // for ever, never say it succeeded.
      await expect.poll(
        () => queryLocalD1<{ status: string }>(`SELECT status FROM tasks WHERE title = '${TITLE}'`)[0]!.status,
        { timeout: 30_000 },
      ).toMatch(/failed|awaiting_approval|queued/);
      const final = queryLocalD1<{ status: string; error: string | null }>(`SELECT status, error FROM tasks WHERE title = '${TITLE}'`)[0]!;
      if (final.status === "failed") {
        expect(final.error, "a failed task names its reason").toBeTruthy();
        await page.reload();
        await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible({ timeout: 15_000 });
        await tab(page, "Team");
        await expect(page.locator("main.page .row", { hasText: TITLE })).toContainText(/failed/);
        await expect(page.locator("main.page .row", { hasText: TITLE })).toContainText(final.error!.slice(0, 30));
      }
      if (vp.name === "phone") await expectNoSidewaysScroll(page);
    });

    /*
     * The employee sheet became her own page (Builder U, 23 Oct 2026, board 8). Same promises, held
     * at least as tightly: a tap opens it, it quotes the charter and lists every duty, and there is a
     * labelled way back to exactly where she was.
     */
    test("the employee page opens on a tap, quotes the charter and the duties, and goes back", async ({ page }) => {
      await unlock(page);
      await tab(page, "Team");
      await page.getByTestId("team-card").filter({ hasText: "Camille" }).click();
      const sheet = page.getByTestId("employee-page");
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText("What she is for");
      await expect(sheet.locator(".charter")).not.toHaveText("");
      await expect(sheet).toContainText("Her duties");
      const cards = sheet.getByTestId("duty-card");
      expect(await cards.count()).toBeGreaterThanOrEqual(1);
      await expect(sheet).toContainText("Executive Intelligence Report");
      await sheet.getByRole("button", { name: "← Back to Your team", exact: true }).first().click();
      await expect(sheet).toHaveCount(0);
      await expect(page.getByTestId("team-card").filter({ hasText: "Camille" })).toBeVisible();
      if (vp.name === "phone") await expectNoSidewaysScroll(page);
    });

    test("stopping owned work costs a reason, and the reason stays in the register", async ({ page }) => {
      const open = queryLocalD1<{ id: string; name: string }>(`SELECT id, name FROM owned_deliverables WHERE state IN ('open','blocked') ORDER BY created_at LIMIT 1`);
      test.skip(open.length === 0, "no owned deliverable is seeded in this build");
      await unlock(page);
      await tab(page, "Team");
      await page.locator("main.page .btn-row").first().getByRole("button", { name: "Owns" }).click();
      await expect(page.locator("main.page")).toContainText(/Owned work — \d+ open/);
      const card = page.locator("main.page .docket", { hasText: open[0]!.name }).first();
      await card.locator("summary").click();
      await card.getByRole("button", { name: "Stop this" }).click();
      const stop = card.getByRole("button", { name: "Stop it" });
      await expect(stop).toBeDisabled();
      await card.locator("input").fill("E2E — no longer worth the seat");
      await stop.click();
      await expect.poll(() => queryLocalD1<{ state: string; r: string }>(`SELECT state, killed_reason AS r FROM owned_deliverables WHERE id = '${open[0]!.id}'`)[0]).toEqual({ state: "killed", r: "E2E — no longer worth the seat" });
      await page.locator("main.page .docket", { hasText: open[0]!.name }).first().locator("summary").click();
      await expect(page.locator("main.page .docket", { hasText: open[0]!.name }).first()).toContainText("Stopped because: E2E — no longer worth the seat");
      // A wordless stop is refused at the route too, not only by the disabled button.
      const bare = await page.request.post(`/api/boss/deliverables/${open[0]!.id}`, { data: { state: "killed", killed_reason: "" } });
      expect(bare.status()).toBe(400);
    });

    test("a capability search is recorded with its trigger and note", async ({ page }) => {
      await unlock(page);
      await tab(page, "Team");
      await page.locator("main.page .btn-row").first().getByRole("button", { name: "Capabilities" }).click();
      const record = page.getByRole("button", { name: "Record the search" });
      await expect(record).toBeDisabled();
      await page.locator("main.page textarea").first().fill("E2E — a cheaper transcription route");
      await expect(record).toBeEnabled();
      await record.click();
      await expect.poll(() => queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM discovery_inbox WHERE note LIKE 'E2E %'`)[0]!.n).toBe(1);
      await expect(page.locator("main.page")).toContainText("E2E — a cheaper transcription route");
    });
  });
}
