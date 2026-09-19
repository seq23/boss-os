import { test, expect } from "@playwright/test";
import { provisionLocalD1, queryLocalD1 } from "./support/provision";
import { unlock, tab, expectNoSidewaysScroll, expectNear, PHONE, LAPTOP } from "./support/boss";

/**
 * THE INBOX'S OTHER CARDS — everything that is not a letter (the letters are `boss-inbox.spec.ts`).
 *
 * A task's output, a budget hold, a notice. Approve, Reject (with a reason; never wordless), Later,
 * "Got it", and the full docket. Each verdict is asserted at the table, and the card must leave the
 * screen (or come back, if the verdict did not take) — never vanish while the row says otherwise.
 */

const P = "e2e_dec_";
const NOW = () => Date.now();

function cleanSql(): string {
  return [
    `DELETE FROM approval_events WHERE approval_id LIKE 'apr_${P}%'`,
    `DELETE FROM task_events WHERE task_id LIKE 'tsk_${P}%'`,
    `UPDATE tasks SET approval_id = NULL WHERE id LIKE 'tsk_${P}%'`,
    `DELETE FROM approvals WHERE id LIKE 'apr_${P}%'`,
    `DELETE FROM tasks WHERE id LIKE 'tsk_${P}%'`,
  ].join("; ");
}

/** One task with its output awaiting her, plus a notice and a budget hold. */
function seedSql(): string {
  const t = NOW();
  const week = t + 7 * 86_400_000;
  const task = (n: string, status: string) =>
    `INSERT INTO tasks (id, lane, employee_id, title, input, output, status, created_at) VALUES ('tsk_${P}${n}', 'ops', 'emp_research', 'E2E task ${n}', '{"prompt":"x"}', '{"text":"E2E output ${n}","model":"fixture"}', '${status}', ${t})`;
  const apr = (n: string, kind: string, origin: string, title: string, summary: string, payload: string) =>
    `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk, payload, status, requested_at, expires_at) VALUES ('apr_${P}${n}', 'ops', '${title}', '${summary}', '${kind}', '${origin}', 'tsk_${P}${n}', 'low', '${payload}', 'pending', ${t - 3 * 86_400_000}, ${week})`;
  return [
    task("approve", "awaiting_approval"), apr("approve", "task_output", "tasks", "E2E output to approve", "Camille drafted E2E output approve", `{"task_id":"tsk_${P}approve"}`),
    task("reject", "awaiting_approval"), apr("reject", "task_output", "tasks", "E2E output to reject", "Camille drafted E2E output reject", `{"task_id":"tsk_${P}reject"}`),
    task("later", "awaiting_approval"), apr("later", "task_output", "tasks", "E2E output for later", "Camille drafted E2E output later", `{"task_id":"tsk_${P}later"}`),
    task("hold", "awaiting_approval"), apr("hold", "spend", "tasks", "Budget hold: E2E task hold", "The day budget is spent", `{"task_id":"tsk_${P}hold","budget_micros":1000}`),
    `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk, payload, status, requested_at, expires_at) VALUES ('apr_${P}notice', 'ops', 'E2E: Monique emailed you the list', 'She told you; nothing to decide.', 'notice', 'duty', 'duty_lp_positive', 'low', '{}', 'pending', ${t}, ${week})`,
    `UPDATE tasks SET approval_id = 'apr_' || substr(id, 5) WHERE id LIKE 'tsk_${P}%'`,
  ].join("; ");
}

for (const vp of [PHONE, LAPTOP]) {
  test.describe(`Inbox decisions (${vp.name})`, () => {
    test.beforeEach(async ({ page }) => {
      provisionLocalD1(cleanSql());
      provisionLocalD1(seedSql());
      await page.setViewportSize({ width: vp.width, height: vp.height });
    });
    test.afterAll(() => { provisionLocalD1(cleanSql()); });

    test("the count, the badge and the groups read one table; a notice is 'Got it', never a verdict", async ({ page }) => {
      await unlock(page);
      await tab(page, "Inbox");
      const masthead = page.getByTestId("inbox-masthead");
      // Four decisions + one notice are pending; the count says how many need an ANSWER.
      await expect(masthead).toContainText(/waiting on you/);
      await expect(masthead).toContainText(/oldest 3 days/);
      const badge = page.locator("nav .tab-badge");
      await expect(badge).toBeVisible();
      const n = Number((await masthead.locator(".masthead-n").innerText()).trim());
      expect(n).toBeGreaterThanOrEqual(4);

      // The notice has ONE button and it does not say approve.
      const notice = page.locator("article.docket", { hasText: "E2E: Monique emailed you the list" });
      await expect(notice).toBeVisible();
      await expect(notice.getByRole("button", { name: /approve|reject|later/i })).toHaveCount(0);
      await notice.getByRole("button", { name: "Got it" }).click();
      await expect(notice).toHaveCount(0);
      expect(queryLocalD1<{ status: string }>(`SELECT status FROM approvals WHERE id = 'apr_${P}notice'`)[0]!.status).toBe("approved");
      if (vp.name === "phone") await expectNoSidewaysScroll(page);
    });

    test("approve releases the task; reject asks why and cancels it; a wordless reject cannot be sent", async ({ page }) => {
      await unlock(page);
      await tab(page, "Inbox");
      const card = (t: string) => page.locator("article.docket", { hasText: t });

      await card("E2E output to approve").getByRole("button", { name: "Approve", exact: true }).click();
      await expect(card("E2E output to approve")).toHaveCount(0);
      await expect.poll(() => queryLocalD1<{ status: string }>(`SELECT status FROM tasks WHERE id = 'tsk_${P}approve'`)[0]!.status).toBe("done");
      expect(queryLocalD1<{ s: string; e: string }>(`SELECT status AS s, execution_status AS e FROM approvals WHERE id = 'apr_${P}approve'`)[0]).toEqual({ s: "approved", e: "executed" });

      const rej = card("E2E output to reject");
      await rej.getByRole("button", { name: "Reject", exact: true }).click();
      const send = rej.getByRole("button", { name: "Reject with this reason" });
      await expect(send).toBeDisabled();
      const why = rej.locator("textarea");
      await why.fill("same");
      await expect(send).toBeDisabled(); // "same" was eleven of thirteen on production; it is not a reason
      await why.fill("The numbers in paragraph two are not sourced.");
      await expect(send).toBeEnabled();
      await expectNear(page, rej.getByRole("button", { name: "Reject with this reason" }), why, 300);
      await send.click();
      await expect(rej).toHaveCount(0);
      const rejected = queryLocalD1<{ status: string; note: string }>(`SELECT status, decision_note AS note FROM approvals WHERE id = 'apr_${P}reject'`)[0]!;
      expect(rejected).toEqual({ status: "rejected", note: "The numbers in paragraph two are not sourced." });
      expect(queryLocalD1<{ status: string }>(`SELECT status FROM tasks WHERE id = 'tsk_${P}reject'`)[0]!.status).toBe("cancelled");

      // A second decision on the same row is refused by name, not executed twice.
      const again = await page.request.post(`/api/boss/approvals/apr_${P}reject/decide`, { data: { decision: "approved" } });
      expect(again.status()).toBe(409);
      expect((await again.json()).error).toContain("already rejected");
    });

    test("a budget hold approved requeues the held task", async ({ page }) => {
      await unlock(page);
      await tab(page, "Inbox");
      const hold = page.locator("article.docket", { hasText: "Budget hold: E2E task hold" });
      await expect(hold).toContainText("budget");
      await hold.getByRole("button", { name: "Approve", exact: true }).click();
      await expect(hold).toHaveCount(0);
      const ev = queryLocalD1<{ event: string }>(`SELECT event FROM task_events WHERE task_id = 'tsk_${P}hold' ORDER BY ts`);
      expect(ev.map((e) => e.event)).toContain("requeued");
    });

    test("Later keeps the card where she can find it — put off, not lost", async ({ page }) => {
      await unlock(page);
      await tab(page, "Inbox");
      const card = page.locator("article.docket", { hasText: "E2E output for later" });
      await card.getByRole("button", { name: "Later", exact: true }).click();
      await expect(page.locator(".notice", { hasText: /deferred|put off/i })).toBeVisible();
      expect(queryLocalD1<{ status: string }>(`SELECT status FROM approvals WHERE id = 'apr_${P}later'`)[0]!.status).toBe("deferred");
      // THE CONTRACT: a deferred card is still on the Inbox, under "Put off", until it expires or she decides it.
      const putOff = page.getByTestId("inbox-put-off");
      await expect(putOff).toBeVisible();
      await expect(putOff).toContainText("E2E output for later");
      // And it survives a reload — it is the table, not a memory of the click.
      await page.reload();
      await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible({ timeout: 15_000 });
      await tab(page, "Inbox");
      await expect(page.getByTestId("inbox-put-off")).toContainText("E2E output for later");
      // She can still decide it from there.
      await page.getByTestId("inbox-put-off").locator("article.docket", { hasText: "E2E output for later" }).getByRole("button", { name: "Approve", exact: true }).click();
      await expect.poll(() => queryLocalD1<{ status: string }>(`SELECT status FROM approvals WHERE id = 'apr_${P}later'`)[0]!.status).toBe("approved");
    });

    test("the full docket opens, shows the work, and comes back to the Inbox", async ({ page }) => {
      await unlock(page);
      await tab(page, "Inbox");
      const card = page.locator("article.docket", { hasText: "E2E output to approve" });
      await card.getByRole("button", { name: /open the full docket/i }).click();
      await expect(page.locator("main.page")).toContainText("E2E output approve");
      await page.getByRole("button", { name: "← Inbox" }).click();
      await expect(page.getByTestId("inbox-masthead")).toBeVisible();
      if (vp.name === "phone") await expectNoSidewaysScroll(page);
    });
  });
}
