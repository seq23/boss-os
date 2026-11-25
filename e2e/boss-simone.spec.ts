import { expect, test, type Locator } from "@playwright/test";
import { expectNoSidewaysScroll, PHONE, tab, unlock } from "./support/boss";
import { runSimone } from "../scripts/ops/simone.mjs";

const MESSAGE = "Find three venues for Saturday and book the cheapest free one.";
const REPLY = "I found three free venues. The park opens at noon. It takes bookings by phone, so I left the time open.";

test("Simone replies in both message boxes at 390 px", async ({ page }, info) => {
  await page.setViewportSize(PHONE);
  await unlock(page);
  const provisioned = await page.request.post("/api/boss/open-loops/intake-token");
  expect(provisioned.status()).toBe(201);
  const { data: { token } } = await provisioned.json();

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
    const result = await runSimone({
      api: async (method, route, body) => {
        const receipt = await page.request.fetch(`/api/boss/simone${route}`, {
          method, data: body, headers: { Authorization: `Bearer ${token}` },
        });
        expect(receipt.ok()).toBe(true);
        return (await receipt.json()).data;
      },
      run: async (call) => {
        expect(call.message.body).toBe(MESSAGE);
        const log = [
          { type: "assistant", message: { content: [{ type: "tool_use", id: "venue-search", name: "WebSearch" }] } },
          { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "venue-search", content: "The free park opens at noon and takes phone bookings. The free hall and the free pavilion open later." }] } },
          { type: "result", subtype: "success", result: `${REPLY}\nOUTPUT: 1 done` },
        ].map((entry) => JSON.stringify(entry)).join("\n");
        return { log, successful: true };
      },
    });
    expect(result).toEqual({ state: "done", id: taskId });
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
