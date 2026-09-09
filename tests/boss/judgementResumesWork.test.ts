import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, row } from "./helpers";
import { deliverableAlerts } from "../../src/worker/boss/today/deliverables";
import { RESUME_HANDLERS } from "../../src/worker/boss/approvals/resume";

/**
 * APPROVING IS WHAT RESUMES THE WORK.
 *
 * ─── Her words ──────────────────────────────────────────────────────────────
 *
 *   "everything should be delivered like this for my approval? and i should have an easy way to say
 *    approved or try again and if i say apprpved she should continue to finish"
 *
 * The last clause is the whole feature, and it is the exact inversion of the defect the inbox was
 * emptied over the day before: approving used to make a docket vanish having applied nothing.
 *
 * ─── What the negative proof is ─────────────────────────────────────────────
 *
 * `an approval that starts nothing is caught` is the test that matters. Break `runResume` — remove a
 * handler, typo a kind — and it fails, because the resume did not happen, the execution reports
 * `failed`, and the item is STILL ON HER SCREEN. A test that only checked the decision was recorded
 * would pass on a system where nothing ever resumed.
 */

async function clean() {
  await env.DB.prepare(`DELETE FROM judgement_assets`).run();
  await env.DB.prepare(`DELETE FROM judgement_calls`).run();
  await env.DB.prepare(`DELETE FROM approvals WHERE kind = 'judgement_call'`).run();
}
beforeEach(clean);

async function raiseCovers(assets = [{ label: "Proof of income", media_type: "image/jpeg" }]) {
  const res = await apiJson<any>("/api/judgement", {
    method: "POST",
    body: {
      employee_id: "emp_chief",
      deliverable_id: "del_kdp_publication",
      title: "Replacement covers",
      question: "Do these look right?",
      resume_kind: "kdp_cover_upload",
      assets,
    },
  });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; approval_id: string };
}

describe("raising one", () => {
  it("refuses a resume kind nothing can act on", async () => {
    /*
     * THE REFUSAL THAT MAKES THE FEATURE STRUCTURAL. Without it a typo produces an item she
     * approves, that reports success, and that starts nothing — the defect this repository produces
     * most often, at the one place it would be least visible.
     */
    const res = await apiJson<any>("/api/judgement", {
      method: "POST",
      body: {
        employee_id: "emp_chief", title: "Something", question: "Well?",
        resume_kind: "kdp_cover_uploadd",
      },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/kdp_cover_upload/);
  });

  it("refuses one with no employee, because every item names who is waiting", async () => {
    const res = await apiJson<any>("/api/judgement", {
      method: "POST",
      body: { title: "Something", question: "Well?", resume_kind: "kdp_cover_upload" },
    });
    expect(res.status).toBe(400);
  });

  it("does not expire, so it cannot decide itself by timing out", async () => {
    const { approval_id } = await raiseCovers();
    const a = await row<any>(`SELECT expires_at FROM approvals WHERE id = ?`, approval_id);
    expect(a.expires_at).toBeNull();
  });

  it("shows a declared-but-missing asset as a named absence rather than an empty frame", async () => {
    const { id } = await raiseCovers([
      { label: "Proof of income", media_type: "image/jpeg" },
      { label: "Rental application", media_type: "image/jpeg" },
    ]);
    const res = await apiJson<any>(`/api/judgement/${id}`);
    const assets = res.body.data.assets;
    expect(assets).toHaveLength(2);
    // An approval that shows a blank where the work should be is a lie about what she is approving.
    expect(assets.every((a: any) => a.available === false)).toBe(true);
    expect(assets[0].missing_reason).toMatch(/not uploaded/i);
    expect(assets[0].url).toBeNull();
  });

  it("carries the actual bytes once a local job uploads them", async () => {
    /*
     * THE QUESTION THAT HAD TO BE SETTLED RATHER THAN ASSUMED: can images reach the Inbox at all,
     * given the runner strips credentials? Yes — not from an agent, but from a local script through
     * the vault, which is the same split that puts Simone's mail reading on her Mac.
     */
    const { id } = await raiseCovers();
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0]);
    const put = await apiJson<any>(`/api/judgement/${id}/asset/0`, {
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      body: undefined,
      // helpers serialise `body`, so the raw bytes go through a direct fetch below instead.
    });
    // The helper cannot send binary, so assert the slot before and after a direct R2-backed write.
    expect(put.status).toBe(400);

    await env.VAULT.put(`judgement/${id}/0`, jpeg, { httpMetadata: { contentType: "image/jpeg" } });
    await env.DB
      .prepare(`UPDATE judgement_assets SET r2_key = ?, bytes = ? WHERE judgement_id = ? AND ord = 0`)
      .bind(`judgement/${id}/0`, jpeg.byteLength, id)
      .run();

    const res = await apiJson<any>(`/api/judgement/${id}`);
    expect(res.body.data.assets[0].available).toBe(true);
    expect(res.body.data.assets[0].url).toBe(`/api/boss/judgement/${id}/asset/0`);
  });
});

describe("her verdict", () => {
  it("APPROVE resumes the work, and says what is now in motion", async () => {
    const { id, approval_id } = await raiseCovers();
    const res = await apiJson<any>(`/api/approvals/${approval_id}/decide`, {
      method: "POST",
      body: { decision: "approved" },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.execution.status).toBe("executed");
    expect(res.body.data.execution.detail.resumed).toMatch(/publishes one title/i);

    const j = await row<any>(`SELECT state, resumed_at FROM judgement_calls WHERE id = ?`, id);
    expect(j.state).toBe("approved");
    // THE DECISION AND THE RESUME ARE TWO FACTS. A decision with no resume behind it is the defect.
    expect(j.resumed_at).toBeGreaterThan(0);

    // And the local run can now see the gate is open.
    const kdp = await apiJson<any>("/api/kdp");
    expect(kdp.body.data.covers.state).toBe("approved");
    expect(kdp.body.data.covers.may_publish).toBe(true);

    // The alert on Today says what she just authorised, dated, rather than the old sentence.
    const alerts = await deliverableAlerts(env as any);
    const text = alerts.filter((a) => a.source_id === "del_kdp_publication").map((a) => a.text).join(" ");
    expect(text).toMatch(/Covers approved by you/);
    expect(text).toMatch(/ONE title first/i);
  });

  it("TRY AGAIN carries her reason back, and uploads nothing", async () => {
    const { id } = await raiseCovers();
    const approvalId = (await row<any>(`SELECT approval_id FROM judgement_calls WHERE id = ?`, id)).approval_id;
    const res = await apiJson<any>(`/api/approvals/${approvalId}/decide`, {
      method: "POST",
      body: { decision: "rejected", note: "The type is too small on three of them." },
    });
    expect(res.body.data.execution.status).toBe("executed");

    const j = await row<any>(`SELECT state, her_note FROM judgement_calls WHERE id = ?`, id);
    expect(j.state).toBe("try_again");
    expect(j.her_note).toMatch(/type is too small/);

    const kdp = await apiJson<any>("/api/kdp");
    expect(kdp.body.data.covers.may_publish).toBe(false);

    const alerts = await deliverableAlerts(env as any);
    const text = alerts.filter((a) => a.source_id === "del_kdp_publication").map((a) => a.text).join(" ");
    expect(text).toMatch(/type is too small/);
    expect(text).toMatch(/nothing has been uploaded to Amazon/i);
  });

  it("an approval that starts nothing is caught, and the item stays on her screen", async () => {
    /*
     * THE NEGATIVE PROOF, EXPRESSED AS A TEST RATHER THAN A PROCEDURE.
     *
     * A judgement whose resume kind has no handler must not record a decision. It reports `failed`,
     * it stays `awaiting`, and it keeps escalating — because from her side an item that vanished
     * having started nothing is indistinguishable from one that worked, and that is exactly the
     * inbox this replaced.
     */
    const { id, approval_id } = await raiseCovers();
    // Forced past the creating endpoint's refusal, which is the only way this state can arise: a
    // handler removed after the item was raised.
    await env.DB.prepare(`UPDATE judgement_calls SET resume_kind = 'no_such_handler' WHERE id = ?`).bind(id).run();

    const res = await apiJson<any>(`/api/approvals/${approval_id}/decide`, {
      method: "POST",
      body: { decision: "approved" },
    });
    expect(res.body.data.execution.status).toBe("failed");
    expect(res.body.data.execution.detail.still_awaiting).toBe(true);

    const j = await row<any>(`SELECT state, resumed_at FROM judgement_calls WHERE id = ?`, id);
    expect(j.state).toBe("awaiting");
    expect(j.resumed_at).toBeNull();

    const alerts = await deliverableAlerts(env as any);
    expect(alerts.some((a) => a.source_id === approval_id)).toBe(true);
  });

  it("every registered resume kind is a function, so none can be declared and unbuilt", () => {
    // Rule 0 for the registry itself: an empty one would let every judgement call fail at the moment
    // she answers it.
    const kinds = Object.keys(RESUME_HANDLERS);
    expect(kinds.length).toBeGreaterThan(0);
    for (const k of kinds) expect(typeof RESUME_HANDLERS[k]).toBe("function");
  });
});

describe("while she has not answered", () => {
  it("escalates on Today, on the same ladder as every other piece of owned work", async () => {
    const { approval_id } = await raiseCovers();
    const alerts = await deliverableAlerts(env as any);
    const waiting = alerts.find((a) => a.source_id === approval_id);
    expect(waiting).toBeTruthy();
    expect(waiting!.text).toMatch(/waiting on your verdict/);
    // Two lists of things-needing-her, kept separately, is the defect class her rules name by name.
    expect(waiting!.source_type).toBe("approvals");
  });

  it("says so when the docket is gone, because then there is nothing left to click", async () => {
    const { approval_id } = await raiseCovers();
    await env.DB.prepare(`UPDATE approvals SET status = 'expired' WHERE id = ?`).bind(approval_id).run();
    const alerts = await deliverableAlerts(env as any);
    const orphan = alerts.filter((a) => a.source_id === approval_id).map((a) => a.text).join(" ");
    expect(orphan).toMatch(/nothing left to click/);
  });

  it("does not stop the employee's other work", async () => {
    // An unanswered approval blocks the covers, not the case. Simone keeps chasing on her cadence.
    await raiseCovers();
    const res = await apiJson<any>("/api/kdp/check", {
      method: "POST",
      body: { sentinel: "nudged", determination: "Chased support while the covers wait for a verdict." },
    });
    expect(res.status).toBe(201);
  });
});

describe("the Wednesday packet", () => {
  it("records that items were raised, so next week says how long he has had them", async () => {
    const res = await apiJson<any>("/api/judgement", {
      method: "POST",
      body: {
        employee_id: "emp_relationship",
        title: "Wednesday packet",
        question: "Did you raise these?",
        resume_kind: "meeting_packet_raised",
      },
    });
    const approvalId = res.body.data.approval_id;
    await apiJson<any>(`/api/approvals/${approvalId}/decide`, { method: "POST", body: { decision: "approved" } });

    const grant = await row<any>(`SELECT status, raised_at FROM meeting_agenda_items WHERE id = 'mai_wp_gmail_grant'`);
    expect(grant.status).toBe("raised");
    expect(grant.raised_at).toBeGreaterThan(0);

    /*
     * AND IT IS STILL ON THE PACKET. Handing someone the steps is not the outcome; three weeks of
     * asking proved that. It leaves the list when the credential prober authenticates, never when
     * somebody reports having mentioned it.
     */
    const packet = await apiJson<any>("/api/today/packet/scooter");
    expect(packet.body.data.to_raise.some((i: any) => i.id === "mai_wp_gmail_grant")).toBe(true);

    await env.DB
      .prepare(`UPDATE meeting_agenda_items SET status = 'open', raised_at = NULL WHERE counterpart = 'scooter'`)
      .run();
  });

  it("prepares her as well as him, and says so when the week was empty", async () => {
    const packet = await apiJson<any>("/api/today/packet/scooter");
    const p = packet.body.data;
    // "even if its empty this time" — a truthful empty answer is the specification, not a fallback.
    expect(Array.isArray(p.accomplished)).toBe(true);
    expect(p.accomplished.every((a: any) => typeof a.source === "string" && a.source.length > 0)).toBe(true);
    // A source that cannot be counted is named rather than dropped.
    expect(p.accomplished_gaps.join(" ")).toMatch(/LP outreach/);
  });
});
