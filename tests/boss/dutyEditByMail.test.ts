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
  it("edits a duty's written instructions at once on 'your call', undoably, and never opens a research page", async () => {
    const res = await handleBossInboundMail(mail("", "Change to Camille's gallery frames recount duty: from now on count the attic too. Your call."), env as never);
    expect(res.outcome).toBe("DUTY_EDITED");
    const d = await row<{ owner_prompt: string | null }>(`SELECT owner_prompt FROM standing_duties WHERE id = '${WRITTEN}'`);
    expect(d!.owner_prompt).toContain("Count the frames in the studio");
    expect(d!.owner_prompt).toContain("count the attic too");
    const versions = await all<{ action: string }>(`SELECT action FROM duty_versions WHERE duty_id = '${WRITTEN}' ORDER BY version`);
    expect(versions.map((v) => v.action)).toEqual(["original", "edit"]);
    expect((await all(`SELECT id FROM tasks WHERE employee_id = 'emp_research'`)).length).toBe(0);
    expect(res.reply).toMatch(/Changed\./);
  });

  it("without 'your call' it waits on her approval and changes nothing yet", async () => {
    const res = await handleBossInboundMail(mail("", "Change to Camille's gallery frames recount duty: from now on count the attic too."), env as never);
    expect(res.outcome).toBe("DUTY_EDIT_DRAFTED");
    expect((await row<{ owner_prompt: string | null }>(`SELECT owner_prompt FROM standing_duties WHERE id = '${WRITTEN}'`))!.owner_prompt).toBeNull();
    expect((await all(`SELECT id FROM judgement_calls WHERE resume_kind = 'duty_edit'`)).length).toBeGreaterThan(0);
  });

  it("sends a fixed-step duty's change to Danielle in the repo that holds its steps, not to a research page", async () => {
    const res = await handleBossInboundMail(mail("", "Change to Camille's Marketplace listings duty (my ruling). Your call.\n\nBefore each refresh, use our real job photos first."), env as never);
    expect(res.outcome).toBe("DUTY_CHANGE_ROUTED");
    const tasks = await all<{ id: string; employee_id: string; input: string }>(`SELECT id, employee_id, input FROM tasks`);
    expect(tasks.map((t) => t.employee_id)).toEqual(["emp_repo"]);
    const input = JSON.parse(tasks[0]!.input);
    expect(input.duty_id).toBe(FIXED);
    expect(input.body).toContain("seq23/seq-bin");
    expect(input.body).toContain("~/bin/pnp-listings-job.md");
    expect(input.body).toContain("real job photos first");
    expect(input.body).not.toMatch(/^research:/m);
    expect(res.reply).toMatch(/not changed yet/);
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
