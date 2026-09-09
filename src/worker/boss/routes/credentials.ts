/**
 * Is the machinery this system runs on still authorised?
 *
 * ─── The failure this exists to end ─────────────────────────────────────────
 *
 * She changed her Google password. Google invalidates every OAuth refresh token when that happens,
 * so the claude.ai Gmail connector was revoked instantly and silently. From that moment Simone's
 * KDP watch could not read a single message, Monique's Sunday sweep could not either, and NOTHING
 * ANYWHERE SAID SO. It was discovered days later because a human ran the watcher by hand and read
 * its output.
 *
 * That detail — a password change rather than a token ageing out — makes this worse rather than
 * better. There is no gradual signal to watch for and no renewal window to anticipate: the
 * credential is alive, and then in one instant it is not, and it will happen again the next time she
 * changes her password. So the only thing that can catch it is something that actually uses the
 * credential, on a schedule, and says what it found.
 *
 * ─── Why a table of one row per credential, upserted ────────────────────────
 *
 * This is a liveness register, not a log. The question is "does this work right now", and a table
 * that appends makes that question a query with an ORDER BY in it. `checked_at` going stale is
 * itself an alarm, on the same construction as an owned deliverable: a prober that stops running
 * makes the screen louder rather than quieter.
 *
 * ─── What may cross this boundary ──────────────────────────────────────────
 *
 * A state word, a date, and a sentence of detail. NEVER a token, never a secret, and never an
 * address — `POST /probe` refuses a detail containing an `@` on exactly the reasoning the KDP
 * endpoint uses, because a prober that has just read a mailbox header is precisely where one would
 * arrive unintended.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest } from "../lib/http";

export const credentials = new Hono<{ Bindings: Env; Variables: Vars }>();

const STATES = new Set(["live", "dead", "unknown"]);

/** Everything the register knows, newest answer first. */
credentials.get("/", async (c) => {
  const now = Date.now();
  const rows = await c.env.DB
    .prepare(
      `SELECT id, label, what_depends, state, detail, fix_steps, checked_at, last_live_at,
              max_age_hours
         FROM credential_probes
        ORDER BY CASE state WHEN 'dead' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END, id`,
    )
    .all<any>();

  const probes = (rows.results ?? []).map((p) => ({
    ...p,
    /*
     * STALE IS ITS OWN ANSWER AND IS COMPUTED HERE RATHER THAN STORED. A row saying `live` with a
     * three-week-old date is not evidence about today, and storing a "stale" state would need
     * something to run in order to write it — which is the exact thing that has stopped running.
     */
    stale: p.checked_at === null || now - p.checked_at > p.max_age_hours * 2 * 3_600_000,
  }));

  return ok(c, {
    probes,
    dead: probes.filter((p: any) => p.state === "dead").length,
    stale: probes.filter((p: any) => p.stale).length,
  });
});

/**
 * The prober reporting what it found.
 *
 * `scripts/ops/credential-check.mjs` is the only caller. It runs on her Mac under launchd, because
 * checking a credential means USING it, and the Claude Code runner strips every credential from an
 * agent's environment on purpose.
 */
credentials.post("/probe", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const list = Array.isArray(b?.probes) ? b.probes : null;
  if (!list || list.length === 0) {
    throw badRequest(
      "No probes were reported",
      "A probe run that examined nothing must not report success — that is the empty-loop pass, and it would leave a dead credential reading as checked.",
    );
  }

  const now = Date.now();
  const applied: { id: string; state: string }[] = [];
  const unknownIds: string[] = [];

  for (const raw of list) {
    const id = String(raw?.id ?? "").trim();
    const state = String(raw?.state ?? "").trim();
    if (!STATES.has(state)) {
      throw badRequest(`"${state}" is not a credential state`, `One of: ${[...STATES].join(", ")}.`);
    }
    const detail = raw?.detail === undefined || raw?.detail === null ? null : String(raw.detail).trim().slice(0, 600);

    /*
     * NOTHING WITH AN '@' IN IT CROSSES THIS LINE, and this prober is the likeliest source of one
     * in the whole system: its Workspace probe reads a From header in order to decide whether
     * Amazon mail is arriving. What it may report is a COUNT. Refused loudly rather than stripped,
     * because a silently-edited detail is one she would read as complete.
     */
    if (detail && detail.includes("@")) {
      throw badRequest(
        `The detail for ${id} contains an '@' and was refused`,
        "A probe reports whether a credential works, never who wrote to whom. Rewrite it without the address and post again.",
      );
    }

    const existing = await c.env.DB
      .prepare(`SELECT id FROM credential_probes WHERE id = ?`).bind(id).first<{ id: string }>();
    if (!existing) {
      /*
       * A PROBE FOR A CREDENTIAL NOBODY DECLARED IS NOT SILENTLY CREATED. Each row carries the fix
       * steps that make its alert self-explaining, and a row invented at runtime would have none —
       * an alert that says something is broken and cannot say what to do about it.
       */
      unknownIds.push(id);
      continue;
    }

    await c.env.DB
      .prepare(
        `UPDATE credential_probes
            SET state = ?, detail = ?, checked_at = ?,
                last_live_at = CASE WHEN ? = 'live' THEN ? ELSE last_live_at END,
                updated_at = ?
          WHERE id = ?`,
      )
      .bind(state, detail, now, state, now, now, id)
      .run();
    applied.push({ id, state });
  }

  if (applied.length === 0) {
    throw badRequest(
      "None of the reported probes are in the register",
      `Unknown: ${unknownIds.join(", ")}. Declare the credential in a migration with its fix steps, then report it.`,
    );
  }

  /*
   * ── A DUTY THAT WAKES ITSELF ──────────────────────────────────────────────
   *
   * `duty_lp_replies` is created suspended because nothing can read the West Peek mailbox until
   * Scooter grants domain-wide delegation, and a duty that errored every morning for three weeks
   * while he got round to it would be noise on the one surface she has to keep reading.
   *
   * THE PROBE IS THE CONDITION, NOT A PERSON REMEMBERING. The morning the impersonation succeeds,
   * this unsuspends the duty and clears its reason. Nobody flips a switch, and nobody has to notice
   * — which matters, because the last thing waiting on this grant went unnoticed for three weeks.
   *
   * ONE WAY ONLY, DELIBERATELY. A probe going back to dead does NOT re-suspend: the duty's own
   * script checks the register before every run and stops with a named reason, so a lapsed grant
   * produces one honest stop rather than a duty silently switching itself off — which would look
   * exactly like a duty somebody turned off and forgot.
   */
  const WOKEN_BY: Record<string, string> = { cred_westpeek_delegation: "duty_lp_replies" };
  const woken: string[] = [];
  for (const p of applied) {
    const dutyId = WOKEN_BY[p.id];
    if (!dutyId || p.state !== "live") continue;
    const res = await c.env.DB
      .prepare(
        `UPDATE standing_duties SET suspended = 0, suspended_reason = NULL
          WHERE id = ? AND suspended = 1`,
      )
      .bind(dutyId)
      .run();
    if ((res.meta?.changes ?? 0) > 0) woken.push(dutyId);
  }
  if (woken.length > 0) {
    await logEvent(c.env.DB, {
      level: "info", scope: "duties", event: "duty_woken_by_credential", entityId: woken[0] ?? null,
      detail: { woken, because: "the credential it waits on is live" },
    }).catch(() => {});
  }

  const dead = applied.filter((p) => p.state === "dead");
  await logEvent(c.env.DB, {
    level: dead.length > 0 ? "warn" : "info",
    scope: "ops", event: "credentials_probed", entityId: null,
    detail: { applied: applied.length, dead: dead.map((d) => d.id), unknown: unknownIds },
  }).catch(() => {});

  await audit(c.env.DB, {
    actor: "system", lane: "ops", entityType: "credential_probe", entityId: null,
    action: "probed", detail: { applied, unknown: unknownIds },
  });

  return ok(c, { applied, unknown: unknownIds, woken, checked_at: now }, 201);
});
