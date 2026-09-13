/**
 * WHAT THE EXAMINATION FOUND ACROSS THE GRID, AND WHERE EACH PIECE OF IT GOES.
 *
 * `scripts/ops/grid-watch.mjs` runs daily on her Mac, reads the Actions, pull request and release
 * history of every non-excluded grid repository through `gh`, and files the result here. It changes
 * nothing in any repository; this is where what it saw becomes work.
 *
 * ─── THE SPLIT THIS ENDPOINT EXISTS TO ENFORCE ─────────────────────────────
 *
 *   "Anything an employee or a script can do must be DISPATCHED, not shown to her. Her slot gets
 *    only what needs HER — her judgement, her name, her signature, her voice."
 *
 * So a `dispatch` observation becomes a TASK owned by Danielle and never reaches Today's contract.
 * A `needs_her` observation is refused unless it can say what only she can do, and refused outright
 * on a property that is not `primary` — her generator is "fix only if broken" and the authority
 * network is "a cost centre, not a line — never a day's work".
 *
 * ─── The grid is read from the grid, not copied into a column ──────────────
 *
 * `property_key` must be a key `src/shared/boss/grid.mjs` declares. A key that file does not know is
 * REFUSED, so this table is a reference to the grid rather than a second copy of it — the same
 * construction `owned_deliverables.project_key` uses against `projects.ts`, and for the same reason:
 * the defect this repository names most often is two components each keeping their own list.
 *
 * ─── A DISPATCHED TASK IS NOT HANDED TO A MODEL, DELIBERATELY ──────────────
 *
 * It is created `queued` and NOT enqueued on `boss_task_queue`, and it carries `input.grid_fix` so
 * that the drain in `bossMount.ts` would refuse it even if somebody later enqueued it — the same
 * guard `input.hunt` already has, and for a sharper reason. Fixing a red workflow means working
 * inside one of her repositories, and her standing rule is ONE AGENT PER REPO, learned when three
 * agents in one repo turned forty minutes of work into four hours. A job that reached into a dozen
 * repositories and started editing them would break that rule twelve times in a single run.
 *
 * So the dispatch is real and it is bounded: the work is named, owned by Danielle, on the board, and
 * escalating through the stale-task alert like any other. Who actually opens the branch is a
 * decision a person makes, one repo at a time.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { ok, badRequest } from "../lib/http";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { GRID, propertyFor } from "../../../shared/boss/grid.mjs";

export const grid = new Hono<{ Bindings: Env; Variables: Vars }>();

/** Who fixes what the examination found. Technical Program Management, not Relationships. */
const REPO_SEAT = "emp_repo";

type Incoming = {
  property_key?: string;
  repo?: string;
  kind?: string;
  disposition?: string;
  needs_her_why?: string | null;
  headline?: string;
  evidence?: string;
  observed_at?: number;
};

grid.get("/", async (c) => {
  const last = await c.env.DB
    .prepare(
      `SELECT id, started_at, finished_at, properties_expected, properties_examined,
              observations, dispatched, needs_her, outcome, note
         FROM grid_examinations ORDER BY started_at DESC LIMIT 1`,
    )
    .first();

  const open = await c.env.DB
    .prepare(
      `SELECT id, property_key, repo, kind, disposition, needs_her_why, headline, evidence,
              observed_at, state
         FROM grid_observations
        WHERE state IN ('open','dispatched')
        ORDER BY disposition DESC, observed_at ASC`,
    )
    .all();

  return ok(c, {
    /*
     * THE GRID ITSELF IS PART OF THE ANSWER. A screen showing three observations cannot tell whether
     * the other nine properties are healthy or were never looked at, and those are opposite facts.
     */
    grid: GRID.map((p) => ({ key: p.key, label: p.label, repos: p.repos, owner: p.owner, tier: p.tier })),
    last_examination: last ?? null,
    open: open.results ?? [],
  });
});

grid.post("/examination", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  if (!b || !Array.isArray(b.observations)) {
    throw badRequest("An examination needs its observations", "Even an empty list, so a run that found nothing is distinguishable from one that never reported.");
  }

  const expected = Number(b.properties_expected);
  const examined = Number(b.properties_examined);
  if (!Number.isInteger(expected) || expected < 1) {
    /*
     * RULE 0, AT THE DOOR. An examination that expected zero properties examined nothing, and
     * "nothing needs you" and "nothing looked" must never be the same row. The grid is never empty;
     * a run claiming it is has read a different file.
     */
    throw badRequest(
      "An examination must expect at least one property",
      "Zero expected means the grid was empty, which is a broken run rather than a quiet day.",
    );
  }
  if (!Number.isInteger(examined) || examined < 0 || examined > expected) {
    throw badRequest("properties_examined must be between 0 and properties_expected");
  }

  const now = Date.now();
  const examId = newId("gex");
  const outcome = examined === 0 ? "failed" : examined < expected ? "partial" : "ok";

  const rows: Array<Required<Incoming> & { id: string }> = [];
  for (const raw of b.observations as Incoming[]) {
    const property = propertyFor(raw?.property_key ?? "");
    if (!property) {
      throw badRequest(
        `"${raw?.property_key}" is not a grid property`,
        "src/shared/boss/grid.mjs is the grid. A key it does not declare is refused rather than stored, so this table cannot drift into a second list.",
      );
    }

    const disposition = raw.disposition === "needs_her" ? "needs_her" : "dispatch";
    const why = String(raw.needs_her_why ?? "").trim();

    if (disposition === "needs_her") {
      /*
       * TWO REFUSALS, AND BOTH OF THEM ARE HER RULES RATHER THAN VALIDATION.
       *
       * A row claiming "this needs you" that cannot say what only she can do is a puzzle, not a
       * task — the same sentence 0233 wrote about `needs_owner_why`.
       *
       * And a property that is not `primary` may not ask for her at all. The generator is
       * secondary: "we really just include it in case something needs to be fixed but the content
       * generator and all the real work is in velocity." The authority network is infrastructure:
       * "a cost centre, not a line — never a day's work." Both are watched, both get fixed, and
       * neither proposes work to her.
       */
      if (!why) {
        throw badRequest(
          `A needs_her observation on ${property.key} does not say what only she can do`,
          "Without that it is a puzzle rather than a task, and one of those at the top of her day teaches her to skim the section.",
        );
      }
      if (property.tier !== "primary") {
        throw badRequest(
          `${property.key} is ${property.tier} and may not put an item in front of her`,
          property.why_tier ?? "Only a primary grid property proposes work to her. The rest are watched and fixed.",
        );
      }
    }

    const kind = String(raw.kind ?? "");
    const headline = String(raw.headline ?? "").trim();
    const evidence = String(raw.evidence ?? "").trim();
    if (!headline || !evidence) {
      throw badRequest(
        "Every observation carries a headline and the URL it was read from",
        "An observation she cannot open is an assertion, and this system does not print those.",
      );
    }

    rows.push({
      id: newId("gob"),
      property_key: property.key,
      repo: String(raw.repo ?? property.repos[0]),
      kind,
      disposition,
      needs_her_why: disposition === "needs_her" ? why : null,
      headline,
      evidence,
      observed_at: Number(raw.observed_at) || now,
    });
  }

  await c.env.DB
    .prepare(
      `INSERT INTO grid_examinations
         (id, started_at, finished_at, properties_expected, properties_examined,
          observations, dispatched, needs_her, outcome, note, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      examId, Number(b.started_at) || now, Number(b.finished_at) || now,
      expected, examined, rows.length,
      rows.filter((r) => r.disposition === "dispatch").length,
      rows.filter((r) => r.disposition === "needs_her").length,
      outcome,
      examined < expected ? `${expected - examined} repository(ies) could not be read.` : null,
      now,
    )
    .run();

  /*
   * ─── AN OBSERVATION SEEN AGAIN IS THE SAME OBSERVATION ────────────────────
   *
   * Identity is (property, kind, evidence): the same red workflow run, the same pull request. Without
   * this a daily job would file a fresh row for one stuck PR every morning and, within a fortnight,
   * her board would carry fourteen tasks about one thing. The row is touched rather than duplicated,
   * and its original `observed_at` is kept — the age of the problem is the whole point of reporting
   * it, and resetting it every day would make a three-week-old block permanently one day old.
   */
  let dispatched = 0;
  let fresh = 0;
  for (const r of rows) {
    const existing = await c.env.DB
      .prepare(
        `SELECT id, state FROM grid_observations
          WHERE property_key = ? AND kind = ? AND evidence = ? AND state IN ('open','dispatched','shown')
          LIMIT 1`,
      )
      .bind(r.property_key, r.kind, r.evidence)
      .first<{ id: string; state: string }>();

    if (existing) {
      await c.env.DB
        .prepare(`UPDATE grid_observations SET examination_id = ?, headline = ?, needs_her_why = ? WHERE id = ?`)
        .bind(examId, r.headline, r.needs_her_why, existing.id)
        .run();
      continue;
    }

    fresh += 1;
    let taskId: string | null = null;

    if (r.disposition === "dispatch") {
      taskId = newId("tsk");
      await c.env.DB
        .prepare(
          `INSERT INTO tasks (id, lane, employee_id, title, input, status, created_at,
                              intake_kind, execution_assignment, risk, sensitivity, cost_mode)
           VALUES (?,'ops',?,?,?,'queued',?,'one_off','USER_ONLY','low','private','NORMAL')`,
        )
        .bind(
          taskId, REPO_SEAT, r.headline.slice(0, 200),
          /*
           * `grid_fix` IS THE TOKEN THAT KEEPS A MODEL OFF IT. `bossMount.ts` excludes a task
           * carrying it from the queue drain, exactly as it does `input.hunt`. Fixing this means
           * working inside one of her repositories, and one agent per repo is her rule.
           */
          JSON.stringify({ grid_fix: { property: r.property_key, repo: r.repo, kind: r.kind, evidence: r.evidence } }),
          now,
        )
        .run();
      dispatched += 1;
    }

    await c.env.DB
      .prepare(
        `INSERT INTO grid_observations
           (id, examination_id, property_key, repo, kind, disposition, needs_her_why,
            headline, evidence, observed_at, state, task_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        r.id, examId, r.property_key, r.repo, r.kind, r.disposition, r.needs_her_why,
        r.headline, r.evidence, r.observed_at,
        r.disposition === "dispatch" ? "dispatched" : "open",
        taskId, now,
      )
      .run();
  }

  /*
   * ─── WHAT IS NO LONGER TRUE STOPS BEING TRUE ──────────────────────────────
   *
   * An observation the latest run did not find again has been fixed, merged or closed. Leaving it
   * open is how an alert surface starts lying: she would be told about a pull request that was
   * merged last week, and one of those teaches her that none of them are current.
   *
   * ONLY WHEN THE RUN ACTUALLY REACHED EVERYTHING. A partial run did not look at some properties, so
   * "not found again" there means "not looked for", and resolving on that would quietly close real
   * problems every time `gh` had a bad morning.
   */
  let resolved = 0;
  if (outcome === "ok") {
    const seen = rows.map((r) => r.id);
    const stale = await c.env.DB
      .prepare(`SELECT id FROM grid_observations WHERE state IN ('open','dispatched') AND examination_id != ?`)
      .bind(examId)
      .all<{ id: string }>();
    for (const s of stale.results ?? []) {
      if (seen.includes(s.id)) continue;
      await c.env.DB
        .prepare(`UPDATE grid_observations SET state = 'resolved', resolved_at = ? WHERE id = ?`)
        .bind(now, s.id)
        .run();
      resolved += 1;
    }
  }

  await audit(c.env.DB, {
    actor: "grid-watch", lane: "ops", entityType: "grid_examinations", entityId: examId,
    action: "examined",
    detail: { expected, examined, outcome, observations: rows.length, dispatched, resolved },
  });

  return ok(c, {
    examination_id: examId,
    outcome,
    observations: rows.length,
    new: fresh,
    dispatched,
    resolved,
  });
});
