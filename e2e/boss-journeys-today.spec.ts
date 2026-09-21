import { test, expect } from "@playwright/test";
import { provisionLocalD1, queryLocalD1 } from "./support/provision";
import { unlock, tab, expectNoSidewaysScroll, expectNear, PHONE, LAPTOP } from "./support/boss";

/**
 * TODAY, DRIVEN AS SHE DRIVES IT — the hostile sweep of 19 September 2026.
 *
 * Her first workflow every morning: open Today, read the briefing, agree the day, and answer what
 * is wrong. Each journey clicks the real button, asserts the route wrote, and asserts the screen
 * read it back — on a phone and on the laptop. Nothing waits on a model: `wrangler dev --local` has
 * no Workers AI, so the briefing block is asserted at the boundary (it must NAME why there is no
 * report, never say "nothing to report").
 */

import { dayIdInZone } from "../src/shared/boss/timezone";

/*
 * HER DAY, NOT UTC'S. This was `new Date().toISOString().slice(0, 10)`, which is tomorrow's date in
 * Chicago from 19:00 every evening — so a CI run after seven at night cleaned the wrong day, read
 * gates off the wrong row and found "carried onto a later day" false (the loop was carried to the
 * date the spec already called today). Six journeys went red on PR #29 at 20:40 CT with no change
 * anywhere near Today. The app keys `days` by `dayIdInZone`; so does the spec now.
 */
const DAY = dayIdInZone(Date.now());

function cleanSql(): string {
  return [
    `DELETE FROM gate_entries WHERE day_id = '${DAY}'`,
    `UPDATE days SET morning_completed_at = NULL, midday_completed_at = NULL, night_completed_at = NULL, morning_contract = NULL, morning_priorities = NULL WHERE id = '${DAY}'`,
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

    test("opens with every block named and the briefing honest about its absence", async ({ page }) => {
      await unlock(page);
      await tab(page, "Today");
      const cards = page.locator("main.page .docket");
      // Thirteen blocks in canon; two are conditional and vanish when irrelevant. Never fewer than eleven.
      await expect.poll(async () => cards.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(11);
      const titles = await cards.locator("h3").allInnerTexts();
      for (const t of titles) expect(t.trim().length, `a block has a title`).toBeGreaterThan(0);
      // Every block says something under its title. A title over a blank is the defect.
      for (const card of await cards.all()) {
        const text = (await card.innerText()).trim();
        expect(text.length, "block body").toBeGreaterThan(20);
      }
      // The briefing: no report locally, so the block must name the reason rather than shrug.
      const briefing = cards.filter({ has: page.locator("h3", { hasText: /briefing|intelligence/i }) }).first();
      await expect(briefing).toBeVisible();
      await expect(briefing).not.toContainText(/nothing to report/i);
      if (vp.name === "phone") await expectNoSidewaysScroll(page);
    });

    test("the three gates record, read back after a reload, and cannot be run twice", async ({ page }) => {
      await unlock(page);
      await tab(page, "Today");

      // ─── Morning ───
      const morning = page.getByRole("button", { name: /morning gate/i });
      await expect(morning).toBeEnabled();
      await morning.click();
      const agree = page.getByRole("button", { name: "Agree the day" });
      await expect(agree).toBeDisabled(); // a day with no priority cannot be agreed
      await page.getByLabel("Priority 1").fill("E2E: write to two buyers");
      await expect(agree).toBeEnabled();
      await agree.click();
      const flash = page.locator(".notice", { hasText: "Morning gate recorded." });
      await expect(flash).toBeVisible();
      await expectNear(page, page.getByRole("button", { name: /morning gate/i }), flash, 600);
      await expect(morning).toBeDisabled();
      const d1 = queryLocalD1<{ m: number | null }>(`SELECT morning_completed_at AS m FROM days WHERE id = '${DAY}'`);
      expect(d1[0]?.m, "days.morning_completed_at").toBeTruthy();
      // The gate form is gone, and a second press does nothing: the stat is disabled.
      await expect(page.getByRole("button", { name: "Agree the day" })).toHaveCount(0);

      // ─── Midday ───
      await page.getByRole("button", { name: /midday reset/i }).click();
      await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeDisabled();
      await page.getByLabel("Check 1").fill("E2E: did the letters go?");
      await page.getByRole("button", { name: "Reset", exact: true }).click();
      await expect(page.locator(".notice", { hasText: "Midday gate recorded." })).toBeVisible();
      await expect(page.getByRole("button", { name: /midday reset/i })).toBeDisabled();

      // ─── Night ───
      await page.getByRole("button", { name: /night gate/i }).click();
      const close = page.getByRole("button", { name: "Close the day" });
      await expect(close).toBeDisabled();
      await page.getByLabel("Focus area 1").fill("E2E: brokerage");
      await page.getByLabel("Percentage 1").fill("60");
      await expect(close).toBeEnabled();
      // Over 100% is refused before any request leaves.
      await page.getByLabel("Percentage 1").fill("140");
      await expect(page.locator("main.page")).toContainText("140% of the day accounted for");
      await expect(close).toBeDisabled();
      await page.getByLabel("Percentage 1").fill("60");
      await close.click();
      await expect(page.locator(".notice", { hasText: "Night gate recorded." })).toBeVisible();

      // All three survive a full reload — they went to D1, not to React state.
      await page.reload();
      await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible({ timeout: 15_000 });
      await tab(page, "Today");
      for (const g of [/morning gate/i, /midday reset/i, /night gate/i]) {
        await expect(page.getByRole("button", { name: g })).toBeDisabled();
      }
      const row = queryLocalD1<{ m: number | null; d: number | null; n: number | null }>(
        `SELECT morning_completed_at AS m, midday_completed_at AS d, night_completed_at AS n FROM days WHERE id = '${DAY}'`,
      )[0]!;
      expect(row.m && row.d && row.n, "all three gates stamped").toBeTruthy();
      const entries = queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM gate_entries WHERE day_id = '${DAY}'`);
      expect(entries[0]!.n).toBeGreaterThanOrEqual(3);
    });

    test("an open loop is added, carried to tomorrow, done, and dropped — each written and read back", async ({ page }) => {
      await unlock(page);
      await tab(page, "Today");
      const loops = page.locator("main.page .docket", { has: page.locator("h3", { hasText: /open loops/i }) });
      await loops.locator("summary").click();
      const input = loops.getByPlaceholder("Something that must not be forgotten");
      const add = loops.getByRole("button", { name: "Add", exact: true });
      await expect(add).toBeDisabled();
      for (const n of [1, 2, 3]) {
        await input.fill(`E2E loop ${n}`);
        await add.click();
        await expect(loops).toContainText(`E2E loop ${n}`);
      }
      expect(queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM open_loops WHERE title LIKE 'E2E loop %'`)[0]!.n).toBe(3);
      await expect(loops).toContainText("3 open");

      const rowFor = (n: number) => loops.locator(".row", { hasText: `E2E loop ${n}` });
      await rowFor(1).getByRole("button", { name: "Done" }).click();
      await expect(rowFor(1)).toHaveCount(0);
      await rowFor(2).getByRole("button", { name: "Tomorrow" }).click();
      await expect(rowFor(2)).toHaveCount(0);
      await rowFor(3).getByRole("button", { name: "Drop" }).click();
      await expect(rowFor(3)).toHaveCount(0);
      // Tomorrow = the loop is closed as deferred AND a copy is opened on tomorrow's day — one loop
      // that comes back, never a loop that quietly vanishes.
      const states = queryLocalD1<{ title: string; status: string; day_id: string }>(`SELECT title, status, day_id FROM open_loops WHERE title LIKE 'E2E loop %' ORDER BY title, status`);
      expect(states.map((s) => `${s.title}:${s.status}`)).toEqual(["E2E loop 1:resolved", "E2E loop 2:deferred", "E2E loop 2:open", "E2E loop 3:dismissed"]);
      const carried = states.find((s) => s.title === "E2E loop 2" && s.status === "open")!;
      expect(carried.day_id > DAY, "carried onto a later day").toBe(true);
    });

    test("a meeting is added to the diary and cancelled, and both reach D1", async ({ page }) => {
      await unlock(page);
      await tab(page, "Today");
      const diary = page.locator("main.page .docket", { has: page.locator("h3", { hasText: /meetings|diary/i }) });
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
      const row = diary.locator(".row", { hasText: "E2E meeting with the Hartleys" });
      await row.getByRole("button", { name: /cancel/i }).click();
      await expect.poll(() => queryLocalD1<{ c: number | null }>(`SELECT cancelled_at AS c FROM diary_entries WHERE title = 'E2E meeting with the Hartleys'`)[0]?.c).toBeTruthy();
      await expect(diary.locator(".row", { hasText: "E2E meeting with the Hartleys" })).toHaveCount(0);
    });

    test("Monique's find — both sides of a trade in her own mailbox — is the day's first money move", async ({ page }) => {
      const now = Date.now();
      provisionLocalD1(
        `INSERT INTO mailbox_findings (id, kind, subject_code, counterpart_code, headline, because, suggested_action, evidence, subject_matter, confidence, status, found_at, updated_at)
         VALUES ('mbf_e2e_pair', 'missed_deal', 'HERON', 'FALCON', 'E2E: a seller and a buyer of the same block', 'Both wrote to you about the same company in the same fortnight.', 'E2E: put HERON and FALCON in one thread about the block today', '[]', 'the block', 'high', 'new', ${now}, ${now})`,
      );
      await unlock(page);
      await tab(page, "Today");
      const contract = page.locator("main.page .docket", { has: page.locator("h3", { hasText: /contract/i }) });
      await contract.locator("summary").click();
      await expect(contract).toContainText("Wealth — the first money move");
      await expect(contract).toContainText("E2E: put HERON and FALCON in one thread about the block today");
      await expect(contract).toContainText("Monique found both sides of this in your own mailbox");
      // The names are CODES. A real name in a finding would be a leak on the one screen she opens first.
      await expect(contract).not.toContainText("@");
    });

    test("an alert is put aside with a reason, and the reason is what the record keeps", async ({ page }) => {
      await unlock(page);
      await tab(page, "Today");
      const alerts = page.locator("main.page .docket", { has: page.locator("h3", { hasText: /wrong|alert/i }) });
      await alerts.locator("summary").click();
      const first = alerts.locator(".row").first();
      const text = (await first.locator(".row-title").innerText()).trim();
      await first.getByRole("button", { name: "Dismiss" }).click();
      const put = first.getByRole("button", { name: /say why first|put it aside/i });
      await expect(put).toBeDisabled();
      await expect(put).toHaveText("Say why first"); // the disabled state names what it is waiting for
      const why = first.locator("textarea");
      await why.fill("E2E — known, waiting on the vault sync");
      await expect(put).toHaveText("Put it aside");
      await put.click();
      await expect(alerts.locator(".row-title", { hasText: text })).toHaveCount(0);
      const rows = queryLocalD1<{ reason: string }>(`SELECT reason FROM alert_dismissals WHERE reason LIKE 'E2E %'`);
      expect(rows).toHaveLength(1);

      // Mark resolved on a still-true alert says so, beside the alert rather than at the top.
      const next = alerts.locator(".row").first();
      const resolve = next.getByRole("button", { name: "Mark resolved" });
      if (await resolve.count()) {
        await resolve.click();
        const verdict = alerts.locator(".notice").first();
        await expect(verdict).toBeVisible();
        expect((await verdict.innerText()).trim().length).toBeGreaterThan(10);
        await expectNear(page, next, verdict, 3000);
      }

      // Refresh re-runs the checks and reports a count, never silence.
      await alerts.getByRole("button", { name: /refresh — re-run the checks/i }).click();
      await expect(alerts.locator(".notice").first()).toContainText(/check\(s\) re-run/);
      if (vp.name === "phone") await expectNoSidewaysScroll(page);
    });
  });
}
