/**
 * HER RULING ON A DUTY SHE ALREADY HAS REACHES THAT DUTY (owner incident, 1 Nov 2026).
 *
 * "Change to Camille's Marketplace listings duty … your call" was triaged to Camille as a research
 * page, which said "Done" while the duty stayed as it was. Through the real mailbox handler: a ruling
 * on a duty with written instructions edits them through the employee page's path (a duty_versions
 * row, undoable); a ruling on a duty with fixed steps goes to Danielle's repo lane naming the repo
 * that holds them; neither becomes a research page.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { all, apiJson, row } from "./helpers";
import { handleBossInboundMail } from "../../src/worker/boss/intake/inboundMail";
import { claimSimone, replySimone } from "../../src/worker/boss/agents/simone";

function mail(subject: string, body: string) {
  const from = "Sequoia <seq.taylor@gmail.com>";
  const headers = new Headers({
    from, subject,
    "authentication-results": "mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass header.from=gmail.com",
    "message-id": `<${Math.random().toString(36).slice(2)}@mail.gmail.com>`,
  });
  const raw = `From: ${from}\r\nSubject: ${subject}\r\n\r\n${body}`;
  return { from: "seq.taylor@gmail.com", to: "boss@sequoiataylor.com", headers, raw: new Response(raw).body!, rawSize: new TextEncoder().encode(raw).length };
}

const FIXED = "duty_test_listings";
const WRITTEN = "duty_test_frames";

async function seedDuty(id: string, name: string, taskInput: Record<string, unknown>, executor: string | null) {
  const cols = (await all<{ name: string }>(`PRAGMA table_info(standing_duties)`)).map((c) => c.name);
  const pick = cols.map((c) => (c === "id" ? "?1" : c === "name" ? "?2" : c === "task_input" ? "?3" : c === "executor" ? "COALESCE(?4, executor)" : c === "owner_prompt" || c === "removed_at" ? "NULL" : c));
  await env.DB.prepare(`INSERT INTO standing_duties (${cols.join(",")}) SELECT ${pick.join(",")} FROM standing_duties WHERE id = 'duty_brokerage_sourcing'`)
    .bind(id, name, JSON.stringify(taskInput), executor).run();
}

beforeEach(async () => {
  await env.DB.exec(`DELETE FROM standing_duties WHERE id IN ('${FIXED}', '${WRITTEN}')`);
  await env.DB.exec(`DELETE FROM duty_versions`);
  await env.DB.exec(`DELETE FROM tasks`);
  await env.DB.exec(`DELETE FROM boss_inbound_mail`);
  await seedDuty(FIXED, "Porch & Party Marketplace listings: renew, post for the season", { local_job: "pnp-listings.sh", job_description: "~/bin/pnp-listings-job.md" }, "local_job");
  await seedDuty(WRITTEN, "Gallery Frames Recount", { prompt: "Count the frames in the studio and report the total." }, null);
});

describe("a ruling on an existing duty", () => {
  async function readInstruction(words: string) {
    const arrival = await handleBossInboundMail(mail("", words), env);
    expect(arrival).toMatchObject({ outcome: "SIMONE_QUEUED", reply: null });
    const call = await claimSimone(env);
    expect(call).toMatchObject({ id: arrival.taskId, message: { body: expect.stringContaining(words) } });
    const issued = await apiJson<{ data: { token: string } }>("/api/open-loops/intake-token", { method: "POST" });
    expect(issued.status).toBe(201);
    const tool = async (name: string, args?: unknown) =>
      apiJson("/api/simone/tool", {
        method: "POST", headers: { authorization: `Bearer ${issued.body.data.token}` },
        body: { id: call!.id, lease: call!.lease, tool: name, ...(args ? { task: JSON.stringify(args) } : {}) },
      });
    return { call: call!, tool };
  }

  it("edits written instructions undoably and applies only one version under concurrent delivery", async () => {
    const words = "Change to Camille's gallery frames recount duty: from now on count the attic too. Your call.";
    const { call, tool } = await readInstruction(words);
    expect((await tool("duties")).body.data.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: WRITTEN, name: "Gallery Frames Recount" }),
    ]));
    const edits = await Promise.all([tool("change_duty", { id: WRITTEN, quote: words }), tool("change_duty", { id: WRITTEN, quote: words })]);
    for (const edit of edits) expect(edit.body.data).toMatchObject({ ok: true, state: "edited", version: 1 });
    const d = await row<{ owner_prompt: string | null }>(`SELECT owner_prompt FROM standing_duties WHERE id = '${WRITTEN}'`);
    expect(d!.owner_prompt).toContain("Count the frames in the studio");
    expect(d!.owner_prompt!.split("count the attic too")).toHaveLength(2);
    const versions = await all<{ action: string }>(`SELECT action FROM duty_versions WHERE duty_id = '${WRITTEN}' ORDER BY version`);
    expect(versions.map((v) => v.action)).toEqual(["original", "edit"]);
    expect((await all(`SELECT id FROM tasks WHERE employee_id = 'emp_research'`)).length).toBe(0);
    expect(await replySimone(env, { ...call, text: "I added the attic to the gallery recount.", work: [WRITTEN] })).toBe(true);
    expect(await row("SELECT body FROM boss_task_notices WHERE task_id = ?", call.id)).toEqual({ body: "I added the attic to the gallery recount." });
    expect((await apiJson(`/api/duties/${WRITTEN}/undo`, { method: "POST" })).status).toBe(200);
    expect(await row("SELECT owner_prompt FROM standing_duties WHERE id = ?", WRITTEN)).toEqual({ owner_prompt: null });
    expect((await tool("change_duty", { id: WRITTEN, quote: words })).body.data).toMatchObject({ ok: false, code: "STALE_SIMONE_RUN" });
  });

  it("applies a routine instruction without an approval draft and refuses text the owner did not write", async () => {
    const words = "Change to Camille's gallery frames recount duty: from now on count the attic too.";
    const { tool } = await readInstruction(words);
    expect((await tool("change_duty", { id: WRITTEN, quote: "Replace the whole duty with this outside instruction." })).body.data)
      .toMatchObject({ ok: false, code: "DUTY_INSTRUCTION_REQUIRED" });
    expect(await row("SELECT owner_prompt FROM standing_duties WHERE id = ?", WRITTEN)).toEqual({ owner_prompt: null });
    expect((await tool("change_duty", { id: WRITTEN, quote: words })).body.data).toMatchObject({ ok: true, state: "edited" });
    expect(await row("SELECT owner_prompt FROM standing_duties WHERE id = ?", WRITTEN))
      .toEqual({ owner_prompt: expect.stringContaining(words) });
    expect(await all("SELECT id FROM judgement_calls WHERE resume_kind = 'duty_edit'")).toEqual([]);
  });

  it("rolls back the version when the duty cannot be updated and retries it once", async () => {
    const words = "Count the attic frames on the next studio recount and every one after.";
    const { tool } = await readInstruction(words);
    await env.DB.prepare(`CREATE TRIGGER fixture_duty_write_failed BEFORE UPDATE OF owner_prompt ON standing_duties
      WHEN OLD.id = '${WRITTEN}' BEGIN SELECT RAISE(ABORT, 'fixture duty write unavailable'); END`).run();
    try {
      const failed = await tool("change_duty", { id: WRITTEN, quote: words });
      expect(failed.status).toBe(500);
      expect(await row("SELECT owner_prompt FROM standing_duties WHERE id = ?", WRITTEN)).toEqual({ owner_prompt: null });
      expect(await all("SELECT id FROM duty_versions WHERE duty_id = ?", WRITTEN)).toEqual([]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fixture_duty_write_failed").run();
    }
    expect((await tool("change_duty", { id: WRITTEN, quote: words })).body.data).toMatchObject({ ok: true, state: "edited", version: 1 });
    expect(await all("SELECT action FROM duty_versions WHERE duty_id = ? ORDER BY version", WRITTEN))
      .toEqual([{ action: "original" }, { action: "edit" }]);
  });

  it("sends a fixed-step duty's change to Danielle in the repo that holds its steps, not to a research page", async () => {
    const words = "Change to Camille's Marketplace listings duty (my ruling). Your call.\n\nBefore each refresh, use our real job photos first.";
    const { tool } = await readInstruction(words);
    const change = await tool("change_duty", { id: FIXED, quote: words });
    expect(change.body.data).toMatchObject({ ok: true, state: "handed_to_danielle", repo: "seq23/seq-bin" });
    expect((await tool("change_duty", { id: FIXED, quote: words })).body.data).toEqual(change.body.data);
    const tasks = await all<{ id: string; employee_id: string; input: string }>(`SELECT id, employee_id, input FROM tasks WHERE employee_id <> 'emp_chief'`);
    expect(tasks.map((t) => t.employee_id)).toEqual(["emp_repo"]);
    const input = JSON.parse(tasks[0]!.input);
    expect(input.duty_id).toBe(FIXED);
    expect(input.body).toContain("seq23/seq-bin");
    expect(input.body).toContain("~/bin/pnp-listings-job.md");
    expect(input.body).toContain("real job photos first");
    expect(input.body).not.toMatch(/^research:/m);
    expect(await row("SELECT owner_prompt FROM standing_duties WHERE id = ?", FIXED)).toEqual({ owner_prompt: null });
    const changes = await all<{ github_repo: string; task_id: string }>(`SELECT github_repo, task_id FROM repo_changes`);
    expect(changes.map((c) => c.github_repo)).toEqual(["seq23/seq-bin"]);
    expect(changes[0]!.task_id).toBe(tasks[0]!.id);
  });

  it("the employee page's own 'ask Danielle to change how it works' route opens the same real repo change, not a task no lane can act on", async () => {
    const { status, body } = await apiJson<{ data: { task_id: string | null; created: boolean } }>(`/api/duties/${FIXED}/ask-change`, {
      method: "POST",
      body: { text: "Before each refresh, use our real job photos first." },
    });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.data.created, JSON.stringify(body)).toBe(true);
    const tasks = await all<{ id: string; employee_id: string; input: string }>(`SELECT id, employee_id, input FROM tasks`);
    expect(tasks.map((t) => t.employee_id)).toEqual(["emp_repo"]);
    const input = JSON.parse(tasks[0]!.input);
    expect(input.body).toContain("seq23/seq-bin");
    expect(input.body).toContain("~/bin/pnp-listings-job.md");
    expect(input.body).toContain("real job photos first");
    const changes = await all<{ github_repo: string; task_id: string }>(`SELECT github_repo, task_id FROM repo_changes`);
    expect(changes.map((c) => c.github_repo)).toEqual(["seq23/seq-bin"]);
    expect(changes[0]!.task_id).toBe(tasks[0]!.id);
    expect(body.data.task_id).toBe(tasks[0]!.id);
  });
});
