import { test, expect } from "@playwright/test";
import { provisionLocalD1, queryLocalD1 } from "./support/provision";
import { unlock, tab, expectNoSidewaysScroll, PHONE, LAPTOP } from "./support/boss";

/**
 * THE NEW TODAY, AS SHE USES IT (owner approved the mock-up, 31 Oct 2026).
 *
 * One list she can tick: the Morning gate first, the Midday gate in the middle, the Night gate last.
 * Above it the summary line, the briefing excerpt, the bold coaching law and one Spirit line. System
 * health lives on Systems. Tell Simone floats on every tab. Every journey below writes to D1 and reads
 * it back: a screen that only looked right is not a pass.
 */

import { dayIdInZone } from "../src/shared/boss/timezone";

const DAY = dayIdInZone(Date.now());

function cleanSql(): string {
  return [
    `DELETE FROM gate_entries WHERE day_id = '${DAY}'`,
    `UPDATE days SET morning_completed_at = NULL, midday_completed_at = NULL, night_completed_at = NULL, morning_contract = NULL, morning_priorities = NULL WHERE id = '${DAY}'`,
    `DELETE FROM today_ticks WHERE day_id = '${DAY}'`,
    `DELETE FROM gate_templates`,
    `DELETE FROM gate_days WHERE day_id = '${DAY}'`,
    `DELETE FROM open_loops WHERE title LIKE 'E2E loop %'`,
    `DELETE FROM diary_entries WHERE title LIKE 'E2E meeting %'`,
    `DELETE FROM alert_dismissals WHERE reason LIKE 'E2E %'`,
    `DELETE FROM mailbox_findings WHERE id = 'mbf_e2e_pair'`,
  ].join("; ");
}

for (const vp of [PHONE, LAPTOP]) {
  test.describe(`Today (${vp.name})`, () => {
    test.beforeEach(async ({ page }) => {
      provisionLocalD1(cleanSql());
      await page.setViewportSize({ width: vp.width, height: vp.height });
    });
    test.afterAll(() => { provisionLocalD1(cleanSql()); });

    test("opens on the summary, the law and one list with the gates first, middle and last; system health is gone", async ({ page }) => {
      await unlock(page);
      await tab(page, "Today");
      const summary = page.getByTestId("today-summary");
      await expect(summary).toContainText(/\d+ for you · \d+ of \d+ done/, { timeout: 15_000 });
      const law = page.getByTestId("law-card");
      await expect(law).toContainText(/Law \d+ · /);
      await expect(law.getByRole("button", { name: "Read it aloud ✓" })).toBeVisible();
      await expect(law.getByRole("button", { name: "Talk it through with your coach ›" })).toBeVisible();

      const rows = page.getByTestId("today-list").locator(".t-row");
      const keys = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
      expect(keys[0]).toBe("row-gate:morning");
      expect(keys[keys.length - 1]).toBe("row-gate:night");
      expect(keys).toContain("row-gate:midday");
      // Every row has a circle, labelled with what tapping it does.
      expect(await rows.locator(".tick").count()).toBe(keys.length);

      // The summary count is the list's count: the rows that need her.
      const n = Number(/(\d+) for you/.exec(await summary.innerText())![1]);
      const api = await page.request.get("/api/boss/practice/list");
      expect((await api.json()).data.needs_you).toBe(n);

      // Off Today, to Systems: no alerts card, no roll call, no Operations panel, no empty cards.
      const main = page.locator("main.page");
      await expect(main.locator("h3", { hasText: /Critical Alerts|AI Employee Status|Approval Inbox|Open Loops|Run of Show|Today's Contract/ })).toHaveCount(0);
      await expect(page.getByTestId("today-operations")).toHaveCount(0);
      for (const gone of [/Nothing is hanging/, /Nothing is waiting on you\./, /Running today:/]) await expect(main).not.toContainText(gone);
      // The summary and the law are on the first screen.
      const lawBox = (await law.boundingBox())!;
      expect(lawBox.y).toBeLessThan(vp.height);
      if (vp.name === "phone") await expectNoSidewaysScroll(page);
    });

    test("the three gates record from inside the list, read back after a reload, and cannot be run twice", async ({ page }) => {
      await unlock(page);
      await tab(page, "Today");
      const row = (g: string) => page.getByTestId(`row-gate:${g}`);

      await row("morning").getByRole("button", { name: "Tap to open ▾" }).click();
      await expect(row("morning")).toContainText("☀ Morning coaching");
      await expect(row("morning")).toContainText("Say it aloud");
      await page.getByLabel("Priority 1").fill("E2E: write to two buyers");
      await row("morning").getByRole("button", { name: "Agree the day" }).click();
      await expect(row("morning").locator(".t-row-time")).toContainText("✓", { timeout: 15_000 });
      const d1 = queryLocalD1<{ m: number | null; p: string | null }>(`SELECT morning_completed_at AS m, morning_priorities AS p FROM days WHERE id = '${DAY}'`);
      expect(d1[0]?.m, "days.morning_completed_at").toBeTruthy();
      expect(d1[0]?.p).toContain("E2E: write to two buyers");
      await expect(row("morning").getByRole("button", { name: "Agree the day" })).toHaveCount(0);

      await row("midday").getByRole("button", { name: "Tap to open ▾" }).click();
      await expect(row("midday")).toContainText("one keto meal");
      await row("midday").getByLabel("What changed").fill("E2E: nothing; the plan stands");
      await row("midday").getByRole("button", { name: "Reset", exact: true }).click();
      await expect(row("midday").locator(".t-row-time")).toContainText("✓", { timeout: 15_000 });

      await row("night").getByRole("button", { name: "Tap to open ▾" }).click();
      const close = row("night").getByRole("button", { name: "Close the day" });
      await expect(close).toBeDisabled();
      await row("night").getByLabel("Focus area 1").fill("E2E: brokerage");
      await row("night").getByLabel("Percentage 1").fill("140");
      await expect(row("night")).toContainText("140% of the day accounted for");
      await expect(close).toBeDisabled();
      await row("night").getByLabel("Percentage 1").fill("60");
      await row("night").getByLabel("Grateful for today").fill("E2E: the call went well");
      await expect(close).toBeEnabled();
      await close.click();
      await expect(row("night").locator(".t-row-time")).toContainText("✓", { timeout: 15_000 });

      await page.reload();
      await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible({ timeout: 15_000 });
      await tab(page, "Today");
      for (const g of ["morning", "midday", "night"]) await expect(row(g).locator(".t-row-time")).toContainText("✓", { timeout: 15_000 });
      const stamped = queryLocalD1<{ m: number | null; d: number | null; n: number | null; e: string | null }>(
        `SELECT morning_completed_at AS m, midday_completed_at AS d, night_completed_at AS n, night_evidence AS e FROM days WHERE id = '${DAY}'`,
      )[0]!;
      expect(stamped.m && stamped.d && stamped.n, "all three gates stamped").toBeTruthy();
      expect(stamped.e).toContain("Grateful: E2E: the call went well");
      expect(queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM gate_entries WHERE day_id = '${DAY}'`)[0]!.n).toBeGreaterThanOrEqual(3);
    });

    test("a tick stamps the time, and the law's tick is one tick on the card and in the gate", async ({ page }) => {
      await unlock(page);
      await tab(page, "Today");
      await page.getByTestId("law-read-aloud").click();
      await expect(page.getByTestId("law-read-aloud")).toContainText("✓ Read aloud");
      expect(queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM today_ticks WHERE day_id = '${DAY}' AND item_key = 'morning:law'`)[0]!.n).toBe(1);
      await page.getByTestId("row-gate:morning").getByRole("button", { name: "Tap to open ▾" }).click();
      await expect(page.locator('[data-tick="morning:law"]')).toContainText("✓");
      await page.locator('[data-tick="morning:law"]').click();
      await expect(page.getByTestId("law-read-aloud")).toHaveText("Read it aloud ✓");
      expect(queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM today_ticks WHERE day_id = '${DAY}' AND item_key = 'morning:law'`)[0]!.n).toBe(0);
    });

    test("Edit gate: remove an item, save as my default, and reset to Boss OS's default", async ({ page }) => {
      await unlock(page);
      await tab(page, "Today");
      const morning = page.getByTestId("row-gate:morning");
      await expect(morning.locator(".dflt")).toHaveText("Default");
      await morning.getByRole("button", { name: "Edit Morning gate" }).click();
      const editor = page.getByTestId("gate-editor");
      const gratitude = editor.getByTestId("edit-item-gratitude");
      await gratitude.getByRole("button", { name: "Remove" }).click();
      await gratitude.getByRole("button", { name: "Yes, remove" }).click();
      await expect(editor.getByTestId("edit-item-gratitude")).toHaveCount(0);
      await expect(editor.getByTestId("edit-item-agree")).toContainText("always on");
      await editor.getByRole("button", { name: "Save as my default" }).click();
      await expect(page.getByTestId("gate-editor")).toHaveCount(0);
      await expect(morning.locator(".dflt")).toHaveCount(0);
      const saved = queryLocalD1<{ items: string }>(`SELECT items FROM gate_templates WHERE gate = 'morning'`);
      expect(saved).toHaveLength(1);
      expect(saved[0]!.items).not.toContain('"gratitude"');
      expect(saved[0]!.items).toContain('"agree"');

      await morning.getByRole("button", { name: "Edit Morning gate" }).click();
      await page.getByTestId("gate-editor").getByRole("button", { name: "Reset to Boss OS default" }).click();
      await expect(morning.locator(".dflt")).toHaveText("Default");
      expect(queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM gate_templates`)[0]!.n).toBe(0);
    });

    test("+ Create a gate takes its place by time; + Add to today is a row whose tick closes the loop", async ({ page }) => {
      await unlock(page);
      await tab(page, "Today");
      await page.getByTestId("create-gate").click();
      const creator = page.getByTestId("gate-creator");
      await expect(creator.getByRole("button", { name: "Save gate" })).toBeDisabled();
      await creator.getByLabel("Gate name").fill("E2E stretch gate");
      await creator.getByLabel("Time").fill("13:30");
      await creator.getByLabel("Check 1").fill("E2E: stand and stretch");
      await creator.getByRole("button", { name: "Save gate" }).click();
      await expect(page.getByTestId("today-list").locator(".t-row", { hasText: "E2E stretch gate" })).toBeVisible({ timeout: 15_000 });
      const keys = await page.getByTestId("today-list").locator(".t-row").evaluateAll((els) => els.map((e) => [e.getAttribute("data-testid"), e.textContent ?? ""] as const));
      const at = keys.findIndex(([, t]) => t.includes("E2E stretch gate"));
      expect(at).toBeGreaterThan(keys.findIndex(([k]) => k === "row-gate:midday"));
      expect(at).toBeLessThan(keys.findIndex(([k]) => k === "row-gate:night"));

      await page.getByTestId("add-to-today").click();
      await page.getByLabel("New item for today").fill("E2E loop to tick");
      await page.getByTestId("add-to-today-sheet").getByRole("button", { name: "Add", exact: true }).click();
      const loopRow = page.getByTestId("today-list").locator(".t-row", { hasText: "E2E loop to tick" });
      await expect(loopRow).toBeVisible({ timeout: 15_000 });
      await loopRow.locator(".tick").click();
      await expect(loopRow).toHaveCount(0, { timeout: 15_000 });
      expect(queryLocalD1<{ status: string }>(`SELECT status FROM open_loops WHERE title = 'E2E loop to tick'`)[0]!.status).toBe("resolved");
    });

    test("Monique's find — both sides of a trade in her own mailbox — is the Brokerage block's first money move", async ({ page }) => {
      const now = Date.now();
      provisionLocalD1(
        `INSERT INTO mailbox_findings (id, kind, subject_code, counterpart_code, headline, because, suggested_action, evidence, subject_matter, confidence, status, found_at, updated_at)
         VALUES ('mbf_e2e_pair', 'missed_deal', 'HERON', 'FALCON', 'E2E: a seller and a buyer of the same block', 'Both wrote to you about the same company in the same fortnight.', 'E2E: put HERON and FALCON in one thread about the block today', '[]', 'the block', 'high', 'new', ${now}, ${now})`,
      );
      await unlock(page);
      await tab(page, "Today");
      const move = page.getByTestId("first-money-move");
      await expect(move).toContainText("E2E: put HERON and FALCON in one thread about the block today", { timeout: 15_000 });
      await expect(move).toContainText("Monique found both sides of this in your own mailbox");
      await expect(move).not.toContainText("@");
    });

    test("Coming up adds and cancels a meeting, and both reach D1", async ({ page }) => {
      await unlock(page);
      await tab(page, "Today");
      const diary = page.getByTestId("coming-up");
      await diary.locator("summary").click();
      await diary.getByRole("button", { name: "Add a meeting" }).click();
      await page.locator("#diary-title").fill("E2E meeting with the Hartleys");
      await page.locator("#diary-with").fill("Hartley");
      const at = new Date(Date.now() + 3 * 3600_000);
      const local = new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
      await page.locator("#diary-when").fill(local);
      await page.getByRole("button", { name: /add it|add$/i }).first().click();
      await expect(diary).toContainText("E2E meeting with the Hartleys");
      const rows = queryLocalD1<{ id: string; cancelled_at: number | null }>(`SELECT id, cancelled_at FROM diary_entries WHERE title = 'E2E meeting with the Hartleys'`);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.cancelled_at).toBeNull();
      await diary.locator(".row", { hasText: "E2E meeting with the Hartleys" }).getByRole("button", { name: /cancel/i }).click();
      await expect.poll(() => queryLocalD1<{ c: number | null }>(`SELECT cancelled_at AS c FROM diary_entries WHERE title = 'E2E meeting with the Hartleys'`)[0]?.c).toBeTruthy();
      await expect(diary.locator(".row", { hasText: "E2E meeting with the Hartleys" })).toHaveCount(0);
    });

    test("an alert is put aside with a reason on Systems → Alerts and team, and the record keeps the reason", async ({ page }) => {
      await unlock(page);
      await tab(page, "Systems");
      await page.getByRole("tab", { name: "Alerts and team" }).click();
      const alerts = page.locator("main.page .docket", { has: page.locator("h3", { hasText: /wrong|alert/i }) });
      await alerts.locator("summary").click();
      const first = alerts.locator(".row").first();
      const text = (await first.locator(".row-title").innerText()).trim();
      await first.getByRole("button", { name: "Dismiss" }).click();
      const put = first.getByRole("button", { name: /say why first|put it aside/i });
      await expect(put).toHaveText("Say why first");
      await first.locator("textarea").fill("E2E — known, waiting on the vault sync");
      await expect(put).toHaveText("Put it aside");
      await put.click();
      await expect(alerts.locator(".row-title", { hasText: text })).toHaveCount(0);
      expect(queryLocalD1<{ reason: string }>(`SELECT reason FROM alert_dismissals WHERE reason LIKE 'E2E %'`)).toHaveLength(1);
      await alerts.getByRole("button", { name: /refresh — re-run the checks/i }).click();
      await expect(alerts.locator(".notice").first()).toContainText(/check\(s\) re-run/);
      if (vp.name === "phone") await expectNoSidewaysScroll(page);
    });

    test("✎ Tell Simone floats on every tab, opens a sheet, hands off the job, and closes back where she was", async ({ page }) => {
      await unlock(page);
      await tab(page, "Capital");
      const fab = page.getByTestId("tell-simone-fab");
      await expect(fab).toBeVisible();
      await fab.click();
      const box = page.getByTestId("tell-sheet").getByTestId("tell-simone");
      await expect(box).toContainText("Same as emailing simone@sequoiataylor.com.");
      await expect(box.locator("textarea")).toBeFocused();
      await box.locator("textarea").fill("What are the three cheapest ways to host a static site with a custom domain? E2E");
      await box.getByRole("button", { name: "Send to Simone" }).click();
      await expect(box).toContainText(/✓ Simone has it: 1 job/, { timeout: 15_000 });
      await page.getByTestId("tell-sheet").getByTestId("sheet-close").click();
      await expect(page.getByTestId("tell-sheet")).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Capital", exact: true })).toHaveAttribute("aria-current", "page");
      for (const t of ["Today", "Spirit", "Systems"]) {
        await tab(page, t);
        await expect(page.getByTestId("tell-simone-fab")).toBeVisible();
      }
      if (vp.name === "phone") await expectNoSidewaysScroll(page);
    });

    test("five tabs and ☰ More, which holds Team, Memory, Trading, Vault, Systems and Operations", async ({ page }) => {
      await unlock(page);
      const nav = page.getByRole("navigation", { name: "Sections" });
      await expect(nav.locator(":scope > button")).toHaveCount(5);
      await nav.getByRole("button", { name: "☰ More", exact: true }).click();
      const more = page.getByTestId("more-panel");
      for (const t of ["Team", "Memory", "Trading", "Vault", "Systems", "Operations"]) await expect(more.getByRole("button", { name: t === "Operations" ? "Open settings" : t, exact: true })).toBeVisible();
      await nav.getByRole("button", { name: "☰ More", exact: true }).click();
      await expect(more).toHaveCount(0);
      // One row of tabs, not two: the old nine took ~250 of the phone's 844px.
      expect((await nav.boundingBox())!.height, "the tab bar's height (px)").toBeLessThan(100);
    });
  });
}
