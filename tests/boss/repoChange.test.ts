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
import { canEnterBuild, canLand, claimablePhase, parseRepoChange, tokenIn, changeToken } from "../../src/shared/boss/repoChange/lane.mjs";

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

    const noMail = await apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: [] } });
    expect(noMail.status).toBe(400);
    expect(noMail.body.error ?? JSON.stringify(noMail.body)).toMatch(/ask_message_id/);

    const planned = await apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan\n- swap hero", decided: ["CSS: reuse the existing tile"], asks: ["Which headline?"], ask_message_id: "re_test_1", written_by: "claude-opus-5" } });
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
    await apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: ["Which headline?"], ask_message_id: "re_test_2" } });

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

  it("a stranger's reply carrying the token records nothing — the approval is hers alone", async () => {
    const { id } = await open();
    await claim(id);
    await apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: ["Which headline?"], ask_message_id: "re_test_3" } });
    const res = await handleBossInboundMail(mail({ from: "Scooter <scooter@example.com>", subject: `Re: #danielle plan ${changeToken(id)}`, body: "Go." }), env as never);
    expect(res.outcome).toBe("REFUSED_SENDER");
    const rc = await row<any>(`SELECT phase, answered_at FROM repo_changes WHERE id = ?`, id);
    expect(rc.phase).toBe("asking");
    expect(rc.answered_at).toBeNull();
  });

  it("LAND ON GREEN: build → landing → green recorded → land claim → done; and never without the green", async () => {
    const { id, taskId } = await open();
    await claim(id);
    await apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: [], ask_message_id: "re_test_4" } });
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
    await apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: DEVICE, plan_text: "# Plan", decided: [], asks: [], ask_message_id: "re_test_5" } });
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
    const res = await apiJson(`/api/repo-changes/${id}/plan`, { method: "POST", body: { device_id: "someone-else", plan_text: "# Plan", ask_message_id: "x" } });
    expect(res.status).toBe(409);
  });
});
