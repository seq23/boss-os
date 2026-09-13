import { env } from "cloudflare:test";
import { BRIEFING_SECTIONS } from "@worker/boss/today/briefing";
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

  /*
   * THIS TEST ASSERTED THE DEFECT, and updating it is the point rather than a concession.
   *
   * It filed ONE section, claimed `status: "complete"`, and expected "complete" back — because the
   * old delivery WROTE DOWN WHATEVER STATUS THE RUN CLAIMED. That was the one field in the whole
   * payload nothing ever checked, and it is why a run that filed all eleven sections could report
   * "partial" and be believed, and why one that filed a single section could have reported
   * "complete" and been believed too.
   *
   * The status is DERIVED now. A report carrying one of §5's eleven sections is partial, and it
   * says which ten are missing.
   */
  it("derives a partial status from what was actually filed, not from what the run claimed", async () => {
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
    expect(report.status).toBe("partial");
    expect(JSON.parse(report.sections)).toHaveLength(1);
    // And it names WHY, so the word does not send her looking for what is wrong.
    expect(JSON.parse(report.shortfalls).join(" ")).toMatch(/section/i);
  });

  /*
   * THE OTHER HALF OF THE SAME RULE, and the one the live defect was about: a report that filed
   * everything §5 asks for is COMPLETE however long its `watching` list is. Four forward-looking
   * notes — Monday's launch, an IPO date not yet set — made a full report call itself partial.
   */
  it("is complete when every section is filed, however much it is watching for", async () => {
    await seedTask({ delivers: "executive_reports", backend_id: "bk_claude_code" });
    const sources = [{ name: "CNBC", url: "https://www.cnbc.com/x", read_at: "2026-09-13T20:35:00Z" }];
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded",
      report: {
        status: "partial",
        summary: "All of it.",
        sections: BRIEFING_SECTIONS.map((b) => ({
          key: b.key,
          heading: b.title,
          so_what: "Something to watch.",
          bullets: ["A development with no figure in it."],
          /*
           * THE INSIGHT HAS TO STAND UP, and the first draft of this test learned that the hard
           * way: filing an `investor_insight` section with bullets and no insight object is a
           * section that exists and cannot be grounded, which is a real shortfall and correctly
           * made the report partial. The fixture files an insight built from the day's own words.
           */
          ...(b.key === "investor_insight"
            ? {
                insight: {
                  synthesis: "A development with no figure in it is still a development.",
                  how_reached: "The same development appears in every section of this fixture.",
                  transferable_frame: "Ask what is being asserted when nothing is being measured.",
                  falsified_by: "A figure appearing anywhere in the report.",
                  cites: [{ fact: "A development with no figure in it.", from: "ai_technology" }],
                },
              }
            : {}),
        })),
        sources,
        watching: [{ wanted: "Monday's launch outcome" }, { wanted: "An IPO date not yet set" }],
      },
    });

    const report = await row<any>(`SELECT * FROM executive_reports WHERE task_id = ?`, TASK);
    expect(report.status).toBe("complete");
    expect(JSON.parse(report.shortfalls)).toHaveLength(0);
    expect(JSON.parse(report.watching)).toHaveLength(2);
  });

  /*
   * THE $72 RULE, END TO END. A section that prints a figure and cites nothing does not reach her.
   */
  it("withholds a section that prints a figure and names no source", async () => {
    await seedTask({ delivers: "executive_reports", backend_id: "bk_claude_code" });
    await deliverExecutiveReport(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded",
      report: {
        status: "complete",
        summary: "One figure, no source.",
        /*
         * A POST-RULE REPORT IS ONE WHERE SOMETHING CITES. This fixture failed at first with only
         * the uncited section in it, and it was right to: a report where nothing anywhere carries a
         * source predates the rule and is rendered whole, because holding historical reports to a
         * rule that did not exist emptied her screen the moment it shipped. So the fixture files a
         * properly cited section alongside the offender, which is what a real morning looks like.
         */
        sections: [
          { key: "markets_dashboard", heading: "Markets & Macro Dashboard", bullets: ["Brent fell 2.8% to ~$72/bbl."] },
          { key: "one_thing_to_watch", heading: "One Thing to Watch", bullets: ["A move worth $1 billion."], sources: [0] },
        ],
        sources: [{ name: "CNBC", url: "https://www.cnbc.com/x", read_at: "2026-09-13T20:35:00Z" }],
      },
    });

    /*
     * THE SECTION IS STORED AND NOT SHOWN, which is deliberate and was worth learning from a failed
     * assertion. Dropping it at the WRITE end would destroy research she paid for — the same reason
     * the old `slice(0, 4)` was moved off the write side — so the row keeps what the run filed and
     * the READ end withholds it, named, with its reason. What the delivery records is the verdict:
     * the report is partial, and the shortfall says it printed figures with no source.
     */
    const report = await row<any>(`SELECT * FROM executive_reports WHERE task_id = ?`, TASK);
    expect(JSON.parse(report.sections)).toHaveLength(2);
    expect(report.status).toBe("partial");
    expect(JSON.parse(report.shortfalls).join(" ")).toMatch(/no source/i);
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
    /*
     * ONE ROW PER DAY is what this test is about, and the retry's summary proves the replacement
     * happened. The STATUS is now derived from what was filed — neither delivery here files a
     * section, so both are partial — so asserting "complete" would be asserting the old defect,
     * where the run's own claim was written down unchecked.
     */
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
    expect(input.prompt).toMatch(/\$20M\+ strongly preferred/);
    /*
     * IT MUST TELL THE RUN THAT A SMALL ANSWER IS A GOOD ANSWER, or it pads. The wording changed
     * when the sweep became incremental — "ten well-sourced names" was right for a first sweep of
     * the whole universe and wrong for a daily hunt for what changed, where two is a good day and
     * zero is legitimate.
     */
    expect(input.prompt).toMatch(/TWO GOOD NEW NAMES IS A GOOD DAY/);
    expect(input.prompt).toMatch(/zero is a real answer/i);
    // And it must not re-deliver what she already has, which is what made a daily run expensive.
    expect(input.prompt).toContain("KNOWN.json");
    expect(input.prompt).toMatch(/DO NOT DELIVER ANY OF THEM AGAIN/);
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
    expect(input.prompt).toMatch(/AFTER EVERY CANDIDATE YOU VERIFY, not at the end/);
    expect(input.prompt).toMatch(/hard timeout/i);
    /*
     * ── THE FIVE-MINUTE CEILING WAS DISPROVEN BY THE RUN LOG, SO IT IS A FLOOR NOW ────────────
     *
     * This asserted `<= 600` on the reasoning that "hunting only what changed, five is enough — and
     * her budget is $25 a month for everything, so a run that can wander for half an hour is the
     * problem." Both halves turned out to be wrong, and they were checked rather than argued:
     *
     *   · ~/Library/Logs/boss-agent/agent.log records this duty starting at 1788957143326 and being
     *     killed at 1788957443573 — 300.2s, exit 124. Five minutes is not enough. It has been dying
     *     on that leash and the Capital tab has been running on results that stopped arriving.
     *   · The budget argument does not hold either: measured spend over thirty days is $0 across
     *     five calls, because this backend runs on her own subscription and records cost_micros 0 by
     *     design. THE MODEL IS THE COST LEVER, NOT THE CLOCK — 0196's model fix produced all of the
     *     saving, and the leash was belt-and-braces on a problem already solved.
     *
     * SO THE ASSERTION IS STRICTER THAN IT WAS, NOT LOOSER. It was one-sided and now it is a band:
     * a floor so the next cost sweep cannot cut it back below what the run demonstrably needs, and a
     * ceiling so it can never become unbounded. Either direction fails this test.
     */
    expect(input.requested.max_seconds).toBeGreaterThanOrEqual(900);
    expect(input.requested.max_seconds).toBeLessThanOrEqual(1200);
    // Every duty names its model now. Defaulting to the most expensive one is what cost $3.88.
    expect(input.requested.model).toBeTruthy();
  });

  it("has its own workspace, separate from the report's", async () => {
    // Two runs writing delivers.json into one directory would race and overwrite each other.
    const s = JSON.parse((await row<any>(`SELECT task_input FROM standing_duties WHERE id = 'duty_brokerage_sourcing'`)).task_input);
    const r = JSON.parse((await row<any>(`SELECT task_input FROM standing_duties WHERE id = 'duty_exec_intel'`)).task_input);
    expect(s.requested.repo_path).not.toBe(r.requested.repo_path);
  });
});

/**
 * KENDRA'S TOOL SUGGESTIONS — and the one rule that makes them worth anything.
 *
 * Her ask was to stop having to go looking for tools herself, and the example that defined the
 * problem was "ex software lightreel.ai i dont know if its good or not." That question cannot be
 * answered by the vendor: every landing page says the product is excellent.
 */
describe("tool suggestions refuse the vendor as its own evidence", () => {
  const TASK = "tsk_tools_test";
  const CONTRACT = { delivers: "tool_suggestions", backend_id: "bk_claude_code" };

  async function seed(input: Record<string, unknown>) {
    await env.DB.prepare(`DELETE FROM tool_suggestions`).run();
    await env.DB.prepare(`DELETE FROM tasks WHERE id = ?`).bind(TASK).run();
    await env.DB.prepare(
      `INSERT INTO tasks (id, lane, title, input, status, created_at) VALUES (?, 'ops', 'Tools', ?, 'running', ?)`,
    ).bind(TASK, JSON.stringify(input), Date.now()).run();
  }

  const deliver = async (tools: unknown[]) => {
    const { deliverToolSuggestions } = await import("../../src/worker/boss/duties/deliverReport");
    return deliverToolSuggestions(env as any, {
      taskId: TASK, runId: uid("brn"), runStatus: "succeeded", payload: { tools },
    });
  };

  it("marks a tool UNPROVEN when the only source is the vendor's own site", async () => {
    await seed(CONTRACT);
    const out = await deliver([{
      name: "Lightreel", url: "https://lightreel.ai/pricing", what_it_does: "Short-form video",
      verdict: "Looks excellent", evidence: "Their homepage says so", evidence_url: "https://www.lightreel.ai/",
    }]);
    expect(out!.unproven).toBe(1);

    const row = await row2();
    expect(row.verdict).toMatch(/^UNPROVEN/);
    // The vendor link is removed rather than stored as if it were evidence.
    expect(row.evidence_url).toBeNull();
    expect(row.evidence).toMatch(/vendor's own site/i);
  });

  const row2 = async () => row<any>(`SELECT * FROM tool_suggestions LIMIT 1`);

  it("keeps a verdict backed by an independent source", async () => {
    await seed(CONTRACT);
    const out = await deliver([{
      name: "Lightreel", url: "https://lightreel.ai/", what_it_does: "Short-form video",
      serves: "digital_products", price_note: "$29/mo", free_tier: true,
      instead_of: "Editing by hand, or CapCut free",
      verdict: "Fine for talking-head clips, weak for anything with b-roll",
      evidence: "A creator's teardown after 3 months of use",
      evidence_url: "https://someblog.example/lightreel-after-three-months",
    }]);
    expect(out!.unproven).toBe(0);
    const r = await row2();
    expect(r.verdict).not.toMatch(/UNPROVEN/);
    expect(r.serves).toBe("digital_products");
    expect(r.free_tier).toBe(1);
    // What it replaces is the half that keeps costs down.
    expect(r.instead_of).toContain("CapCut");
  });

  it("marks it unproven when no evidence is offered at all", async () => {
    await seed(CONTRACT);
    const out = await deliver([{ name: "X", url: "https://x.example/", what_it_does: "Does a thing" }]);
    expect(out!.unproven).toBe(1);
    expect((await row2()).verdict).toMatch(/^UNPROVEN/);
  });

  it("never invents a price", async () => {
    // A guessed price is the one number that turns a suggestion into a bad decision.
    await seed(CONTRACT);
    await deliver([{ name: "Y", url: "https://y.example/", what_it_does: "Thing", evidence_url: "https://z.example/r" }]);
    expect((await row2()).price_note).toBeNull();
  });

  it("everything lands as a suggestion, never adopted", async () => {
    await seed(CONTRACT);
    await deliver([{ name: "Z", url: "https://z.example/", what_it_does: "Thing", evidence_url: "https://q.example/r" }]);
    expect((await row2()).status).toBe("new");
  });
});
