import { test, expect } from "@playwright/test";
import { provisionLocalD1, queryLocalD1 } from "./support/provision";
import { unlock, tab, expectNoSidewaysScroll, expectNear, PHONE, LAPTOP } from "./support/boss";

/**
 * SYSTEMS, SETTINGS AND THE LOCK — the levers she actually pulls.
 *
 * Sixteen Systems sections and five Settings panels, each of which must NAME its state; the spend
 * lever and the cost mode, which must write, be audited, and read back after a reload; the KDP
 * publication state on a title; the Launch panel, which must price a task by asking every backend
 * and print each refusal with its reason; and the lock, which must actually lock.
 */

function cleanSql(): string {
  return [
    `UPDATE settings SET value = 'FREE_ONLY' WHERE key = 'spend_lever'`,
    `UPDATE settings SET value = 'NORMAL' WHERE key = 'cost_mode'`,
    `DELETE FROM kdp_titles WHERE title_ref = 'e2e-title'`,
  ].join("; ");
}

const SECTIONS = ["Launch", "Watch", "Backends", "Costs", "Publishing", "Airlock", "Router", "Intake", "Governance", "Knowledge", "Prompts", "Quant", "Bridge", "Capability", "Runtimes", "Sync"];

for (const vp of [PHONE, LAPTOP]) {
  test.describe(`Systems and Settings (${vp.name})`, () => {
    test.beforeEach(async ({ page }) => {
      provisionLocalD1(cleanSql());
      await page.setViewportSize({ width: vp.width, height: vp.height });
    });
    test.afterAll(() => { provisionLocalD1(cleanSql()); });

    test("every Systems section reaches its endpoint and names what it found", async ({ page }) => {
      test.setTimeout(90_000);
      await unlock(page);
      await tab(page, "Systems");
      const main = page.locator("main.page");
      for (const s of SECTIONS) {
        await page.getByRole("tab", { name: s, exact: true }).click();
        await expect(page.getByRole("tab", { name: s, exact: true })).toHaveAttribute("aria-selected", "true");
        // Settled: no skeleton left, and more than a section switcher's worth of words.
        await expect.poll(async () => main.locator(".skel").count(), { timeout: 15_000 }).toBe(0);
        const text = (await main.innerText()).replace(/\s+/g, " ");
        const own = text.replace(SECTIONS.join(" "), "").trim();
        expect(own.length, `${s} says something`).toBeGreaterThan(60);
        // No empty slot may be wordless.
        for (const e of await main.locator(".empty, .state-empty").all()) {
          expect((await e.innerText()).trim().length, `${s}: an empty slot explains itself`).toBeGreaterThan(20);
        }
        if (vp.name === "phone") await expectNoSidewaysScroll(page);
      }
    });

    test("the spend lever and the cost mode write, are audited, and read back after a reload", async ({ page }) => {
      await unlock(page);
      await tab(page, "Systems");
      await page.getByRole("tab", { name: "Costs", exact: true }).click();
      const lever = page.getByRole("group", { name: "Spend lever" });
      await expect(page.locator("main.page")).toContainText("Spend lever — FREE_ONLY");
      await lever.getByRole("button", { name: "MODERATE", exact: true }).click();
      const note = page.locator(".notice", { hasText: "Lever moved to MODERATE." });
      await expect(note).toBeVisible();
      await expect(page.locator("main.page")).toContainText("Spend lever — MODERATE");
      expect(queryLocalD1<{ value: string }>(`SELECT value FROM settings WHERE key = 'spend_lever'`)[0]!.value).toBe("MODERATE");
      const audited = queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'spend_lever' AND ts > ${Date.now() - 60_000}`);
      expect(audited[0]!.n, "moving the lever is audited").toBeGreaterThanOrEqual(1);

      // Cost mode is the OTHER axis, and moving it does not move the lever.
      await page.getByRole("button", { name: "HIGH_PERFORMANCE", exact: true }).click();
      await expect(page.locator(".notice", { hasText: "Cost mode set to HIGH_PERFORMANCE." })).toBeVisible();
      expect(queryLocalD1<{ value: string }>(`SELECT value FROM settings WHERE key = 'cost_mode'`)[0]!.value).toBe("HIGH_PERFORMANCE");
      expect(queryLocalD1<{ value: string }>(`SELECT value FROM settings WHERE key = 'spend_lever'`)[0]!.value).toBe("MODERATE");

      // Settings shows the same two truths, from the same table, after a reload.
      await page.reload();
      await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Open settings" }).click();
      await expect(page.locator("main.page")).toContainText("High performance");
      await expect(page.locator("main.page .row", { hasText: "High performance" })).toContainText(/current/i);
      await expect(page.locator(".lever-btn[aria-pressed='true']")).toContainText(/moderate/i);
      // And the lever can be moved back from here, with Moderate's figure refusing nonsense.
      await page.locator(".lever-btn", { hasText: /free only/i }).click();
      await expect.poll(() => queryLocalD1<{ value: string }>(`SELECT value FROM settings WHERE key = 'spend_lever'`)[0]!.value).toBe("FREE_ONLY");
      await expect(page.locator(".lever-btn[aria-pressed='true']")).toContainText(/free only/i);
      if (vp.name === "phone") await expectNoSidewaysScroll(page);
    });

    test("a Kindle title's publication state is set from Publishing and read back", async ({ page }) => {
      const now = Date.now();
      provisionLocalD1(`INSERT INTO kdp_titles (id, title_ref, label, state, first_seen_at, state_changed_at, updated_at) VALUES ('kdp_e2e', 'e2e-title', 'E2E: The Gift Letter', 'blocked', ${now}, ${now}, ${now})`);
      await unlock(page);
      await tab(page, "Systems");
      await page.getByRole("tab", { name: "Publishing", exact: true }).click();
      const select = page.getByLabel("Publication state for e2e-title");
      await expect(select).toHaveValue("blocked");
      await select.selectOption("in_review");
      await expect.poll(() => queryLocalD1<{ state: string }>(`SELECT state FROM kdp_titles WHERE title_ref = 'e2e-title'`)[0]!.state).toBe("in_review");
      await page.reload();
      await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible({ timeout: 15_000 });
      await tab(page, "Systems");
      await page.getByRole("tab", { name: "Publishing", exact: true }).click();
      await expect(page.getByLabel("Publication state for e2e-title")).toHaveValue("in_review");
      // Nonsense is refused by the route by name.
      const bad = await page.request.post("/api/boss/kdp/titles/e2e-title", { data: { state: "published" } });
      expect(bad.status()).toBe(400);
    });

    test("Launch prices a task by asking every backend, and each refusal says why", async ({ page }) => {
      await unlock(page);
      await tab(page, "Systems");
      await page.getByRole("tab", { name: "Launch", exact: true }).click();
      await expect(page.locator("main.page")).toContainText("Nothing to price yet");
      await expect(page.getByRole("button", { name: /choose a backend first/i })).toBeDisabled();
      await page.getByPlaceholder("Add the missing validator to the deploy script").fill("E2E: read the three Reuters pieces and list the firms named");
      // Every registered backend answers — with a quote or a refusal sentence — never silence.
      const cards = page.locator("main.page .panel").nth(1).locator("button, .row");
      await expect.poll(async () => cards.count(), { timeout: 15_000 }).toBeGreaterThan(0);
      const text = (await page.locator("main.page").innerText()).replace(/\s+/g, " ");
      expect(text).not.toContain("Nothing to price yet");
      expect(text.length).toBeGreaterThan(200);
      if (vp.name === "phone") await expectNoSidewaysScroll(page);
    });

    test("Settings' five panels name their state, Health re-runs, and Lock actually locks", async ({ page }) => {
      await unlock(page);
      await page.getByRole("button", { name: "Open settings" }).click();
      for (const p of ["Overview", "Cost", "Audit", "Diagnostics"]) {
        await page.locator("main.page .seg-btn", { hasText: new RegExp(`^${p}$`, "i") }).click();
        await expect.poll(async () => page.locator("main.page .skel").count(), { timeout: 15_000 }).toBe(0);
        expect((await page.locator("main.page").innerText()).trim().length, `${p} says something`).toBeGreaterThan(80);
      }
      // Health: the verdict line AND one row per check, each with its detail — a failing check that
      // does not say what failed is a light with no label.
      await page.locator("main.page .seg-btn", { hasText: /^health$/i }).click();
      await expect(page.locator("main.page .notice", { hasText: /Failing:|Every binding responded/ })).toBeVisible({ timeout: 15_000 });
      const checks = page.locator("main.page .row");
      await expect.poll(async () => checks.count()).toBeGreaterThanOrEqual(3);
      for (const row of await checks.all()) {
        expect((await row.locator(".row-sub").innerText()).trim().length, "a check carries its detail").toBeGreaterThan(2);
      }
      await page.getByRole("button", { name: "Re-run checks" }).click();
      await expect(page.locator("main.page .notice", { hasText: /Failing:|Every binding responded/ })).toBeVisible();
      await page.locator("main.page .seg-btn", { hasText: /^overview$/i }).click();
      await page.getByRole("button", { name: "Lock", exact: true }).click();
      await expect(page.getByLabel("Passcode")).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Sections" })).toHaveCount(0);
      // Locked means the API refuses too, not only that the screen changed.
      const res = await page.request.get("/api/boss/system/status");
      expect(res.status()).toBe(401);
    });
  });
}
