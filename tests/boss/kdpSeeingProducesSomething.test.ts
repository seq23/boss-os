import { env } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";
import { apiJson, row, all } from "./helpers";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";

/**
 * SEEING IT PRODUCES SOMETHING — the Kindle surface, against real D1.
 *
 * 12–21 Sep 2026: Simone's daily scan saw Amazon's title flag on The Gift Letter three times and
 * nothing followed: no email (needs_owner with no delivery), an assignment that was a sentence
 * (work_assignments empty), four "quiet" runs that never re-raised an open problem inside Amazon's
 * five-day window. These pin the endpoint half: an assignment is a row created in the same request,
 * a problem carries its deadline and stays open until resolved, needs_owner needs the one question,
 * the delivered id is recorded, and her `[kml_…]` reply lands on the row.
 */

function mail(opts: { from?: string; subject?: string; body?: string }) {
  const body = opts.body ?? "";
  const headers = new Headers({
    from: opts.from ?? "Sequoia <seq.taylor@gmail.com>",
    subject: opts.subject ?? "",
    "authentication-results": "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com",
  });
  const raw = `From: ${opts.from ?? "seq.taylor@gmail.com"}\r\nSubject: ${opts.subject ?? ""}\r\n\r\n${body}`;
  return {
    from: (opts.from ?? "seq.taylor@gmail.com").replace(/.*<|>.*/g, ""),
    to: "simone@sequoiataylor.com", headers, raw: new Response(raw).body!, rawSize: new TextEncoder().encode(raw).length,
  };
}

const PROBLEM = {
  disposition: "problem", matter: "title", title_ref: "A1EYXUFGFV7CN6",
  note: "Amazon closed its review of one title's wording; the book stays unpublished until the subtitle is edited and resubmitted.",
  outcome_kind: "acted", action_taken: "Confirmed Draft on the bookshelf. The fix is a subtitle edit I make on her word.",
  needs_owner: true, owner_ask: "Approve the new subtitle. Recommended: A Template for Documenting Family Funds Toward a Home Purchase.",
  due_at: Date.now() + 24 * 3600 * 1000,
};

beforeEach(async () => {
  await env.DB.exec("DELETE FROM kdp_mail_log");
  await env.DB.exec("DELETE FROM work_assignments");
  await env.DB.exec("DELETE FROM boss_inbound_mail");
});

describe("an assignment is a row, not a sentence", () => {
  it("refuses 'assigned' without an assign block — the 15/16 Sep defect", async () => {
    const res = await apiJson<any>("/api/kdp/mail", { method: "POST", body: { items: [{ ...PROBLEM, needs_owner: false, owner_ask: undefined, outcome_kind: "assigned", action_taken: "Assigned to Zora for verification." }] } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/assign block/);
    expect((await all(`SELECT id FROM kdp_mail_log`)).length).toBe(0);
    expect((await all(`SELECT id FROM work_assignments`)).length).toBe(0);
  });

  it("creates the work_assignments row in the same request and writes its id on the log row", async () => {
    const res = await apiJson<any>("/api/kdp/mail", {
      method: "POST",
      body: { items: [{ ...PROBLEM, needs_owner: false, owner_ask: undefined, outcome_kind: "assigned", action_taken: "Zora repairs the asset.", assign: { helper_employee_id: "emp_knowledge", what: "Repair the cover", why: "Amazon rejects it; a clean export that passes is the outcome" } }] },
    });
    expect(res.status).toBe(201);
    const item = res.body.data.items[0];
    expect(item.assignment_id).toMatch(/^asg_/);
    const asg = await row<any>(`SELECT owner_employee_id, helper_employee_id, state, what FROM work_assignments WHERE id = ?`, item.assignment_id);
    expect(asg).toMatchObject({ owner_employee_id: "emp_chief", helper_employee_id: "emp_knowledge", state: "open", what: "Repair the cover" });
    const log = await row<any>(`SELECT assignment_id FROM kdp_mail_log WHERE id = ?`, item.id);
    expect(log?.assignment_id).toBe(item.assignment_id);
  });
});

describe("a problem stays loud until it ends", () => {
  it("needs_owner without owner_ask is refused; with it, the row carries due_at, matter and the ask", async () => {
    const bad = await apiJson<any>("/api/kdp/mail", { method: "POST", body: { items: [{ ...PROBLEM, owner_ask: undefined }] } });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toMatch(/owner_ask/);
    const res = await apiJson<any>("/api/kdp/mail", { method: "POST", body: { items: [PROBLEM] } });
    expect(res.status).toBe(201);
    const id = res.body.data.items[0].id;
    const r = await row<any>(`SELECT needs_owner, due_at, matter, owner_ask, resolved_at, delivered_message_id FROM kdp_mail_log WHERE id = ?`, id);
    expect(r).toMatchObject({ needs_owner: 1, due_at: PROBLEM.due_at, matter: "title", resolved_at: null, delivered_message_id: null });
    expect(r.owner_ask).toContain("Approve the new subtitle");
  });

  it("a problem without a matter is refused", async () => {
    const res = await apiJson<any>("/api/kdp/mail", { method: "POST", body: { items: [{ ...PROBLEM, matter: undefined }] } });
    expect(res.status).toBe(400);
  });

  it("is listed as open, the delivered id is recorded, a nag is stamped, and resolve closes it and its assignment", async () => {
    const res = await apiJson<any>("/api/kdp/mail", {
      method: "POST",
      body: { items: [{ ...PROBLEM, needs_owner: false, owner_ask: undefined, outcome_kind: "assigned", assign: { helper_employee_id: "emp_knowledge", what: "x", why: "y" } }] },
    });
    const { id, assignment_id } = res.body.data.items[0];
    let open = await apiJson<any>("/api/kdp/mail/open");
    expect(open.body.data.open.map((o: any) => o.id)).toEqual([id]);

    const noId = await apiJson<any>(`/api/kdp/mail/${id}/delivered`, { method: "POST", body: { kind: "ask" } });
    expect(noId.status).toBe(400);
    await apiJson<any>(`/api/kdp/mail/${id}/delivered`, { method: "POST", body: { kind: "ask", message_id: "re_abc123" } });
    await apiJson<any>(`/api/kdp/mail/${id}/delivered`, { method: "POST", body: { kind: "nag", message_id: "re_nag456" } });
    const r = await row<any>(`SELECT delivered_message_id, nagged_at FROM kdp_mail_log WHERE id = ?`, id);
    expect(r.delivered_message_id).toBe("re_abc123");
    expect(r.nagged_at).toBeGreaterThan(0);

    const bad = await apiJson<any>(`/api/kdp/mail/${id}/resolve`, { method: "POST", body: {} });
    expect(bad.status).toBe(400);
    const done = await apiJson<any>(`/api/kdp/mail/${id}/resolve`, { method: "POST", body: { resolution: "Resubmitted with her wording; bookshelf says in_review." } });
    expect(done.status).toBe(200);
    open = await apiJson<any>("/api/kdp/mail/open");
    expect(open.body.data.open).toEqual([]);
    const asg = await row<any>(`SELECT state, outcome FROM work_assignments WHERE id = ?`, assignment_id);
    expect(asg.state).toBe("done");
    expect(asg.outcome).toContain("in_review");
  });
});

describe("her reply on the [kml_…] thread lands on the row", () => {
  it("'approved' is recorded with the mail that carried it; a stranger's is not; a hold is her words", async () => {
    const res = await apiJson<any>("/api/kdp/mail", { method: "POST", body: { items: [PROBLEM] } });
    const id = res.body.data.items[0].id;

    const stranger = await handleBossInboundMail(mail({ from: "attacker@example.com", subject: `Re: #simone [${id}] The Gift Letter — one decision`, body: "approved" }), env as never);
    expect(stranger.outcome).not.toBe("KDP_ANSWERED");
    expect((await row<any>(`SELECT owner_answer FROM kdp_mail_log WHERE id = ?`, id)).owner_answer).toBeNull();

    const hers = await handleBossInboundMail(mail({ subject: `Re: #simone [${id}] The Gift Letter — one decision`, body: "approved" }), env as never);
    expect(hers.outcome).toBe("KDP_ANSWERED");
    const r = await row<any>(`SELECT owner_answer, answered_at, answer_mail_id FROM kdp_mail_log WHERE id = ?`, id);
    expect(r.owner_answer).toBe("approved");
    expect(r.answered_at).toBeGreaterThan(0);
    expect(r.answer_mail_id).toMatch(/^iml_/);
    expect((await row<any>(`SELECT COUNT(*) AS n FROM tasks WHERE created_at >= ?`, r.answered_at - 5000)).n).toBe(0);

    const held = await handleBossInboundMail(mail({ subject: `Re: [${id}]`, body: "hold - I want a different subtitle, let me think" }), env as never);
    expect(held.outcome).toBe("KDP_ANSWERED");
    expect((await row<any>(`SELECT owner_answer FROM kdp_mail_log WHERE id = ?`, id)).owner_answer).toMatch(/^held: /);
  });
});
