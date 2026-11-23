import { test, expect } from "@playwright/test";
import { unlock, tab, expectNoSidewaysScroll, PHONE } from "./support/boss";

/**
 * THE GROWTH PAGE, AS SHE USES IT (21 Nov 2026). Phone first (Boss OS has one light theme): line 1 says what needs
 * her, one section per business in scoreboard order with Upcoming / Happening / Happened, numbers that
 * were not read say so (never 0), and nothing scrolls sideways. A day's readings are posted first so
 * the page shows real numbers.
 */
for (const scheme of ["light"] as const) {
  test(`Growth page at 390 px (${scheme})`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: PHONE.width, height: PHONE.height });
    await unlock(page);
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const posted = await page.request.post("/api/boss/growth/readings", { data: { day, readings: [
      { measure: "pnp-requests", business: "porch-and-party", kind: "requests", channel: "all", language: "en", value: 2 },
      { measure: "pnp-money", business: "porch-and-party", kind: "money", channel: "all", language: "en", value: 730 },
      { measure: "pnp-search", business: "porch-and-party", kind: "visits", channel: "google-search", language: "en", value: null, unread: "not read: Search Console refused the key" },
    ] } });
    expect(posted.status()).toBe(201);
    await tab(page, "Growth");
    const g = page.getByTestId("growth");
    await expect(g.getByTestId("growth-summary")).toBeVisible();
    const pnp = g.getByTestId("growth-business-porch-and-party");
    await expect(pnp).toContainText("Upcoming");
    await expect(pnp).toContainText("Happening");
    await expect(pnp).toContainText("Happened");
    await expect(pnp).toContainText("$730");
    await pnp.getByText(/number.* not read ▾/).click();
    await expect(pnp).toContainText("Search Console refused the key");
    await expect(g.getByTestId("growth-business-how-we-know")).toContainText("Paused");
    await expect(g).not.toContainText("NAMED STOP");
    await expectNoSidewaysScroll(page);
    await page.screenshot({ path: info.outputPath(`growth-390-${scheme}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}

/**
 * THE AI ANSWERS CARD (22 Nov 2026). A week is posted through the real route (POST /api/boss/growth/ai-week,
 * every count recomputed there): KeepMyProof read, ApprovalPrep an honest stop. The card says cited and named
 * out of its buyer questions per engine, kept apart from the 28-day numbers; the stop reads "Not read", never 0.
 * Shot at 390 px and 1280 px, light and dark (Boss OS has one light theme: dark proves nothing breaks).
 */
const ENGINES = ["chatgpt", "gemini", "google_ai_overview"];
function week(host: string) {
  const prompts = [1, 2, 3, 4].map((i) => ({ id: `e2e-p${i}`, text: `buyer question ${i}` }));
  const observations = prompts.flatMap((p, i) => ENGINES.map((e) => ({
    id: `${p.id}-${e}`, prompt_id: p.id, engine: e, status: "answered",
    mentioned: i < 2 && e !== "gemini", cited: i === 0 && e === "chatgpt", rivals: ["rival.example"], sources: ["review-site.example"],
  })));
  return {
    site: host, tracker: { prompts, engines: ENGINES },
    run: { id: "e2e-run-1", createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), expected: 12, completed: 12, failed: 0 },
    summary_own: { mentions: observations.filter((o) => o.mentioned).length, citations: observations.filter((o) => o.cited).length },
    observations, lanes: [],
  };
}
for (const [w, h, size] of [[390, 844, "390"], [1280, 900, "desktop"]] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`Growth AI answers card at ${size} (${scheme})`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: w, height: h });
      await unlock(page);
      const posted = await page.request.post("/api/boss/growth/ai-week", { data: { sites: [
        { host: "keepmyproof.com", block: week("keepmyproof.com"), prefix: "/questions/", strengthened: [] },
        { host: "approvalprep.com", stop: "OPENSEO_NOT_YET" },
      ] } });
      expect(posted.status()).toBe(201);
      await tab(page, "Growth");
      const kmp = page.getByTestId("growth-ai-keepmyproof.com");
      await expect(kmp).toContainText("Cited for 1 of 4 buyer questions, named in 2");
      await expect(kmp).toContainText("ChatGPT: cited 1, named 2 of 4 answered");
      await expect(page.getByTestId("growth-ai-approvalprep.com")).toContainText("Not read:");
      await expect(page.getByTestId("growth")).not.toContainText("NAMED STOP");
      await expectNoSidewaysScroll(page);
      await kmp.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`growth-ai-${size}-${scheme}.png`), fullPage: true });
      expect(errors).toEqual([]);
    });
  }
}
