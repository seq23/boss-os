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

function mail(opts: { from?: string; subject?: string; body?: string; dmarc?: string }) {
  const body = opts.body ?? "";
  const from = opts.from ?? "Sequoia <seq.taylor@gmail.com>";
  const headers = new Headers({
    from,
    subject: opts.subject ?? "",
    "authentication-results": opts.dmarc ?? "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com",
    "message-id": `<${Math.random().toString(36).slice(2)}@mail.gmail.com>`,
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
