import { test, expect } from "@playwright/test";
import { provisionLocalD1, queryLocalD1 } from "./support/provision";
import { unlock, tab, PHONE, expectNoSidewaysScroll } from "./support/boss";

const ID = "cmd_e2e_mail";
const ADDRESS = "booking@venue.example.test";
const sql = (v: unknown) => `'${String(v).replace(/'/g, "''")}'`;
function clean() {
  provisionLocalD1(`DELETE FROM boss_sent_mail WHERE command_id = '${ID}'; DELETE FROM boss_inbound_mail WHERE id = 'iml_e2e_refused'; DELETE FROM boss_commands WHERE id = '${ID}'; DELETE FROM boss_mail_senders WHERE address = '${ADDRESS}'`);
}
test.beforeEach(async ({ page }) => {
  clean();
  const now = Date.now();
  provisionLocalD1(`INSERT INTO boss_commands (id, kind, state, spec, result, created_at, updated_at) VALUES ('${ID}', 'errand', 'needs_card', ${sql(JSON.stringify({ to: ADDRESS, ask: "Book a table for two at The Example Room" }))}, ${sql(JSON.stringify({ booking: { at: now + 40 * 3_600_000, time: "9:00 pm", confirmed: false }, pending: { text: "A stale reply" } }))}, ${now}, ${now}); INSERT INTO boss_inbound_mail (id, received_at, to_addr, from_addr, dmarc_pass, authorised, subject, outcome, why, bytes, message_id, thread_id) VALUES ('iml_e2e_refused', ${now}, 'owner@example.test', '${ADDRESS}', 1, 0, 'A card request from a new sender', 'REFUSED_SENDER', 'Unknown sender', 100, '<refused@example.test>', '<refused@example.test>')`);
  await page.setViewportSize(PHONE);
  await unlock(page);
});
test.afterEach(clean);

test("the phone Inbox keeps four sections, admits a refused sender, and reads full sent words", async ({ page }) => {
  const saved = await page.request.post("/api/boss/mail/sent", { data: { message_id: "<sent-e2e@example.test>", from: "simone@example.test", to: ADDRESS, subject: "Your table request", text: "The exact outgoing words. Card terms: https://pay.example.test/fake", command_id: ID, employee_id: "emp_chief" } });
  expect(saved.ok()).toBe(true);
  await tab(page, "Inbox");
  for (const title of ["Approvals", "Notices", "Emails sent by agents", "Emails sent to you"]) await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await page.getByText("Your table request ·", { exact: false }).click();
  await expect(page.getByText("The exact outgoing words.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "View the original email", exact: true })).toHaveAttribute("href", /\/api\/boss\/mail\//);
  await page.getByText("A card request from a new sender ·", { exact: false }).click();
  await page.getByRole("button", { name: "Let this sender in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Let this sender in", exact: true })).toHaveCount(0);
  expect(queryLocalD1<any>(`SELECT address FROM boss_mail_senders WHERE address = '${ADDRESS}'`)).toHaveLength(1);
  await expectNoSidewaysScroll(page);
  await page.getByLabel("Other person or business").fill("nobody@example.test");
  await page.getByRole("button", { name: "Filter emails", exact: true }).click();
  await expect(page.getByRole("region", { name: "Emails sent by agents", exact: true })).toContainText("No emails in this section for these filters");
});

test("Team shows the errand; its detail stands Simone down without cancellation mail or reminders", async ({ page }) => {
  await tab(page, "Team");
  await page.getByTestId("team-card").filter({ hasText: "Simone" }).click();
  await page.getByRole("link", { name: "Book a table for two at The Example Room", exact: true }).click();
  await expect(page.getByTestId("command-page")).toContainText("Needs you: card");
  await expect(page.getByTestId("command-page")).toContainText("Waiting for the venue to confirm");
  await expect(page.getByRole("button", { name: "← Back", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "I’m handling it myself", exact: true }).click();
  await expect(page.getByTestId("command-page")).toContainText("Owner is handling this herself");
  await expect(page.getByTestId("command-page")).toContainText("No reminder will be sent");
  const [row] = queryLocalD1<any>(`SELECT state, result FROM boss_commands WHERE id = '${ID}'`);
  expect(row.state).toBe("done"); expect(JSON.parse(row.result).pending).toBeNull();
  expect(queryLocalD1<any>(`SELECT id FROM boss_sent_mail WHERE command_id = '${ID}'`)).toEqual([]);
  await expectNoSidewaysScroll(page);
});
