/**
 * THE DUTY LANE — "is there a lane for me to ask for a new duty to my Boss OS agents?" (21 Sep 2026)
 *
 * The whole arc against the real mailbox handler, the real drafter, the real judgement call and
 * the real decision path: her `#<seat> new duty` mail comes back as the full draft with every
 * refusal; `approved` on the thread creates exactly one duty through the approval loop; `changes:`
 * redrafts and withdraws the earlier card; `your call` in the request creates at once and records
 * the phrase; a stranger's identical mail is refused with no row; a duty whose script does not
 * exist on her Mac is a NAMED STOP and creates nothing; the screen door files the same thing.
 * `validate:duty-birth` pins the structural half — one writer, two roads to it — over the source.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, row } from "./helpers";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { dutyRequestIn, readDutyReply, pickSlot, overridesFrom, dutyProblems, INSTALLED_LOCAL_JOBS, draftTokenIn } from "../../src/shared/boss/duties/lane.mjs";
import { DELIVERABLE_KEYS } from "../../src/worker/boss/duties/author";

function mail(opts: { from?: string; subject?: string; body?: string; dmarc?: string; messageId?: string; inReplyTo?: string; references?: string }) {
  const body = opts.body ?? "";
  const from = opts.from ?? "Sequoia <seq.taylor@gmail.com>";
  const headers = new Headers({
    from,
    subject: opts.subject ?? "",
    "authentication-results": opts.dmarc ?? "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com",
    "message-id": opts.messageId ?? `<${Math.random().toString(36).slice(2)}@mail.gmail.com>`,
    ...(opts.inReplyTo ? { "in-reply-to": opts.inReplyTo } : {}),
    ...(opts.references ? { references: opts.references } : {}),
  });
  const raw = `From: ${from}\r\nSubject: ${opts.subject ?? ""}\r\n\r\n${body}`;
  return {
    from: from.replace(/.*<|>.*/g, ""), to: "boss@sequoiataylor.com", headers,
    raw: new Response(raw).body!, rawSize: new TextEncoder().encode(raw).length,
  };
}

const AGENT_PHRASE = "every friday, write me a short report on what changed in the private markets this week";
const LOCAL_PHRASE = "every friday, read my inbox and tell me which LPs went quiet";

const dutyCount = async () => (await row<any>(`SELECT COUNT(*) AS n FROM standing_duties WHERE json_extract(task_input, '$.provenance') IS NOT NULL`)).n as number;

/** Her request, then the thread her client would build on the reply. */
async function request(subject: string, body: string) {
  const messageId = `<req-${Math.random().toString(36).slice(2)}@mail.gmail.com>`;
  const res = await handleBossInboundMail(mail({ subject, body, messageId }), env as never);
  return { res, messageId, thread: { inReplyTo: `<reply-${messageId.slice(1)}`, references: `${messageId} <reply-${messageId.slice(1)}` } };
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM standing_duties WHERE json_extract(task_input, '$.provenance') IS NOT NULL");
  await env.DB.exec("DELETE FROM duty_drafts");
  await env.DB.exec("DELETE FROM judgement_calls WHERE resume_kind = 'duty_created'");
  await env.DB.exec("DELETE FROM approvals WHERE kind = 'judgement_call' AND payload LIKE '%duty_created%'");
  await env.DB.exec("DELETE FROM boss_inbound_mail");
});

describe("the grammar, pure", () => {
  const roster = [
    { id: "emp_chief", name: "Simone", role: "Chief of Staff" },
    { id: "emp_relationship", name: "Monique", role: "Director of Relationships" },
  ];
  it("#<seat> new duty <words> names the seat and keeps her words", () => {
    const r = dutyRequestIn("#monique new duty", "every friday check the sheet", roster) as any;
    expect(r.seat.id).toBe("emp_relationship");
    expect(r.phrase).toBe("every friday check the sheet");
    expect(r.routedBy).toBeNull();
    expect(r.preApproved).toBeNull();
  });
  it("#simone new duty monique … lets the Chief of Staff route it; #monique new duty camille … does not", () => {
    const r = dutyRequestIn("#simone new duty monique every friday check the sheet", "", roster) as any;
    expect(r.seat.id).toBe("emp_relationship");
    expect(r.routedBy.id).toBe("emp_chief");
    expect(r.phrase).toBe("every friday check the sheet");
    const notRouted = dutyRequestIn("#monique new duty camille's list every friday", "", roster) as any;
    expect(notRouted.seat.id).toBe("emp_relationship");
    expect(notRouted.routedBy).toBeNull();
  });
  it("an unknown seat is an error, an ordinary mail is null, `your call` is read from the request", () => {
    expect((dutyRequestIn("#nobody new duty x", "", roster) as any).error).toMatch(/no employee/);
    expect(dutyRequestIn("#monique please add the Databricks buyers", "", roster)).toBeNull();
    expect((dutyRequestIn("#monique new duty every friday, your call on the details", "", roster) as any).preApproved).toBe("your call");
  });
  it("the reply reader: approved / changes / held / other", () => {
    expect(readDutyReply("approved").mode).toBe("approved");
    expect(readDutyReply("Approved!").mode).toBe("approved");
    expect(readDutyReply("changes: make it daily at 3pm").text).toBe("make it daily at 3pm");
    expect(readDutyReply("no, not this one").mode).toBe("held");
    expect(readDutyReply("what does this cost?").mode).toBe("other");
    expect(overridesFrom("make it daily at 3pm on the better model")).toMatchObject({ cadence: "daily", local_hour: 15, local_minute: 0, model: "claude-sonnet-4-5-20250929" });
  });
  it("the slot avoids her busy hours and the hours already taken, and says why", () => {
    const s = pickSlot([{ local_hour: 8, cadence: "daily", name: "Something at eight" }], { cadence: "weekly", weekday: 5 });
    expect(s.hour).toBe(13);
    expect(s.why).toMatch(/Something at eight/);
    const free = pickSlot([], { cadence: "weekly", weekday: 1 });
    expect(free.hour).toBe(8);
    expect(free.why).toMatch(/quiet hour/);
    // A weekly duty on a different day does not block the hour.
    expect(pickSlot([{ local_hour: 8, cadence: "weekly", weekday: 2 }], { cadence: "weekly", weekday: 5 }).hour).toBe(8);
  });
  it("the owner ↔ executor ↔ script check refuses what cannot run and passes what can", () => {
    const base = { employee_id: "emp_x", employee_active: true, model: "claude-haiku-4-5-20251001" };
    expect(dutyProblems({ ...base, executor: "agent", delivers: "executive_reports" }, [], DELIVERABLE_KEYS)).toEqual([]);
    expect(dutyProblems({ ...base, executor: "agent", delivers: "nowhere" }, [], DELIVERABLE_KEYS)[0]).toMatch(/land nowhere/);
    expect(dutyProblems({ ...base, executor: "local_job", local_job: "made-up.sh" }, [], DELIVERABLE_KEYS)[0]).toMatch(/NAMED STOP \[NO_SUCH_SCRIPT\]/);
    const installed = INSTALLED_LOCAL_JOBS[0]!;
    expect(dutyProblems({ ...base, executor: "local_job", local_job: installed }, [], DELIVERABLE_KEYS)).toEqual([]);
    expect(dutyProblems({ ...base, executor: "local_job", local_job: installed }, [{ id: "duty_other", name: "Other", local_job: installed }], DELIVERABLE_KEYS)[0]).toMatch(/already belongs/);
    expect(dutyProblems({ ...base, employee_active: false, executor: "agent", delivers: "executive_reports" }, [], DELIVERABLE_KEYS)[0]).toMatch(/not an active employee/);
    expect(dutyProblems({ ...base, model: "", executor: "agent", delivers: "executive_reports" }, [], DELIVERABLE_KEYS)[0]).toMatch(/No model/);
  });
});

describe("the mail door", () => {
  it("her request comes back as the full draft — every field with its reason, the token, and the one line to answer with; nothing is created", async () => {
    const { res } = await request("#camille new duty", AGENT_PHRASE);
    expect(res.outcome).toBe("DUTY_DRAFTED");
    expect(res.taskId).toBeNull();
    expect(res.reply).toMatch(/Here is the duty as I would create it for Camille/);
    expect(res.reply).toMatch(/Name: /);
    expect(res.reply).toMatch(/Owner:\s+Camille/);
    expect(res.reply).toMatch(/Cadence:\s+every Friday at \d\d:\d\d America\/Chicago/);
    expect(res.reply).toMatch(/quiet hour|first quiet hour/);
    expect(res.reply).toMatch(/Executor:\s+an agent/);
    expect(res.reply).toMatch(/Model:\s+Haiku/);
    expect(res.reply).toMatch(/Delivery:\s+executive_reports/);
    expect(res.reply).toMatch(/Reply `approved` to create it, `changes: …` to redraft\./);
    expect(res.reply).toMatch(/— Camille$/);
    expect(draftTokenIn(res.reply!)).toMatch(/^dd_/);

    const draft = await row<any>(`SELECT * FROM duty_drafts`);
    expect(draft.state).toBe("drafted");
    expect(draft.door).toBe("mail");
    expect(draft.intake_kind).toBe("recurring_duty");
    expect(draft.mail_id).toBe(res.mailId);
    expect(draft.judgement_id).toMatch(/^jdg_/);
    const j = await row<any>(`SELECT state, resume_kind FROM judgement_calls WHERE id = ?`, draft.judgement_id);
    expect(j.state).toBe("awaiting");
    expect(j.resume_kind).toBe("duty_created");
    expect(await dutyCount()).toBe(0);
    expect((await row<any>(`SELECT COUNT(*) AS n FROM tasks WHERE employee_id = 'emp_research' AND title LIKE '%new duty%'`)).n).toBe(0);
  });

  it("a draft that cannot run comes back with every refusal verbatim and files nothing in the Inbox", async () => {
    const { res } = await request("#zora new duty", "every monday, tidy the archive and tell me what moved");
    expect(res.outcome).toBe("DUTY_REFUSED");
    expect(res.reply).toMatch(/I have NOT created this duty for Zora/);
    expect(res.reply).toMatch(/Why not:/);
    expect(res.reply).toMatch(/land nowhere/);
    expect(res.reply).toMatch(/Nothing is waiting on you/);
    const draft = await row<any>(`SELECT state, judgement_id, refusals_json FROM duty_drafts`);
    expect(draft.state).toBe("refused");
    expect(draft.judgement_id).toBeNull();
    expect(JSON.parse(draft.refusals_json).length).toBeGreaterThan(0);
    expect((await row<any>(`SELECT COUNT(*) AS n FROM judgement_calls WHERE resume_kind = 'duty_created'`)).n).toBe(0);
  });

  it("A DUTY WHOSE SCRIPT DOES NOT EXIST ON HER MAC IS A NAMED STOP: refused, nothing created, the script named", async () => {
    const { res } = await request("#monique new duty", LOCAL_PHRASE);
    expect(res.outcome).toBe("DUTY_REFUSED");
    expect(res.reply).toMatch(/NAMED STOP \[NO_SUCH_SCRIPT\]/);
    expect(res.reply).toMatch(/every-friday-read-my-inbox[a-z-]*\.sh/);
    expect(res.reply).toMatch(/Executor:\s+a job on your Mac/);
    expect(await dutyCount()).toBe(0);
    expect((await row<any>(`SELECT state FROM duty_drafts`)).state).toBe("refused");
  });

  it("`approved` on the thread creates EXACTLY ONE duty through the approval loop, and the reply names the first run", async () => {
    const { res, thread } = await request("#camille new duty", AGENT_PHRASE);
    const draft = await row<any>(`SELECT id, approval_id FROM duty_drafts`);

    const yes = await handleBossInboundMail(mail({ subject: "Re: #camille new duty", body: "approved", ...thread }), env as never);
    expect(yes.outcome).toBe("DUTY_ANSWERED");
    expect(yes.reply).toMatch(/^Created\./);
    expect(yes.reply).toMatch(/First run: /);
    expect(yes.reply).toMatch(/Team → Duties/);
    expect(yes.taskId).toBeNull();

    expect(await dutyCount()).toBe(1);
    const duty = await row<any>(`SELECT * FROM standing_duties WHERE json_extract(task_input, '$.provenance') IS NOT NULL`);
    expect(duty.employee_id).toBe("emp_research");
    expect(duty.executor).toBe("agent");
    expect(duty.cadence).toBe("weekly");
    expect(duty.weekday).toBe(5);
    const input = JSON.parse(duty.task_input);
    expect(input.requested.model).toBe("claude-haiku-4-5-20251001");
    expect(input.delivers).toBe("executive_reports");
    expect(input.provenance.via).toBe("mail");
    expect(input.provenance.approved_by).toBe("seq.taylor@gmail.com");
    expect(input.provenance.draft_id).toBe(draft.id);
    expect(duty.next_due_at).toBeGreaterThan(Date.now());

    // Through the loop, not around it: the approval is decided by her address and the judgement resumed.
    const apr = await row<any>(`SELECT status, decided_by FROM approvals WHERE id = ?`, draft.approval_id);
    expect(apr.status).toBe("approved");
    expect(apr.decided_by).toBe("seq.taylor@gmail.com");
    expect((await row<any>(`SELECT state FROM judgement_calls WHERE approval_id = ?`, draft.approval_id)).state).toBe("approved");
    const after = await row<any>(`SELECT state, duty_id, first_run_at, approval_mail_id FROM duty_drafts WHERE id = ?`, draft.id);
    expect(after.state).toBe("created");
    expect(after.duty_id).toBe(duty.id);
    expect(after.first_run_at).toBe(duty.next_due_at);
    expect(after.approval_mail_id).toBe(yes.mailId);

    // A second `approved` on the same thread creates nothing more.
    const again = await handleBossInboundMail(mail({ subject: "Re: #camille new duty", body: "approved", ...thread }), env as never);
    expect(again.outcome).toBe("DUTY_ANSWERED");
    expect(again.reply).toMatch(/already created/);
    expect(await dutyCount()).toBe(1);
    expect(res.outcome).toBe("DUTY_DRAFTED");
  });

  it("`changes: …` redrafts with her text as overrides, withdraws the earlier card, and the new draft waits on her", async () => {
    const { thread } = await request("#camille new duty", AGENT_PHRASE);
    const first = await row<any>(`SELECT id, approval_id FROM duty_drafts`);

    const res = await handleBossInboundMail(mail({ subject: "Re: #camille new duty", body: "changes: make it daily at 3pm on the better model", ...thread }), env as never);
    expect(res.outcome).toBe("DUTY_ANSWERED");
    expect(res.reply).toMatch(/^Redrafted with your changes/);
    expect(res.reply).toMatch(/Cadence:\s+daily at 15:00/);
    expect(res.reply).toMatch(/Model:\s+Sonnet/);
    expect(res.reply).toMatch(/Reply `approved` to create it/);

    const rows = (await env.DB.prepare(`SELECT id, state, supersedes, draft_json FROM duty_drafts ORDER BY created_at`).all<any>()).results!;
    expect(rows).toHaveLength(2);
    expect(rows[0].state).toBe("redrafted");
    expect(rows[1].state).toBe("drafted");
    expect(rows[1].supersedes).toBe(first.id);
    const d = JSON.parse(rows[1].draft_json);
    expect(d.cadence).toBe("daily");
    expect(d.local_hour).toBe(15);
    expect(d.model).toContain("sonnet");
    expect(d.task_prompt).toMatch(/Changes: make it daily at 3pm/);
    // The first card is out of her Inbox; the second is in it.
    expect((await row<any>(`SELECT status FROM approvals WHERE id = ?`, first.approval_id)).status).toBe("rejected");
    expect((await row<any>(`SELECT COUNT(*) AS n FROM judgement_calls WHERE resume_kind = 'duty_created' AND state = 'awaiting'`)).n).toBe(1);
    expect(await dutyCount()).toBe(0);

    // Her `approved` to the redraft (same thread) creates the changed duty, once.
    const yes = await handleBossInboundMail(mail({ subject: "Re: #camille new duty", body: "approved", ...thread }), env as never);
    expect(yes.reply).toMatch(/^Created\./);
    expect(await dutyCount()).toBe(1);
    expect((await row<any>(`SELECT cadence, local_hour FROM standing_duties WHERE json_extract(task_input, '$.provenance') IS NOT NULL`)).local_hour).toBe(15);
  });

  it("`your call` in the ORIGINAL request creates it without waiting, tells her, and records the phrase", async () => {
    const { res } = await request("#camille new duty", `${AGENT_PHRASE} — your call on the details`);
    expect(res.outcome).toBe("DUTY_CREATED");
    expect(res.reply).toMatch(/^Created — you said "your call"/);
    expect(res.reply).toMatch(/First run: /);
    expect(res.reply).toMatch(/Nothing is waiting on you/);
    expect(await dutyCount()).toBe(1);
    const duty = await row<any>(`SELECT task_input FROM standing_duties WHERE json_extract(task_input, '$.provenance') IS NOT NULL`);
    const input = JSON.parse(duty.task_input);
    expect(input.provenance.via).toBe("pre_approved");
    expect(input.provenance.pre_approved_phrase).toBe("your call");
    expect(input.authored_from).toMatch(/pre-approved in the request \("your call"\)/);
    const draft = await row<any>(`SELECT state, pre_approved_phrase, judgement_id, approved_by FROM duty_drafts`);
    expect(draft.state).toBe("created");
    expect(draft.pre_approved_phrase).toBe("your call");
    expect(draft.judgement_id).toBeNull();
    expect(draft.approved_by).toBe("seq.taylor@gmail.com");
    expect((await row<any>(`SELECT COUNT(*) AS n FROM judgement_calls WHERE resume_kind = 'duty_created'`)).n).toBe(0);
  });

  it("`your call` in a LATER message is not a pre-approval: it is a note, and nothing is created", async () => {
    const { thread } = await request("#camille new duty", AGENT_PHRASE);
    const res = await handleBossInboundMail(mail({ subject: "Re: #camille new duty", body: "your call", ...thread }), env as never);
    expect(res.reply).toMatch(/^Noted on/);
    expect(await dutyCount()).toBe(0);
    expect((await row<any>(`SELECT state FROM duty_drafts`)).state).toBe("drafted");
  });

  it("`your call` on a duty that cannot run is still refused — pre-approval never creates an inert duty", async () => {
    const { res } = await request("#monique new duty", `${LOCAL_PHRASE}. your call.`);
    expect(res.outcome).toBe("DUTY_REFUSED");
    expect(res.reply).toMatch(/NAMED STOP \[NO_SUCH_SCRIPT\]/);
    expect(await dutyCount()).toBe(0);
  });

  it("ANOTHER SENDER IS REFUSED: a perfect request, and a perfect `approved`, from anyone else create nothing and get no reply", async () => {
    const stranger = await handleBossInboundMail(mail({ from: "Scooter <scooter@example.com>", subject: "#camille new duty", body: `${AGENT_PHRASE} your call` }), env as never);
    expect(stranger.outcome).toBe("REFUSED_SENDER");
    expect(stranger.reply).toBeNull();
    expect((await row<any>(`SELECT COUNT(*) AS n FROM duty_drafts`)).n).toBe(0);

    const { thread } = await request("#camille new duty", AGENT_PHRASE);
    const draft = await row<any>(`SELECT id FROM duty_drafts`);
    const forged = await handleBossInboundMail(mail({ from: "Scooter <scooter@example.com>", subject: "Re: #camille new duty", body: `approved [${draft.id}]`, ...thread }), env as never);
    expect(forged.outcome).toBe("REFUSED_SENDER");
    expect(forged.reply).toBeNull();
    expect(await dutyCount()).toBe(0);
    expect((await row<any>(`SELECT state FROM duty_drafts`)).state).toBe("drafted");

    const unproven = await handleBossInboundMail(mail({ subject: "Re: #camille new duty", body: "approved", dmarc: "mx.cloudflare.net; dmarc=fail", ...thread }), env as never);
    expect(unproven.outcome).toBe("REFUSED_SENDER");
    expect(await dutyCount()).toBe(0);
  });

  it("`no` holds it: the card is sent back, nothing is created, and a later `approved` cannot revive it", async () => {
    const { thread } = await request("#camille new duty", AGENT_PHRASE);
    const draft = await row<any>(`SELECT approval_id FROM duty_drafts`);
    const res = await handleBossInboundMail(mail({ subject: "Re: #camille new duty", body: "no, not this one", ...thread }), env as never);
    expect(res.reply).toMatch(/^Held\./);
    expect((await row<any>(`SELECT state FROM duty_drafts`)).state).toBe("held");
    expect((await row<any>(`SELECT status FROM approvals WHERE id = ?`, draft.approval_id)).status).toBe("rejected");
    const late = await handleBossInboundMail(mail({ subject: "Re: #camille new duty", body: "approved", ...thread }), env as never);
    expect(late.reply).toMatch(/was held/);
    expect(await dutyCount()).toBe(0);
  });

  it("the token alone finds the draft when the thread headers are gone (a forward from her phone)", async () => {
    const { res } = await request("#camille new duty", AGENT_PHRASE);
    const token = draftTokenIn(res.reply!);
    const yes = await handleBossInboundMail(mail({ subject: "Fwd: duty", body: `approved [${token}]` }), env as never);
    expect(yes.outcome).toBe("DUTY_ANSWERED");
    expect(yes.reply).toMatch(/^Created\./);
    expect(await dutyCount()).toBe(1);
  });

  it("#simone new duty camille … routes it: Camille owns it, Simone signs the reply", async () => {
    const { res } = await request("#simone new duty camille", AGENT_PHRASE);
    expect(res.outcome).toBe("DUTY_DRAFTED");
    expect(res.reply).toMatch(/Owner:\s+Camille \(routed by Simone\)/);
    expect(res.reply).toMatch(/— Simone$/);
    expect(res.employeeId).toBe("emp_research");
    expect((await row<any>(`SELECT employee_id, routed_by FROM duty_drafts`)).routed_by).toBe("emp_chief");
  });

  it("the verb with no seat, or no words, is answered and nothing is drafted or admitted", async () => {
    const nobody = await handleBossInboundMail(mail({ subject: "#nobody new duty", body: AGENT_PHRASE }), env as never);
    expect(nobody.outcome).toBe("DUTY_NOT_UNDERSTOOD");
    expect(nobody.reply).toMatch(/no employee with the tag #nobody/);
    expect(nobody.taskId).toBeNull();
    const empty = await handleBossInboundMail(mail({ subject: "#camille new duty", body: "" }), env as never);
    expect(empty.outcome).toBe("DUTY_NOT_UNDERSTOOD");
    expect(empty.reply).toMatch(/did not say what it is/);
    expect(empty.taskId).toBeNull();
    expect((await row<any>(`SELECT COUNT(*) AS n FROM duty_drafts`)).n).toBe(0);
  });

  it("an ordinary #camille instruction is ordinary work, exactly as before", async () => {
    const res = await handleBossInboundMail(mail({ subject: "#camille question", body: "Which of my properties grew fastest this month?" }), env as never);
    expect(res.outcome).toBe("ROUTED");
    expect(res.taskId).toBeTruthy();
    expect((await row<any>(`SELECT COUNT(*) AS n FROM duty_drafts`)).n).toBe(0);
  });
});

describe("the Inbox button takes the same road", () => {
  it("Approve on the card creates the duty through the one writer, with the Inbox as provenance", async () => {
    await request("#camille new duty", AGENT_PHRASE);
    const draft = await row<any>(`SELECT id, approval_id FROM duty_drafts`);
    const decided = await apiJson(`/api/approvals/${draft.approval_id}/decide`, { method: "POST", body: { decision: "approved" } });
    expect(decided.status).toBe(200);
    expect(decided.body.data.execution.status).toBe("executed");
    expect(decided.body.data.execution.detail.resumed).toMatch(/^Created\./);
    expect(await dutyCount()).toBe(1);
    const input = JSON.parse((await row<any>(`SELECT task_input FROM standing_duties WHERE json_extract(task_input, '$.provenance') IS NOT NULL`)).task_input);
    expect(input.provenance.via).toBe("mail"); // the draft came in by mail; the yes came from the button
    expect(input.provenance.approved_by).toBe("boss");
    expect((await row<any>(`SELECT state, duty_id FROM duty_drafts WHERE id = ?`, draft.id)).state).toBe("created");
  });

  it("Send back on the card holds the draft row", async () => {
    await request("#camille new duty", AGENT_PHRASE);
    const draft = await row<any>(`SELECT id, approval_id FROM duty_drafts`);
    await apiJson(`/api/approvals/${draft.approval_id}/decide`, { method: "POST", body: { decision: "rejected", note: "not yet" } });
    expect((await row<any>(`SELECT state, held_note FROM duty_drafts WHERE id = ?`, draft.id))).toMatchObject({ state: "held", held_note: "not yet" });
    expect(await dutyCount()).toBe(0);
  });
});

describe("the screen door", () => {
  it("preview shows the draft and the letter without filing anything", async () => {
    const res = await apiJson(`/api/employees/duties/draft`, { method: "POST", body: { employee_id: "emp_research", phrase: AGENT_PHRASE, preview: true } });
    expect(res.status).toBe(200);
    expect(res.body.data.draft.executor).toBe("agent");
    expect(res.body.data.draft.refusals).toEqual([]);
    expect(res.body.data.letter).toMatch(/Reply `approved` to create it/);
    expect((await row<any>(`SELECT COUNT(*) AS n FROM duty_drafts`)).n).toBe(0);
    expect((await row<any>(`SELECT COUNT(*) AS n FROM judgement_calls WHERE resume_kind = 'duty_created'`)).n).toBe(0);
  });

  it("Create files exactly what the mail door files: a duty_drafts row, a duty_created card, nothing on the schedule until Approve", async () => {
    const res = await apiJson(`/api/employees/duties/draft`, { method: "POST", body: { employee_id: "emp_research", phrase: AGENT_PHRASE } });
    expect(res.status).toBe(201);
    expect(res.body.data.state).toBe("drafted");
    expect(res.body.data.judgement_id).toMatch(/^jdg_/);
    const draft = await row<any>(`SELECT door, state, judgement_id, approval_id FROM duty_drafts`);
    expect(draft.door).toBe("screen");
    expect(draft.judgement_id).toBe(res.body.data.judgement_id);
    expect(await dutyCount()).toBe(0);

    const list = await apiJson(`/api/employees/duties/drafts`);
    expect(list.body.data.drafts).toHaveLength(1);
    expect(list.body.data.drafts[0].employee_name).toBe("Camille");

    const decided = await apiJson(`/api/approvals/${draft.approval_id}/decide`, { method: "POST", body: { decision: "approved" } });
    expect(decided.body.data.execution.status).toBe("executed");
    expect(await dutyCount()).toBe(1);
    expect(JSON.parse((await row<any>(`SELECT task_input FROM standing_duties WHERE json_extract(task_input, '$.provenance') IS NOT NULL`)).task_input).provenance.via).toBe("inbox");
  });

  it("a refused draft is refused at the door with the reasons and files nothing", async () => {
    const res = await apiJson(`/api/employees/duties/draft`, { method: "POST", body: { employee_id: "emp_relationship", phrase: LOCAL_PHRASE } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/NAMED STOP \[NO_SUCH_SCRIPT\]/);
    expect((await row<any>(`SELECT state FROM duty_drafts`)).state).toBe("refused");
    expect((await row<any>(`SELECT COUNT(*) AS n FROM judgement_calls WHERE resume_kind = 'duty_created'`)).n).toBe(0);
  });

  it("the roster carries each duty's executor, last run, next run and last outcome", async () => {
    const res = await apiJson(`/api/employees/roster`);
    expect(res.status).toBe(200);
    const withDuties = res.body.data.roster.find((e: any) => e.duties.length > 0);
    expect(withDuties).toBeTruthy();
    const d = withDuties.duties[0];
    for (const k of ["executor", "last_run_at", "next_due_at", "last_outcome", "last_failure_reason", "state"]) expect(k in d).toBe(true);
  });
});
