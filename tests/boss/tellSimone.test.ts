import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { expect, it } from "vitest";
import worker from "../../src/worker/boss/index";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { claimSimone, finishSimoneHandoff } from "../../src/worker/boss/agents/simone";
import { BOSS_INTAKE_MAILBOX, SIMONE_MAILBOX } from "../../src/shared/boss/intake/mail.mjs";
import { all, apiJson, row } from "./helpers";

const ASKS = [
  "Build a one-page landing for a sample studio in seq23/creator-studios",
  "What are the three cheapest ways to host a static site with a custom domain?",
  "Draft a short thank-you note for the event organisers",
];
const THREE_ASKS = ASKS.map((ask, i) => `${i + 1}. ${ask}`).join("\n");
const OWNER = "owner@example.test";

function mail(to: string, body: string, subject = "") {
  const from = `Boss OS fixture <${OWNER}>`;
  const headers = new Headers({
    from, subject,
    "authentication-results": "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=example.test",
    "message-id": `<${crypto.randomUUID()}@example.test>`,
  });
  const raw = `From: ${from}\r\nSubject: ${subject}\r\n\r\n${body}`;
  return handleBossInboundMail({ from: OWNER, to, headers, raw: new Response(raw).body!, rawSize: new TextEncoder().encode(raw).length }, {
    ...env, BOSS_EXTRA_OWNER_SENDERS: OWNER,
  });
}

const DELEGATED = ["emp_repo", "emp_research", "emp_knowledge"];

async function delegate(id: string, asks: string[], employees: string[], delivery: string[] = []) {
  const call = (await claimSimone(env))!;
  expect(call.id).toBe(id);
  expect(call.message.body).toContain(asks[0]);
  expect(await finishSimoneHandoff(env, {
    id, lease: call.lease, assignments: asks.map((words, i) => ({ words, employee: employees[i], delivery: delivery[i] ?? "ordinary" })),
  })).toEqual({ replied: true, refused: false });
  const tasks = await all<{ title: string; employee_id: string; words: string; envelope_id: string }>(`SELECT title, employee_id,
    json_extract(input, '$.body') AS words, envelope_id FROM tasks WHERE json_extract(input, '$.simone_handoff') = ? ORDER BY rowid`, id);
  expect(tasks.map((task) => task.employee_id)).toEqual(employees);
  expect(tasks.map((task) => task.words)).toEqual(asks);
  expect(tasks.every((task) => task.title && task.envelope_id)).toBe(true);
  return tasks.map(({ envelope_id: _id, ...task }) => task);
}

it("both chief mailboxes and both boxes make the same three handoffs using the model's answer", async () => {
  const deliveries = [
    async () => (await mail(BOSS_INTAKE_MAILBOX, THREE_ASKS)).taskId,
    async () => (await mail(SIMONE_MAILBOX, THREE_ASKS)).taskId,
    ...["/api/intake/simone", "/api/simone/message"].map((path) => async () => {
      const submission = await apiJson(path, { method: "POST", body: { text: THREE_ASKS } });
      expect(submission.status).toBe(201);
      return submission.body.data.taskId as string;
    }),
  ];
  let previous;
  for (const deliver of deliveries) {
    const id = (await deliver())!;
    const result = await delegate(id, ASKS, DELEGATED, ["repository", "research_page", "ordinary"]);
    expect(result[0]?.title).toMatch(/^Build a one-page landing/);
    if (previous) expect(result).toEqual(previous);
    previous = result;
  }
  expect((await row<{ n: number }>(`SELECT count(*) AS n FROM boss_task_notices WHERE kind = 'simone_result'`))?.n).toBe(2);
  expect(await row(`SELECT count(*) AS n FROM repo_changes rc JOIN tasks t ON t.id = rc.task_id
    WHERE json_extract(t.input, '$.simone_handoff') IS NOT NULL AND t.employee_id = 'emp_repo' AND rc.phase = 'plan'`)).toEqual({ n: 4 });
  expect(await row(`SELECT count(*) AS n FROM research_pages rp JOIN tasks t ON t.id = rp.task_id
    WHERE json_extract(t.input, '$.simone_handoff') IS NOT NULL AND t.employee_id = 'emp_research' AND rp.question = ?`, ASKS[1]!)).toEqual({ n: 4 });
});

it("Simone hands the research ask to Camille and preserves a direct address to Danielle", async () => {
  for (const target of [BOSS_INTAKE_MAILBOX, SIMONE_MAILBOX]) {
    const res = await mail(target, ASKS[1]!, "Hosting");
    expect(res.outcome).toBe("SIMONE_QUEUED");
    expect(res.reply).toBeNull();
    await delegate(res.taskId!, [ASKS[1]!], ["emp_research"]);
  }
  const to = "danielle@sequoiataylor.com";
  const words = "Please look at the Q3 numbers";
  const direct = await mail(to, words);
  expect(direct).toMatchObject({ outcome: "SIMONE_QUEUED", reply: null });
  expect(JSON.parse((await row<{ input: string }>("SELECT input FROM tasks WHERE id = ?", direct.taskId))!.input)).toMatchObject({ to, body: words });
  await delegate(direct.taskId!, [words], ["emp_repo"]);
  const tagged = await mail(BOSS_INTAKE_MAILBOX, "#camille please look at the Q3 numbers");
  await delegate(tagged.taskId!, ["#camille please look at the Q3 numbers"], ["emp_research"]);
});

it("rejects empty and unauthenticated submissions without opening a task", async () => {
  const empty = await apiJson("/api/intake/simone", { method: "POST", body: { text: "   " } });
  expect(empty.status).toBe(400);
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://boss.test/api/intake/simone", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: THREE_ASKS }),
  }), env, ctx);
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(401);
  expect((await row<{ n: number }>(`SELECT COUNT(*) AS n FROM tasks WHERE json_extract(input, '$.agent') = 'simone'`))!.n).toBe(0);
});
