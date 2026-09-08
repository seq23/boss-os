/**
 * WHAT EACH EMPLOYEE OWNS, AND WHAT IS IN THE WAY OF IT.
 *
 * Her rule: "she owns this deliverable so she needs to make sure its done and if there is any block
 * she needs to tell me immediately and keep reminding me until its done. she canot drop it. that
 * goes for all employees when i give them something to own."
 *
 * The escalating half of that lives in `today/deliverables.ts` and lands on Today, because an
 * escalation she has to go and find is not an escalation. This is the register itself — the list,
 * with each terminal condition in the words she would recognise, and the one lever that closes a
 * commitment without completing it.
 *
 * ONLY SHE CAN KILL ONE, AND IT COSTS A REASON. There is deliberately no path by which an employee,
 * a run, a duty or a job decides her commitment is no longer worth keeping. That absence IS "she
 * cannot drop it" — not a rule someone could choose to ignore, but a thing there is no code for.
 * Completion has the opposite property: nobody can claim it, and only `TERMINAL_CHECKS` counting
 * real rows can grant it.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { audit } from "../lib/audit";
import { ok, badRequest, notFound } from "../lib/http";
import { TERMINAL_CHECKS, escalationFor } from "../today/deliverables";

export const deliverables = new Hono<{ Bindings: Env; Variables: Vars }>();

deliverables.get("/", async (c) => {
  const now = Date.now();
  const rows = await c.env.DB
    .prepare(
      `SELECT d.*, e.name AS employee_name, e.role AS employee_role
         FROM owned_deliverables d
         LEFT JOIN employees e ON e.id = d.employee_id
        ORDER BY CASE d.state WHEN 'blocked' THEN 0 WHEN 'open' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
                 COALESCE(d.blocked_since, d.created_at)`,
    )
    .all<any>();

  const list = (rows.results ?? []).map((d: any) => {
    const daysBlocked = d.blocked_since ? Math.floor((now - d.blocked_since) / 86_400_000) : null;
    const daysSilent = d.last_activity_at ? Math.floor((now - d.last_activity_at) / 86_400_000) : null;
    return {
      ...d,
      days_blocked: daysBlocked,
      days_silent: daysSilent,
      stalled: daysSilent !== null && daysSilent >= d.stall_after_days,
      escalation: d.state === "blocked" && daysBlocked !== null ? escalationFor(daysBlocked) : null,
      // A check this system does not have means the deliverable can never complete. Said here as
      // well as on Today, because this is the screen where someone would go to fix it.
      checkable: Object.prototype.hasOwnProperty.call(TERMINAL_CHECKS, d.terminal_check),
    };
  });

  return ok(c, {
    deliverables: list,
    open: list.filter((d: any) => d.state === "open" || d.state === "blocked").length,
    /*
     * AN EMPTY REGISTER IS REPORTED AS A FAULT, never as a clean slate. Zero owned deliverables
     * renders as "nothing is stuck", which is indistinguishable from "everything is fine" — the
     * empty-loop pass, at the level of a screen.
     */
    empty_register: list.length === 0
      ? "The register of owned work is empty. That is a broken register rather than a clear plate."
      : null,
    rule: "An owned deliverable is finished when the world says so, not when someone reports it. Nothing here closes because a job succeeded.",
  });
});

/**
 * Her hand on a commitment: record a block, clear one, or stop it.
 *
 * `done` IS NOT ACCEPTED HERE, even from her. Marking something done by hand would make the
 * terminal check advisory, and the terminal check is the entire reason this cannot be dropped —
 * once a person can declare completion, "done" means "somebody said so", which is what a duty
 * already meant. If she wants it off her screen without it being finished, that is `killed`, and
 * it is a different word on purpose so the record never claims she published books she did not.
 */
deliverables.post("/:id", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<any>().catch(() => null);

  const row = await c.env.DB
    .prepare(`SELECT id, state FROM owned_deliverables WHERE id = ?`).bind(id)
    .first<{ id: string; state: string }>();
  if (!row) throw notFound(`No owned deliverable called ${id}`);

  const state = String(b?.state ?? row.state);
  if (!["open", "blocked", "killed"].includes(state)) {
    throw badRequest(
      `"${state}" is not something you can set`,
      "open, blocked or killed. 'done' is granted by the terminal check counting real records, never declared — the moment a person can declare completion, this stops being a commitment and goes back to being a report.",
    );
  }

  const reason = b?.killed_reason === undefined || b.killed_reason === null
    ? null
    : String(b.killed_reason).trim().slice(0, 500);
  if (state === "killed" && !reason) {
    throw badRequest(
      "Stopping an owned deliverable needs a reason",
      "It stays in the register with the reason attached. A commitment that vanishes without one is indistinguishable from one that was forgotten, which is the thing this whole mechanism exists to prevent.",
    );
  }

  const now = Date.now();
  const blocker = b?.blocker === undefined || b.blocker === null ? null : String(b.blocker).trim().slice(0, 500);

  await c.env.DB
    .prepare(
      `UPDATE owned_deliverables
          SET state = ?,
              blocker = CASE WHEN ? = 'blocked' THEN COALESCE(?, blocker) ELSE blocker END,
              -- The clock is never restarted by looking at it: a block that is still a block on day
              -- twelve is twelve days old. Only clearing it resets this.
              blocked_since = CASE WHEN ? = 'blocked' THEN COALESCE(blocked_since, ?) ELSE NULL END,
              killed_at = CASE WHEN ? = 'killed' THEN ? ELSE NULL END,
              killed_reason = CASE WHEN ? = 'killed' THEN ? ELSE killed_reason END,
              last_activity_at = ?,
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(state, state, blocker, state, now, state, now, state, reason, now, now, id)
    .run();

  await audit(c.env.DB, {
    actor: "owner", lane: "ops", entityType: "owned_deliverable", entityId: id,
    action: `state_${state}`, detail: { from: row.state, reason },
  });

  return ok(c, await c.env.DB.prepare(`SELECT * FROM owned_deliverables WHERE id = ?`).bind(id).first());
});
