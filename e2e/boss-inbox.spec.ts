import { test, expect, type Page } from "@playwright/test";
import { provisionLocalD1, queryLocalD1 } from "./support/provision";

/**
 * THE INBOX AND THE CAPITAL DESK, DRIVEN AS SHE DRIVES THEM — 19 September 2026.
 *
 * Her report, verbatim: "The inbox needs an overhaul. I need to be able to reject all things at
 * once with an overarching reason why — right now I had 13 messages to reject. And I cannot even
 * input my position sizes; it doesn't record." And later: "The Capital tab said the 13 emails they
 * proposed are in flight to be fixed, but the Inbox tab brings them back after I sent them away."
 *
 * Four journeys, each one of her real paths, each asserting up to the boundary and no further
 * (`wrangler dev --local` cannot reach Gmail, so the draft journey proves the NAMED STOP; the
 * created path is proven against a fake Gmail in tests/boss/gmailDraft.test.ts):
 *
 *   1 · type the sizes as she types them → recorded → shown on Capital → still there after reload;
 *       and the unreadable case fails BESIDE the field with the save disabled.
 *   2 · 13 letters seeded → select all → one reason → confirm → 13 rejected, the reason on each
 *       record, the Inbox empty, Capital listing them as sent back — and the raising lane run again
 *       raises nothing. The boomerang, pinned shut in a browser.
 *   3 · the green button on a letter creates the draft (here: the named stop), and the card has
 *       exactly one primary action and it says draft.
 *   4 · all of it at phone width.
 */

const PASSCODE = "local-dev-passcode";
const PREFIX = "src_e2e_inbox_";

async function unlock(page: Page) {
  await page.goto("/boss");
  const field = page.getByLabel("Passcode");
  await expect(field).toBeVisible();
  await field.fill(PASSCODE);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
}

async function tab(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(page.locator("main.page")).toBeVisible();
}

function cleanSql(): string {
  return [
    `DELETE FROM gmail_drafts WHERE candidate_id LIKE '${PREFIX}%'`,
    `DELETE FROM approvals WHERE id IN (SELECT approval_id FROM judgement_calls WHERE id IN (SELECT judgement_id FROM buyer_outreach_drafts WHERE candidate_id LIKE '${PREFIX}%'))`,
    `DELETE FROM judgement_calls WHERE id IN (SELECT judgement_id FROM buyer_outreach_drafts WHERE candidate_id LIKE '${PREFIX}%')`,
    `DELETE FROM buyer_outreach_drafts WHERE candidate_id LIKE '${PREFIX}%'`,
    `DELETE FROM sourcing_candidates WHERE id LIKE '${PREFIX}%'`,
    `DELETE FROM settings WHERE key IN ('brokerage_working_position_usd','brokerage_working_positions_usd')`,
  ].join("; ");
}

/** N public-research buyers, reviewed through the real route so each produces a letter in the Inbox. */
async function seedLetters(page: Page, n: number): Promise<string[]> {
  const now = Date.now();
  const rows = Array.from({ length: n }, (_, i) =>
    `('${PREFIX}${i + 1}', 'E2E Buyer ${i + 1}', 'buyer', NULL, 'buys shares directly from employees', 'https://example.test/e2e/${i + 1}', 'their own site', ${now}, 'public_research', 'new', ${now}, ${now})`,
  );
  provisionLocalD1(
    `INSERT INTO sourcing_candidates (id, name, kind, ticket_floor_usd, thesis, source_url, source_name, read_at, origin, status, created_at, updated_at) VALUES ${rows.join(", ")}`,
  );
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    const res = await page.request.post(`/api/boss/wealth/sourcing/${PREFIX}${i}/status`, { data: { status: "reviewed" } });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.data.letter.drafted, `letter ${i} drafted`).toBe(true);
    ids.push(`${PREFIX}${i}`);
  }
  return ids;
}

test.describe("Boss OS Inbox overhaul", () => {
  test.beforeEach(() => { provisionLocalD1(cleanSql()); });
  test.afterAll(() => { provisionLocalD1(cleanSql()); });

  test("her position sizes record the way she types them, and an unreadable size fails beside the field", async ({ page }) => {
    await unlock(page);
    await tab(page, "Capital");

    const panel = page.getByTestId("working-positions");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Nothing here knows the sizes you are working");
    await page.getByTestId("working-positions-toggle").click();

    // THE UNREADABLE CASE, WHICH USED TO BE SILENT. No request leaves, the save is disabled, and the
    // error sits within a hand's width of the input rather than 3,000px above it.
    const puts: string[] = [];
    page.on("request", (r) => { if (r.method() === "PUT" && r.url().includes("/working-positions")) puts.push(r.url()); });
    const input = page.getByTestId("working-positions-input");
    await input.fill("5M and some");
    const error = page.getByTestId("working-positions-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText('"some" is not a size');
    const ib = (await input.boundingBox())!;
    const eb = (await error.boundingBox())!;
    expect(eb.y).toBeGreaterThan(ib.y);
    expect(eb.y - (ib.y + ib.height)).toBeLessThan(120);
    await expect(page.getByTestId("working-positions-save")).toBeDisabled();
    expect(puts).toHaveLength(0);

    // THE CASE SHE TYPED. Recorded, read back from the table, shown.
    await input.fill("$5M, 12M and 40M");
    await expect(error).toHaveCount(0);
    await expect(panel).toContainText("Reads as $40M, $12M and $5M");
    await page.getByTestId("working-positions-save").click();
    await expect(page.getByTestId("working-positions-saved")).toContainText("Recorded: $40M, $12M and $5M");
    await expect(panel).toContainText("You are working positions of $40M, $12M and $5M");
    expect(puts).toHaveLength(1);

    // It went to D1, and it is still there after a full reload.
    const rows = queryLocalD1<{ key: string; value: string }>(
      `SELECT key, value FROM settings WHERE key IN ('brokerage_working_position_usd','brokerage_working_positions_usd') ORDER BY key`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.value).toBe("40000000");
    expect(JSON.parse(rows[1]!.value)).toEqual([40_000_000, 12_000_000, 5_000_000]);

    await page.reload();
    await tab(page, "Capital");
    await expect(page.getByTestId("working-positions")).toContainText("You are working positions of $40M, $12M and $5M");
  });

  test("13 letters → select all → one reason → all 13 rejected with the reason on each, gone from the Inbox, listed on Capital, and never raised again", async ({ page }) => {
    await unlock(page);
    await seedLetters(page, 13);

    await tab(page, "Inbox");
    const masthead = page.getByTestId("inbox-masthead");
    await expect(masthead).toContainText("13");
    await expect(masthead).toContainText("waiting on you");
    await expect(masthead).toContainText("oldest");
    // Grouped by who raised what, with the count on the group.
    const group = page.getByTestId("inbox-group").filter({ hasText: "Letters to buyers" });
    await expect(group).toHaveCount(1);
    await expect(group.locator(".eyebrow")).toContainText("13");
    await expect(group.locator("article.docket")).toHaveCount(13);

    // Select all, from the bar.
    await page.getByLabel("Select all").check();
    await expect(page.getByTestId("bulk-bar")).toContainText("13 selected");
    await expect(page.locator("article.docket-selected")).toHaveCount(13);

    // Reject selected → one reason → the count is named twice before anything happens.
    await page.getByTestId("reject-selected").click();
    const reasonPanel = page.getByTestId("bulk-reason");
    await expect(reasonPanel).toContainText("One reason for all 13");
    await expect(page.getByTestId("bulk-continue")).toBeDisabled();
    await page.getByTestId("bulk-reason-text").fill("same");
    await expect(reasonPanel.getByRole("alert")).toContainText("more character");
    await expect(page.getByTestId("bulk-continue")).toBeDisabled();
    // One of her real reasons, to hand.
    await reasonPanel.getByRole("button", { name: /Rewrite the opening/ }).click();
    await expect(page.getByTestId("bulk-continue")).toBeEnabled();
    await page.getByTestId("bulk-continue").click();
    await expect(page.getByTestId("bulk-confirm")).toContainText("Yes — reject all 13");
    await page.getByTestId("bulk-confirm").click();

    // The result line, then nothing left.
    const result = page.getByTestId("bulk-result");
    await expect(result).toContainText("13 rejected · 0 failed", { timeout: 30_000 });
    await expect(page.locator("article.docket")).toHaveCount(0);
    await expect(page.getByTestId("inbox-masthead")).toContainText("0");
    await expect(page.getByText("Nothing needs you")).toBeVisible();

    // EACH RECORD CARRIES THE WHOLE SENTENCE AND THE ACT. Thirteen rows, one batch.
    const decided = queryLocalD1<{ status: string; decision_note: string; batch_id: string }>(
      `SELECT a.status, a.decision_note, a.batch_id FROM approvals a
        JOIN judgement_calls j ON j.approval_id = a.id
        JOIN buyer_outreach_drafts d ON d.judgement_id = j.id
       WHERE d.candidate_id LIKE '${PREFIX}%'`,
    );
    expect(decided).toHaveLength(13);
    const batches = new Set(decided.map((r) => r.batch_id));
    expect(batches.size).toBe(1);
    for (const r of decided) {
      expect(r.status).toBe("rejected");
      expect(r.decision_note).toContain("Rewrite the opening");
    }

    // THE BOOMERANG: the Inbox stays empty after a reload, and Capital lists them as sent back.
    await page.reload();
    await tab(page, "Inbox");
    await expect(page.getByTestId("inbox-masthead")).toContainText("0");
    await expect(page.locator("article.docket")).toHaveCount(0);

    await tab(page, "Capital");
    const sentBack = page.getByTestId("sent-back");
    await expect(sentBack).toBeVisible();
    await expect(page.getByText("Sent back · 13")).toBeVisible();
    await expect(sentBack.locator(".row")).toHaveCount(13);
    await expect(sentBack).toContainText("Rewrite the opening");

    // THE RAISING LANE RUNS AGAIN — from the desk — AND RAISES NOTHING, because the letter would be
    // word-for-word the one she sent back.
    await page.getByTestId("redraft-sent-back").click();
    await expect(page.getByText(/Nothing redrafted/)).toBeVisible();
    await tab(page, "Inbox");
    await expect(page.getByTestId("inbox-masthead")).toContainText("0");
    const stillOne = queryLocalD1<{ n: number }>(
      `SELECT COUNT(*) AS n FROM buyer_outreach_drafts WHERE candidate_id LIKE '${PREFIX}%'`,
    );
    expect(stillOne[0]!.n).toBe(13); // no attempt 2 anywhere
  });

  test("the green button on a letter creates the draft — one primary action, no send — and here reports the named stop", async ({ page }) => {
    await unlock(page);
    await seedLetters(page, 1);
    await tab(page, "Inbox");

    const card = page.locator("article.docket").first();
    await expect(card).toContainText("A letter to E2E Buyer 1");
    await expect(card).toContainText("My name is Sequoia Taylor, and I run Spry VC");
    await expect(card).toContainText("The green button does not send this");

    // EXACTLY ONE PRIMARY, AND IT IS THE DRAFT. No button on the card is a send verb.
    const primaries = card.locator("button.btn-approve");
    await expect(primaries).toHaveCount(1);
    await expect(primaries.first()).toHaveText("Create the draft in my Gmail");
    const labels = await card.locator("button").allInnerTexts();
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l.trim()).not.toMatch(/^send( it| this| now)?$/i);

    await primaries.first().click();
    // The card leaves; the outcome is said in words. Locally there is no Google key, so it is the
    // named stop — never a silent approval that looks like a draft exists.
    await expect(page.locator("article.docket")).toHaveCount(0);
    await expect(page.getByText(/Blocked: the Worker holds no Google key/)).toBeVisible();

    // Capital shows the approved letter with the state named and a retry, and nothing marked sent.
    await tab(page, "Capital");
    const approved = page.getByTestId("approved-letter");
    await expect(approved).toHaveCount(1);
    await expect(approved.getByTestId("gmail-state")).toContainText("the Worker holds no Google key");
    await expect(approved.getByTestId("gmail-draft-retry")).toHaveText("Create the draft in my Gmail");
    const rows = queryLocalD1<{ state: string; failure_code: string; sent_at: number | null }>(
      `SELECT g.state, g.failure_code, d.sent_at FROM gmail_drafts g JOIN buyer_outreach_drafts d ON d.id = g.outreach_draft_id WHERE g.candidate_id LIKE '${PREFIX}%'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe("blocked");
    expect(rows[0]!.failure_code).toBe("no_worker_key");
    expect(rows[0]!.sent_at).toBeNull();

    // Pressing retry from the desk is the same named stop, and does not make a second row of noise
    // that reads differently.
    await approved.getByTestId("gmail-draft-retry").click();
    await expect(page.getByText(/Blocked: the Worker holds no Google key/)).toBeVisible();
  });

  test("at phone width the masthead, the bar and the reason panel are on screen and the sizes field still records", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await unlock(page);
    await seedLetters(page, 3);
    await tab(page, "Inbox");
    await expect(page.getByTestId("inbox-masthead")).toBeInViewport();
    await expect(page.getByTestId("inbox-masthead")).toContainText("3");
    await page.getByLabel("Select all").check();
    await expect(page.getByTestId("bulk-bar")).toBeInViewport();
    await page.getByTestId("reject-selected").click();
    await expect(page.getByTestId("bulk-reason")).toBeInViewport();
    // No horizontal overflow.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await tab(page, "Capital");
    await page.getByTestId("working-positions-toggle").click();
    await page.getByTestId("working-positions-input").fill("500k, 2.5 million");
    await expect(page.getByTestId("working-positions")).toContainText("Reads as $2.5M and $500k");
    await page.getByTestId("working-positions-save").click();
    await expect(page.getByTestId("working-positions-saved")).toContainText("Recorded: $2.5M and $500k");
  });
});
