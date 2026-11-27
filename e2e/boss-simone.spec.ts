import { expect, test, type Locator } from "@playwright/test";
import { expectNoSidewaysScroll, PHONE, tab, unlock } from "./support/boss";
import { dayIdInZone } from "../src/shared/boss/timezone";
import { runSimone } from "../scripts/ops/simone.mjs";

const MESSAGE = "Find three venues for Saturday and book the cheapest free one.";
const REPLY = "The park has a free slot at noon, and the hall and pavilion each have a free afternoon slot. The park takes reservations by phone, so I couldn’t book it.";

test("Simone replies in both message boxes at 390 px", async ({ page }, info) => {
  await page.setViewportSize(PHONE);
  // Any console error on the way through fails the journey (the Clicked through line says "console clean").
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const mailboxLabels = page.getByRole("region", { name: "Simone’s Google accounts" }).locator(".row-title");
  const capture = (name: string) => page.screenshot({ path: info.outputPath(name), mask: [mailboxLabels], maskColor: "#eadbd0" });
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
          { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "venue-search", content: "The park has a free noon slot and takes phone bookings. The hall and the pavilion each have a free afternoon slot." }] } },
          { type: "result", subtype: "success", result: `${REPLY}\nOUTPUT: 1 done` },
        ].map((entry) => JSON.stringify(entry)).join("\n");
        return { log, successful: true };
      },
    });
    expect(result).toEqual({ state: "done", id: taskId });
    await expect(box.getByRole("status")).toContainText(REPLY, { timeout: 15_000 });
    await expectNoSidewaysScroll(page);
    await capture(screenshot);
  }

  await page.getByTestId("tell-simone-fab").click();
  await sendAndRead(page.getByTestId("tell-sheet").getByTestId("tell-simone"), "/api/boss/intake/simone", "tell-simone-390.png");
  await page.getByTestId("tell-sheet").getByTestId("sheet-close").click();
  await tab(page, "Team");
  await page.getByTestId("team-card").filter({ hasText: "Simone" }).click();
  await expect(page.getByTestId("employee-page").locator(".charter")).toHaveText(
    "Chief of Staff: runs your day and is in charge of everything Boss OS runs",
  );
  const box = page.getByTestId("employee-message-simone");
  await sendAndRead(box, "/api/boss/simone/message", "simone-page-390.png");
  const account = page.getByRole("switch", { name: /time-2-read/ });
  await expect(account).toHaveAttribute("aria-checked", "true");
  await account.click();
  await expect(account).toHaveAttribute("aria-checked", "false");
  await expectNoSidewaysScroll(page);
  await capture("simone-accounts-390.png");
  await account.click();
  await expect(account).toHaveAttribute("aria-checked", "true");

  // One tap only asks: nothing pauses until "Yes, stop everything" (#582 review finding 7).
  const stopButton = box.getByRole("button", { name: "Stop everything", exact: true });
  await stopButton.click();
  await expect(box.getByText(/This pauses every agent and job in Boss OS/)).toBeVisible();
  await expect(box.getByText("Boss OS operations are paused.")).toHaveCount(0);
  await expectNoSidewaysScroll(page);
  await capture("simone-stop-confirm-390.png");
  await box.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(stopButton).toBeEnabled();
  expect((await (await page.request.get("/api/boss/simone/stop")).json()).data.stopped).toBe(false);
  await stopButton.click();
  await box.getByRole("button", { name: "Yes, stop everything", exact: true }).click();
  await expect(box.getByText("Boss OS operations are paused.")).toBeVisible();
  await expectNoSidewaysScroll(page);
  await capture("simone-stop-390.png");
  await box.getByRole("button", { name: "Resume Boss OS operations" }).click();
  await expect(box.getByRole("button", { name: "Stop everything", exact: true })).toBeEnabled();
  expect(errors, "console errors on the Simone journey").toEqual([]);
});

test("the Scorecard opens daily worker checks at 390 px", async ({ page }, info) => {
  await page.setViewportSize(PHONE);
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
  await unlock(page);
  const roster = await page.request.get("/api/boss/employees/roster");
  expect(roster.ok()).toBe(true);
  const { data } = await roster.json();
  const toni = data.roster.find((employee: { id: string }) => employee.id === "emp_risk");
  expect(toni.duties).toEqual(expect.arrayContaining(["duty_risk_watch", "duty_outside_locks"].map((id) =>
    expect.objectContaining({ id, model: "shared-free", model_warning: null, estimated_per_month_usd: 0 }))));
  const { data: { token } } = await (await page.request.post("/api/boss/open-loops/intake-token")).json();
  const evidence = "The billing mailbox couldn't be checked.";
  const row = { id: "worker-check:risk-watch", name: "Risk watch", kind: "schedule", aim: "Read the billing mailbox",
    state: "unknown", coverage: "listed", evidence };
  const report = await page.request.post("/api/boss/simone/operations/report", {
    headers: { Authorization: `Bearer ${token}` },
    data: { day: dayIdInZone(Date.now()), issues: [], proposal: null, rows: [row] },
  });
  expect(report.ok()).toBe(true);
  const nav = page.getByRole("navigation", { name: "Sections" });
  await nav.getByRole("button", { name: "☰ More", exact: true }).click();
  await nav.getByRole("button", { name: "Scorecard", exact: true }).click();
  const scorecard = page.getByTestId("scorecard");
  await scorecard.getByText("Daily worker checks · 1 need a look").click();
  await expect(scorecard.getByText(evidence)).toBeVisible();
  await expectNoSidewaysScroll(page);
  await page.screenshot({ path: info.outputPath("worker-scorecard-390.png") });
  expect(errors, "console errors on the Scorecard journey").toEqual([]);
});
