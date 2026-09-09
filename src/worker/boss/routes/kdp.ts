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

/**
 * DID THE RUN ACTUALLY RUN?
 *
 * On 7 September the Gmail connector's token had expired, so the watcher could not read a single
 * message. It reported and the screen showed silence — which is exactly what a quiet week at Amazon
 * also looks like. Two opposite facts rendering identically is the failure this column exists to
 * end: `could-not-run` means nothing was learned, so the absence of news is not news.
 *
 * The wrapper posts it too. `kdp-watch.sh` used to exit at a named stop without telling anyone, so
 * the runs that most needed to reach her were the only ones that never did.
 */
const RUN_OUTCOMES = new Set(["determined", "could-not-run"]);

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
  check: { sentinel: string; next_action: string | null; needs_owner: number; run_outcome?: string } | null,
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

  /*
   * A RUN THAT COULD NOT RUN IS ANSWERED FIRST, BEFORE ANY SENTINEL.
   *
   * It reported `needs-her` on 7 September and the screen said "Support asked for something only
   * you can give" — a sentence about Amazon, produced by a run that never reached Amazon. Whatever
   * sentinel a broken run carries is a guess; the fact that it could not run is not.
   */
  if (check.run_outcome === "could-not-run") {
    return {
      who: "her",
      headline: "The last check could not run.",
      detail:
        check.next_action ??
        "Something the watcher depends on was unavailable, so nothing was learned about the case and the quiet is not good news. See Critical Alerts on Today for which credential, and the exact steps to restore it.",
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
              days_since_support, nudges_unanswered, threads_seen, source, run_outcome
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

  /*
   * ── HER VERDICT ON THE COVERS, WHERE THE LOCAL RUN CAN READ IT ─────────────
   *
   * Amazon support's diagnosis is that Cover Creator images fail server-side processing, and that
   * uploading finished covers directly is the fix. She chose to approve them through the Inbox
   * rather than have anyone publish by hand — "i dont care about this happening right away id
   * rather see them in my inbox for approval and then approve them and have simone publish them" —
   * so this field is the gate the publish path actually waits on.
   *
   * READ BY TWO THINGS, WHICH IS WHY IT IS ON THIS ENDPOINT RATHER THAN ONLY IN THE INBOX.
   * `scripts/ops/kdp-resume.mjs` polls it from her Mac so an approval starts the work within hours
   * instead of waiting for the next Mon/Wed/Fri slot, and `kdp-watch-prompt.md` reads it to decide
   * whether it is allowed to upload and publish at all.
   */
  const covers = await c.env.DB
    .prepare(
      `SELECT id, state, attempt, her_note, decided_at, resumed_at, resume_detail, created_at
         FROM judgement_calls
        WHERE resume_kind = 'kdp_cover_upload' AND state != 'superseded'
        ORDER BY created_at DESC LIMIT 1`,
    )
    .first<any>();

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
    /*
     * `null` MEANS NO COVER BATCH HAS EVER BEEN PUT TO HER, which is a different fact from one
     * waiting and a different fact again from one she sent back. The local run branches on all
     * three, and a single boolean would have collapsed them.
     */
    covers: covers
      ? {
          judgement_id: covers.id,
          state: covers.state,
          attempt: covers.attempt,
          her_note: covers.her_note,
          decided_at: covers.decided_at,
          resumed_at: covers.resumed_at,
          // May Simone upload and publish? Only her approval opens that door.
          may_publish: covers.state === "approved",
        }
      : null,
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
  const runOutcome = RUN_OUTCOMES.has(String(b?.run_outcome ?? "")) ? String(b.run_outcome) : "determined";

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
          days_since_support, nudges_unanswered, threads_seen, source, run_outcome, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id, now, sentinel, determination, nextAction,
      // A run that could not run always needs her: nothing else can renew a credential or repair
      // an installation, and a blocked run that does not ask for help is a run that stays blocked.
      b?.needs_owner === true || runOutcome === "could-not-run"
        || sentinel === "needs-her" || sentinel === "stalled" ? 1 : 0,
      optionalCount(b?.days_since_support),
      optionalCount(b?.nudges_unanswered),
      optionalCount(b?.threads_seen),
      b?.source === "manual" ? "manual" : "launchd",
      runOutcome,
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

  /*
   * ── THE ALERT IS UPDATED, EVERY RUN, WITHOUT TOUCHING THE STANDING REASON ──
   *
   * Both halves of that sentence are fixes for defects that reached production.
   *
   * The first determination this endpoint ever received OVERWROTE the deliverable's `blocker`, so
   * Today read "Simone is blocked on Every authored book published — <whatever the last run
   * happened to find>", and the one sentence she acts on became a log line. 0203 fixed that by
   * making this call pass nothing at all — which meant the alert could never change again, and on
   * 9 September it was still describing a week-old theory about a hidden account flag while the
   * connector had expired and support had named cover image processing instead. Her words: "the
   * critical alerts for simone did not say anything about my oauth being disconnected and that is a
   * problem. it says something else".
   *
   * TWO FACTS, TWO FIELDS. `blocker` is deliberately still not passed — the standing reason is not
   * a run's to rewrite. `status` is passed on EVERY run, because an alert nothing may update is one
   * that will eventually be wrong in the loudest place on her screen.
   *
   * `blocked_since` is untouched either way, so the ladder keeps counting from when the books
   * stopped rather than from the last time somebody rephrased why.
   */
  const status =
    determination ??
    (runOutcome === "could-not-run"
      ? `The run reported "${sentinel}" and could not complete, without saying why.`
      : `The run reported "${sentinel}" and filed no determination.`);

  await recordDeliverableActivity(c.env, {
    id: "del_kdp_publication",
    blocked: stillBlocked,
    status,
    statusKind: runOutcome === "could-not-run" ? "could-not-run" : "determined",
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


// ─── The standing surface: everything Amazon sends, triaged ──────────────────

const DISPOSITIONS = new Set(["promo", "update", "problem"]);
const SURFACE_DUTY = "duty_kdp_surface";

/**
 * What Amazon sent, and what Simone decided about it.
 *
 * ─── Her instruction ───────────────────────────────────────────────────────
 *
 *   "if the company sends marketing and promo emails she just notes it and moves on. if there are
 *    updates she needs to know about she needs to notate them. if something is wrong w/one of my
 *    titles she needs to spring into action... i prefer to be handsoff"
 *
 * ─── HANDS-OFF IS ENFORCED HERE, NOT ASKED FOR IN A PROMPT ─────────────────
 *
 * `promo` may not set `needs_owner`, and the endpoint overrides it rather than trusting the run.
 * That is the difference between a rule and a request: a model having a generous day cannot decide
 * that a Kindle newsletter is worth waking her for. Getting this wrong in the noisy direction is how
 * she stops reading the useful ones.
 *
 * A RUN OF ONLY PROMOTIONAL MAIL THEREFORE PRODUCES SILENCE — no alert, no Inbox item, no summary
 * line — and the rows are still there if she ever wants to look.
 */
kdp.post("/mail", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const items = Array.isArray(b?.items) ? b.items : null;
  if (!items) {
    throw badRequest(
      "Send an items array, even an empty one",
      "An empty array is a real answer — nothing arrived — and it advances the duty's clock. A missing array is a malformed report.",
    );
  }

  const now = Date.now();
  const recorded: { id: string; disposition: string }[] = [];

  for (const raw of items) {
    const disposition = String(raw?.disposition ?? "").trim();
    if (!DISPOSITIONS.has(disposition)) {
      throw badRequest(`"${disposition}" is not a disposition`, `One of: ${[...DISPOSITIONS].join(", ")}.`);
    }
    const note = optionalText(raw?.note, 400);
    const action = optionalText(raw?.action_taken, 400);
    if (!note) throw badRequest("Every logged message needs a note", "A row that cannot say what the message was is one she cannot read back.");

    for (const [field, value] of [["note", note], ["action_taken", action]] as const) {
      if (value && value.includes("@")) {
        throw badRequest(
          `The ${field} contains an '@' and was refused`,
          "The log describes what Amazon said; it never quotes it and never carries an address.",
        );
      }
    }

    const id = newId("kml");
    await c.env.DB
      .prepare(
        `INSERT INTO kdp_mail_log
           (id, seen_at, disposition, note, title_ref, action_taken, needs_owner, source, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id, now, disposition, note,
        optionalText(raw?.title_ref, 32),
        action,
        // ONLY A PROBLEM MAY NEED HER. Enforced rather than trusted — see the header.
        disposition === "problem" && raw?.needs_owner === true ? 1 : 0,
        b?.source === "manual" ? "manual" : "launchd",
        now,
      )
      .run();
    recorded.push({ id, disposition });
  }

  /*
   * THE DUTY'S CLOCK ADVANCES EVEN ON A QUIET DAY. A `local_job` duty is never materialised by the
   * cron, so this is the only thing that can say it ran — and a day with no mail is a day the job
   * did its work. Without this, silence would read as a duty that had stopped firing, which is the
   * exact confusion the whole morning was spent removing.
   */
  const duty = await c.env.DB
    .prepare(`SELECT local_hour, local_minute, timezone, cadence, weekday, weekdays FROM standing_duties WHERE id = ?`)
    .bind(SURFACE_DUTY)
    .first<any>();
  if (duty) {
    let advanced: number | null = null;
    try {
      advanced = nextDueAt(
        {
          local_hour: duty.local_hour, local_minute: duty.local_minute, timezone: duty.timezone,
          cadence: duty.cadence, weekday: duty.weekday,
          weekdays: duty.weekdays ? JSON.parse(duty.weekdays) : null,
        },
        now,
      );
    } catch { advanced = null; }
    await c.env.DB
      .prepare(
        advanced === null
          ? `UPDATE standing_duties SET last_run_at = ? WHERE id = ?`
          : `UPDATE standing_duties SET last_run_at = ?, next_due_at = ? WHERE id = ?`,
      )
      .bind(...(advanced === null ? [now, SURFACE_DUTY] : [now, advanced, SURFACE_DUTY]))
      .run();
  }

  const problems = recorded.filter((r) => r.disposition === "problem").length;
  await logEvent(c.env.DB, {
    level: problems > 0 ? "warn" : "info",
    scope: "duties", event: "kdp_mail_triaged", entityId: SURFACE_DUTY,
    detail: { total: recorded.length, problems },
  }).catch(() => {});

  return ok(c, { recorded: recorded.length, problems }, 201);
});

/** What she can read back: the updates and the problems, newest first. Promo is not returned. */
kdp.get("/mail", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT id, seen_at, disposition, note, title_ref, action_taken, needs_owner
         FROM kdp_mail_log WHERE disposition != 'promo' ORDER BY seen_at DESC LIMIT 40`,
    )
    .all<any>();
  const promo = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM kdp_mail_log WHERE disposition = 'promo'`)
    .first<{ n: number }>();
  return ok(c, {
    notated: rows.results ?? [],
    /*
     * THE PROMO COUNT AND NOTHING ELSE. "she just notes it and moves on" — so it is countable if she
     * ever wonders whether the triage is working, and invisible otherwise.
     */
    promo_noted: promo?.n ?? 0,
  });
});

/**
 * Simone handing a piece of work to a colleague.
 *
 * "she can assign help from another employee as needed."
 *
 * THE OWNER IS NOT REASSIGNED, and that is the whole guard. Delegation is easy to get wrong in one
 * specific way — work disappearing into somebody else's queue — so the owner stays on the row, the
 * assignment escalates under the owner's name if the helper stalls, and only the owner's report can
 * close it.
 */
kdp.post("/assign", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const owner = String(b?.owner_employee_id ?? "emp_chief");
  const helper = String(b?.helper_employee_id ?? "").trim();
  const what = optionalText(b?.what, 300);
  const why = optionalText(b?.why, 400);

  if (!what || !why) {
    throw badRequest(
      "An assignment needs what and why",
      "A colleague handed a task with no reason has to guess at the outcome, which is how a delegated piece comes back wrong.",
    );
  }
  const seat = await c.env.DB.prepare(`SELECT id, name FROM employees WHERE id = ?`).bind(helper).first<any>();
  if (!seat) {
    throw badRequest("That is not an employee", "Work can only be handed to a seat that exists, or nobody is accountable for it.");
  }
  if (helper === owner) {
    throw badRequest("An employee cannot assign work to themselves", "That is not delegation; it is the work they already own.");
  }

  const now = Date.now();
  const id = newId("asg");
  await c.env.DB
    .prepare(
      `INSERT INTO work_assignments
         (id, owner_employee_id, helper_employee_id, deliverable_id, what, why, state,
          assigned_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'open', ?,?,?)`,
    )
    .bind(id, owner, helper, b?.deliverable_id ?? null, what, why, now, now, now)
    .run();

  await audit(c.env.DB, {
    actor: "system", lane: "ops", entityType: "work_assignment", entityId: id,
    action: "assigned", detail: { owner, helper, what },
  });
  return ok(c, { id, helper: seat.name }, 201);
});
