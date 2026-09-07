import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { deliverExecutiveReport } from "../../src/worker/boss/duties/deliverReport";
import { row, uid, all } from "./helpers";

/**
 * THE REPORT NOBODY WROTE.
 *
 * `executive_reports` has existed since migration 0176. `today.ts` reads it on every page load. The
 * duty that produces it fired at 06:30 Central every morning. And nothing anywhere in the worker
 * held an `INSERT INTO executive_reports` — so the Executive Briefing block rendered its "no report
 * yet" state, correctly, for ever.
 *
 * A missing writer is invisible to every test that checks the reader. These check the writer.
 */

const TASK = "tsk_report_test";

async function seedTask(input: Record<string, unknown>) {
  await env.DB.prepare(`DELETE FROM tasks WHERE id = ?`).bind(TASK).run();
  await env.DB.prepare(
    `INSERT INTO tasks (id, lane, title, input, status, created_at) VALUES (?, 'ops', 'Executive Intelligence Report', ?, 'running', ?)`,
  ).bind(TASK, JSON.stringify(input), Date.now()).run();
}

describe("delivering the executive intelligence report", () => {
  beforeEach(async () => {
    await env.DB.prepare(`DELETE FROM executive_reports`).run();
  });

  it("writes the day's report when the task was contracted to deliver one", async () => {
    await seedTask({ delivers: "executive_reports", backend_id: "bk_claude_code" });
    const id = await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded",
      report: {
        status: "complete",
        summary: "Two things moved.",
        sections: [{ heading: "Secondaries", body: "..." }],
        sources: [{ name: "example", read_at: 1 }],
      },
    });
    expect(id).toBeTruthy();

    const report = await row<any>(`SELECT * FROM executive_reports WHERE task_id = ?`, TASK);
    expect(report).not.toBeNull();
    expect(report.status).toBe("complete");
    expect(JSON.parse(report.sections)).toHaveLength(1);
  });

  it("delivers nothing for a task that was not contracted to — the ordinary case", async () => {
    // Every other backend run reaches this function too. Treating "no contract" as an error would
    // make repo work fail on a report path it has nothing to do with.
    await seedTask({ backend_id: "bk_claude_code" });
    const id = await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded", report: { status: "complete" },
    });
    expect(id).toBeNull();
    expect(await row(`SELECT id FROM executive_reports`)).toBeNull();
  });

  it("refuses to call a report complete when it lists gaps", async () => {
    /*
     * The spec's criterion is that anything unverified is listed as a gap rather than omitted. A
     * report that lists gaps and calls itself complete has quietly redefined the word, and it is the
     * runner — not this side — that would be making the claim.
     */
    await seedTask({ delivers: "executive_reports" });
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded",
      report: { status: "complete", summary: "Mostly.", gaps: [{ wanted: "LP flows", why: "source down" }] },
    });
    const report = await row<any>(`SELECT status, gaps FROM executive_reports WHERE task_id = ?`, TASK);
    expect(report.status).toBe("partial");
    expect(JSON.parse(report.gaps)).toHaveLength(1);
  });

  it("still writes a row when the run failed, so the block can say when the last good one was", async () => {
    await seedTask({ delivers: "executive_reports" });
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "failed", report: null,
    });
    const report = await row<any>(`SELECT status, summary FROM executive_reports WHERE task_id = ?`, TASK);
    expect(report.status).toBe("failed");
    // An unexplained blank looks identical to "nothing ran". This says which.
    expect(report.summary).toBeTruthy();
  });

  it("calls an unlabelled success partial rather than complete", async () => {
    await seedTask({ delivers: "executive_reports" });
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded", report: { summary: "Something." },
    });
    const report = await row<any>(`SELECT status FROM executive_reports WHERE task_id = ?`, TASK);
    expect(report.status).toBe("partial");
  });

  it("keeps one row per day, replacing a partial morning with a better retry", async () => {
    await seedTask({ delivers: "executive_reports" });
    const day = "2026-09-07";
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded",
      report: { day_id: day, status: "partial", summary: "Half of it.", gaps: [{ wanted: "x" }] },
    });
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded",
      report: { day_id: day, status: "complete", summary: "All of it." },
    });

    const rows = await env.DB.prepare(`SELECT status, summary FROM executive_reports WHERE day_id = ?`).bind(day).all();
    expect(rows.results).toHaveLength(1);
    expect((rows.results![0] as any).status).toBe("complete");
    expect((rows.results![0] as any).summary).toBe("All of it.");
  });

  it("files the report under the Central day, not the UTC one", async () => {
    /*
     * 06:30 Central is already the next day in UTC for half the year — which is exactly how a
     * report generated at her breakfast files itself under tomorrow and the block shows nothing.
     */
    await seedTask({ delivers: "executive_reports" });
    const at = Date.parse("2026-09-07T06:30:00-05:00");
    expect(new Date(at).toISOString().slice(0, 10)).toBe("2026-09-07");
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded", report: { status: "complete" }, now: at,
    });
    const report = await row<any>(`SELECT day_id FROM executive_reports WHERE task_id = ?`, TASK);
    expect(report.day_id).toBe("2026-09-07");

    // And the case that actually bites: late evening Central is already tomorrow in UTC.
    await env.DB.prepare(`DELETE FROM executive_reports`).run();
    const evening = Date.parse("2026-09-07T20:00:00-05:00");
    expect(new Date(evening).toISOString().slice(0, 10)).toBe("2026-09-08");
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded", report: { status: "complete" }, now: evening,
    });
    const late = await row<any>(`SELECT day_id FROM executive_reports WHERE task_id = ?`, TASK);
    expect(late.day_id).toBe("2026-09-07");
  });
});

/**
 * THE HOP THAT WAS NOT THERE: a queued task reaching her Mac instead of a cloud model.
 *
 * The consumer's only move was `routeCompletion`. For the report that is not a slower answer but a
 * wrong one — a Worker cannot read this morning's news, and a model asked to recall it returns
 * something shaped exactly like a report, citing sources it never opened.
 */
describe("the delivery contract survives the dispatch endpoint", () => {
  it("carries `delivers` onto the task, or a hand-dispatched report is silently dropped", async () => {
    /*
     * FOUND BY DISPATCHING THE REAL REPORT, NOT BY READING THE CODE. The run researched for ten
     * minutes, wrote a good `delivers.json`, reported it — and the Executive Briefing block still
     * said no report had ever been produced, because the endpoint wrote a task input of
     * { prompt, backend_id, kind } and `deliverExecutiveReport` reads `input.delivers` to decide
     * whether a run's output is a report at all. The duty carried the contract; a hand dispatch did
     * not, which is exactly the path anyone re-running a failed morning would take.
     */
    const { apiJson } = await import("./helpers");
    const { status, body } = await apiJson("/api/backends/dispatch", {
      method: "POST",
      body: {
        title: "Executive Intelligence Report",
        prompt: "Produce the report.",
        kind: "research",
        backend_id: "bk_claude_code",
        lane: "ops",
        delivers: "executive_reports",
      },
    });
    expect(status).toBe(201);
    const task = await row<any>(`SELECT input FROM tasks WHERE id = ?`, body.data.run.task_id);
    expect(JSON.parse(task.input).delivers).toBe("executive_reports");
  });

  it("writes no contract when none was asked for", async () => {
    const { apiJson } = await import("./helpers");
    const { body } = await apiJson("/api/backends/dispatch", {
      method: "POST",
      body: { title: "Repo work", prompt: "Do the thing.", kind: "repo_work", backend_id: "bk_claude_code", lane: "ops" },
    });
    const task = await row<any>(`SELECT input FROM tasks WHERE id = ?`, body.data.run.task_id);
    expect(JSON.parse(task.input).delivers).toBeUndefined();
  });
});

describe("a task that names a backend leaves the cloud", () => {
  it("dispatches a claimable run instead of asking a model, and never calls out", async () => {
    const { handleTask } = await import("../../src/worker/boss/queue/consumer");
    const { insertTask, stubFetch } = await import("./helpers");

    // Any egress at all is the failure this test exists to catch: if the consumer fell through to
    // the router, a provider call would be attempted here.
    let calls = 0;
    const restore = stubFetch(() => { calls++; return new Response("{}", { status: 200 }); });
    try {
      const taskId = await insertTask({
        status: "queued",
        title: "Executive Intelligence Report",
        input: JSON.stringify({ backend_id: "bk_claude_code", delivers: "executive_reports" }),
        intake_kind: "research",
      });

      await handleTask(env as any, { taskId, lane: "ops" });

      const run = await row<any>(`SELECT id, backend_id, status FROM backend_runs WHERE task_id = ?`, taskId);
      expect(run, "no backend run was created — the task fell through to the cloud router").not.toBeNull();
      expect(run.backend_id).toBe("bk_claude_code");
      expect(run.status).toBe("running");
      expect(calls, "the consumer called a provider for work that belongs on her machine").toBe(0);

      // The task stays running: it is not done, and it is not awaiting HER — it is awaiting a claim.
      const task = await row<any>(`SELECT status FROM tasks WHERE id = ?`, taskId);
      expect(task.status).toBe("running");

      const event = await row(`SELECT id FROM task_events WHERE task_id = ? AND event = 'dispatched'`, taskId);
      expect(event).not.toBeNull();
    } finally {
      restore();
    }
  });
});

/**
 * THE BROKERAGE SOURCING SWEEP — the motion this business has never had.
 *
 * Her account: no system at all, taking calls as they come. A business running purely on inbound
 * has a funnel fed by nothing. West Peek already has an agent surfacing LPs daily; this is the same
 * shape pointed at buyers, and her instruction was plain: "this area of my life is going poorly and
 * it should help me."
 */
describe("delivering brokerage sourcing candidates", () => {
  const TASK = "tsk_sourcing_test";

  async function seed(input: Record<string, unknown>) {
    await env.DB.prepare(`DELETE FROM sourcing_candidates`).run();
    await env.DB.prepare(`DELETE FROM tasks WHERE id = ?`).bind(TASK).run();
    await env.DB.prepare(
      `INSERT INTO tasks (id, lane, title, input, status, created_at) VALUES (?, 'ops', 'Brokerage Sourcing Sweep', ?, 'running', ?)`,
    ).bind(TASK, JSON.stringify(input), Date.now()).run();
  }

  const CONTRACT = { delivers: "sourcing_candidates", backend_id: "bk_claude_code" };

  it("stores a well-sourced candidate", async () => {
    const { deliverSourcingCandidates } = await import("../../src/worker/boss/duties/deliverReport");
    await seed(CONTRACT);
    const out = await deliverSourcingCandidates(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded",
      payload: {
        candidates: [{
          name: "Example Secondaries Partners", kind: "buyer", ticket_floor_usd: 20_000_000,
          thesis: "Direct secondaries programme in late-stage software.",
          source_url: "https://example.com/strategy", source_name: "Strategy page",
          read_at: "2026-09-07T12:00:00Z",
        }],
      },
    });
    expect(out).toEqual({ inserted: 1, skipped: 0 });

    const c = await row<any>(`SELECT * FROM sourcing_candidates`);
    expect(c.status).toBe("new");
    expect(c.origin).toBe("public_research");
    expect(c.ticket_floor_usd).toBe(20_000_000);
    expect(c.read_at).toBe(Date.parse("2026-09-07T12:00:00Z"));
  });

  it("drops a candidate with no source, because checking one costs her a phone call", async () => {
    /*
     * THE LOAD-BEARING RULE. The whole failure mode of automated sourcing is a plausible name nobody
     * can verify. The run is told this; being told is not a guarantee, so it is enforced here too.
     */
    const { deliverSourcingCandidates } = await import("../../src/worker/boss/duties/deliverReport");
    await seed(CONTRACT);
    const out = await deliverSourcingCandidates(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded",
      payload: { candidates: [{ name: "Plausible Capital", thesis: "Sounds right." }] },
    });
    expect(out).toEqual({ inserted: 0, skipped: 1 });
    expect(await row(`SELECT id FROM sourcing_candidates`)).toBeNull();
  });

  it("never promotes a web-found firm into her real network", async () => {
    /*
     * `people` and `relationships` drive the daily touch. A stranger silently becoming a
     * "relationship" would make the system lie about who she knows, which is the one thing that
     * would make the first money move worthless.
     */
    const { deliverSourcingCandidates } = await import("../../src/worker/boss/duties/deliverReport");
    await seed(CONTRACT);
    const before = await row<any>(`SELECT COUNT(*) AS n FROM people`);
    await deliverSourcingCandidates(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded",
      payload: { candidates: [{ name: "Example Two", source_url: "https://example.com/x" }] },
    });
    const after = await row<any>(`SELECT COUNT(*) AS n FROM people`);
    expect(after.n).toBe(before.n);
    expect((await row<any>(`SELECT status FROM sourcing_candidates`)).status).toBe("new");
  });

  it("re-runs without duplicating, and refreshes the source", async () => {
    const { deliverSourcingCandidates } = await import("../../src/worker/boss/duties/deliverReport");
    await seed(CONTRACT);
    const one = { name: "Same Firm", kind: "buyer", source_url: "https://example.com/old", thesis: "Old." };
    await deliverSourcingCandidates(env as any, { taskId: TASK, runId: uid("brn"), runStatus: "succeeded", payload: { candidates: [one] } });
    await deliverSourcingCandidates(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded",
      payload: { candidates: [{ ...one, source_url: "https://example.com/new", thesis: "New." }] },
    });
    const rows = await all(`SELECT thesis, source_url FROM sourcing_candidates`);
    expect(rows).toHaveLength(1);
    expect(rows[0].thesis).toBe("New.");
  });

  it("delivers nothing for a task not contracted to source", async () => {
    const { deliverSourcingCandidates } = await import("../../src/worker/boss/duties/deliverReport");
    await seed({ backend_id: "bk_claude_code" });
    expect(await deliverSourcingCandidates(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded", payload: { candidates: [{ name: "X", source_url: "u" }] },
    })).toBeNull();
  });

  it("writes nothing when the run failed", async () => {
    const { deliverSourcingCandidates } = await import("../../src/worker/boss/duties/deliverReport");
    await seed(CONTRACT);
    const out = await deliverSourcingCandidates(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "failed", payload: { candidates: [{ name: "X", source_url: "u" }] },
    });
    expect(out).toEqual({ inserted: 0, skipped: 0 });
    expect(await row(`SELECT id FROM sourcing_candidates`)).toBeNull();
  });
});

describe("the sourcing duty is scoped and honest about what it cannot do", () => {
  it("reads correspondents from a file and never touches a mailbox itself", async () => {
    /*
     * The email half runs now, and the shape of HOW it runs is the whole safety property.
     * `scripts/ops/gmail-metadata.mjs` reads the brokerage mailbox on her own machine with
     * `format=metadata` and an explicit header allowlist — Gmail never returns a subject, a snippet
     * or a body — and leaves CONTACTS.json in the workspace. The run reads that file.
     *
     * Claude's connector was the obvious route and the wrong one: it holds one account at a time,
     * hers is her personal Gmail, and it would pull live mandates and counterparties into a cloud
     * conversation.
     */
    const duty = await row<any>(`SELECT task_input FROM standing_duties WHERE id = 'duty_brokerage_sourcing'`);
    const input = JSON.parse(duty.task_input);
    expect(input.prompt).toContain("CONTACTS.json");
    expect(input.prompt).toMatch(/Do not read any mailbox yourself/i);
    // An absent file is a gap, not a licence to go hunting for the inbox.
    expect(input.prompt).toMatch(/do not go looking for a mailbox/i);
  });

  it("still refuses the half that would need her mail's contents", async () => {
    /*
     * Her third ask — clients who might want to buy something she recently discussed — needs subject
     * lines at minimum, which is materially more than metadata and more than she has agreed to. Two
     * of three honestly beats three of three where one was quietly invented.
     */
    const input = JSON.parse((await row<any>(`SELECT task_input FROM standing_duties WHERE id = 'duty_brokerage_sourcing'`)).task_input);
    expect(input.prompt).toMatch(/must not seek/i);
    expect(input.prompt).toMatch(/Record it in gaps as not run/i);
  });

  it("may not add anyone to her network from an inbox", async () => {
    // A mailbox is full of people who emailed once. Who she actually trusts is her judgement.
    const input = JSON.parse((await row<any>(`SELECT task_input FROM standing_duties WHERE id = 'duty_brokerage_sourcing'`)).task_input);
    expect(input.prompt).toMatch(/Do not add anyone to her network/i);
    expect(input.prompt).toMatch(/DO NOT infer what any relationship was about/i);
  });

  it("looks at who she stopped writing to, not just who stopped writing", async () => {
    /*
     * The decay this is built to catch is one-sided and silent. `days_since_she_wrote` is the signal;
     * `days_since_last` alone would rank a stranger's recent cold email above a five-year referral
     * source she has not contacted since June.
     */
    const input = JSON.parse((await row<any>(`SELECT task_input FROM standing_duties WHERE id = 'duty_brokerage_sourcing'`)).task_input);
    expect(input.prompt).toContain("days_since_she_wrote");
    expect(input.prompt).toMatch(/long relationship gone cold/i);
  });

  it("does not go near her email, and says so in its own instruction", async () => {
    /*
     * She asked for three things: web sourcing, contacts gone quiet in her brokerage inbox, and
     * missed connections between clients. Only the first can run — the inbox is offered but not
     * connected, and it is the most confidential material she owns. A duty that silently did two
     * thirds of its job would be the worst of both, so the prompt forbids the email half by name and
     * requires it to be reported as a gap.
     */
    const duty = await row<any>(`SELECT task_input, local_hour, local_minute FROM standing_duties WHERE id = 'duty_brokerage_sourcing'`);
    expect(duty).not.toBeNull();
    const input = JSON.parse(duty.task_input);
    expect(input.prompt).toMatch(/WHAT YOU MAY NOT DO/);
    expect(input.prompt).toMatch(/do not read any mailbox/i);
  });

  it("asks for the ticket size she actually wants", async () => {
    const duty = await row<any>(`SELECT task_input FROM standing_duties WHERE id = 'duty_brokerage_sourcing'`);
    const input = JSON.parse(duty.task_input);
    expect(input.prompt).toContain("$5M+");
    expect(input.prompt).toMatch(/\$20M\+ is strongly preferred/);
    // Ten sourced names beat fifty guesses — the instruction has to say so or it will pad.
    expect(input.prompt).toMatch(/Ten well-sourced names beat fifty guesses/);
  });

  it("runs after the report so the two never contend for the single work slot", async () => {
    const sourcing = await row<any>(`SELECT local_hour, local_minute FROM standing_duties WHERE id = 'duty_brokerage_sourcing'`);
    const report = await row<any>(`SELECT local_hour, local_minute FROM standing_duties WHERE id = 'duty_exec_intel'`);
    const mins = (d: any) => d.local_hour * 60 + d.local_minute;
    expect(mins(sourcing)).toBeGreaterThan(mins(report));
  });

  it("is told to write as it goes, because a timeout must degrade to partial", async () => {
    /*
     * THE FIRST LIVE RUN LOST FIFTEEN MINUTES OF WORK. It researched for the full 900s, was killed
     * by the hard timeout, and produced nothing: `stdout was not JSON`, an empty workspace, zero
     * candidates. The whole deliverable had been staked on reaching the last line.
     *
     * The kill is correct and stays — an unattended run that hangs holds the single work slot for
     * ever. What was wrong was the instruction. Web research is a loop over an unknown number of
     * slow lookups, so the file is rewritten after every verified candidate and a kill at minute 14
     * leaves thirteen minutes of names on disk.
     */
    const duty = await row<any>(`SELECT task_input FROM standing_duties WHERE id = 'duty_brokerage_sourcing'`);
    const input = JSON.parse(duty.task_input);
    expect(input.prompt).toMatch(/AFTER EVERY CANDIDATE YOU VERIFY — not at the end/);
    expect(input.prompt).toMatch(/killed without warning/i);
    expect(input.prompt).toMatch(/Do not batch the write/i);
    // Fifteen minutes was simply too short for the work.
    expect(input.requested.max_seconds).toBeGreaterThanOrEqual(1800);
  });

  it("has its own workspace, separate from the report's", async () => {
    // Two runs writing delivers.json into one directory would race and overwrite each other.
    const s = JSON.parse((await row<any>(`SELECT task_input FROM standing_duties WHERE id = 'duty_brokerage_sourcing'`)).task_input);
    const r = JSON.parse((await row<any>(`SELECT task_input FROM standing_duties WHERE id = 'duty_exec_intel'`)).task_input);
    expect(s.requested.repo_path).not.toBe(r.requested.repo_path);
  });
});
