/**
 * The publishing block, owned by Simone and executed from her Mac.
 *
 * WHAT THIS IS FOR. Seven authored books cannot be published: KDP's Publish button returns "please
 * fix the highlighted error(s)" with nothing highlighted, and a hidden DOM alert reading "Account
 * Information Incomplete". Every account section reads complete, and three titles published from
 * the same account on 1-2 September. It is a server-side flag on the account, and Amazon case
 * #51496198 is the only route to it. The 10-draft-cap theory was tested and disproven on
 * 7 September: draining the queue freed slots and the refusal did not change.
 *
 * WHY THE WORK RUNS SOMEWHERE ELSE. Determining whether a support reply resolves a case needs the
 * SUBJECTS AND BODIES of her mail. The Claude Code runner strips every credential from its
 * environment, so no agent can read them; `scripts/ops/kdp-watch.sh` does, from launchd, through
 * the connector she is already signed into. Simone owns the work. The job is the only thing that
 * can do it. That split is the architecture, not a workaround.
 *
 * WHAT CROSSES BACK. A sentinel, a determination in the run's own words, a next action, and some
 * counts. Never a quotation, never an address — `POST /check` refuses a determination containing an
 * `@`, which is the same guard the relationships sync carries and it caught a real leak on its
 * first run.
 *
 * WHY THE SCREEN NAMES WHO ACTS. The owner asked whether the system could "launch claude code
 * browser tool to try again" when the block clears. Half of that is honest: the watcher CAN drive
 * the browser and walk one title to Publish, but only if her Mac is awake and Chrome is reachable,
 * and it runs at 09:23 when the laptop may be shut. So the state says which of the two happened
 * rather than implying the automation always works. A system that quietly does not try is worse
 * than one that says it needs her.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest, notFound } from "../lib/http";
import { nextDueAt } from "../duties/cadence";
import { recordDeliverableActivity } from "../today/deliverables";

export const kdp = new Hono<{ Bindings: Env; Variables: Vars }>();

const DUTY_ID = "duty_kdp_publication";

const SENTINELS = new Set([
  "no-reply", "replied", "needs-her", "cleared", "published", "nudged", "stalled",
]);

const STATES = new Set(["blocked", "in_review", "live", "withdrawn"]);

/** The longest a determination may be. Two sentences; a paragraph is where a quotation hides. */
const MAX_DETERMINATION = 600;

const optionalText = (v: unknown, max = MAX_DETERMINATION): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

const optionalCount = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

/**
 * What happens next, and WHO does it.
 *
 * This is the whole answer to "surface an actionable try-again state". It is computed from the
 * latest determination rather than stored, so it can never disagree with the check it describes.
 */
function actionFor(
  check: { sentinel: string; next_action: string | null; needs_owner: number } | null,
  blocked: number,
): { who: "her" | "simone" | "nobody"; headline: string; detail: string } {
  if (blocked === 0) {
    return {
      who: "nobody",
      headline: "Every authored title is Live.",
      detail: "Nothing is stuck. This duty has nothing left to chase and can be suspended.",
    };
  }
  if (!check) {
    return {
      who: "simone",
      headline: "No determination yet.",
      detail: "Simone's watcher has not reported since this was wired up. The next run is Monday, Wednesday or Friday at 09:23 Central.",
    };
  }

  switch (check.sentinel) {
    case "cleared":
      return {
        who: "her",
        headline: "Support says the block is cleared — publish one title now.",
        detail:
          check.next_action ??
          "The watcher could not reach a browser to verify it. Open KDP, take A2C99P6JESFOP0, check the Content tab's AI questionnaire is committed with Save and Continue, and click Publish once. One title proves the flag is gone before the rest of the shelf follows.",
      };
    case "published":
      return {
        who: "her",
        headline: "One title went through.",
        detail: check.next_action ?? "The account-level flag is gone. The remaining titles are yours to publish when you want them out.",
      };
    case "needs-her":
      return {
        who: "her",
        headline: "Support asked for something only you can give.",
        detail: check.next_action ?? "Read the email Simone sent. The watcher will not supply an ID, a bank detail or a tax answer on your behalf, and must not.",
      };
    case "stalled":
      return {
        who: "her",
        headline: "The case is not being worked.",
        detail:
          check.next_action ??
          "Three or more nudges have gone unanswered, so more email will not move it. This needs phone support or a new case referencing #51496198 — a route only you can open.",
      };
    case "nudged":
      return {
        who: "simone",
        headline: "The case was chased.",
        detail: check.next_action ?? "One short message went to support. Nothing is needed from you.",
      };
    case "replied":
      return {
        who: "simone",
        headline: "Support wrote, and Simone answered.",
        detail: check.next_action ?? "A reply went back on the thread restating the unanswered question. Nothing is needed from you.",
      };
    default:
      return {
        who: "simone",
        headline: "Nothing new from support.",
        detail: check.next_action ?? "Silence is watched rather than waited on: the chase ladder decides when the next nudge goes, so a quiet case cannot quietly die.",
      };
  }
}

/** Everything the Publishing screen shows. */
kdp.get("/", async (c) => {
  const now = Date.now();

  const [titles, checks, duty] = await Promise.all([
    c.env.DB.prepare(
      `SELECT title_ref, label, state, note, state_changed_at, went_live_at
         FROM kdp_titles ORDER BY state, title_ref`,
    ).all(),
    c.env.DB.prepare(
      `SELECT id, checked_at, sentinel, determination, next_action, needs_owner,
              days_since_support, nudges_unanswered, threads_seen, source
         FROM kdp_case_checks ORDER BY checked_at DESC LIMIT 12`,
    ).all(),
    c.env.DB.prepare(
      `SELECT id, name, employee_id, next_due_at, last_run_at, suspended, executor
         FROM standing_duties WHERE id = ?`,
    ).bind(DUTY_ID).first<{
      id: string; name: string; employee_id: string; next_due_at: number;
      last_run_at: number | null; suspended: number; executor: string;
    }>(),
  ]);

  const rows = (titles.results ?? []) as any[];
  const history = (checks.results ?? []) as any[];
  const latest = history[0] ?? null;

  const byState = { blocked: 0, in_review: 0, live: 0, withdrawn: 0 } as Record<string, number>;
  for (const t of rows) byState[t.state] = (byState[t.state] ?? 0) + 1;

  /*
   * A WATCHER THAT HAS STOPPED IS THE FAILURE THIS WHOLE THING EXISTS TO PREVENT, and it looks
   * exactly like good news: no determination arriving reads the same as nothing happening. So the
   * age of the last check is reported as a fact rather than left to be inferred from a timestamp.
   */
  const sinceLastCheck = latest ? Math.floor((now - latest.checked_at) / 86_400_000) : null;

  return ok(c, {
    owner: { employee_id: duty?.employee_id ?? "emp_chief", name: "Simone" },
    case_number: "51496198",
    duty: duty
      ? {
          id: duty.id,
          name: duty.name,
          executor: duty.executor,
          next_due_at: duty.next_due_at,
          last_run_at: duty.last_run_at,
          suspended: duty.suspended === 1,
          // Overdue by the duty's own clock, which only a report from the Mac advances.
          overdue: duty.suspended !== 1 && duty.next_due_at < now - 86_400_000,
          runs_where: "launchd on her Mac — com.seq.kdp-watch, Mon/Wed/Fri 09:23 Central",
        }
      : null,
    titles: rows,
    counts: byState,
    latest,
    days_since_last_check: sinceLastCheck,
    history,
    action: actionFor(latest, byState.blocked ?? 0),
    // Said on the screen rather than only in a migration, because it is the fact that stops her
    // re-testing a theory she has already disproved.
    known: "The 10-unpublished-title cap was tested on 7 September and is not the cause: draining the queue freed slots and the refusal did not change. It is a server-side flag on the account, and case #51496198 is the only route to it.",
  });
});

/**
 * The watcher reporting what it found.
 *
 * WHY THIS ADVANCES THE DUTY'S CLOCK. A `local_job` duty is never materialised by the cron — see
 * `duties/materialise.ts` — so this is the only thing that can say the duty ran. Which is the
 * correct place for it: the duty ran when the work happened, not when a scheduler believed it had.
 */
kdp.post("/check", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const sentinel = String(b?.sentinel ?? "").trim();
  if (!SENTINELS.has(sentinel)) {
    throw badRequest(
      `"${sentinel}" is not a watcher sentinel`,
      `One of: ${[...SENTINELS].join(", ")}. These are the exact strings kdp-watch-prompt.md requires as its final line.`,
    );
  }

  const determination = optionalText(b?.determination);
  const nextAction = optionalText(b?.next_action);

  /*
   * NOTHING WITH AN '@' IN IT CROSSES THIS LINE.
   *
   * The determination is prose written by a run that has just read her mail, and prose is exactly
   * where an address or a quoted header would arrive without anyone intending it. The relationships
   * sync carries the identical guard and it caught a real leak on its first run — a collision
   * suffix built from the first three characters of a real address. Refused loudly rather than
   * stripped, because a silently-edited determination is one she would read as complete.
   */
  for (const [field, value] of [["determination", determination], ["next_action", nextAction]] as const) {
    if (value && value.includes("@")) {
      throw badRequest(
        `The ${field} contains an '@' and was refused`,
        "Determinations describe what support said; they never quote it and never carry an address. Rewrite it without the address and post again.",
      );
    }
  }

  const now = Date.now();
  const id = newId("kdp");

  await c.env.DB
    .prepare(
      `INSERT INTO kdp_case_checks
         (id, checked_at, sentinel, determination, next_action, needs_owner,
          days_since_support, nudges_unanswered, threads_seen, source, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, now, sentinel, determination, nextAction,
      b?.needs_owner === true || sentinel === "needs-her" || sentinel === "stalled" ? 1 : 0,
      optionalCount(b?.days_since_support),
      optionalCount(b?.nudges_unanswered),
      optionalCount(b?.threads_seen),
      b?.source === "manual" ? "manual" : "launchd",
      now,
    )
    .run();

  /*
   * A PUBLISHED TITLE IS RECORDED HERE AND NOWHERE ELSE. The watcher may publish AT MOST ONE title
   * per run, and only after support says the block is cleared — that rule lives in the prompt and
   * is restated here because being told is not a guarantee. Anything else it claims about a title
   * is ignored: `published_title_ref` is the only title fact this endpoint accepts.
   */
  const publishedRef = optionalText(b?.published_title_ref, 32);
  if (sentinel === "published" && publishedRef) {
    await c.env.DB
      .prepare(
        `UPDATE kdp_titles SET state = 'live', went_live_at = ?, state_changed_at = ?, updated_at = ?
          WHERE title_ref = ? AND state != 'live'`,
      )
      .bind(now, now, now, publishedRef)
      .run();
  }

  const duty = await c.env.DB
    .prepare(`SELECT id, local_hour, local_minute, timezone, cadence, weekday, weekdays FROM standing_duties WHERE id = ?`)
    .bind(DUTY_ID)
    .first<{
      id: string; local_hour: number; local_minute: number; timezone: string;
      cadence: "daily" | "weekly" | "monthly"; weekday: number | null; weekdays: string | null;
    }>();

  if (duty) {
    let weekdays: number[] | null = null;
    try { weekdays = duty.weekdays ? (JSON.parse(duty.weekdays) as number[]) : null; } catch { weekdays = null; }
    let advanced: number | null = null;
    try {
      advanced = nextDueAt(
        {
          local_hour: duty.local_hour, local_minute: duty.local_minute, timezone: duty.timezone,
          cadence: duty.cadence, weekday: duty.weekday, weekdays,
        },
        now,
      );
    } catch {
      // An unschedulable duty keeps its old clock rather than being given an invented one. It will
      // read as overdue, which is the honest render of "nobody can say when this runs next".
      advanced = null;
    }
    await c.env.DB
      .prepare(
        advanced === null
          ? `UPDATE standing_duties SET last_run_at = ? WHERE id = ?`
          : `UPDATE standing_duties SET last_run_at = ?, next_due_at = ? WHERE id = ?`,
      )
      .bind(...(advanced === null ? [now, DUTY_ID] : [now, advanced, DUTY_ID]))
      .run();
  }

  /*
   * THE COMMITMENT IS TOLD SOMETHING HAPPENED — and told nothing else.
   *
   * `del_kdp_publication` is an owned deliverable, so this advances its `last_activity_at`, which is
   * the single thing standing between it and the stall alarm on Today. It may also set or clear the
   * block. It emphatically CANNOT mark it done: only `TERMINAL_CHECKS.kdp_all_live` closes it, by
   * counting titles that are not Live. A support agent saying the flag is cleared, a watcher saying
   * it published, a run reporting success — none of those is the books being on sale, and this case
   * has already produced one confident answer that changed nothing.
   *
   * `published` STILL LEAVES IT BLOCKED, and that is deliberate rather than pessimistic: one title
   * going through proves the account flag is gone and leaves six books unpublished, which is not
   * the terminal condition. The check will close it on the run that clears the last one.
   */
  const stillBlocked = sentinel !== "published" && sentinel !== "cleared";
  await recordDeliverableActivity(c.env, {
    id: "del_kdp_publication",
    blocked: stillBlocked,
    /*
     * NO BLOCKER IS PASSED, AND THAT IS THE FIX FOR SOMETHING THAT SHIPPED.
     *
     * The first determination this endpoint received overwrote the deliverable's `blocker`, so the
     * escalation on Today read "Simone is blocked on Every authored book published — <what the last
     * run happened to find>". Those are two different facts. The blocker is WHY the work is stuck —
     * the account flag, the case number, the three titles that published from the same account —
     * and it changes rarely and deliberately. What one run found changes every run and already has
     * its own table and its own screen. Letting the second overwrite the first turns an escalation
     * into a log line and loses the sentence she has to act on.
     */
    now,
  }).catch(() => {});

  await logEvent(c.env.DB, {
    level: sentinel === "stalled" ? "warn" : "info",
    scope: "duties", event: "kdp_check_recorded", entityId: DUTY_ID,
    detail: { sentinel, needs_owner: sentinel === "needs-her" || sentinel === "stalled" },
  }).catch(() => {});

  await audit(c.env.DB, {
    actor: "system", lane: "ops", entityType: "standing_duty", entityId: DUTY_ID,
    action: "kdp_checked", detail: { sentinel, check_id: id },
  });

  return ok(c, { id, sentinel, recorded_at: now }, 201);
});

/**
 * Her hand on a title.
 *
 * WHY THIS EXISTS AT ALL. The watcher may only ever move a title to `live`, and only the one it
 * actually published. Everything else — withdrawing a book, marking one she published herself,
 * putting a label on one so she can tell them apart — is hers, and a list she cannot correct is a
 * list she stops trusting.
 */
kdp.post("/titles/:ref", async (c) => {
  const ref = c.req.param("ref");
  const b = await c.req.json<any>().catch(() => null);

  const existing = await c.env.DB
    .prepare(`SELECT title_ref, state FROM kdp_titles WHERE title_ref = ?`).bind(ref)
    .first<{ title_ref: string; state: string }>();
  if (!existing) throw notFound(`No title with reference ${ref}`);

  const state = b?.state === undefined ? existing.state : String(b.state);
  if (!STATES.has(state)) throw badRequest(`"${state}" is not a publication state`, `One of: ${[...STATES].join(", ")}.`);

  const now = Date.now();
  await c.env.DB
    .prepare(
      `UPDATE kdp_titles
          SET state = ?, label = COALESCE(?, label), note = COALESCE(?, note),
              state_changed_at = CASE WHEN ? != state THEN ? ELSE state_changed_at END,
              went_live_at = CASE WHEN ? = 'live' AND went_live_at IS NULL THEN ? ELSE went_live_at END,
              updated_at = ?
        WHERE title_ref = ?`,
    )
    .bind(state, optionalText(b?.label, 120), optionalText(b?.note, 400), state, now, state, now, now, ref)
    .run();

  await audit(c.env.DB, {
    actor: "owner", lane: "ops", entityType: "kdp_title", entityId: ref,
    action: "state_set", detail: { from: existing.state, to: state },
  });

  return ok(c, await c.env.DB.prepare(`SELECT * FROM kdp_titles WHERE title_ref = ?`).bind(ref).first());
});
