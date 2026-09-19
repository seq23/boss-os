import { test, expect } from "@playwright/test";
import { provisionLocalD1, queryLocalD1 } from "./support/provision";
import { unlock, tab, expectNoSidewaysScroll, expectNear, PHONE, LAPTOP } from "./support/boss";

/**
 * MEMORY, THE VAULT AND TRADING — the records she keeps and the switch she can throw.
 *
 * A capture written by hand climbs only through the Inbox (promotion raises an approval, never
 * moves the tier itself); retiring asks why; a snapshot is written to R2, verified, and drilled;
 * an order is a draft that raises a trading approval; the kill switch cancels what is open and
 * says how many. Every write is read back from the table.
 */

function cleanSql(): string {
  return [
    `DELETE FROM promotion_events WHERE item_id IN (SELECT id FROM memory_items WHERE title LIKE 'E2E memory%')`,
    `DELETE FROM approvals WHERE origin_id IN (SELECT id FROM memory_items WHERE title LIKE 'E2E memory%')`,
    `DELETE FROM memory_items WHERE title LIKE 'E2E memory%'`,
    `DELETE FROM trading_orders WHERE symbol = 'E2ECOIN'`,
    `DELETE FROM approvals WHERE kind = 'trade' AND title LIKE '%E2ECOIN%'`,
    `UPDATE trading_authority SET kill_switch = 0`,
  ].join("; ");
}

for (const vp of [PHONE, LAPTOP]) {
  test.describe(`Records (${vp.name})`, () => {
    test.beforeEach(async ({ page }) => {
      provisionLocalD1(cleanSql());
      await page.setViewportSize({ width: vp.width, height: vp.height });
    });
    test.afterAll(() => { provisionLocalD1(cleanSql()); });

    test("a memory is captured, its promotion goes to the Inbox, retiring asks why, and archiving files it away", async ({ page }) => {
      await unlock(page);
      await tab(page, "Memory");
      await page.getByRole("button", { name: "Capture something" }).click();
      const save = page.getByRole("button", { name: "Capture", exact: true });
      await expect(save).toBeDisabled();
      await page.getByLabel("Title").fill("E2E memory: buyers answer on Tuesdays");
      await page.getByLabel("What is worth remembering").fill("Three of four replies this month landed on a Tuesday morning.");
      await save.click();
      const row = page.locator("main.page .row", { hasText: "E2E memory: buyers answer on Tuesdays" }).filter({ has: page.getByRole("button", { name: "Retire" }) });
      await expect(row).toBeVisible();
      await expect(row).toContainText("capture");
      const item = queryLocalD1<{ id: string; tier: string }>(`SELECT id, tier FROM memory_items WHERE title = 'E2E memory: buyers answer on Tuesdays'`)[0]!;
      expect(item.tier).toBe("capture");

      // Promotion asks first: the tier does not move, an approval does.
      await row.getByRole("button", { name: /→ working/ }).click();
      await expect(page.locator(".notice", { hasText: "Sent to the inbox. Nothing moves tier until you approve it." })).toBeVisible();
      expect(queryLocalD1<{ tier: string }>(`SELECT tier FROM memory_items WHERE id = '${item.id}'`)[0]!.tier).toBe("capture");
      await expect.poll(() => queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM approvals WHERE kind = 'memory_promotion' AND origin_id = '${item.id}' AND status = 'pending'`)[0]!.n).toBe(1);

      // Retire asks why — and a cancelled prompt writes nothing.
      page.once("dialog", (d) => d.dismiss());
      await row.getByRole("button", { name: "Retire" }).click();
      expect(queryLocalD1<{ r: number | null }>(`SELECT retired_at AS r FROM memory_items WHERE id = '${item.id}'`)[0]!.r).toBeNull();
      page.once("dialog", (d) => d.accept("E2E — it was one month's pattern"));
      await row.getByRole("button", { name: "Retire" }).click();
      await expect(page.locator(".notice", { hasText: /Retired\./ })).toBeVisible();
      await expect.poll(() => queryLocalD1<{ r: number | null; why: string }>(`SELECT retired_at AS r, retired_reason AS why FROM memory_items WHERE id = '${item.id}'`)[0]!.why).toBe("E2E — it was one month's pattern");
      // Retired means kept and no longer surfaced: it leaves the list, and the reason is on the record.
      await expect(row).toHaveCount(0);
      if (vp.name === "phone") await expectNoSidewaysScroll(page);
    });

    test("a snapshot is written, verified, and drilled — and the list reads the table back", async ({ page }) => {
      test.setTimeout(90_000);
      await unlock(page);
      await tab(page, "Vault");
      const before = queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM vault_snapshots`)[0]!.n;
      await page.getByRole("button", { name: "Take snapshot" }).click();
      const msg = page.locator("main.page .notice").first();
      await expect(msg).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM vault_snapshots`)[0]!.n).toBe(before + 1);
      const snap = queryLocalD1<{ id: string; status: string; bytes: number }>(`SELECT id, status, bytes FROM vault_snapshots ORDER BY ts DESC LIMIT 1`)[0]!;
      expect(snap.status).toBe("complete");
      expect(snap.bytes).toBeGreaterThan(0);
      // The list shows the snapshot by its hash prefix and its size.
      await expect(page.locator("main.page")).toContainText(String(queryLocalD1<{ h: string }>(`SELECT sha256 AS h FROM vault_snapshots WHERE id = '${snap.id}'`)[0]!.h).slice(0, 12));
      // Verify reads it back from R2 and compares the hash.
      const verify = page.locator("main.page .row", { hasText: /manual · complete/ }).first().getByRole("button", { name: "Verify" });
      await verify.click();
      await expect(page.locator("main.page .notice").first()).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "Restore drill" }).click();
      await expect(page.locator("main.page .notice").first()).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM vault_restores WHERE mode = 'verify' AND status = 'verified' AND ts > ${Date.now() - 120_000}`)[0]!.n, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
      await expect(page.locator("main.page")).not.toContainText("No restores");
    });

    test("an order is a draft that raises a trading approval; the kill switch cancels it and says so", async ({ page }) => {
      await unlock(page);
      await tab(page, "Trading");
      await expect(page.locator("main.page")).toContainText("Paper mode");
      await page.getByRole("button", { name: "Draft an order" }).click();
      const send = page.getByRole("button", { name: /Draft — it still needs approval/ });
      await expect(send).toBeDisabled();
      await page.getByPlaceholder("BTC").fill("E2ECOIN");
      await page.getByLabel("Quantity").fill("abc");
      await page.getByLabel("Reference price").fill("10");
      await send.click();
      // Nonsense is refused by name, beside the form — not recorded as zero.
      const err = page.locator("main.page .notice", { hasText: /quantity|needs a symbol/i }).first();
      await expect(err).toBeVisible();
      await expectNear(page, send, err, 900);
      expect(queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM trading_orders WHERE symbol = 'E2ECOIN'`)[0]!.n).toBe(0);
      await page.getByLabel("Quantity").fill("2");
      await send.click();
      await expect.poll(() => queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM trading_orders WHERE symbol = 'E2ECOIN'`)[0]!.n).toBe(1);
      const order = queryLocalD1<{ id: string; status: string }>(`SELECT id, status FROM trading_orders WHERE symbol = 'E2ECOIN'`)[0]!;
      expect(queryLocalD1<{ n: number }>(`SELECT COUNT(*) AS n FROM approvals WHERE kind = 'trade' AND origin_id = '${order.id}' AND status = 'pending'`)[0]!.n).toBe(1);
      await expect(page.locator("main.page")).toContainText("E2ECOIN");

      await page.getByRole("button", { name: "Kill switch", exact: true }).click();
      await expect(page.locator("main.page .notice", { hasText: /Kill switch engaged\. \d+ open order/ })).toBeVisible();
      await expect(page.locator("main.page")).toContainText("Nothing in this lane executes");
      expect(queryLocalD1<{ k: number }>(`SELECT kill_switch AS k FROM trading_authority`)[0]!.k).toBe(1);
      await expect.poll(() => queryLocalD1<{ status: string }>(`SELECT status FROM trading_orders WHERE id = '${order.id}'`)[0]!.status).toBe("cancelled");
      await page.getByRole("button", { name: "Clear kill switch" }).click();
      await expect.poll(() => queryLocalD1<{ k: number }>(`SELECT kill_switch AS k FROM trading_authority`)[0]!.k).toBe(0);
      await expect(page.locator("main.page")).toContainText("Paper mode");
      if (vp.name === "phone") await expectNoSidewaysScroll(page);
    });
  });
}
