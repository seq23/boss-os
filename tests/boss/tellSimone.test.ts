import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/worker/boss/index";
import { handleBossInboundMail, type HandoffJob } from "../../src/worker/boss/intake/inboundMail";
import { BOSS_INTAKE_MAILBOX, SIMONE_MAILBOX } from "../../src/shared/boss/intake/mail.mjs";
import { all, apiJson, row } from "./helpers";

/**
 * "TELL SIMONE" (owner, 26 Oct 2026): simone@ IS boss@, and the box on Today IS an email to simone@.
 *
 * Before this, mail to simone@ was routed by its address like danielle@: filed WHOLE on Simone's
 * desk, never split into asks (outcome ROUTED, one task). boss@ was triaged. These tests pin the
 * two addresses to one behaviour, and the app route to the email path, by comparing the jobs and
 * their owners that the same text produces each way, down to the tasks in D1.
 */

// Three asks for three different desks. No people's names (her rule for test mail).
const THREE_ASKS = [
  "1. Build a one-page landing for a sample studio in seq23/creator-studios",
  "2. What are the three cheapest ways to host a static site with a custom domain?",
  "3. Draft a short thank-you note for the event organisers",
].join("\n");

function mail(to: string, body: string, subject = "") {
  const from = "Sequoia <seq.taylor@gmail.com>";
  const headers = new Headers({
    from, subject,
    "authentication-results": "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com",
    "message-id": `<${Math.random().toString(36).slice(2)}@mail.gmail.com>`,
  });
  const raw = `From: ${from}\r\nSubject: ${subject}\r\n\r\n${body}`;
  return { from: "seq.taylor@gmail.com", to, headers, raw: new Response(raw).body!, rawSize: new TextEncoder().encode(raw).length };
}

/** What a handoff is, without the ids that are new each time. */
const shape = (jobs: HandoffJob[] | undefined) => (jobs ?? []).map((j) => ({ title: j.title, employeeId: j.employeeId, duty: j.duty, started: Boolean(j.taskId) && !j.failure }));

/** The tasks one message opened, as owners in order. */
async function ownersOf(mailId: string) {
  const rows = await all<{ employee_id: string; input: string }>(`SELECT employee_id, input FROM tasks WHERE json_extract(input, '$.mail_id') = ? ORDER BY created_at, rowid`, mailId);
  return rows.map((r) => ({ employee: r.employee_id, source: JSON.parse(r.input).source }));
}

beforeEach(async () => {
  await env.DB.exec("DELETE FROM boss_inbound_mail");
});

describe("simone@ is boss@", () => {
  it("an untagged email to simone@ is split into its asks exactly like boss@ — same jobs, same owners", async () => {
    const viaBoss = await handleBossInboundMail(mail(BOSS_INTAKE_MAILBOX, THREE_ASKS) as never, env as never);
    const viaSimone = await handleBossInboundMail(mail(SIMONE_MAILBOX, THREE_ASKS) as never, env as never);
    expect(viaBoss.outcome).toBe("TRIAGED");
    expect(viaSimone.outcome).toBe("TRIAGED");
    expect(new Set(shape(viaBoss.jobs).map((j) => j.employeeId)).size).toBeGreaterThanOrEqual(2);
    expect(shape(viaSimone.jobs)).toEqual(shape(viaBoss.jobs));
    expect(await ownersOf(viaSimone.mailId)).toEqual(await ownersOf(viaBoss.mailId));
    expect(viaSimone.reply).toMatch(/^Simone here\. Got it/);
  });

  it("a one-ask email to simone@ goes to the seat that can do it, not Simone's desk by address", async () => {
    const body = "What are the three cheapest ways to host a static site with a custom domain?";
    const viaBoss = await handleBossInboundMail(mail(BOSS_INTAKE_MAILBOX, body, "hosting") as never, env as never);
    const viaSimone = await handleBossInboundMail(mail(SIMONE_MAILBOX, body, "hosting") as never, env as never);
    expect(viaSimone.outcome).toBe(viaBoss.outcome);
    expect(viaSimone.employeeId).toBe(viaBoss.employeeId);
    expect(viaSimone.employeeId).not.toBe("emp_chief");
  });

  it("direct addresses and #name still go straight to that person", async () => {
    const direct = await handleBossInboundMail(mail("danielle@sequoiataylor.com", "please look at the Q3 numbers") as never, env as never);
    expect(direct.outcome).toBe("ROUTED");
    expect(direct.employeeId).toBe("emp_repo");
    const tagged = await handleBossInboundMail(mail(BOSS_INTAKE_MAILBOX, "#camille please look at the Q3 numbers") as never, env as never);
    expect(tagged.outcome).toBe("ROUTED");
    expect(tagged.employeeId).toBe("emp_research");
  });
});

describe("the Tell Simone box is the simone@ email", () => {
  it("POST /api/intake/simone gives the same jobs and owners as the same text emailed to simone@ and boss@", async () => {
    const app = await apiJson("/api/intake/simone", { method: "POST", body: { text: THREE_ASKS } });
    expect(app.status).toBe(201);
    const emailed = await handleBossInboundMail(mail(SIMONE_MAILBOX, THREE_ASKS) as never, env as never);
    const boss = await handleBossInboundMail(mail(BOSS_INTAKE_MAILBOX, THREE_ASKS) as never, env as never);

    expect(app.body.data.outcome).toBe(emailed.outcome);
    expect(shape(app.body.data.jobs)).toEqual(shape(emailed.jobs));
    expect(shape(app.body.data.jobs)).toEqual(shape(boss.jobs));
    expect(app.body.data.jobs.length).toBe(emailed.jobs!.length);
    expect(app.body.data.jobs.every((j: HandoffJob) => j.taskId && j.employee)).toBe(true);
    expect(await ownersOf(app.body.data.mailId)).toEqual(await ownersOf(emailed.mailId));

    // Tailed like an emailed job: the tail reads authorised rows to @sequoiataylor.com and the
    // tasks carry the intake's own source.
    const arrival = await row<any>(`SELECT to_addr, authorised, outcome, reply_state FROM boss_inbound_mail WHERE id = ?`, app.body.data.mailId);
    expect(arrival).toMatchObject({ to_addr: SIMONE_MAILBOX, authorised: 1, outcome: "TRIAGED", reply_state: "shown_on_screen" });
    expect((await ownersOf(app.body.data.mailId)).every((t) => t.source === "boss_inbound_mail")).toBe(true);
  });

  it("titles a job by its ask when there is no subject", async () => {
    const app = await apiJson("/api/intake/simone", { method: "POST", body: { text: THREE_ASKS } });
    const titles = app.body.data.jobs.map((j: HandoffJob) => j.title);
    expect(titles[0]).toMatch(/^Build a one-page landing/);
    const tasks = await all<{ title: string }>(`SELECT title FROM tasks WHERE json_extract(input, '$.mail_id') = ?`, app.body.data.mailId);
    for (const t of tasks) expect(t.title).not.toMatch(/^Mail from /);
  });

  it("refuses empty text (400) and an unauthenticated call (401), opening nothing", async () => {
    const empty = await apiJson("/api/intake/simone", { method: "POST", body: { text: "   " } });
    expect(empty.status).toBe(400);
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://boss.test/api/intake/simone", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: THREE_ASKS }),
    }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
    expect((await row<{ n: number }>(`SELECT COUNT(*) AS n FROM boss_inbound_mail`))!.n).toBe(0);
  });
});
