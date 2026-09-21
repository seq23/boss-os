/**
 * THE REPO-CHANGE LANE — Plan B, 20 September 2026.
 *
 * The whole arc, end to end against the real handler, the real intake and the real routes:
 * her `#danielle` mail becomes a repo change; a stranger's identical mail becomes nothing; the plan
 * cannot be claimed twice; BUILD cannot start without her reply; LAND cannot start without a
 * recorded green AND her reply; and the queue consumer parks the task instead of sending it to a
 * cloud rung. `validate:repo-lane` runs the pure guards over fixtures as well, so a rule that only
 * this file pins would still be caught if this file were skipped.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { apiJson, row } from "./helpers";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { canEnterBuild, canLand, claimablePhase, parseRepoChange, tokenIn, changeToken, readReply, needsPreview, isForced, APPROVED_DEFAULTS_TEXT } from "../../src/shared/boss/repoChange/lane.mjs";

const FOLDER = "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv";

function mail(opts: { from?: string; subject?: string; body?: string; dmarc?: string; messageId?: string; references?: string }) {
  const body = opts.body ?? "";
  const from = opts.from ?? "Sequoia <seq.taylor@gmail.com>";
  const headers = new Headers({
    from,
    subject: opts.subject ?? "",
    "authentication-results": opts.dmarc ?? "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com",
    "message-id": opts.messageId ?? `<${Math.random().toString(36).slice(2)}@mail.gmail.com>`,
    ...(opts.references ? { references: opts.references, "in-reply-to": opts.references } : {}),
  });
  const raw = `From: ${from}\r\nSubject: ${opts.subject ?? ""}\r\n\r\n${body}`;
  return {
    from: from.replace(/.*<|>.*/g, ""), to: "boss@sequoiataylor.com", headers,
    raw: new Response(raw).body!, rawSize: new TextEncoder().encode(raw).length,
  };
}

const DEVICE = "mac-test";
const claim = (id: string) => apiJson(`/api/repo-changes/${id}/claim`, { method: "POST", body: { device_id: DEVICE } });

beforeEach(async () => {
  await env.DB.exec("DELETE FROM repo_changes");
  await env.DB.exec("DELETE FROM boss_inbound_mail");
});

describe("her sentence, read as a repo change", () => {
  it("names a grid repo and a Drive folder; ignores an ordinary instruction", () => {
    const p = parseRepoChange(`#danielle update WPP-llm from ${FOLDER} — new hero copy`) as any;
    expect(p.repo).toBe("WPP-llm");
    expect(p.property).toBe("virtual_agency");
    expect(p.drive_folder).toBe("1AbCdEfGhIjKlMnOpQrStUv");
    expect(parseRepoChange("#danielle have a look at the dashboard")).toBeNull();
    // Folder alone is enough — the package can name the repo.
    expect((parseRepoChange(`#danielle ${FOLDER}`) as any).drive_folder).toBeTruthy();
  });
  it("refuses a West Peek repo with the grid's own reason", () => {
    const p = parseRepoChange("#danielle change the hero on join-west-peek-main") as any;
    expect(p.excluded.repo).toBe("join-west-peek-main");
    expect(p.excluded.why).toMatch(/West Peek/);
  });
  it("does not read local-guides-generator as its longer neighbour", () => {
    expect((parseRepoChange("#danielle fix local-guides-citation-velocity") as any).repo).toBe("local-guides-citation-velocity");
    expect((parseRepoChange("#danielle fix local-guides-generator") as any).repo).toBe("local-guides-generator");
  });
  it("the token survives a Re: and a forward", () => {
    expect(tokenIn(`Re: #danielle plan for WPP-llm ${changeToken("rc_abc123")} — 2 questions`)).toBe("rc_abc123");
    expect(tokenIn("no token here")).toBeNull();
  });
});

describe("the mail opens a repo change, and only for her", () => {
  it("her #danielle mail becomes a queued repository task with a plan-phase row", async () => {
    const res = await handleBossInboundMail(mail({ subject: "#danielle site refresh", body: `Please update WPP-llm using the package at ${FOLDER}. Swap the hero and add the new team section.` }), env as never);
    expect(res.outcome).toBe("ROUTED");
    expect(res.taskId).toBeTruthy();
    const task = await row<any>(`SELECT status, intake_kind, employee_id, input FROM tasks WHERE id = ?`, res.taskId);
    expect(task.status).toBe("queued");
    expect(task.intake_kind).toBe("repository");
    expect(task.employee_id).toBe("emp_repo");
    const input = JSON.parse(task.input);
    expect(input.repo_change.repo).toBe("WPP-llm");
    const rc = await row<any>(`SELECT * FROM repo_changes WHERE task_id = ?`, res.taskId);
    expect(rc.phase).toBe("plan");
    expect(rc.drive_folder).toBe("1AbCdEfGhIjKlMnOpQrStUv");
    expect(rc.instruction).toContain("Swap the hero");
    expect(rc.mail_id).toBe(res.mailId);
  });

  it("SCOOTER CANNOT USE THIS LANE: a perfect #danielle mail from anyone else is refused and opens nothing", async () => {
    const before = (await row<any>(`SELECT COUNT(*) AS n FROM tasks`)).n;
    const res = await handleBossInboundMail(mail({ from: "Scooter <scooter@example.com>", subject: "#danielle site refresh", body: `Update WPP-llm from ${FOLDER}` }), env as never);
    expect(res.outcome).toBe("REFUSED_SENDER");
    expect(res.taskId).toBeNull();
    expect(res.reply).toBeNull();
    expect((await row<any>(`SELECT COUNT(*) AS n FROM repo_changes`)).n).toBe(0);
    expect((await row<any>(`SELECT COUNT(*) AS n FROM tasks`)).n).toBe(before);
  });

  it("her address WITHOUT a DMARC pass is refused the same way", async () => {
    const res = await handleBossInboundMail(mail({ subject: "#danielle refresh", body: `Update WPP-llm from ${FOLDER}`, dmarc: "mx.cloudflare.net; dmarc=fail" }), env as never);
    expect(res.outcome).toBe("REFUSED_SENDER");
    expect((await row<any>(`SELECT COUNT(*) AS n FROM repo_changes`)).n).toBe(0);
  });

  it("a West Peek repo is refused with the reason, and no work opens", async () => {
    const res = await handleBossInboundMail(mail({ subject: "#danielle hero", body: "Change the hero on join-west-peek-main please." }), env as never);
    expect(res.outcome).toBe("NOT_ADMITTED");
    expect(res.taskId).toBeNull();
    expect(res.reply).toMatch(/out of scope for Danielle/);
    expect(res.reply).toMatch(/West Peek/);
  });

  it("an ordinary #danielle instruction is ordinary work, exactly as before", async () => {
    const res = await handleBossInboundMail(mail({ subject: "#danielle question", body: "Which of my sites is slowest to build these days?" }), env as never);
    expect(res.outcome).toBe("ROUTED");
    expect((await row<any>(`SELECT COUNT(*) AS n FROM repo_changes`)).n).toBe(0);
  });
});

describe("the queue parks it for her Mac", () => {
  it("handleTask leaves the task queued and writes the parked event; no cloud rung runs", async () => {
    const res = await handleBossInboundMail(mail({ subject: "#danielle refresh", body: `Update WPP-llm from ${FOLDER}` }), env as never);
    await handleTask(env as never, { taskId: res.taskId!, lane: "ops" } as never);
    const task = await row<any>(`SELECT status FROM tasks WHERE id = ?`, res.taskId);
    expect(task.status).toBe("queued");
    const ev = await row<any>(`SELECT event, detail FROM task_events WHERE task_id = ? AND event = 'parked_for_mac'`, res.taskId);
    expect(ev).toBeTruthy();
    expect(JSON.parse(ev.detail).lane).toBe("repo_change");
  });
});

describe("the phases, and the two facts every landing rests on", () => {
  async function open() {
    const res = await handleBossInboundMail(mail({ subject: "#danielle refresh", body: `Update WPP-llm from ${FOLDER}. New hero.` }), env as never);
    const rc = await row<any>(`SELECT id FROM repo_changes WHERE task_id = ?`, res.taskId);
    return { taskId: res.taskId!, id: rc.id as string };
  }

  it("PLAN is claimable once; the second claim is refused; the plan report needs the email id", async () => {
    const { id } = await open();
    const listed = await apiJson("/api/repo-changes/claimable");
    expect(listed.body.data.claimable.map((c: any) => c.id)).toContain(id);

    const first = await claim(id);
    expect(first.status).toBe(201);
    expect(first.body.data.phase).toBe("plan");
    expect(first.body.data.model).toBe("claude-opus-5");
    const second = await claim(id);
    expect(second.status).toBe(409);

    const noMail = await apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: [], publish_ready: true } });
    expect(noMail.status).toBe(400);
    expect(noMail.body.error ?? JSON.stringify(noMail.body)).toMatch(/ask_message_id/);
    // A plan that does not say whether it is publish-ready is refused: "did not say" must not read as ready.
    const noVerdict = await apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: [], ask_message_id: "re_x" } });
    expect(noVerdict.status).toBe(400);
    expect(noVerdict.body.error ?? "").toMatch(/publish_ready/);
    const notReadyUnnamed = await apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: [], publish_ready: false, ask_message_id: "re_x" } });
    expect(notReadyUnnamed.status).toBe(400);

    const planned = await apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan\n- swap hero", decided: ["CSS: reuse the existing tile"], asks: ["Which headline?"], publish_ready: true, ask_message_id: "re_test_1", written_by: "claude-opus-5" } });
    expect(planned.status).toBe(200);
    expect((await row<any>(`SELECT phase, claimed_at FROM repo_changes WHERE id = ?`, id)).phase).toBe("asking");
    expect((await row<any>(`SELECT claimed_at FROM repo_changes WHERE id = ?`, id)).claimed_at).toBeNull();

    // A TASK WITH AN UNANSWERED ASK CANNOT ENTER BUILD.
    const blocked = await claim(id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error ?? JSON.stringify(blocked.body)).toMatch(/waiting for your reply/);
  });

  it("her reply with the token is the approval: phase becomes build, no new task opens, and BUILD is claimable", async () => {
    const { id, taskId } = await open();
    await claim(id);
    await apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: ["Which headline?"], publish_ready: true, ask_message_id: "re_test_2" } });

    const tasksBefore = (await row<any>(`SELECT COUNT(*) AS n FROM tasks`)).n;
    const reply = await handleBossInboundMail(mail({ subject: `Re: #danielle plan for WPP-llm ${changeToken(id)} — 1 question`, body: "Use 'Agencies, on autopilot.' Go." }), env as never);
    expect(reply.outcome).toBe("PLAN_ANSWERED");
    expect(reply.taskId).toBeNull();
    expect(reply.reply).toMatch(/on the record as the plan approval/);
    expect((await row<any>(`SELECT COUNT(*) AS n FROM tasks`)).n).toBe(tasksBefore);

    const rc = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("build");
    expect(rc.answers_text).toContain("Agencies, on autopilot");
    expect(rc.answered_at).toBeTruthy();
    expect(rc.answer_mail_id).toBe(reply.mailId);
    expect(canEnterBuild(rc).ok).toBe(true);
    const ev = await row<any>(`SELECT event FROM task_events WHERE task_id = ? AND event = 'repo_change_answered'`, taskId);
    expect(ev).toBeTruthy();

    const build = await claim(id);
    expect(build.status).toBe(201);
    expect(build.body.data.phase).toBe("build");
    expect(build.body.data.model).toBe("claude-sonnet-5");
  });

  it("ONE WORD IS THE APPROVAL: a reply of exactly \"approved\" advances the task with every default", async () => {
    const { id } = await open();
    await claim(id);
    await apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: [{ question: "Which headline?", options: ["A", "B"], default: "A" }], publish_ready: true, ask_message_id: "re_test_6" } });
    const reply = await handleBossInboundMail(mail({ subject: `Re: #danielle plan for WPP-llm ${changeToken(id)} — reply "approved"`, body: "approved" }), env as never);
    expect(reply.outcome).toBe("PLAN_ANSWERED");
    expect(reply.reply).toMatch(/takes the recommended default/);
    const rc = await row<any>(`SELECT phase, answers_mode, answers_text FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("build");
    expect(rc.answers_mode).toBe("approved");
    expect(rc.answers_text).toBe(APPROVED_DEFAULTS_TEXT);
    expect((await claim(id)).status).toBe(201);
  });

  it("\"no\" HOLDS the task: phase stays asking, her note is kept, BUILD is not claimable, and a later \"approved\" still works", async () => {
    const { id } = await open();
    await claim(id);
    await apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: [{ question: "Which headline?", default: "A" }], publish_ready: true, ask_message_id: "re_test_7" } });
    const held = await handleBossInboundMail(mail({ subject: `Re: ${changeToken(id)}`, body: "no — the hero copy is wrong, I will send a new package" }), env as never);
    expect(held.outcome).toBe("PLAN_ANSWERED");
    expect(held.reply).toMatch(/^Held\./);
    let rc = await row<any>(`SELECT phase, held_at, held_text, answered_at FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("asking");
    expect(rc.held_at).toBeTruthy();
    expect(rc.held_text).toMatch(/hero copy is wrong/);
    expect(rc.answered_at).toBeNull();
    expect((await claim(id)).status).toBe(409);

    for (const word of ["Not approved.", "changes: swap A for B", "stop"]) {
      await handleBossInboundMail(mail({ subject: `Re: ${changeToken(id)}`, body: word }), env as never);
      expect((await row<any>(`SELECT phase FROM repo_changes WHERE id = ?`, id)).phase).toBe("asking");
    }
    await handleBossInboundMail(mail({ subject: `Re: ${changeToken(id)}`, body: "Approved." }), env as never);
    rc = await row<any>(`SELECT phase, answers_mode FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("build");
    expect(rc.answers_mode).toBe("approved");
  });

  it("readReply: the exact words, and the ones that must not be mistaken for them", () => {
    for (const w of ["approved", "Approved.", "approve", "yes", "go", "Land it!", "ok"]) expect(readReply(w).mode, w).toBe("approved");
    for (const w of ["no", "No thanks", "not approved", "stop", "changes: use B", "hold"]) expect(readReply(w).mode, w).toBe("held");
    for (const w of ["Use B. Go.", "note: use B", "now use B, approved", "approved\nbut use B", "approved to prod"]) expect(readReply(w).mode, w).toBe("answers");
    for (const w of ["preview", "Preview only", "preview first"]) expect(readReply(w).mode, w).toBe("preview");
    for (const w of ["approved to production", "Approved to production.", "force production", "ship it anyway", "land anyway"]) expect(readReply(w).mode, w).toBe("forced");
    expect(readReply("").mode).toBe("empty");
  });

  it("a stranger's reply carrying the token records nothing — the approval is hers alone", async () => {
    const { id } = await open();
    await claim(id);
    await apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: ["Which headline?"], publish_ready: true, ask_message_id: "re_test_3" } });
    const res = await handleBossInboundMail(mail({ from: "Scooter <scooter@example.com>", subject: `Re: #danielle plan ${changeToken(id)}`, body: "Go." }), env as never);
    expect(res.outcome).toBe("REFUSED_SENDER");
    const rc = await row<any>(`SELECT phase, answered_at FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("asking");
    expect(rc.answered_at).toBeNull();
  });

  it("LAND ON GREEN: build → landing → green recorded → land claim → done; and never without the green", async () => {
    const { id, taskId } = await open();
    await claim(id);
    await apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: [], publish_ready: true, ask_message_id: "re_test_4" } });
    await handleBossInboundMail(mail({ subject: `Re: #danielle plan ${changeToken(id)}`, body: "Go." }), env as never);
    await claim(id);
    const built = await apiJson(`/api/repo-changes/${id}/build`, { method: "POST", body: { device_id: DEVICE, branch: "work/hero", pr_url: "https://github.com/seq23/WPP-llm/pull/99", pr_number: 99, proof: { validators: ["npm run validate"], screenshots: 2, links_checked: 3 } } });
    expect(built.status).toBe(200);
    let rc = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("landing");
    expect(claimablePhase(rc)).toBeNull();
    expect((await claim(id)).status).toBe(409);

    // Pending keeps waiting. Green moves to land. The guard says so before and after.
    await apiJson(`/api/repo-changes/${id}/checks`, { method: "POST", body: { state: "pending", detail: "ci: in progress" } });
    rc = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("landing");
    expect(canLand({ ...rc, phase: "land" }).ok).toBe(false);
    expect(canLand({ ...rc, phase: "land" }).why).toMatch(/no recorded green check/);

    const green = await apiJson(`/api/repo-changes/${id}/checks`, { method: "POST", body: { state: "green", detail: "ci: pass, validate: pass" } });
    expect(green.status).toBe(200);
    rc = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("land");
    expect(rc.checks_green_at).toBeTruthy();
    expect(canLand(rc).ok).toBe(true);
    // And the other fact: strip the approval and the same row may not land.
    expect(canLand({ ...rc, answered_at: null, answers_text: null }).ok).toBe(false);
    expect(canLand({ ...rc, answered_at: null, answers_text: null }).why).toMatch(/plan approval/);

    const land = await claim(id);
    expect(land.status).toBe(201);
    expect(land.body.data.model).toBe("claude-haiku-4-5");
    const noProof = await apiJson(`/api/repo-changes/${id}/land`, { method: "POST", body: { device_id: DEVICE, merge_sha: "abc1234" } });
    expect(noProof.status).toBe(400);
    const landed = await apiJson(`/api/repo-changes/${id}/land`, { method: "POST", body: { device_id: DEVICE, merge_sha: "abc1234def", live_proof: { "https://virtualagency-os.com/": 200 }, done_message_id: "re_done_4" } });
    expect(landed.status).toBe(200);
    rc = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("done");
    expect(rc.merge_sha).toBe("abc1234def");
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId)).status).toBe("done");
  });

  it("a red check is a named stop, and only after she was told", async () => {
    const { id } = await open();
    await claim(id);
    await apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: [], publish_ready: true, ask_message_id: "re_test_5" } });
    await handleBossInboundMail(mail({ subject: `Re: ${changeToken(id)}`, body: "Go." }), env as never);
    await claim(id);
    await apiJson(`/api/repo-changes/${id}/build`, { method: "POST", body: { device_id: DEVICE, pr_url: "https://github.com/seq23/WPP-llm/pull/100", pr_number: 100 } });
    const untold = await apiJson(`/api/repo-changes/${id}/checks`, { method: "POST", body: { state: "red", detail: "validate: fail" } });
    expect(untold.status).toBe(400);
    const told = await apiJson(`/api/repo-changes/${id}/checks`, { method: "POST", body: { state: "red", detail: "validate: fail", notified_message_id: "re_red_5" } });
    expect(told.status).toBe(200);
    const rc = await row<any>(`SELECT phase, failure FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("failed");
    expect(rc.failure).toMatch(/red/);
  });

  it("a report from a device that holds no claim is refused", async () => {
    const { id } = await open();
    const res = await apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: "someone-else", plan_text: "# Plan", publish_ready: true, ask_message_id: "x" } });
    expect(res.status).toBe(409);
  });
});


describe("a package that is not publish-ready lands only after she has seen the preview", () => {
  async function open() {
    const res = await handleBossInboundMail(mail({ subject: "#danielle refresh", body: `Update WPP-llm from ${FOLDER}. New team section.` }), env as never);
    const rc = await row<any>(`SELECT id FROM repo_changes WHERE task_id = ?`, res.taskId);
    return { taskId: res.taskId!, id: rc.id as string };
  }
  const NOT_READY = { publish_ready: false, placeholders: ["Team bios for two of four people are not in the package"] };
  async function planned(id: string, verdict: Record<string, unknown> = NOT_READY) {
    await claim(id);
    const r = await apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: [{ question: "Which headline?", default: "A" }], ...verdict, ask_message_id: "re_prev" } });
    expect(r.status).toBe(200);
  }
  async function built(id: string) {
    const c = await claim(id);
    expect(c.status).toBe(201);
    expect(c.body.data.phase).toBe("build");
    return apiJson(`/api/repo-changes/${id}/build`, { method: "POST", body: { device_id: DEVICE, branch: "work/team", pr_url: "https://github.com/seq23/WPP-llm/pull/7", pr_number: 7, proof: { validators: ["npm run validate"], validators_passed: true, screenshots: ["a.png"] } } });
  }

  it("PATH 1 — not ready + plain approved: build → PR → preview → her second approved → land; never land before it", async () => {
    const { id } = await open();
    await planned(id);
    let rc = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, id);
    expect(rc.publish_ready).toBe(0);
    expect(JSON.parse(rc.placeholders_json)).toHaveLength(1);
    expect(needsPreview(rc)).toBe(true);

    // Plain "approved" on a not-ready plan means preview — the reply says so; nothing about production.
    const reply = await handleBossInboundMail(mail({ subject: `Re: ${changeToken(id)}`, body: "approved" }), env as never);
    expect(reply.reply).toMatch(/lands only after you reply "approved" to that/);
    expect(isForced(await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, id))).toBe(false);

    const b = await built(id);
    expect(b.body.data.phase).toBe("preview");
    expect((await claim(id)).body.data.phase).toBe("preview");
    // Green arrives while the preview is being sent: recorded, and STILL no landing.
    await apiJson(`/api/repo-changes/${id}/checks`, { method: "POST", body: { state: "green", detail: "ci: pass" } });
    rc = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("preview");
    expect(rc.checks_green_at).toBeTruthy();
    expect(canLand({ ...rc, phase: "land" }).ok).toBe(false);
    expect(canLand({ ...rc, phase: "land" }).why).toMatch(/needs a preview/);

    const noMail = await apiJson(`/api/repo-changes/${id}/preview`, { method: "POST", body: { device_id: DEVICE, preview_url: "https://abc.wpp-llm.pages.dev" } });
    expect(noMail.status).toBe(400);
    const previewed = await apiJson(`/api/repo-changes/${id}/preview`, { method: "POST", body: { device_id: DEVICE, preview_url: "https://abc.wpp-llm.pages.dev", preview_message_id: "re_preview_1" } });
    expect(previewed.status).toBe(200);
    rc = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("previewing");
    expect(rc.preview_sent_at).toBeTruthy();
    expect((await claim(id)).status).toBe(409);
    // Her own words at the preview are a note; "preview" again sets nothing; only "approved" lands.
    await handleBossInboundMail(mail({ subject: `Re: ${changeToken(id)}`, body: "looks fine but the second bio is thin" }), env as never);
    await handleBossInboundMail(mail({ subject: `Re: ${changeToken(id)}`, body: "preview" }), env as never);
    rc = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("previewing");
    expect(rc.land_approved_at).toBeNull();
    expect(rc.forced_at).toBeNull();

    const second = await handleBossInboundMail(mail({ subject: `Re: #danielle preview ready ${changeToken(id)}`, body: "approved" }), env as never);
    expect(second.reply).toMatch(/approval of the preview is on the record/);
    rc = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("land");
    expect(rc.land_approved_at).toBeGreaterThanOrEqual(rc.preview_sent_at);
    expect(canLand(rc).ok).toBe(true);
    expect(canLand({ ...rc, land_approved_at: rc.preview_sent_at - 1 }).ok).toBe(false);
    const land = await claim(id);
    expect(land.status).toBe(201);
    expect(land.body.data.phase).toBe("land");
    const done = await apiJson(`/api/repo-changes/${id}/land`, { method: "POST", body: { device_id: DEVICE, merge_sha: "deadbeef1", live_proof: {}, done_message_id: "re_done_p" } });
    expect(done.status).toBe(200);
  });

  it("PATH 2 — not ready, preview sent, checks not yet green: her approved moves to landing, and green then lands", async () => {
    const { id } = await open();
    await planned(id);
    await handleBossInboundMail(mail({ subject: `Re: ${changeToken(id)}`, body: "approved" }), env as never);
    await built(id);
    await claim(id);
    await apiJson(`/api/repo-changes/${id}/preview`, { method: "POST", body: { device_id: DEVICE, preview_url: null, preview_message_id: "re_preview_2" } });
    await handleBossInboundMail(mail({ subject: `Re: ${changeToken(id)}`, body: "approved" }), env as never);
    let rc = await row<any>(`SELECT phase FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("landing");
    await apiJson(`/api/repo-changes/${id}/checks`, { method: "POST", body: { state: "green", detail: "ci: pass" } });
    rc = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("land");
    expect(canLand(rc).ok).toBe(true);
  });

  it("PATH 3 — a READY plan answered with \"preview\" is approved but previewed: no landing on green until her second word", async () => {
    const { id } = await open();
    await planned(id, { publish_ready: true });
    const reply = await handleBossInboundMail(mail({ subject: `Re: ${changeToken(id)}`, body: "preview only" }), env as never);
    expect(reply.outcome).toBe("PLAN_ANSWERED");
    let rc = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("build");
    expect(rc.answers_mode).toBe("preview");
    expect(rc.preview_forced).toBe(1);
    expect(rc.land_approved_at).toBeNull();
    expect(needsPreview(rc)).toBe(true);
    const b = await built(id);
    expect(b.body.data.phase).toBe("preview");
    await apiJson(`/api/repo-changes/${id}/checks`, { method: "POST", body: { state: "green", detail: "ci: pass" } });
    rc = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("preview");
    expect(canLand({ ...rc, phase: "land" }).ok).toBe(false);
  });

  it("PATH 4 — a READY plan answered with plain \"approved\" lands on green with no preview, exactly as before", async () => {
    const { id } = await open();
    await planned(id, { publish_ready: true });
    await handleBossInboundMail(mail({ subject: `Re: ${changeToken(id)}`, body: "approved" }), env as never);
    const b = await built(id);
    expect(b.body.data.phase).toBe("landing");
    await apiJson(`/api/repo-changes/${id}/checks`, { method: "POST", body: { state: "green", detail: "ci: pass" } });
    const rc = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("land");
    expect(canLand(rc).ok).toBe(true);
    expect(rc.preview_sent_at).toBeNull();
  });

  it("THE FORCE — \"approved to production\" on a not-ready plan lands on green with no preview, recorded and named", async () => {
    const { id, taskId } = await open();
    await planned(id);
    const reply = await handleBossInboundMail(mail({ subject: `Re: ${changeToken(id)}`, body: "approved to production" }), env as never);
    expect(reply.outcome).toBe("PLAN_ANSWERED");
    expect(reply.reply).toMatch(/TO PRODUCTION BY YOUR INSTRUCTION, with 1 placeholder/);
    let rc = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("build");
    expect(rc.answers_mode).toBe("forced");
    expect(rc.forced_by).toBe("seq.taylor@gmail.com");
    expect(rc.forced_at).toBeTruthy();
    expect(JSON.parse(rc.forced_placeholders)).toEqual(["Team bios for two of four people are not in the package"]);
    expect(rc.forced_mail_id).toBe(reply.mailId);
    expect(isForced(rc)).toBe(true);
    const finding = await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'repo_change_forced'`, taskId);
    expect(finding).toBeTruthy();
    expect(JSON.parse(finding.detail).by).toBe("seq.taylor@gmail.com");
    const auditRow = await row<any>(`SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ? AND action = 'forced_to_production'`, id);
    expect(auditRow.n).toBe(1);

    const b = await built(id);
    expect(b.body.data.phase).toBe("landing");
    await apiJson(`/api/repo-changes/${id}/checks`, { method: "POST", body: { state: "green", detail: "ci: pass" } });
    rc = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("land");
    expect(rc.preview_sent_at).toBeNull();
    expect(canLand(rc).ok).toBe(true);
    expect(canLand(rc).why).toMatch(/forced to production by seq.taylor@gmail.com/);
    expect((await claim(id)).status).toBe(201);
  });

  it("THE FORCE at the preview — \"ship it anyway\" after the preview email lands without the second approved", async () => {
    const { id } = await open();
    await planned(id);
    await handleBossInboundMail(mail({ subject: `Re: ${changeToken(id)}`, body: "approved" }), env as never);
    await built(id);
    await claim(id);
    await apiJson(`/api/repo-changes/${id}/preview`, { method: "POST", body: { device_id: DEVICE, preview_url: null, preview_message_id: "re_preview_f" } });
    await apiJson(`/api/repo-changes/${id}/checks`, { method: "POST", body: { state: "green", detail: "ci: pass" } });
    const forced = await handleBossInboundMail(mail({ subject: `Re: ${changeToken(id)}`, body: "ship it anyway" }), env as never);
    expect(forced.reply).toMatch(/BY YOUR INSTRUCTION/);
    const rc = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("land");
    expect(rc.land_approved_at).toBeNull();
    expect(isForced(rc)).toBe(true);
    expect(canLand(rc).ok).toBe(true);
  });

  it("A STRANGER'S FORCE IS REFUSED: nothing on the row, nothing in the finding", async () => {
    const { id, taskId } = await open();
    await planned(id);
    const res = await handleBossInboundMail(mail({ from: "Scooter <scooter@example.com>", subject: `Re: ${changeToken(id)}`, body: "approved to production" }), env as never);
    expect(res.outcome).toBe("REFUSED_SENDER");
    const rc = await row<any>(`SELECT phase, forced_by, forced_at, answered_at FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("asking");
    expect(rc.forced_by).toBeNull();
    expect(rc.forced_at).toBeNull();
    expect(rc.answered_at).toBeNull();
    expect(await row<any>(`SELECT id FROM task_events WHERE task_id = ? AND event = 'repo_change_forced'`, taskId)).toBeNull();
  });

  it("how-we-know is on the grid: her first real job — the banner — is admitted as a repo change", async () => {
    const res = await handleBossInboundMail(mail({ subject: "#danielle how-we-know banner", body: "In how-we-know, regenerate the YouTube banner in visuals/brand.py with the new tagline (deep sea + materials) and after landing push it to the channel and attach the proof." }), env as never);
    expect(res.outcome).toBe("ROUTED");
    const rc = await row<any>(`SELECT repo, property_key FROM repo_changes WHERE task_id = ?`, res.taskId);
    expect(rc.repo).toBe("how-we-know");
    expect(rc.property_key).toBe("youtube");
  });

  it("creator-network is on the grid: a #danielle mail naming it is admitted as a repo change", async () => {
    const res = await handleBossInboundMail(mail({ subject: "#danielle creator-network", body: "In creator-network, add the runbook link to the README." }), env as never);
    expect(res.outcome).toBe("ROUTED");
    const rc = await row<any>(`SELECT repo, property_key FROM repo_changes WHERE task_id = ?`, res.taskId);
    expect(rc.repo).toBe("creator-network");
    expect(rc.property_key).toBe("creator_network");
  });
});

describe("pre-approval in the request: she said pick everything", () => {
  const READY = { publish_ready: true };
  const NOT_READY = { publish_ready: false, placeholders: ["Team bios for two of four people are not in the package"] };
  async function open(body: string, from?: string) {
    const res = await handleBossInboundMail(mail({ from, subject: "#danielle refresh", body }), env as never);
    const rc = res.taskId ? await row<any>(`SELECT * FROM repo_changes WHERE task_id = ?`, res.taskId) : null;
    return { res, rc };
  }
  async function plan(id: string, verdict: Record<string, unknown>, asks: unknown[] = []) {
    await claim(id);
    return apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: ["Headline: A — it matches the thesis page"], asks, ...verdict, ask_message_id: "re_fyi" } });
  }
  async function build(id: string) {
    const c = await claim(id);
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.data.phase).toBe("build");
    return apiJson(`/api/repo-changes/${id}/build`, { method: "POST", body: { device_id: DEVICE, branch: "work/x", pr_url: "https://github.com/seq23/WPP-llm/pull/8", pr_number: 8, proof: { validators: ["npm run validate"], validators_passed: true } } });
  }

  it("PRE-APPROVED + READY: the plan files as approved by her, BUILD parks with no reply, and it lands on green", async () => {
    const { res, rc } = await open(`Update WPP-llm from ${FOLDER}. New hero — your call, no need to ask.`);
    expect(res.outcome).toBe("ROUTED");
    expect(rc.pre_approved_phrase).toBe("your call");
    expect(rc.pre_approved_by).toBe("seq.taylor@gmail.com");
    const finding = await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'repo_change_pre_approved'`, res.taskId);
    expect(JSON.parse(finding.detail).phrase).toBe("your call");
    expect(JSON.parse(finding.detail).by).toBe("seq.taylor@gmail.com");

    // A pre-approved plan that still asks is refused; one that decides everything files as approved.
    const asking = await plan(rc.id, READY, [{ question: "Which headline?", default: "A" }]);
    expect(asking.status).toBe(400);
    await apiJson(`/api/repo-changes/${rc.id}/release`, { method: "POST", body: { device_id: DEVICE, reason: "test" } });
    const filed = await plan(rc.id, READY);
    expect(filed.status).toBe(200);
    expect(filed.body.data.phase).toBe("build");
    let r = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, rc.id);
    expect(r.phase).toBe("build");
    expect(r.answered_at).toBeTruthy();
    expect(r.plan_approved_by).toBe('seq.taylor@gmail.com (pre-approved in the request: "your call")');
    expect(canEnterBuild(r).ok).toBe(true);

    const b = await build(rc.id);
    expect(b.body.data.phase).toBe("landing");
    await apiJson(`/api/repo-changes/${rc.id}/checks`, { method: "POST", body: { state: "green", detail: "ci: pass" } });
    r = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, rc.id);
    expect(r.phase).toBe("land");
    expect(canLand(r).ok).toBe(true);
    expect(isForced(r)).toBe(false);
    expect((await claim(rc.id)).status).toBe(201);
  });

  it("PRE-APPROVED + NOT READY: parks BUILD, then stops at the preview gate exactly as an unforced task does", async () => {
    const { rc } = await open(`Update WPP-llm from ${FOLDER}. Just do it.`);
    expect(rc.pre_approved_phrase).toBe("just do it");
    expect(rc.force_phrase).toBeNull();
    const filed = await plan(rc.id, NOT_READY);
    expect(filed.body.data.phase).toBe("build");
    const b = await build(rc.id);
    expect(b.body.data.phase).toBe("preview");
    await apiJson(`/api/repo-changes/${rc.id}/checks`, { method: "POST", body: { state: "green", detail: "ci: pass" } });
    const r = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, rc.id);
    expect(r.phase).toBe("preview");
    expect(isForced(r)).toBe(false);
    expect(canLand({ ...r, phase: "land" }).ok).toBe(false);
    expect(canLand({ ...r, phase: "land" }).why).toMatch(/needs a preview/);
  });

  it("PRE-APPROVED + FORCED + NOT READY: lands on green, named as forced by her from the request", async () => {
    const { rc, res } = await open(`Update WPP-llm from ${FOLDER}. You decide everything — approved to production, the missing bios can ship.`);
    expect(rc.pre_approved_phrase).toBe("you decide");
    expect(rc.force_phrase).toBe("approved to production");
    const filed = await plan(rc.id, NOT_READY);
    expect(filed.body.data.phase).toBe("build");
    let r = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, rc.id);
    expect(r.forced_by).toBe("seq.taylor@gmail.com");
    expect(JSON.parse(r.forced_placeholders)).toEqual(NOT_READY.placeholders);
    const forcedFinding = await row<any>(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'repo_change_forced'`, res.taskId);
    expect(JSON.parse(forcedFinding.detail).at).toBe("request");
    const b = await build(rc.id);
    expect(b.body.data.phase).toBe("landing");
    await apiJson(`/api/repo-changes/${rc.id}/checks`, { method: "POST", body: { state: "green", detail: "ci: pass" } });
    r = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, rc.id);
    expect(r.phase).toBe("land");
    expect(canLand(r).ok).toBe(true);
    expect(canLand(r).why).toMatch(/forced to production by seq.taylor@gmail.com/);
  });

  it("\"stop\" within the build withdraws the approval; \"stop\" while landing parks the PR unlanded", async () => {
    const { rc } = await open(`Update WPP-llm from ${FOLDER}. Pick everything.`);
    await plan(rc.id, READY);
    const held = await handleBossInboundMail(mail({ subject: `Re: ${changeToken(rc.id)}`, body: "stop" }), env as never);
    expect(held.reply).toMatch(/^Held\./);
    let r = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, rc.id);
    expect(r.phase).toBe("asking");
    expect(r.answered_at).toBeNull();
    expect(r.plan_approved_by).toBeNull();
    expect((await claim(rc.id)).status).toBe(409);
    await handleBossInboundMail(mail({ subject: `Re: ${changeToken(rc.id)}`, body: "approved" }), env as never);
    await build(rc.id);
    const held2 = await handleBossInboundMail(mail({ subject: `Re: ${changeToken(rc.id)}`, body: "no — wait" }), env as never);
    expect(held2.reply).toMatch(/will not land/);
    r = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, rc.id);
    expect(r.phase).toBe("previewing");
    await apiJson(`/api/repo-changes/${rc.id}/checks`, { method: "POST", body: { state: "green", detail: "ci: pass" } });
    r = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, rc.id);
    expect(r.phase).toBe("previewing");
    expect(canLand({ ...r, phase: "land" }).ok).toBe(false);
    await handleBossInboundMail(mail({ subject: `Re: ${changeToken(rc.id)}`, body: "approved" }), env as never);
    r = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, rc.id);
    expect(r.phase).toBe("land");
    expect(canLand(r).ok).toBe(true);
  });

  it("A STRANGER'S PRE-APPROVAL IS REFUSED, and a later message by anyone never pre-approves", async () => {
    const s = await open(`Update WPP-llm from ${FOLDER}. Your call.`, "Scooter <scooter@example.com>");
    expect(s.res.outcome).toBe("REFUSED_SENDER");
    expect(s.rc).toBeNull();
    const { rc } = await open(`Update WPP-llm from ${FOLDER}. New hero.`);
    expect(rc.pre_approved_phrase).toBeNull();
    await plan(rc.id, READY, [{ question: "Which headline?", default: "A" }]);
    const later = await handleBossInboundMail(mail({ subject: `Re: ${changeToken(rc.id)}`, body: "your call, just do it" }), env as never);
    expect(later.outcome).toBe("PLAN_ANSWERED");
    const r = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, rc.id);
    expect(r.pre_approved_phrase).toBeNull();
    expect(r.plan_approved_by).toBeNull();
    expect(r.answers_mode).toBe("answers"); // her words are her answers; not a pre-approval, not a force
  });
});


describe("retry is her door for a failed row", () => {
  it("a failed change goes back to plan, keeps her instruction and pre-approval, and is claimable again; a live one cannot be retried", async () => {
    const res = await handleBossInboundMail(mail({ subject: "#danielle refresh", body: `Update WPP-llm from ${FOLDER}. Your call.` }), env as never);
    const rc = await row<any>(`SELECT id, task_id FROM repo_changes WHERE task_id = ?`, res.taskId);
    expect((await apiJson(`/api/repo-changes/${rc.id}/retry`, { method: "POST", body: {} })).status).toBe(409);
    await claim(rc.id);
    await apiJson(`/api/repo-changes/${rc.id}/failed`, { method: "POST", body: { failure: "NAMED STOP [PHASE_DID_NOT_COMPLETE] claude exited 1", notified_message_id: "re_f" } });
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, rc.task_id)).status).toBe("failed");
    const r = await apiJson(`/api/repo-changes/${rc.id}/retry`, { method: "POST", body: { reason: "the lane handed the CLI an API key; fixed" } });
    expect(r.status).toBe(200);
    const after = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, rc.id);
    expect(after.phase).toBe("plan");
    expect(after.failure).toBeNull();
    expect(after.pre_approved_phrase).toBe("your call");
    expect(after.instruction).toContain("Your call");
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, rc.task_id)).status).toBe("queued");
    expect((await claim(rc.id)).status).toBe(201);
  });
});


describe("a retry is a resume of her original instruction, never a new one", () => {
  it("\"try again\" on the ORIGINAL thread of a failed pre-approved change keeps the row, its pre-approval, repo and folder; opens nothing; the fresh plan is FYI-only", async () => {
    const originalId = `<orig-${Date.now()}@mail.gmail.com>`;
    const res = await handleBossInboundMail(mail({ messageId: originalId, subject: "#danielle how-we-know banner", body: `In how-we-know, regenerate the YouTube banner with the new tagline. Your call, pick everything, no options. Package: ${FOLDER}` }), env as never);
    const rc = await row<any>(`SELECT * FROM repo_changes WHERE task_id = ?`, res.taskId);
    expect(rc.pre_approved_phrase).toBe("your call");
    expect(rc.drive_folder).toBe("1AbCdEfGhIjKlMnOpQrStUv");
    await claim(rc.id);
    await apiJson(`/api/repo-changes/${rc.id}/failed`, { method: "POST", body: { failure: "NAMED STOP [PHASE_DID_NOT_COMPLETE] claude exited 1", notified_message_id: "re_f" } });

    const tasksBefore = (await row<any>(`SELECT COUNT(*) AS n FROM tasks`)).n;
    const rowsBefore = (await row<any>(`SELECT COUNT(*) AS n FROM repo_changes`)).n;
    // Her reply on her OWN original thread: subject "Re: #danielle how-we-know banner" (no token), References = her message-id.
    const reply = await handleBossInboundMail(mail({ subject: "Re: #danielle how-we-know banner", body: "try again", references: originalId }), env as never);
    expect(reply.outcome).toBe("PLAN_ANSWERED");
    expect(reply.taskId).toBeNull();
    expect(reply.reply).toMatch(/Retrying rc_/);
    expect(reply.reply).toMatch(/your pre-approval \("your call"\)/);
    expect((await row<any>(`SELECT COUNT(*) AS n FROM tasks`)).n).toBe(tasksBefore);
    expect((await row<any>(`SELECT COUNT(*) AS n FROM repo_changes`)).n).toBe(rowsBefore);

    const after = await row<any>(`SELECT * FROM repo_changes WHERE id = ?`, rc.id);
    expect(after.phase).toBe("plan");
    expect(after.failure).toBeNull();
    expect(after.pre_approved_phrase).toBe("your call");
    expect(after.pre_approved_by).toBe("seq.taylor@gmail.com");
    expect(after.repo).toBe("how-we-know");
    expect(after.drive_folder).toBe("1AbCdEfGhIjKlMnOpQrStUv");
    expect(after.instruction).toBe(rc.instruction); // "try again" adds nothing to it
    expect((await row<any>(`SELECT status FROM tasks WHERE id = ?`, rc.task_id)).status).toBe("queued");

    // The fresh plan: asks are refused, a deciding plan files as approved by her and parks BUILD — FYI-only.
    const c = await claim(rc.id);
    expect(c.status).toBe(201);
    const asking = await apiJson(`/api/repo-changes/${rc.id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: [{ question: "Keep the handle?", default: "yes" }], publish_ready: true, ask_message_id: "re_x" } });
    expect(asking.status).toBe(400);
    const filed = await apiJson(`/api/repo-changes/${rc.id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: ["Keep the handle — yes"], asks: [], publish_ready: true, ask_message_id: "re_fyi_2" } });
    expect(filed.status).toBe(200);
    expect(filed.body.data.phase).toBe("build");
    expect(filed.body.data.pre_approved).toBe(true);
    expect((await row<any>(`SELECT plan_approved_by FROM repo_changes WHERE id = ?`, rc.id)).plan_approved_by).toMatch(/pre-approved in the request: "your call"/);
  });

  it("a reply that says MORE than try again is appended as her follow-up; a hold leaves it stopped", async () => {
    const originalId = `<orig2-${Date.now()}@mail.gmail.com>`;
    const res = await handleBossInboundMail(mail({ messageId: originalId, subject: "#danielle hero", body: `Update WPP-llm from ${FOLDER}. New hero.` }), env as never);
    const rc = await row<any>(`SELECT * FROM repo_changes WHERE task_id = ?`, res.taskId);
    await claim(rc.id);
    await apiJson(`/api/repo-changes/${rc.id}/failed`, { method: "POST", body: { failure: "NAMED STOP [X] y", notified_message_id: "re_f" } });
    await handleBossInboundMail(mail({ subject: "Re: #danielle hero", body: "no, leave it", references: originalId }), env as never);
    expect((await row<any>(`SELECT phase FROM repo_changes WHERE id = ?`, rc.id)).phase).toBe("failed");
    const again = await handleBossInboundMail(mail({ subject: "Re: #danielle hero", body: "try again but use the second headline", references: originalId }), env as never);
    expect(again.reply).toMatch(/Retrying/);
    const after = await row<any>(`SELECT phase, instruction FROM repo_changes WHERE id = ?`, rc.id);
    expect(after.phase).toBe("plan");
    expect(after.instruction).toMatch(/Her follow-up on retry .*: try again but use the second headline/);
  });

  it("A RETRY RESUMES WHERE IT STOPPED, never at plan when her approval is on the record: a failed BUILD goes back to build with the plan and her answer kept", async () => {
    /*
     * 21 Sep 2026, rc_m32h946mv0eybxhj: approved 20:00Z with defaults, then stopped in BUILD on a
     * dirty checkout. A retry that re-plans throws her approval away and — on a row with no
     * pre-approval — asks the same questions again. So a failed build resumes at build.
     */
    const originalId = `<orig3-${Date.now()}@mail.gmail.com>`;
    const res = await handleBossInboundMail(mail({ messageId: originalId, subject: "#danielle tags", body: `In how-we-know, add hashtags per episode. Package: ${FOLDER}` }), env as never);
    const rc = await row<any>(`SELECT * FROM repo_changes WHERE task_id = ?`, res.taskId);
    await claim(rc.id);
    await apiJson(`/api/repo-changes/${rc.id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan\nAfter landing, push the About text.", decided: ["x"], asks: [{ question: "Both domains?", default: "yes" }], publish_ready: true, ask_message_id: "re_p", post_land_step: { command: ".venv/bin/python loop/channel_about.py", proof: "channels.list shows the new text" } } });
    const approved = await handleBossInboundMail(mail({ subject: `Re: #danielle tags [${rc.id}]`, body: "approved" }), env as never);
    expect(approved.outcome).toBe("PLAN_ANSWERED");
    const built = await row<any>(`SELECT phase, answered_at, answers_text, post_land_command, post_land_proof FROM repo_changes WHERE id = ?`, rc.id);
    expect(built.phase).toBe("build");
    expect(built.post_land_command).toBe(".venv/bin/python loop/channel_about.py");
    expect(built.post_land_proof).toMatch(/channels\.list/);
    await claim(rc.id);
    await apiJson(`/api/repo-changes/${rc.id}/failed`, { method: "POST", body: { failure: "NAMED STOP [WORKTREE_NOT_MADE] x", notified_message_id: "re_f" } });

    const reply = await handleBossInboundMail(mail({ subject: "Re: #danielle tags", body: "try again", references: originalId }), env as never);
    expect(reply.reply).toMatch(/Retrying rc_.* from build/);
    const after = await row<any>(`SELECT phase, plan_text, answered_at, answers_text, answers_mode, post_land_command, pr_url, failure FROM repo_changes WHERE id = ?`, rc.id);
    expect(after.phase).toBe("build");
    expect(after.failure).toBeNull();
    expect(after.plan_text).toMatch(/# Plan/);
    expect(after.answered_at).toBe(built.answered_at);
    expect(after.answers_text).toBe(built.answers_text);
    expect(after.answers_mode).toBe("approved");
    expect(after.post_land_command).toBe(".venv/bin/python loop/channel_about.py");
    expect(after.pr_url).toBeNull();
    const c = await claim(rc.id);
    expect(c.status).toBe(201);
    expect(c.body.data.phase).toBe("build");
  });

  it("a failed LAND with a green PR and her approval resumes at land — the merge is not redone and nothing is re-asked; a plan step without a command is refused", async () => {
    const res = await handleBossInboundMail(mail({ subject: "#danielle widen", body: `In how-we-know, widen the channel. Package: ${FOLDER}` }), env as never);
    const rc = await row<any>(`SELECT * FROM repo_changes WHERE task_id = ?`, res.taskId);
    await claim(rc.id);
    const prose = await apiJson(`/api/repo-changes/${rc.id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: ["x"], asks: [], publish_ready: true, ask_message_id: "re_p", post_land_step: { proof: "the About text" } } });
    expect(prose.status).toBe(400);
    expect(JSON.stringify(prose.body)).toMatch(/needs command/);
    await apiJson(`/api/repo-changes/${rc.id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: ["x"], asks: [], publish_ready: true, ask_message_id: "re_p" } });
    await handleBossInboundMail(mail({ subject: `Re: [${rc.id}]`, body: "approved" }), env as never);
    await claim(rc.id);
    await apiJson(`/api/repo-changes/${rc.id}/build`, { method: "POST", body: { device_id: DEVICE, branch: "work/rc-x", pr_url: "https://github.com/seq23/how-we-know/pull/102", pr_number: 102, proof: { a: 1 } } });
    await apiJson(`/api/repo-changes/${rc.id}/checks`, { method: "POST", body: { device_id: DEVICE, state: "green", detail: "all green" } });
    const landing = await row<any>(`SELECT phase, checks_green_at FROM repo_changes WHERE id = ?`, rc.id);
    expect(landing.phase).toBe("land");
    await claim(rc.id);
    await apiJson(`/api/repo-changes/${rc.id}/failed`, { method: "POST", body: { failure: "NAMED STOP [POST_LAND_STEP_NOT_RUN] landed as abc", notified_message_id: "re_f" } });
    const r = await apiJson(`/api/repo-changes/${rc.id}/retry`, { method: "POST", body: { reason: "the step" } });
    expect(r.status).toBe(200);
    expect(r.body.data.phase).toBe("land");
    const after = await row<any>(`SELECT phase, pr_url, pr_number, checks_green_at, answered_at, failure FROM repo_changes WHERE id = ?`, rc.id);
    expect(after).toMatchObject({ phase: "land", pr_url: "https://github.com/seq23/how-we-know/pull/102", pr_number: 102, checks_green_at: landing.checks_green_at, failure: null });
    expect(after.answered_at).toBeGreaterThan(0);
  });
});
