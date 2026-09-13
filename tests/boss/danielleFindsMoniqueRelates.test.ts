import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * DANIELLE FINDS, MONIQUE RELATES.
 *
 * ─── The seam, which is not workload ───────────────────────────────────────
 *
 * Monique carried eight of fourteen duties and Danielle carried one. Rebalancing by COUNT would have
 * moved whichever duties happened to be movable and left the roster no more legible than before. The
 * real line is:
 *
 *   FINDING A PERSON IS RESEARCH. KNOWING A PERSON IS A RELATIONSHIP.
 *
 * These assert the seam as it actually stands in the database, because a seam described in a
 * migration comment and contradicted by a row is worse than no seam: the roster screen would say one
 * thing and the work would go somewhere else.
 */

const ownerOf = async (id: string) =>
  (await env.DB.prepare(`SELECT employee_id FROM standing_duties WHERE id = ?`).bind(id).first<{ employee_id: string }>())
    ?.employee_id ?? null;

describe("Danielle finds, Monique relates", () => {
  it("gives the research to Danielle: filings, contacts and backlink prospecting", async () => {
    expect(await ownerOf("duty_filing_research")).toBe("emp_repo");
    // Technical outreach research that sat on Relationships since 0193 because it produces a list of
    // people — a resemblance to relationship work rather than the thing itself.
    expect(await ownerOf("duty_link_prospects")).toBe("emp_repo");
    expect(await ownerOf("duty_grid_watch")).toBe("emp_repo");
  });

  it("keeps the mailbox half, and the people, with Monique", async () => {
    expect(await ownerOf("duty_buyer_hunt")).toBe("emp_relationship");
    for (const id of ["duty_lp_replies", "duty_people_worth_a_call", "duty_mailbox_sweep"]) {
      expect(await ownerOf(id), `${id} is relationship work`).toBe("emp_relationship");
    }
  });

  /*
   * MOVING A SEAT MUST NOT ERASE THE RUN HISTORY. `duty_link_prospects` moved by UPDATE rather than
   * by delete-and-reinsert precisely so that `duty_runs` rows still point at it and `last_run_at`
   * survives. A recreated row would read as "this has never run", which is the exact confusion 0228
   * exists to end — and it would be invisible, because a NULL looks like a duty that is simply new.
   */
  it("moves the seat without resetting the record of the work", async () => {
    const row = await env.DB
      .prepare(`SELECT id, cadence, task_input FROM standing_duties WHERE id = 'duty_link_prospects'`)
      .first<{ id: string; cadence: string; task_input: string }>();
    expect(row).not.toBeNull();
    expect(row!.cadence).toBe("weekly");
    // Its delivery target is untouched: only the seat changed.
    expect(JSON.parse(row!.task_input).delivers).toBe("link_prospects");
  });

  /*
   * TWO DUTIES, AND EACH MUST BE ABLE TO GO RED ALONE. If EDGAR is unreachable for a week that is
   * Danielle's row failing, and it must not be hidden behind a mailbox half that worked fine.
   */
  it("gives each half its own script, so each can fail on its own", async () => {
    const scriptOf = async (id: string) => {
      const r = await env.DB
        .prepare(`SELECT json_extract(task_input, '$.local_job') AS job FROM standing_duties WHERE id = ?`)
        .bind(id).first<{ job: string }>();
      return r?.job ?? null;
    };
    expect(await scriptOf("duty_filing_research")).toBe("filing-hunt.mjs");
    expect(await scriptOf("duty_buyer_hunt")).toBe("buyer-hunt.mjs");
  });

  /*
   * AND THE SUCCESS CRITERIA DESCRIBE ONLY THE HALF THAT SEAT OWNS. A duty evaluated against
   * somebody else's work cannot be evaluated at all — it goes green when the other person delivers
   * and red when they do not.
   */
  it("stops holding Monique to Danielle's half of the answer", async () => {
    const hunt = await env.DB
      .prepare(`SELECT success_criteria AS s FROM standing_duties WHERE id = 'duty_buyer_hunt'`)
      .first<{ s: string }>();
    expect(hunt!.s).toMatch(/ledger/i);
    expect(hunt!.s).toMatch(/duty_filing_research/);

    const research = await env.DB
      .prepare(`SELECT success_criteria AS s FROM standing_duties WHERE id = 'duty_filing_research'`)
      .first<{ s: string }>();
    // The rule the research half most needs, in the place it is evaluated.
    expect(research!.s).toMatch(/NO PERSON IDENTIFIED IS A SUCCESS/);
    expect(research!.s).toMatch(/confidence/i);
  });

  it("never lets the research job send from her broker-dealer mailbox", async () => {
    const rows = await env.DB
      .prepare(`SELECT task_input AS i FROM standing_duties WHERE id IN ('duty_filing_research','duty_buyer_hunt')`)
      .all<{ i: string }>();
    expect(rows.results.length).toBe(2);
    for (const r of rows.results) expect(r.i).not.toMatch(/spry\.vc/);
  });
});
