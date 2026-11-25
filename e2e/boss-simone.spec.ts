import { expect, test, type Locator } from "@playwright/test";
import { expectNoSidewaysScroll, PHONE, tab, unlock } from "./support/boss";
import { provisionLocalD1 } from "./support/provision";

const MESSAGE = "Find three venues for Saturday and book the cheapest free one.";
const REPLY = "I found three free venues. The park has the earliest opening.";

test("Simone replies in both message boxes at 390 px", async ({ page }, info) => {
  await page.setViewportSize(PHONE);
  await unlock(page);

  async function sendAndRead(box: Locator, path: string, screenshot: string) {
    await expect(box).toBeVisible();
    await box.getByLabel("What should Simone do?").fill(MESSAGE);
    const submitted = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === path);
    await box.getByRole("button", { name: "Send to Simone" }).click();
    const response = await submitted;
    expect(response.status()).toBe(201);
    const { data: { taskId } } = await response.json();
    expect(taskId).toMatch(/^tsk_[a-z0-9]+$/);
    await expect(box.getByRole("status")).toContainText("Simone has your message");
    // Local D1 stands in for the Mac seat. The app still submits and polls the real Worker routes.
    provisionLocalD1(`UPDATE tasks SET status = 'done', output = '${JSON.stringify({ text: REPLY, work: ["fixture_web"] })}' WHERE id = '${taskId}'`);
    await expect(box.getByRole("status")).toContainText(REPLY, { timeout: 15_000 });
    await expectNoSidewaysScroll(page);
    await page.screenshot({ path: info.outputPath(screenshot) });
  }

  await page.getByTestId("tell-simone-fab").click();
  await sendAndRead(page.getByTestId("tell-sheet").getByTestId("tell-simone"), "/api/boss/intake/simone", "tell-simone-390.png");
  await page.getByTestId("tell-sheet").getByTestId("sheet-close").click();
  await tab(page, "Team");
  await page.getByTestId("team-card").filter({ hasText: "Simone" }).click();
  await sendAndRead(page.getByTestId("employee-message-simone"), "/api/boss/simone/message", "simone-page-390.png");
});
