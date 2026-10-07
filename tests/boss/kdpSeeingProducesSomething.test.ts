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

    // HER REAL REPLY SHAPE (21 Sep 2026): "approved." above her signature and the quoted thread.
    // Read as the whole message it was "her own wording" — and that would have been typed into a
    // subtitle. Only her own words are judged.
    const gmail = "approved.\r\n\r\n*- Sequoia Taylor*\r\n*www.sequoiataylor.com* <http://www.sequoiataylor.com/>\r\n*901-355-1050 <901-355-1050> (mobile)*\r\n\r\nOn Mon, Sep 21, 2026 at 5:32\u202fPM Simone · Boss OS <simone@sequoiataylor.com>\r\nwrote:\r\n\r\n> Amazon flagged The Gift Letter for repetitive terms.\r\n> What I need from you: Approve the new subtitle.\r\n";
    await env.DB.prepare(`UPDATE kdp_mail_log SET owner_answer = NULL, answered_at = NULL WHERE id = ?`).bind(id).run();
    const real = await handleBossInboundMail(mail({ subject: `Re: #simone [${id}] The Gift Letter — one decision`, body: gmail }), env as never);
    expect(real.outcome).toBe("KDP_ANSWERED");
    expect((await row<any>(`SELECT owner_answer FROM kdp_mail_log WHERE id = ?`, id)).owner_answer).toBe("approved");
    await env.DB.prepare(`UPDATE kdp_mail_log SET owner_answer = NULL, answered_at = NULL WHERE id = ?`).bind(id).run();
    const wording = await handleBossInboundMail(mail({ subject: `Re: [${id}]`, body: "Use: A Better Subtitle Here\n\nOn Mon, Sep 21, 2026 at 5:32 PM Simone <simone@sequoiataylor.com> wrote:\n> quoted" }), env as never);
    expect(wording.outcome).toBe("KDP_ANSWERED");
    expect((await row<any>(`SELECT owner_answer FROM kdp_mail_log WHERE id = ?`, id)).owner_answer).toBe("Use: A Better Subtitle Here");

    const held = await handleBossInboundMail(mail({ subject: `Re: [${id}]`, body: "hold - I want a different subtitle, let me think" }), env as never);
    expect(held.outcome).toBe("KDP_ANSWERED");
    expect((await row<any>(`SELECT owner_answer FROM kdp_mail_log WHERE id = ?`, id)).owner_answer).toMatch(/^held: /);
  });
});

describe("work goes only to a seat that can do it, and an ask is never a task (7 Oct 2026)", () => {
  const KDP_EDIT = {
    helper_employee_id: "emp_knowledge",
    what: "Edit The Gift Letter (Down Payment) KDP Details tab: change subtitle to the approved wording, save, and publish",
    why: "The fix moves the title from Draft to Live",
  };

  it("refuses the 4 Oct assignment of a KDP edit to Zora — on /mail and on /assign — and creates no row", async () => {
    const viaMail = await apiJson<any>("/api/kdp/mail", { method: "POST", body: { items: [{ ...PROBLEM, needs_owner: false, owner_ask: undefined, outcome_kind: "assigned", action_taken: "Assigned to Zora.", assign: KDP_EDIT }] } });
    expect(viaMail.status).toBe(400);
    expect(JSON.stringify(viaMail.body)).toMatch(/only Simone's own run can do it/);
    const viaAssign = await apiJson<any>("/api/kdp/assign", { method: "POST", body: KDP_EDIT });
    expect(viaAssign.status).toBe(400);
    expect(JSON.stringify(viaAssign.body)).toMatch(/kdp:retitle/);
    expect((await all(`SELECT id FROM work_assignments`)).length).toBe(0);
    expect((await all(`SELECT id FROM kdp_mail_log`)).length).toBe(0);
  });

  it("still lets Simone hand a colleague an asset job", async () => {
    const res = await apiJson<any>("/api/kdp/assign", { method: "POST", body: { helper_employee_id: "emp_knowledge", what: "Repair the cover export and hand me the file", why: "Amazon rejects the current one" } });
    expect(res.status).toBe(201);
  });

  it("refuses an owner_ask that tells her to chase an employee or do the edit herself", async () => {
    for (const ask of [
      "Zora's assignment to edit The Gift Letter is overdue. Can you check the status with Zora or complete the manual edit yourself?",
      "Go to KDP Bookshelf, click Manage title, change the subtitle, save and publish.",
    ]) {
      const res = await apiJson<any>("/api/kdp/mail", { method: "POST", body: { items: [{ ...PROBLEM, owner_ask: ask }] } });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/owner_ask was refused/);
    }
    expect((await all(`SELECT id FROM kdp_mail_log`)).length).toBe(0);
  });

  it("treats In review as progress: no ask about it unless the facts changed", async () => {
    const now = Date.now();
    await env.DB.prepare(`DELETE FROM kdp_titles WHERE title_ref = ?`).bind("A1EYXUFGFV7CN6").run();
    await env.DB.prepare(`INSERT INTO kdp_titles (id, title_ref, label, state, first_seen_at, state_changed_at, updated_at) VALUES (?,?,?,?,?,?,?)`)
      .bind("kdp_A1EYXUFGFV7CN6", "A1EYXUFGFV7CN6", "The Gift Letter (Down Payment)", "in_review", now, now, now).run();
    const quiet = await apiJson<any>("/api/kdp/mail", { method: "POST", body: { items: [PROBLEM] } });
    expect(quiet.status).toBe(400);
    expect(JSON.stringify(quiet.body)).toMatch(/In review/);
    const changed = await apiJson<any>("/api/kdp/mail", { method: "POST", body: { items: [{ ...PROBLEM, facts_changed: "Amazon asked for documentation of the content" }] } });
    expect(changed.status).toBe(201);
  });

  it("refuses a deadline in the wrong year (27 Sep 2026 filed one due 30 Sep 2024)", async () => {
    const res = await apiJson<any>("/api/kdp/mail", { method: "POST", body: { items: [{ ...PROBLEM, due_at: 1727740799000 }] } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/30 days in the past/);
  });
});
