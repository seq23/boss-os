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
import { advance } from "./duties";
import { recordDeliverableActivity } from "../today/deliverables";

export const kdp = new Hono<{ Bindings: Env; Variables: Vars }>();

const DUTY_ID = "duty_kdp_publication";

const SENTINELS = new Set([
  "no-reply", "replied", "needs-her", "cleared", "published", "nudged", "stalled",
]);

/**
 * `draft` IS A TITLE NOBODY HAS PUBLISHED, and it is not `blocked`. On 14 September 2026 six of the
 * seven titles read Live on the bookshelf and the seventh read Draft — publishable, nothing refusing
 * it, simply not sent. The register had no word for that: `blocked` would have kept a cleared case
 * open and `in_review` would have claimed Amazon was looking at it. A register that cannot say the
 * true state says a false one.
 */
const STATES = new Set(["blocked", "draft", "in_review", "live", "withdrawn"]);

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
  /*
   * ── THE STATE THE STORED SENTENCE MIGHT ALREADY BE WRONG ABOUT ─────────────
   *
   * Observed on production, 9 September 2026:
   *
   *   covers: { state: "approved", may_publish: true, decided_at: 09:30:38 }
   *   action: { who: "simone", detail: "Approve the replacement covers in Boss OS (state: approved),
   *             then Simone will upload and publish." }
   *
   * Simone's run finished at 09:24:24 and wrote that sentence into `next_action`. She approved at
   * 09:30:38, six minutes later. Nothing recomputed it, so the screen spent the rest of the day
   * asking her to repeat a step she had already taken — and she reported it twice.
   *
   * IT IS THE SAME DEFECT SHAPE AS THE APPROVAL BADGE THAT SAID 9 OVER AN EMPTY INBOX: a value
   * derived once at write time and never reconciled with the state it describes. The function was
   * already documented as "computed from the latest determination rather than stored, so it can
   * never disagree with the check it describes" — and it was, but `check.next_action` is a STORED
   * STRING from a moment that has passed, and every branch below preferred it.
   *
   * So the covers state is passed in and the stored sentence is refused whenever it asks for
   * something already done. This is the general form, not a patch on one string.
   */
  covers: { state: string; may_publish: boolean } | null,
): { who: "her" | "simone" | "nobody"; headline: string; detail: string } {
  if (blocked === 0) {
    return {
      who: "nobody",
      headline: "Nothing is blocked.",
      detail: "No title is refused. There is nothing left to chase; a title still in Draft is yours to publish whenever you want it out.",
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
  /*
   * WHAT SHE HAS ALREADY DONE OUTRANKS ANY SENTENCE WRITTEN BEFORE SHE DID IT.
   *
   * Placed above every sentinel branch for the same reason `could-not-run` is: a stored sentence is
   * a claim about a moment that has passed, and the covers row is the current fact. Approving them
   * was the last thing this case needed from her, so the honest reading of the screen after that
   * approval is "waiting on Simone", which is a calming true thing rather than a wrong instruction.
   */
  if (covers?.may_publish) {
    return {
      who: "simone",
      headline: "You approved the covers. It is Simone's move now.",
      detail:
        "Nothing further is needed from you on this. She uploads them on her next run, publishes ONE title, " +
        "checks it actually reaches Live on the bookshelf, and only then does the remaining six — and she " +
        "reports back here when they are Live rather than when Publish was clicked.",
    };
  }
  if (covers?.state === "awaiting") {
    return {
      who: "her",
      headline: "Seven replacement covers are waiting on your verdict.",
      detail: "They are in your Inbox with the covers themselves in the card: Approve, or Try Again with a sentence saying what is wrong.",
    };
  }

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

  const [titles, checks, duty, commitment] = await Promise.all([
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
    c.env.DB.prepare(
      `SELECT id, state, killed_at, killed_reason, done_at FROM owned_deliverables WHERE id = 'del_kdp_publication'`,
    ).first<{ id: string; state: string; killed_at: number | null; killed_reason: string | null; done_at: number | null }>(),
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

  const byState = { blocked: 0, draft: 0, in_review: 0, live: 0, withdrawn: 0 } as Record<string, number>;
  for (const t of rows) byState[t.state] = (byState[t.state] ?? 0) + 1;

  /*
   * ─── IS THERE ANYTHING LEFT TO CHASE? SAID ONCE, READ BY EVERY RUN ─────────
   *
   * 14 September 2026, 09:23: the case watcher ran on schedule, found no title blocked on the
   * register, and emailed her anyway — a message built from a 9 September narrative about covers
   * awaiting approval, two days after six of the seven titles went Live. Nothing it read told it to
   * stop, because nothing said, in one field, whether the chase was still open.
   *
   * This is that field. `open` is false when no title is blocked OR when she has stopped the
   * commitment herself. `kdp-watch.sh` and `kdp-publish.mjs` read it FIRST and exit at a named stop
   * when it is false — no mail is read, no determination is filed, no email goes to her. The
   * register decides; the run does not.
   */
  const chase = commitment && (commitment.state === "killed" || commitment.state === "done")
    ? {
        open: false,
        why: commitment.state === "killed"
          ? `You stopped this on ${new Date(commitment.killed_at ?? now).toISOString().slice(0, 10)}: "${commitment.killed_reason ?? ""}"`
          : `Finished on ${new Date(commitment.done_at ?? now).toISOString().slice(0, 10)}: every title reached Live.`,
      }
    : (byState.blocked ?? 0) === 0
      ? { open: false, why: "No title is blocked on the register. There is no case to chase and nothing to publish." }
      : { open: true, why: `${byState.blocked} title(s) still blocked.` };

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
    commitment: commitment ? { id: commitment.id, state: commitment.state, killed_reason: commitment.killed_reason } : null,
    chase,
    latest,
    days_since_last_check: sinceLastCheck,
    history,
    action: actionFor(latest, byState.blocked ?? 0, covers ? { state: covers.state, may_publish: covers.state === "approved" } : null),
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
    /*
     * ─── WHAT SIMONE NEEDS FROM HER MACHINE, SAID ONCE AND ON SCREEN ──────────
     *
     * Her requirement: "yea id rather it work regardless if my tab is open and if my laptop is open
     * or shut." Both halves are answered here, and the second one is answered HONESTLY rather than
     * optimistically, because a promise that a shut laptop is fine would be the same class of lie
     * as "her laptop is shut" was.
     *
     * THE TAB DEPENDENCY IS GONE. Proven on 9 September 2026: a scheduled `claude -p` run has no
     * Chrome tools at all — an open tab was never going to help it. Simone now starts her own Chrome
     * against her own profile, so nothing of hers has to be open. The one act left is a sign-in she
     * does once, by hand, in that profile; no password passes through this system and none can.
     *
     * THE LID IS PARTLY SOLVABLE AND THE LIMIT IS NAMED. launchd does not fire while the Mac sleeps;
     * it runs late on the next wake. A scheduled wake fixes that on power. On battery it will still
     * often miss, and powered off nothing local runs at all — and moving this to a cloud runner is
     * NOT the answer: it would put her Amazon publishing session on a datacentre IP that Amazon will
     * challenge, on the one account that is already flagged.
     */
    machine: {
      needs: [
        {
          key: "kdp_signin",
          what: "Sign Simone into KDP once, in her own browser profile",
          why: "She has her own Chrome profile now, so nothing of yours has to be open. It needs your sign-in once, and then every run reuses it.",
          how: "cd ~/GitHub/boss-os && npm run kdp:signin",
          how_kind: "terminal",
          takes: "about a minute, once",
        },
        {
          key: "scheduled_wake",
          what: "Wake the Mac three minutes before each run",
          why: "launchd cannot fire while the Mac is asleep — it runs late, on the next wake. This wakes it in time. It needs your password because it is a system setting.",
          how: "sudo pmset repeat wake MWF 09:20:00",
          how_kind: "terminal",
          takes: "seconds, once",
        },
      ],
      honest_limits: [
        "On battery and unplugged, a scheduled wake often will not fire. Plugged in, it will.",
        "Powered off, nothing on this Mac runs. There is no fix for that here, and moving the work to a server would put your Amazon publishing session on a datacentre IP — on an account that is already flagged.",
      ],
    },
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
  /*
   * AND THE REGISTER OUTRANKS THE SENTINEL. On 14 September a `needs-her` arrived for a shelf with
   * zero blocked titles and re-blocked the commitment, resetting `blocked_since` to that minute and
   * putting a cleared case back at the top of Today. A run's sentinel describes what the run read in
   * her mail; whether a book is blocked is a fact about the register, and the register is consulted.
   */
  const stillBlockedRow = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM kdp_titles WHERE state = 'blocked'`)
    .first<{ n: number }>();
  const anyBlocked = (stillBlockedRow?.n ?? 0) > 0;
  const stillBlocked = anyBlocked && sentinel !== "published" && sentinel !== "cleared";

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
/**
 * Where a message is allowed to end.
 *
 *   acted    — Simone did something about it, and `action_taken` says what.
 *   assigned — she opened work: a colleague through /assign, or something in her own queue.
 *   noted    — nothing to do, and `action_taken` says WHY not. The only outcome promo may carry,
 *              and the only one a `problem` may not.
 *
 * There is deliberately no fourth value and no default. A message that ends in none of these was
 * read and dropped, which is the defect.
 */
const OUTCOME_KINDS = new Set(["acted", "assigned", "noted"]);
const SURFACE_DUTY = "duty_kdp_surface";
/** What a problem is ABOUT, so the register's settled matters can be told from a new one without reading prose. */
const MATTERS = new Set(["title", "subtitle", "cover", "content", "rights", "case", "account", "other"]);
/** Simone. The surface duty's owner (`standing_duties.duty_kdp_surface.employee_id`). */
const SURFACE_OWNER = "emp_chief";

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
  const recorded: { id: string; disposition: string; needs_owner: boolean; assignment_id: string | null }[] = [];

  for (const raw of items) {
    const disposition = String(raw?.disposition ?? "").trim();
    if (!DISPOSITIONS.has(disposition)) {
      throw badRequest(`"${disposition}" is not a disposition`, `One of: ${[...DISPOSITIONS].join(", ")}.`);
    }
    const note = optionalText(raw?.note, 400);
    const action = optionalText(raw?.action_taken, 400);
    if (!note) throw badRequest("Every logged message needs a note", "A row that cannot say what the message was is one she cannot read back.");

    /*
     * ── EVERY MESSAGE ENDS SOMEWHERE NAMED ────────────────────────────────
     *
     *   "EVERYTIME I GET A KDP EMAIL SHE SHOULD READ IT AND DETERMINE IF THERE IS A TASK FOR HER"
     *
     * The defect this closes is the one this system produces most: a message read and silently
     * dropped. Before now `action_taken` was nullable and a row with nothing in it was accepted —
     * the same shape as the audit emails that carried counts and no URLs, and the same shape as the
     * approval that was marked executed having done nothing.
     *
     * THREE OUTCOMES, AND "NOTHING" IS ONE OF THEM. That is not a loophole. Promotional mail SHOULD
     * end in nothing; the difference between deciding that and forgetting is whether a reason was
     * written down. So `noted` is accepted and `noted` with no reason is refused, exactly as a
     * missing note is.
     */
    const outcome = String(raw?.outcome_kind ?? "").trim();
    if (!OUTCOME_KINDS.has(outcome)) {
      throw badRequest(
        `"${outcome}" is not an outcome`,
        `One of: ${[...OUTCOME_KINDS].join(", ")}. A message that ends in none of them was read and dropped, ` +
          "which is the one thing this log exists to make impossible.",
      );
    }
    if (!action) {
      throw badRequest(
        "Every message has to end in something said out loud",
        outcome === "noted"
          ? "Even 'nothing to do' needs its reason. Deciding a message is promotional and forgetting to read it look identical without one."
          : "Say what was actually done about it. An outcome with no account of itself is not an outcome.",
      );
    }
    /*
     * A PROBLEM MAY NOT END IN 'NOTHING TO DO'. "if something is wrong w/one of my titles she needs
     * to spring into action" — so the one disposition that means something is wrong is the one
     * disposition that cannot be noted and dropped. Enforced rather than requested, on the same
     * reasoning that stops `promo` waking her.
     */
    if (disposition === "problem" && outcome === "noted") {
      throw badRequest(
        "A problem with a title cannot end in 'nothing to do'",
        "Her instruction is that a title in trouble gets acted on without her being asked first. " +
          "Either act on it, or hand it to a colleague with POST /api/boss/kdp/assign and record that as the outcome.",
      );
    }

    for (const [field, value] of [["note", note], ["action_taken", action]] as const) {
      if (value && value.includes("@")) {
        throw badRequest(
          `The ${field} contains an '@' and was refused`,
          "The log describes what Amazon said; it never quotes it and never carries an address.",
        );
      }
    }

    /*
     * ── AN ASSIGNMENT IS A ROW, NOT A SENTENCE ────────────────────────────
     *
     * 15 and 16 Sep 2026: two rows read "Assigned to Zora for verification and metadata
     * correction" and `work_assignments` was empty. Zora never had it, nobody worked it, and
     * Amazon's five-day window lapsed. So `assigned` is refused unless the item carries a
     * structured `assign` — helper, what, why — and the row is created HERE, in the same request,
     * and its id is written on the log row. A colleague's queue is the record; prose about it is not.
     */
    const assign = raw?.assign && typeof raw.assign === "object" ? raw.assign : null;
    if (outcome === "assigned" && !assign) {
      throw badRequest(
        "'assigned' needs an assign block — helper_employee_id, what, why",
        "On 15 and 16 Sep 2026 an item said 'Assigned to Zora' and no assignment existed; Zora never had it. " +
          "The assignment is the work_assignments row this request creates, not the sentence.",
      );
    }
    if (assign && outcome !== "assigned") {
      throw badRequest("An assign block belongs on an 'assigned' outcome", "Say the outcome is what it is.");
    }
    const matter = raw?.matter == null ? null : String(raw.matter).trim().toLowerCase();
    if (matter !== null && !MATTERS.has(matter)) {
      throw badRequest(`"${matter}" is not a matter`, `One of: ${[...MATTERS].join(", ")}.`);
    }
    if (disposition === "problem" && !matter) {
      throw badRequest("A problem says what it is about", `matter is one of: ${[...MATTERS].join(", ")} — so a settled matter (the covers, the case) can be told from a new one.`);
    }
    const dueAt = raw?.due_at == null ? null : Number(raw.due_at);
    if (dueAt !== null && (!Number.isFinite(dueAt) || dueAt < 1_600_000_000_000)) {
      throw badRequest("due_at is a millisecond timestamp", "The sender's deadline, as a time, so a run can tell 'within five days' from 'whenever'.");
    }
    const ownerAsk = optionalText(raw?.owner_ask, 1200);
    const needsOwner = disposition === "problem" && raw?.needs_owner === true;
    if (needsOwner && !ownerAsk) {
      throw badRequest(
        "needs_owner needs an owner_ask — the one decision she is asked for, with a recommended default",
        "An email that says 'something needs you' with no question in it is the wake-up she stops reading.",
      );
    }
    if (ownerAsk && ownerAsk.includes("@")) throw badRequest("The owner_ask contains an '@' and was refused", "No addresses in the record.");

    const id = newId("kml");
    let assignmentId: string | null = null;
    if (assign) {
      const helper = String(assign.helper_employee_id ?? "").trim();
      const what = optionalText(assign.what, 300);
      const why = optionalText(assign.why, 400);
      if (!what || !why) throw badRequest("An assignment needs what and why", "A colleague handed a task with no reason has to guess at the outcome.");
      const seat = await c.env.DB.prepare(`SELECT id, name FROM employees WHERE id = ?`).bind(helper).first<any>();
      if (!seat) throw badRequest("That is not an employee", "Work can only be handed to a seat that exists, or nobody is accountable for it.");
      if (helper === SURFACE_OWNER) throw badRequest("Simone cannot assign the work to herself", "That is the work she already owns; the outcome is 'acted'.");
      assignmentId = newId("asg");
      await c.env.DB
        .prepare(
          `INSERT INTO work_assignments
             (id, owner_employee_id, helper_employee_id, deliverable_id, what, why, state, assigned_at, created_at, updated_at)
           VALUES (?,?,?,?,?,?, 'open', ?,?,?)`,
        )
        .bind(assignmentId, SURFACE_OWNER, helper, null, what, why, now, now, now)
        .run();
      await audit(c.env.DB, {
        actor: "system", lane: "ops", entityType: "work_assignment", entityId: assignmentId,
        action: "assigned", detail: { owner: SURFACE_OWNER, helper, what, kdp_mail_log_id: id },
      });
    }

    await c.env.DB
      .prepare(
        `INSERT INTO kdp_mail_log
           (id, seen_at, disposition, note, title_ref, action_taken, outcome_kind, needs_owner, source, created_at,
            due_at, matter, owner_ask, assignment_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id, now, disposition, note,
        optionalText(raw?.title_ref, 32),
        action,
        outcome,
        // ONLY A PROBLEM MAY NEED HER. Enforced rather than trusted — see the header.
        needsOwner ? 1 : 0,
        b?.source === "manual" ? "manual" : "launchd",
        now,
        dueAt, matter, ownerAsk, assignmentId,
      )
      .run();
    recorded.push({ id, disposition, needs_owner: needsOwner, assignment_id: assignmentId });
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

  return ok(c, { recorded: recorded.length, problems, items: recorded }, 201);
});

/**
 * ─── AN OPEN PROBLEM IS NEVER "ALREADY REPORTED" ─────────────────────────────
 *
 * 17–20 Sep 2026: the runs said quiet or blocked while a flagged title sat two days from Amazon's
 * deadline, because "newer_than:2d" found nothing new and nothing re-read what was still open. The
 * wrapper reads this BEFORE the run and hands the list to the prompt; the report script reads it
 * AFTER and chases anything within two days of `due_at` or past it, under Simone's name, every day
 * until `resolved_at` is set. Her answer on the `[kml_…]` thread rides on the row too, so the run
 * that executes it reads nothing else.
 */
kdp.get("/mail/open", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT id, seen_at, note, title_ref, action_taken, outcome_kind, needs_owner, due_at, matter, owner_ask,
              owner_answer, answered_at, delivered_message_id, nagged_at, assignment_id
         FROM kdp_mail_log WHERE disposition = 'problem' AND resolved_at IS NULL ORDER BY COALESCE(due_at, seen_at) ASC LIMIT 40`,
    )
    .all<any>();
  return ok(c, { open: rows.results ?? [] });
});

/** The one email a needs_owner row sent her (kind=ask), or a chase (kind=nag) — recorded by its Resend id. */
kdp.post("/mail/:id/delivered", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const kind = String(b?.kind ?? "ask");
  const messageId = optionalText(b?.message_id, 120);
  if (!messageId) throw badRequest("delivered needs the provider's message_id", "A delivery with no id is a claim; the id is the proof.");
  if (kind !== "ask" && kind !== "nag") throw badRequest("kind is ask or nag", "");
  const row = await c.env.DB.prepare(`SELECT id FROM kdp_mail_log WHERE id = ?`).bind(c.req.param("id")).first<any>();
  if (!row) throw notFound("No KDP mail row with that id");
  const now = Date.now();
  if (kind === "ask") {
    await c.env.DB.prepare(`UPDATE kdp_mail_log SET delivered_message_id = ? WHERE id = ?`).bind(messageId, row.id).run();
  } else {
    await c.env.DB.prepare(`UPDATE kdp_mail_log SET nagged_at = ? WHERE id = ?`).bind(now, row.id).run();
  }
  return ok(c, { id: row.id, kind, message_id: messageId });
});

/** A problem ends — with how. The only way `resolved_at` is set. */
kdp.post("/mail/:id/resolve", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const resolution = optionalText(b?.resolution, 600);
  if (!resolution) throw badRequest("A resolution says how the problem ended", "'Resolved' with no account of itself is the assignment-in-prose defect again.");
  if (resolution.includes("@")) throw badRequest("The resolution contains an '@' and was refused", "No addresses in the record.");
  const row = await c.env.DB.prepare(`SELECT id, resolved_at, assignment_id FROM kdp_mail_log WHERE id = ?`).bind(c.req.param("id")).first<any>();
  if (!row) throw notFound("No KDP mail row with that id");
  const now = Date.now();
  await c.env.DB.prepare(`UPDATE kdp_mail_log SET resolved_at = ?, resolution = ? WHERE id = ? AND resolved_at IS NULL`).bind(now, resolution, row.id).run();
  if (row.assignment_id) {
    await c.env.DB.prepare(`UPDATE work_assignments SET state = 'done', outcome = ?, completed_at = ?, updated_at = ? WHERE id = ? AND state = 'open'`).bind(resolution, now, now, row.assignment_id).run();
  }
  await audit(c.env.DB, { actor: "system", lane: "ops", entityType: "kdp_mail_log", entityId: row.id, action: "resolved", detail: { resolution } });
  return ok(c, { id: row.id, resolved_at: row.resolved_at ?? now });
});

/** What she can read back: the updates and the problems, newest first. Promo is not returned. */
kdp.get("/mail", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT id, seen_at, disposition, note, title_ref, action_taken, outcome_kind, needs_owner
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


// ─── Simone acting: the covers she approved, put up, and Publish pressed ─────

const PUBLISH_DUTY = "duty_kdp_publish";
const PUBLISH_OUTCOMES = new Set(["attempted", "could-not-run"]);
/** What the BOOKSHELF may say. `live` is the only one that ends anything. */
const RESULT_STATES = new Set(["blocked", "in_review", "live"]);

/**
 * What Simone did with the approved covers, per title.
 *
 * ─── The two-day defect this closes ────────────────────────────────────────
 *
 * The owner approved seven replacement covers on 9 September at 14:30. `approvals/resume.ts` fired
 * its `kdp_cover_upload` handler, stamped `executed_at`, wrote `execution_status = 'executed'`, and
 * its ENTIRE EFFECT was a sentence on the deliverable describing what Simone would do on her next
 * run. No run does it: the two existing KDP jobs are `claude -p` processes that read Amazon and
 * report, and a scheduled `claude -p` has no browser tools at all. So a real decision was recorded,
 * receipted, and handed to a run that was never scheduled. Seven books stayed blocked.
 *
 * This endpoint is what that run reports to, and everything about it is shaped by the lesson:
 *
 * A TITLE GOES LIVE BECAUSE THE BOOKSHELF SAYS SO. `resulting_state` is read from Amazon's own
 * shelf after the click, never from the click succeeding. "Publish was clicked" and "the book is
 * published" are different facts, and this case has already produced one confident answer that
 * changed nothing.
 *
 * A REFUSAL CARRIES AMAZON'S OWN WORDS. `amazon_message` is never a paraphrase — a paraphrased
 * refusal is how a server-side flag spent a week being described as an account-information problem.
 *
 * NOTHING MAY BE PUBLISHED THAT SHE DID NOT APPROVE. An attempt claiming a cover was uploaded must
 * name the judgement call that authorised it, and that call must actually be approved. A run
 * reporting an upload against an unapproved batch is refused outright, which is the gate she chose
 * — "have simone publish them" — enforced in the one place a script cannot route around.
 */
kdp.post("/publish", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const runOutcome = PUBLISH_OUTCOMES.has(String(b?.run_outcome ?? "")) ? String(b.run_outcome) : "attempted";
  const results = Array.isArray(b?.results) ? b.results : [];
  const judgementId = optionalText(b?.judgement_id, 64);
  const stopCode = optionalText(b?.stop_code, 64);
  const reason = optionalText(b?.reason);
  const nextAction = optionalText(b?.next_action);
  const source = b?.source === "manual" ? "manual" : "launchd";
  const now = Date.now();

  if (runOutcome === "could-not-run" && !reason) {
    throw badRequest(
      "A run that could not run has to say why",
      "Silence from a broken run and silence from a quiet day render identically, which is the confusion this whole lane exists to remove.",
    );
  }

  /*
   * ── HER APPROVAL, CHECKED SERVER-SIDE, BEFORE ANY UPLOAD IS BELIEVED ──────
   *
   * The script checks this too, and that check is the legible error rather than the guarantee. This
   * one is the guarantee: a run cannot report having put a cover on a book unless the batch it
   * names is a judgement call she actually approved.
   */
  const claimsWork = results.some((r: any) => r?.cover_uploaded === true || r?.publish_attempted === true);
  if (claimsWork) {
    if (!judgementId) {
      throw badRequest(
        "A publish attempt must name the approval it acted on",
        "An upload that cannot name her verdict is one nobody authorised. Her approval is the gate and it is not optional.",
      );
    }
    const approved = await c.env.DB
      .prepare(`SELECT id, state FROM judgement_calls WHERE id = ? AND resume_kind = 'kdp_cover_upload'`)
      .bind(judgementId)
      .first<{ id: string; state: string }>();
    if (!approved) {
      throw badRequest(
        `${judgementId} is not a cover decision on this system`,
        "Nothing was recorded. A publish attempt has to trace to a judgement call she was actually shown.",
      );
    }
    if (approved.state !== "approved") {
      throw badRequest(
        `The covers on ${judgementId} are "${approved.state}", not approved`,
        "Uploading a cover she has not approved, or has sent back, is refused here rather than trusted to the run. " +
          "Her verdict is the gate — that was her own instruction and this is where it is kept.",
      );
    }
  }

  const recorded: { title_ref: string; state: string }[] = [];
  for (const r of results) {
    const ref = optionalText(r?.title_ref, 32);
    if (!ref) throw badRequest("Every result needs a title reference", "A result that cannot say which book it is about is one nobody can act on.");
    const resulting = RESULT_STATES.has(String(r?.state ?? "")) ? String(r.state) : "blocked";
    const message = optionalText(r?.message, 500);
    if (message && message.includes("@")) {
      throw badRequest(
        "An Amazon message contains an '@' and was refused",
        "What Amazon said about a title never needs an address in it, and prose is where one would arrive unintended.",
      );
    }

    await c.env.DB
      .prepare(
        `INSERT INTO kdp_publish_attempts
           (id, attempted_at, judgement_id, title_ref, cover_uploaded, publish_attempted,
            resulting_state, amazon_message, run_outcome, stop_code, source, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        newId("kpa"), now, judgementId, ref,
        r?.cover_uploaded === true ? 1 : 0,
        r?.publish_attempted === true ? 1 : 0,
        resulting, message, runOutcome, stopCode, source, now,
      )
      .run();

    /*
     * THE TITLE MOVES ONLY ON WHAT THE SHELF SAID. `live` and `in_review` are both written from the
     * bookshelf read the run performed afterwards; `blocked` never overwrites a title she has
     * already taken live or withdrawn by hand.
     */
    if (resulting === "live") {
      await c.env.DB
        .prepare(
          `UPDATE kdp_titles SET state = 'live', went_live_at = COALESCE(went_live_at, ?), state_changed_at = ?, updated_at = ?
            WHERE title_ref = ? AND state != 'live'`,
        )
        .bind(now, now, now, ref)
        .run();
    } else if (resulting === "in_review") {
      await c.env.DB
        .prepare(
          `UPDATE kdp_titles SET state = 'in_review', state_changed_at = ?, updated_at = ?
            WHERE title_ref = ? AND state = 'blocked'`,
        )
        .bind(now, now, ref)
        .run();
    }
    recorded.push({ title_ref: ref, state: resulting });
  }

  /*
   * THE DUTY'S CLOCK, ON THE SAME RULE EVERY OTHER LOCAL JOB NOW FOLLOWS. A run that could not run
   * does NOT advance it: the duty is still due, because the work did not happen.
   */
  const duty = await c.env.DB
    .prepare(`SELECT id, local_hour, local_minute, timezone, cadence, weekday, weekdays FROM standing_duties WHERE id = ?`)
    .bind(PUBLISH_DUTY)
    .first<any>();
  if (duty) {
    if (runOutcome === "attempted") {
      const next = advance(duty, now);
      await c.env.DB
        .prepare(
          next === null
            ? `UPDATE standing_duties SET last_run_at = ?, last_outcome = 'ok', last_outcome_at = ?, last_failure_reason = NULL WHERE id = ?`
            : `UPDATE standing_duties SET last_run_at = ?, last_outcome = 'ok', last_outcome_at = ?, last_failure_reason = NULL, next_due_at = ? WHERE id = ?`,
        )
        .bind(...(next === null ? [now, now, PUBLISH_DUTY] : [now, now, next, PUBLISH_DUTY]))
        .run();
    } else {
      await c.env.DB
        .prepare(`UPDATE standing_duties SET last_outcome = 'failed', last_outcome_at = ?, last_failure_reason = ? WHERE id = ?`)
        .bind(now, reason, PUBLISH_DUTY)
        .run();
    }
  }

  const live = recorded.filter((r) => r.state === "live").length;
  const stillBlocked = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM kdp_titles WHERE state = 'blocked'`)
    .first<{ n: number }>();

  await recordDeliverableActivity(c.env, {
    id: "del_kdp_publication",
    blocked: (stillBlocked?.n ?? 0) > 0,
    status:
      runOutcome === "could-not-run"
        ? `Simone tried to publish and could not: ${reason}${nextAction ? ` What to do: ${nextAction}` : ""}`
        : live > 0
          ? `${live} title(s) reached Live on the bookshelf. ${stillBlocked?.n ?? 0} still blocked.`
          : `Covers went up and nothing reached Live. ${stillBlocked?.n ?? 0} still blocked; Amazon's own message is on each title.`,
    statusKind: runOutcome === "could-not-run" ? "could-not-run" : "determined",
    now,
  }).catch(() => {});

  await logEvent(c.env.DB, {
    level: runOutcome === "could-not-run" || live === 0 ? "warn" : "info",
    scope: "duties", event: "kdp_publish_attempted", entityId: PUBLISH_DUTY,
    detail: { attempted: recorded.length, live, stop_code: stopCode },
  }).catch(() => {});

  await audit(c.env.DB, {
    actor: "system", lane: "ops", entityType: "standing_duty", entityId: PUBLISH_DUTY,
    action: "kdp_publish_reported", detail: { results: recorded.length, live, run_outcome: runOutcome },
  });

  return ok(c, { recorded: recorded.length, live, still_blocked: stillBlocked?.n ?? 0 }, 201);
});

/** What was tried on each book, newest first, with Amazon's own words for anything that refused. */
kdp.get("/publish", async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT id, attempted_at, judgement_id, title_ref, cover_uploaded, publish_attempted,
              resulting_state, amazon_message, run_outcome, stop_code, source
         FROM kdp_publish_attempts ORDER BY attempted_at DESC LIMIT 60`,
    )
    .all<any>();
  return ok(c, { attempts: rows.results ?? [] });
});
