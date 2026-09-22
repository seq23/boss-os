/**
 * "I DO NOT HAVE DIRECT ACCESS TO…" IS NOT A DRAFT — the queue's own gate for the ops lane.
 *
 * ─── What happened ──────────────────────────────────────────────────────────
 *
 * 22 September 2026, `tsk_m351xejbtekke2cb`: she asked `#simone` — Chief of Staff, `ops`,
 * `one_off`, `AI_DRAFT` — to "dig through the code and figure out what the entire loop is" for
 * `how-we-know`, a repository `#danielle` owns. It ran as ONE ~13-second cloud completion with no
 * filesystem and no tools, answered that it had no access, and was filed `awaiting_approval` — the
 * same card as work worth her time.
 *
 * `handleTask` already parks a `repo_change` for her Mac and says why in a comment: "a cloud model
 * asked to 'do' it would return a paragraph shaped like a PR." That gate existed for one lane.
 * These tests pin it for the rest of the ops lane.
 *
 * ─── What is pinned, driven through `handleTask` rather than asserted about it ──
 *
 *   · a self-declared non-answer never reaches `awaiting_approval`, and no approval row is raised
 *   · the model's words are KEPT IN FULL on the task, so a wrong call destroys nothing
 *   · she is told by email — a `boss_task_notices` row, since the Worker cannot send
 *   · the work is handed to the desk that owns the repository, THROUGH `admitTask`, and the handed
 *     task is parked for her Mac rather than run as another paragraph
 *   · a real draft that merely mentions a limitation is untouched
 */
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertTask, row, all, api, uid } from "./helpers";
import { handleTask } from "../../src/worker/boss/queue/consumer";
import { setSpendLever } from "../../src/worker/boss/router/spend";

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

/** The Workers AI binding this Worker does not have in test config, supplied by hand. */
function withAi(text: string) {
  const bound = Object.create(env) as typeof env & { AI: { run: (m: string, i: unknown) => Promise<unknown> } };
  (bound as any).AI = {
    async run() { return { response: text, usage: { prompt_tokens: 20, completion_tokens: 10 } }; },
  };
  return bound;
}

async function provisionWorkersAi() {
  await env.DB.prepare(`UPDATE execution_backends SET status = 'enabled' WHERE id = 'bk_workers_ai'`).run();
  const res = await api("/api/models/provision/bk_workers_ai", { method: "POST", body: {} });
  expect(res.status).toBe(201);
  await setSpendLever(env.DB, { position: "MODERATE" }, "test");
}

/** The reply that actually came back on 22 September, near enough to be the same thing. */
const NON_ANSWER =
  "I do not have direct access to the how-we-know repository or its codebase, so I cannot dig "
  + "through the code to trace the loop you are describing. If you can share the relevant files I "
  + "will happily walk through them.";

const REAL_DRAFT =
  "Here is where the loop stands.\n\nThe watcher runs hourly, writes a row per finding, and the "
  + "digest picks those up on Sunday. Two of the three steps are proven in production; the third "
  + "has never fired because no finding has yet crossed its threshold. I do not have access to "
  + "this week's counts, so the numbers below are from last Sunday's digest and should be "
  + "refreshed before you act on them.";

describe("a non-answer is not a draft", () => {
  beforeEach(async () => { await provisionWorkersAi(); });

  it("files a self-declared non-answer as failed, raises no approval, and keeps every word", async () => {
    const taskId = await insertTask({
      status: "queued", employee_id: "emp_chief", lane: "ops", intake_kind: "one_off",
      title: "Audit the loop",
      input: JSON.stringify({ body: "Please dig through the code and figure out what the entire loop is." }),
    });

    await handleTask(withAi(NON_ANSWER), { taskId, lane: "ops" });

    const task = await row(`SELECT status, output, error, approval_id FROM tasks WHERE id = ?`, taskId);
    expect(task!.status).toBe("failed");
    // THE CARD SHE MUST NOT SEE IS NEVER RAISED.
    expect(task!.approval_id).toBeNull();
    expect(await row(`SELECT id FROM approvals WHERE origin_id = ?`, taskId)).toBeNull();
    // And the error line says what happened in words, not a code.
    expect(task!.error).toMatch(/could not actually do this/i);

    // NOTHING IS THROWN AWAY. A wrong call costs a heading, never the work.
    const output = JSON.parse(task!.output);
    expect(output.text).toBe(NON_ANSWER);
    expect(output.could_not_do.matched).toMatch(/I do not have direct access to/i);

    const event = await row(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'could_not_do'`, taskId);
    expect(event).not.toBeNull();
  });

  it("queues an email, because the Worker cannot send one itself", async () => {
    const taskId = await insertTask({
      status: "queued", employee_id: "emp_chief", lane: "ops", intake_kind: "one_off",
      title: "Audit the loop",
      input: JSON.stringify({ body: "Figure out what the entire loop is." }),
    });

    await handleTask(withAi(NON_ANSWER), { taskId, lane: "ops" });

    const notice = await row(
      `SELECT from_name, kind, subject, body, sent_at, attempts FROM boss_task_notices WHERE task_id = ?`,
      taskId,
    );
    expect(notice).not.toBeNull();
    expect(notice!.kind).toBe("could_not_do");
    // The employee who owned the work signs it. `notify.mjs` turns the NAME into the address and
    // refuses a name that is not on the roster, which is why this column is a name.
    const employee = await row(`SELECT name FROM employees WHERE id = 'emp_chief'`);
    expect(notice!.from_name).toBe(employee!.name);
    expect(notice!.subject).toMatch(/^Could not do: /);
    expect(notice!.body).toContain(taskId);
    // Never marked sent by the thing that cannot send it.
    expect(notice!.sent_at).toBeNull();
    expect(notice!.attempts).toBe(0);
  });

  it("hands a repository question to the desk that owns repositories, through the one door", async () => {
    const taskId = await insertTask({
      status: "queued", employee_id: "emp_chief", lane: "ops", intake_kind: "one_off",
      title: "Dig through how-we-know and figure out what the entire loop is",
      input: JSON.stringify({ body: "I want to know how the whole how-we-know loop actually works end to end." }),
    });

    await handleTask(withAi(NON_ANSWER), { taskId, lane: "ops" });

    const handed = await row(
      `SELECT id, employee_id, status, input, intake_kind FROM tasks WHERE id != ? AND employee_id = 'emp_repo'`,
      taskId,
    );
    expect(handed).not.toBeNull();
    const input = JSON.parse(handed!.input);
    expect(input.handed_off_from).toBe(taskId);
    expect(input.handed_off_why).toMatch(/could not open how-we-know/);
    /*
     * ADMITTED THROUGH `admitTask`, WHICH IS THE WHOLE POINT. Only that path reads a sentence as a
     * repo change and mints the `repo_changes` row the Mac lane claims — so the proof that the one
     * door was used is that the door's own side effects are here.
     */
    expect(input.repo_change.repo).toBe("how-we-know");
    expect(handed!.intake_kind).toBe("repository");
    const change = await row(`SELECT id, repo, phase FROM repo_changes WHERE task_id = ?`, handed!.id);
    expect(change).not.toBeNull();
    expect(change!.repo).toBe("how-we-know");

    // The original says where the work went.
    const event = await row(`SELECT detail FROM task_events WHERE task_id = ? AND event = 'could_not_do'`, taskId);
    expect(JSON.parse(event!.detail).handed_to.task_id).toBe(handed!.id);
  });

  it("the handed-off task is parked for her Mac, never run as another paragraph", async () => {
    const taskId = await insertTask({
      status: "queued", employee_id: "emp_chief", lane: "ops", intake_kind: "one_off",
      title: "Dig through how-we-know and figure out what the entire loop is",
      input: JSON.stringify({ body: "How does the how-we-know loop work?" }),
    });
    await handleTask(withAi(NON_ANSWER), { taskId, lane: "ops" });
    const handed = await row(`SELECT id FROM tasks WHERE employee_id = 'emp_repo' AND id != ?`, taskId);

    /*
     * Run the handed task through the SAME consumer, with a model that would happily produce
     * another non-answer. It must never reach it: `input.repo_change.change_id` parks it.
     */
    await handleTask(withAi(NON_ANSWER), { taskId: handed!.id as string, lane: "ops" });

    const after = await row(`SELECT status FROM tasks WHERE id = ?`, handed!.id);
    expect(after!.status).toBe("queued");
    const parked = await row(`SELECT id FROM task_events WHERE task_id = ? AND event = 'parked_for_mac'`, handed!.id);
    expect(parked).not.toBeNull();
    // And it did not hand itself on again.
    const hops = await all(`SELECT id FROM tasks WHERE employee_id = 'emp_repo'`);
    expect(hops.length).toBe(1);
  });

  it("names no other desk when her request names no repository — and still tells her", async () => {
    const taskId = await insertTask({
      status: "queued", employee_id: "emp_chief", lane: "ops", intake_kind: "one_off",
      title: "What is in my Dropbox",
      input: JSON.stringify({ body: "Have a look in my Dropbox and tell me what is in there." }),
    });

    await handleTask(withAi(NON_ANSWER), { taskId, lane: "ops" });

    expect(await row(`SELECT status FROM tasks WHERE id = ?`, taskId)).toMatchObject({ status: "failed" });
    // Nothing was invented: no repository was named, so no desk was named.
    expect(await row(`SELECT id FROM tasks WHERE employee_id = 'emp_repo'`)).toBeNull();
    // She is told anyway. A dead end she is not told about is the bug.
    const notice = await row(`SELECT body FROM boss_task_notices WHERE task_id = ?`, taskId);
    expect(notice).not.toBeNull();
    expect(notice!.body).toMatch(/needs a seat with a filesystem and tools/i);
  });

  it("leaves a real draft that merely names a limitation completely alone", async () => {
    const taskId = await insertTask({
      status: "queued", employee_id: "emp_chief", lane: "ops", intake_kind: "one_off",
      title: "Where does the loop stand",
    });

    await handleTask(withAi(REAL_DRAFT), { taskId, lane: "ops" });

    const task = await row(`SELECT status, output, approval_id FROM tasks WHERE id = ?`, taskId);
    // The ordinary path, untouched: this is a draft and it goes to her for a decision.
    expect(task!.status).toBe("awaiting_approval");
    expect(task!.approval_id).not.toBeNull();
    expect(JSON.parse(task!.output).text).toBe(REAL_DRAFT);
    // No email, no handoff, no failure event.
    expect(await row(`SELECT id FROM boss_task_notices WHERE task_id = ?`, taskId)).toBeNull();
    expect(await row(`SELECT id FROM task_events WHERE task_id = ? AND event = 'could_not_do'`, taskId)).toBeNull();
  });
});

describe("the notices door her Mac drains", () => {
  beforeEach(async () => { await provisionWorkersAi(); });

  async function seedNotice(over: Record<string, unknown> = {}) {
    const id = uid("tnt");
    await env.DB
      .prepare(
        `INSERT INTO boss_task_notices (id, task_id, lane, from_name, kind, subject, body, created_at, attempts)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id, (over.task_id as string) ?? uid("tsk"), "ops", "Simone", "could_not_do",
        "Could not do: something", "the body", Date.now(), (over.attempts as number) ?? 0,
      )
      .run();
    return id;
  }

  it("offers what is waiting and records BOTH outcomes from what the sender actually said", async () => {
    const good = await seedNotice();
    const bad = await seedNotice();

    const pending = await api("/api/task-notices/pending");
    expect(pending.status).toBe(200);
    const body = await pending.json() as { data: { items: { id: string }[]; gave_up: number } };
    expect(body.data.items.map((i) => i.id).sort()).toEqual([good, bad].sort());
    expect(body.data.gave_up).toBe(0);

    expect((await api(`/api/task-notices/${good}/sent`, { method: "POST", body: { from: "Simone" } })).status).toBe(200);
    expect((await api(`/api/task-notices/${bad}/failed`, { method: "POST", body: { error: "403 domain not verified" } })).status).toBe(200);

    expect(await row(`SELECT sent_at FROM boss_task_notices WHERE id = ?`, good)).not.toMatchObject({ sent_at: null });
    const failed = await row(`SELECT sent_at, attempts, error FROM boss_task_notices WHERE id = ?`, bad);
    expect(failed!.sent_at).toBeNull();
    expect(failed!.attempts).toBe(1);
    expect(failed!.error).toContain("403");
  });

  it("refuses a failure with no reason — a refusal nobody can read is a silence", async () => {
    const id = await seedNotice();
    const res = await api(`/api/task-notices/${id}/failed`, { method: "POST", body: {} });
    expect(res.status).toBe(400);
    expect(await row(`SELECT attempts FROM boss_task_notices WHERE id = ?`, id)).toMatchObject({ attempts: 0 });
  });

  it("stops offering a notice that has been refused too often, and says how many it gave up on", async () => {
    await seedNotice({ attempts: 5 });
    const res = await api("/api/task-notices/pending");
    const body = await res.json() as { data: { items: unknown[]; gave_up: number } };
    expect(body.data.items).toHaveLength(0);
    // Named rather than hidden: this is a thing she was never told.
    expect(body.data.gave_up).toBe(1);
  });
});
