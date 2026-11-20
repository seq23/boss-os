/**
 * THE SHARED SHIP-READY REVIEWER'S RECORD (grid row 6f, owner 19 Nov 2026 "VETERAN QUALITY BAR").
 * A verdict is kept only when it says what it looked at; a PASS only with the line `land` reads; the
 * monthly read's drift lines never pick up a ship verdict. Made-up records only.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { apiJson } from "./helpers";
import { latestShipReview } from "../../src/worker/boss/routes/quality";
import { driftReport } from "../../src/worker/boss/duties/drift";

const pass = { id: "sr_testpass1", subject: "page:https://example.test/", kind: "page", verdict: "PASS", findings: [], builder: "an agent", route: "claude seat",
  looked_at: "https://example.test/ at 390 px (1 capture: phone-390-light.png)",
  line: "Ship-ready: PASS — boss-os ship-review sr_testpass1 (claude seat) looked at https://example.test/ at 390 px" };

describe("ship-ready verdicts", () => {
  it("a PASS and a later FAIL are kept; the newest is what a sender or lane waits on, and passed_before stays true", async () => {
    expect((await apiJson("/api/quality/reviews", { method: "POST", body: pass })).status).toBe(201);
    const fail = { ...pass, id: "sr_testfail1", verdict: "FAIL", line: "", findings: [{ where: "phone-390-light.png hero", what: "headline cut off at 390 px", feels: "looks broken" }] };
    expect((await apiJson("/api/quality/reviews", { method: "POST", body: fail })).status).toBe(201);
    const got = await apiJson(`/api/quality/reviews?subject=${encodeURIComponent(pass.subject)}`);
    expect(got.body.data.latest.verdict).toBe("FAIL");
    expect(got.body.data.latest.findings[0].what).toMatch(/cut off/);
    expect(got.body.data.passed_before).toBe(true);
    expect((await latestShipReview(env as any, pass.subject))?.id).toBe("sr_testfail1");
  });

  it("refuses a verdict that does not say what it looked at, a FAIL with no findings, and a PASS without land's line", async () => {
    expect((await apiJson("/api/quality/reviews", { method: "POST", body: { ...pass, id: "sr_testx1", looked_at: "" } })).status).toBe(400);
    expect((await apiJson("/api/quality/reviews", { method: "POST", body: { ...pass, id: "sr_testx2", verdict: "FAIL", findings: [] } })).status).toBe(400);
    expect((await apiJson("/api/quality/reviews", { method: "POST", body: { ...pass, id: "sr_testx3", line: "PASS, looks fine" } })).status).toBe(400);
    expect(await latestShipReview(env as any, "page:https://never.test/")).toBeNull();
  });

  it("the monthly read's drift report never shows a ship verdict as a monthly read", async () => {
    await apiJson("/api/quality/reviews", { method: "POST", body: { ...pass, id: "sr_testdrift", subject: "briefing" } });
    const r = await driftReport(env as any);
    expect(r.reads.find((x) => x.deliverable === "briefing")).toBeUndefined();
  });
});
