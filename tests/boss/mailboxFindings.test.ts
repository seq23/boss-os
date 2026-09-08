import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, row, all } from "./helpers";

/**
 * MONIQUE READS THE MAILBOX AND TELLS HER THINGS.
 *
 * Her words, 8 September 2026: "the people tab is stupid, i just want one of the employees to
 * peruse the mailbox and find connections and find people that could be buyers that i havent talked
 * to in a while etc.... and find deals im missing between a buyer and seller in my inbox"
 *
 * The last clause is the "missed connections" feature that has been the first outstanding item in
 * OPERATIONS.md since it was written.
 *
 * WHAT THESE TESTS ARE REALLY GUARDING. The sweep reads subjects and bodies on her Mac. The only
 * thing standing between that and a leak is this endpoint's refusal, and a refusal that has never
 * been exercised is a comment. The one time this class of guard fired for real, it was because a
 * collision suffix had been built from the first three characters of a real address.
 */

const good = {
  kind: "missed_deal",
  subject_code: "ROOK",
  counterpart_code: "AVOCET",
  subject_matter: "Acme Robotics",
  headline: "ROOK asked about Acme Robotics in March; AVOCET offered access in August.",
  because: "ROOK wrote about it 5 times between 2026-02 and 2026-03. AVOCET mentioned holding it on 2026-08-14. They appear on no thread together.",
  suggested_action: "Introduce ROOK to AVOCET on Acme Robotics before the next round prices.",
  confidence: "high",
  evidence: ["18f2c0a1b", "19a44de02"],
};

const postFindings = (findings: unknown[], runId = "mbx_test") =>
  apiJson("/api/relationships/mailbox-findings", { method: "POST", body: { run_id: runId, findings } });

describe("the mailbox sweep reports code names and nothing else", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM mailbox_findings`).run();
  });

  it("writes a finding with all four of its required parts", async () => {
    const { status, body } = await postFindings([good]);
    expect(status).toBe(201);
    expect(body.data.written).toBe(1);

    const f = await row<any>(`SELECT * FROM mailbox_findings WHERE subject_code = 'ROOK'`);
    expect(f.kind).toBe("missed_deal");
    expect(f.counterpart_code).toBe("AVOCET");
    expect(f.suggested_action).toContain("Introduce");
    expect(JSON.parse(f.evidence)).toHaveLength(2);
  });

  /*
   * THE WHOLE BATCH, NOT THE OFFENDING ROW. A partial accept would put some of a leaking run's
   * output into the cloud and answer 201, which is the failure this refusal exists to prevent.
   */
  it("refuses the entire batch when any field carries an address, and writes nothing at all", async () => {
    const { status } = await postFindings([
      good,
      { ...good, subject_code: "SWIFT", headline: "someone@example.com asked about this" },
    ]);
    expect(status).toBe(400);

    const written = await all<any>(`SELECT id FROM mailbox_findings`);
    expect(written).toHaveLength(0);
  });

  it("refuses an address hidden in the reasoning, not only in a name field", async () => {
    const { status } = await postFindings([{ ...good, because: "They wrote from buyer@fund.com twice." }]);
    expect(status).toBe(400);
    expect(await all<any>(`SELECT id FROM mailbox_findings`)).toHaveLength(0);
  });

  /*
   * A finding without a reason and an action is an observation, and she has enough of those. Same
   * rule the sourcing list uses for a candidate with no checkable source.
   */
  it("drops an incomplete finding rather than storing half of one", async () => {
    const { body } = await postFindings([
      good,
      { kind: "cooling_buyer", subject_code: "SWIFT", headline: "SWIFT has gone quiet." },
    ]);
    expect(body.data.written).toBe(1);
    expect(body.data.skipped).toBe(1);
  });

  it("re-derives the same finding without stacking a second copy on her screen", async () => {
    await postFindings([good]);
    await postFindings([{ ...good, because: "Updated: 6 mentions now." }], "mbx_test2");

    const rows = await all<any>(`SELECT because FROM mailbox_findings WHERE subject_code = 'ROOK'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].because).toContain("6 mentions");
  });

  /*
   * ZERO FINDINGS IS A REPORT, NOT SILENCE. "The sweep found nothing" and "the sweep never ran" are
   * opposite facts, and the whole reason a local job reports back at all is to tell them apart.
   * This is also what makes `duty_mailbox_sweep` an honest `local_job` duty: its clock advances
   * when the job REPORTS, never when launchd merely fires.
   */
  it("accepts a zero-finding sweep and advances Monique's clock", async () => {
    await env.DB.prepare(`UPDATE standing_duties SET last_run_at = NULL WHERE id = 'duty_mailbox_sweep'`).run();

    const { status, body } = await postFindings([]);
    expect(status).toBe(201);
    expect(body.data.written).toBe(0);

    const duty = await row<any>(`SELECT last_run_at, next_due_at FROM standing_duties WHERE id = 'duty_mailbox_sweep'`);
    expect(duty.last_run_at).not.toBeNull();
    expect(duty.next_due_at).toBeGreaterThan(Date.now());
  });

  it("refuses a report with no findings array, because that is a malformed run rather than a quiet week", async () => {
    const { status } = await apiJson("/api/relationships/mailbox-findings", { method: "POST", body: { run_id: "x" } });
    expect(status).toBe(400);
  });
});

describe("the People screen can tell an empty mailbox from a broken job", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM mailbox_findings`).run();
  });

  it("says the sweep has never run rather than showing a bare empty list", async () => {
    await env.DB.prepare(`UPDATE standing_duties SET last_run_at = NULL WHERE id = 'duty_mailbox_sweep'`).run();
    const { body } = await apiJson("/api/relationships/mailbox-findings?status=new");
    expect(body.data.findings).toEqual([]);
    expect(body.data.sweep.state).toContain("never run");
    expect(body.data.sweep.owner).toBe("Monique");
  });

  it("says when it last read the mailbox once it has", async () => {
    await postFindings([good]);
    const { body } = await apiJson("/api/relationships/mailbox-findings?status=new");
    expect(body.data.sweep.state).toContain("last read the mailbox");
    expect(body.data.findings).toHaveLength(1);
  });

  it("orders by confidence, so the live pairing is above the pattern", async () => {
    await postFindings([
      { ...good, subject_code: "SWIFT", confidence: "low", subject_matter: "Beta Corp" },
      good,
    ]);
    const { body } = await apiJson("/api/relationships/mailbox-findings?status=new");
    expect(body.data.findings[0].confidence).toBe("high");
  });

  it("takes a decision off the screen without deleting the record of it", async () => {
    await postFindings([good]);
    const id = (await row<any>(`SELECT id FROM mailbox_findings`)).id;

    const { status } = await apiJson(`/api/relationships/mailbox-findings/${id}/dismissed`, { method: "POST" });
    expect(status).toBe(200);

    const { body } = await apiJson("/api/relationships/mailbox-findings?status=new");
    expect(body.data.findings).toHaveLength(0);
    // The register remembers what was already decided. A next sweep must not re-raise it as new.
    expect(await row<any>(`SELECT status FROM mailbox_findings WHERE id = ?`, id)).toMatchObject({ status: "dismissed" });
  });

  it("refuses a decision that is not one of the two", async () => {
    await postFindings([good]);
    const id = (await row<any>(`SELECT id FROM mailbox_findings`)).id;
    const { status } = await apiJson(`/api/relationships/mailbox-findings/${id}/maybe`, { method: "POST" });
    expect(status).toBe(400);
  });

  /*
   * REGISTERED BEFORE `GET /:id`. Hono matches in registration order and `/:id` sits at the bottom
   * of relationships.ts, so a path declared after it answers "no relationship with that id" — a 404
   * that looks exactly like an empty feature and would be found by nobody until she asked why the
   * screen was blank.
   */
  it("is not swallowed by the /:id route below it", async () => {
    const { status, body } = await apiJson("/api/relationships/mailbox-findings");
    expect(status).toBe(200);
    expect(body.data).toHaveProperty("sweep");
  });
});

describe("a missed deal becomes the first money move", () => {
  /*
   * FINDINGS MUST LAND WHERE SHE WILL SEE THEM. A screen she has to remember to open is where
   * Simone's determinations sat for five days, and it is the reason this repository has a
   * `validate:reachable` at all. Today's Wealth Pillar Contract already answers "what is the first
   * money move", so a high-confidence pairing IS that answer rather than a fourteenth panel.
   */
  it("puts a high-confidence pairing above the sourcing pile on Today", async () => {
    await env.DB.prepare(`DELETE FROM mailbox_findings`).run();
    await postFindings([good]);

    const day = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(`UPDATE days SET morning_contract = NULL, morning_completed_at = NULL WHERE id = ?`)
      .bind(day).run();

    const { body } = await apiJson(`/api/today?date=${day}`);
    const block = (body.data.blocks as any[]).find((b) => b.key === "todays_contract");
    expect(block.content.agenda.pillars.wealth.action).toContain("Introduce");
    expect(block.content.agenda.pillars.wealth.why).toContain("your own mailbox");
  });

  it("does not promote a medium-confidence guess to the top of her morning", async () => {
    await env.DB.prepare(`DELETE FROM mailbox_findings`).run();
    await postFindings([{ ...good, confidence: "medium" }]);

    const day = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(`UPDATE days SET morning_contract = NULL, morning_completed_at = NULL WHERE id = ?`)
      .bind(day).run();

    const { body } = await apiJson(`/api/today?date=${day}`);
    const block = (body.data.blocks as any[]).find((b) => b.key === "todays_contract");
    expect(block.content.agenda.pillars.wealth.action).not.toContain("Introduce");
  });
});
