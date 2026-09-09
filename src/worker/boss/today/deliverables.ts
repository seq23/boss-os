import type { Env } from "../env";

/**
 * OWNED WORK, AND WHY IT CANNOT BE QUIETLY DROPPED.
 *
 * Her rule: "she owns this deliverable so she needs to make sure its done and if there is any block
 * she needs to tell me immediately and keep reminding me until its done. she canot drop it. that
 * goes for all employees when i give them something to own."
 *
 * ─── The distinction this file rests on ─────────────────────────────────────
 *
 * A DUTY IS DEFINED BY FIRING. A DELIVERABLE IS DEFINED BY BEING TRUE.
 *
 * `duty_practice_week` fired every Sunday for eleven weeks, cost real money, and delivered into a
 * handler that did not exist. Every signal said it worked, because a duty's success criterion is
 * that it ran. That is the failure this mechanism outlaws, and it is why the terminal check here
 * asks the RECORDS rather than asking the duty, the employee, or the job.
 *
 * ─── Which is what makes a broken executor loud instead of restful ──────────
 *
 * Nothing a run says can close a deliverable. A watcher that stops reporting stops advancing
 * `last_activity_at`, and that silence IS the stall condition — so the failure mode where a
 * commitment dies along with the job that was keeping it alive cannot happen here. The commitment
 * outlives its executor by construction.
 *
 * ─── Computed on read, on the screen she already opens ──────────────────────
 *
 * Every alert below is produced while rendering Today. Not by a cron that could itself fail
 * silently, and not on a page she has to remember to visit. An escalation you have to go and find
 * is not an escalation.
 */

export interface DeliverableRow {
  id: string;
  name: string;
  employee_id: string;
  employee_name: string | null;
  lane: string;
  terminal_condition: string;
  terminal_check: string;
  state: string;
  duty_id: string | null;
  escalation_path: string;
  blocker: string | null;
  /**
   * WHAT IS STOPPING IT RIGHT NOW, AND WHAT THE LAST RUN LEARNED.
   *
   * The second of the two facts, and the one whose absence made the alert lie. `blocker` is the
   * standing reason the commitment exists and has not completed; it changes rarely and deliberately
   * and it is what she acts on. This changes on every run.
   *
   * 0203 collapsed them, so a determination overwrote the standing reason and the escalation became
   * a log line. The fix was to stop writing a blocker at all, which meant the alert froze on the day
   * it was seeded and was still confidently describing a week-old theory after the connector had
   * expired and after support had named a different cause entirely. Two facts need two fields.
   */
  current_status: string | null;
  current_status_at: number | null;
  /**
   * 'determined'    — a run happened and this is what it found.
   * 'could-not-run' — a run was attempted and could not proceed. A dead credential, a missing
   *                   prompt, a session that never reached its sentinel.
   *
   * On 7 September these looked identical on the screen: silence. They are opposite facts. Silence
   * is only evidence when something was actually listening, and this is how the screen says which.
   */
  current_status_kind: string | null;
  blocked_since: number | null;
  last_activity_at: number | null;
  stall_after_days: number;
}

export interface DeliverableAlert {
  severity: "medium" | "high" | "critical";
  text: string;
  source_type: string;
  source_id: string | null;
}

/**
 * THE LADDER. Days blocked → how loudly she is told.
 *
 * "Keep reminding me until its done" is the instruction, and a reminder that reads identically on
 * day one and day twenty is one she learns to skim past — which is the same silence it was meant to
 * replace, wearing a badge. So the words change as well as the severity, and the top rung says the
 * thing that is actually true at a fortnight: the current route is not working and something else
 * has to happen.
 *
 * Pure arithmetic, exported, so the interesting rungs are testable without standing anything up.
 */
export function escalationFor(daysBlocked: number): { severity: "medium" | "high" | "critical"; tone: string } {
  if (daysBlocked >= 14) {
    return {
      severity: "critical",
      tone: "This has been blocked for over two weeks. The route being used is not working — it needs a different one, and only you can open it.",
    };
  }
  if (daysBlocked >= 7) {
    return { severity: "critical", tone: "A week blocked. Whatever is being tried is not moving it." };
  }
  if (daysBlocked >= 3) {
    return { severity: "high", tone: "Still blocked after several days." };
  }
  return { severity: "medium", tone: "Raised now, and it stays here until it clears." };
}

/** An unambiguous date. Not "3 days ago": a date she can compare against her own week. */
const on = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/**
 * THE CURRENT STATE, ON THE ALERT, DATED — which is the whole of what was missing.
 *
 * Her words, on 9 September: "the critical alerts for simone did not say anything about my oauth
 * being disconnected and that is a problem. it says something else". What it said was the diagnosis
 * from a week earlier, because nothing was allowed to write it any more.
 *
 * Three things are non-negotiable here and each of them is a defect that actually happened:
 *
 *  1. THE DATE IS PRINTED. A stale sentence that carries its own date is visibly stale; the same
 *     sentence without one reads as today's news. This is the only reason she could not tell.
 *  2. "I COULD NOT RUN" IS NOT ALLOWED TO LOOK LIKE "I RAN AND FOUND NOTHING". A run blocked by a
 *     dead credential learned nothing, so its silence is not evidence about Amazon, and the
 *     sentence says so out loud rather than leaving her to infer it from a sentinel.
 *  3. NEVER HAVING REPORTED IS ITS OWN SENTENCE. An empty status is not a calm one.
 */
export function statusLine(
  d: Pick<DeliverableRow, "current_status" | "current_status_at" | "current_status_kind">,
): string {
  if (!d.current_status || d.current_status_at === null) {
    return "No run has reported on this yet, so nothing here is current — which is itself worth knowing.";
  }
  const when = on(d.current_status_at);
  if (d.current_status_kind === "could-not-run") {
    return (
      `The last attempt COULD NOT RUN (${when}): ${d.current_status} ` +
      "Nothing was learned about the work itself, so this silence is not evidence that nothing has changed."
    );
  }
  return `Latest, ${when}: ${d.current_status}`;
}

/**
 * The terminal conditions the Worker knows how to evaluate.
 *
 * A DELIVERABLE IS CLOSED BY THE WORLD, NOT BY A CLAIM. Each check counts real rows. Adding one is
 * a deliberate act: `validate:owned-deliverables` fails the build if a migration names a check that
 * is not in this object, because a deliverable whose terminal check is a typo can never be
 * satisfied and would nag her for ever with no way out but killing it.
 */
export const TERMINAL_CHECKS: Record<
  string,
  (env: Env) => Promise<{ met: boolean; progress: string }>
> = {
  /**
   * Every authored title is Live.
   *
   * `in_review` DOES NOT COUNT AS DONE. A title Amazon is still looking at is not published, and
   * three of hers sat in review for days before going Live. Counting them would close the
   * deliverable on the strength of a submission.
   */
  kdp_all_live: async (env: Env) => {
    const row = await env.DB
      .prepare(
        `SELECT
           SUM(CASE WHEN state IN ('blocked','in_review') THEN 1 ELSE 0 END) AS outstanding,
           SUM(CASE WHEN state = 'live' THEN 1 ELSE 0 END) AS live,
           COUNT(*) AS total
         FROM kdp_titles WHERE state != 'withdrawn'`,
      )
      .first<{ outstanding: number; live: number; total: number }>();

    const outstanding = row?.outstanding ?? 0;
    const live = row?.live ?? 0;
    const total = row?.total ?? 0;

    /*
     * AN EMPTY TABLE IS NOT COMPLETION. Zero outstanding out of zero titles would otherwise read as
     * "everything is published" — the empty-loop pass, at the level of an outcome. If the register
     * of titles is empty, the deliverable is not met and says why.
     */
    if (total === 0) {
      return { met: false, progress: "No titles are recorded at all, which is a broken register rather than a finished shelf." };
    }

    /*
     * WHEN IT IS DONE, IT SAYS WHICH BOOKS — because "Simone finished it" is not a report.
     *
     * Her ask: "simone should report back to me when she has uploaded the new covers AND
     * successfully published the books." The three verbs in that sentence are not the same event,
     * and this is exactly where a system lies to its owner: a cover uploaded is not a book
     * published, and Publish clicked is not Live. Only the register of what is actually Live can
     * close this, and when it does she is told which references went out rather than being told
     * that a job succeeded.
     */
    if (outstanding === 0) {
      const refs = await env.DB
        .prepare(`SELECT title_ref FROM kdp_titles WHERE state = 'live' ORDER BY went_live_at, title_ref`)
        .all<{ title_ref: string }>();
      const list = (refs.results ?? []).map((r) => r.title_ref).join(", ");
      return { met: true, progress: `All ${live} titles are Live on Amazon: ${list}. Nothing is outstanding.` };
    }

    const stuck = await env.DB
      .prepare(`SELECT title_ref, state FROM kdp_titles WHERE state IN ('blocked','in_review') ORDER BY state, title_ref`)
      .all<{ title_ref: string; state: string }>();
    const still = (stuck.results ?? []).map((r) => `${r.title_ref} (${r.state})`).join(", ");
    return { met: false, progress: `${live} of ${total} Live. Still outstanding: ${still}.` };
  },

  /**
   * The KDP mail is readable without the claude.ai connector.
   *
   * CLOSED BY A CALL THAT SUCCEEDED, NOT BY A FILTER BEING CREATED. She could set up the forwarding
   * rule and mistype the address, or forward to the wrong mailbox, or Google could quietly stop
   * honouring it — and in every one of those cases the work would look done and Simone would still
   * go blind the next time the connector expired. So the condition is that the prober, using the
   * service account, ACTUALLY FOUND Amazon mail in the Workspace mailbox on its last run.
   *
   * `unknown` is not `live` and never closes this. A probe that could not decide has decided
   * nothing.
   */
  kdp_mail_reachable_without_connector: (env: Env) => probeIsLive(env, "cred_kdp_mail_via_workspace"),

  /**
   * West Peek LP replies can be read.
   *
   * CLOSED BY THE IMPERSONATION SUCCEEDING, NOT BY THE GRANT BEING REQUESTED. This item has been on
   * the Wednesday packet, unchanged, every week since 19 August — which is how three weeks passed
   * with nobody noticing. Asking is not the outcome, and an item she has to tick off by hand will
   * sit there wrongly for ever while one that never re-tests will keep nagging after it is fixed.
   * So the prober attempts the call the grant would authorise, and the morning after Scooter
   * authorises it, this closes itself.
   */
  westpeek_replies_readable: (env: Env) => probeIsLive(env, "cred_westpeek_delegation"),
};

/**
 * A terminal condition that is "this credential actually works".
 *
 * `unknown` IS NOT `live` AND NEVER CLOSES ANYTHING. A probe that could not decide has decided
 * nothing, and treating it as success would be the empty-loop pass at the level of an outcome —
 * exactly what the zero-titles guard above exists to prevent.
 */
async function probeIsLive(env: Env, probeId: string): Promise<{ met: boolean; progress: string }> {
  const row = await env.DB
    .prepare(`SELECT state, detail, checked_at FROM credential_probes WHERE id = ?`)
    .bind(probeId)
    .first<{ state: string; detail: string | null; checked_at: number | null }>();

  // The register having lost its row is a broken prober, not a working credential.
  if (!row) {
    return { met: false, progress: `The probe that would decide this (${probeId}) is not in the register at all, so nothing can answer it.` };
  }
  if (row.checked_at === null) {
    return { met: false, progress: "Nothing has probed this yet. Run npm run credentials:check." };
  }
  return {
    met: row.state === "live",
    progress: row.detail ?? `The probe last answered ${row.state} on ${on(row.checked_at)}.`,
  };
}

/**
 * Every open deliverable, evaluated, with anything that needs saying.
 *
 * Returns the alerts rather than pushing them, so `today.ts` decides where they sit and this file
 * stays testable. Closing a deliverable whose condition is now met is a WRITE and happens here on
 * purpose: the moment the world becomes true is the moment it should stop nagging her, and making
 * that depend on a separate job would be one more thing that can fail silently.
 */
export async function deliverableAlerts(env: Env, now = Date.now()): Promise<DeliverableAlert[]> {
  const rows = await env.DB
    .prepare(
      `SELECT d.id, d.name, d.employee_id, e.name AS employee_name, d.lane, d.terminal_condition,
              d.terminal_check, d.state, d.duty_id, d.escalation_path, d.blocker,
              d.current_status, d.current_status_at, d.current_status_kind, d.blocked_since,
              d.last_activity_at, d.stall_after_days
         FROM owned_deliverables d
         LEFT JOIN employees e ON e.id = d.employee_id
        WHERE d.state IN ('open','blocked')
        ORDER BY COALESCE(d.blocked_since, d.created_at)`,
    )
    .all<DeliverableRow>();

  const open = rows.results ?? [];
  const alerts: DeliverableAlert[] = [];

  /*
   * ── FINISHED WORK STAYS ON THE SCREEN FOR A WEEK ────────────────────────────
   *
   * Her ask: "simone should report back to me when she has uploaded the new covers AND successfully
   * published the books. maybe she should send a message in my inbox".
   *
   * THE COMPLETION USED TO EXIST FOR EXACTLY ONE PAGE LOAD. The moment a terminal check passed, the
   * row flipped to `done`, an alert was pushed, and from the next render onward it was gone from
   * the query above — so whether she ever saw the one thing she asked to be told depended on
   * whether she happened to be looking. A report that fires into an empty room is not a report.
   *
   * NOT THE APPROVAL INBOX, WHICH IS WHERE SHE SUGGESTED PUTTING IT. That surface was emptied
   * deliberately on 8 September — "an approval exists when your answer changes what happens next" —
   * and putting a notification back into it is how it filled up with things to clear without
   * reading last time. This is the same screen she already opens every morning, and it is the
   * channel that survives the Gmail connector being dead, which the email cannot say of itself.
   */
  const recentlyDone = await env.DB
    .prepare(
      `SELECT d.id, d.name, d.terminal_check, d.done_at, e.name AS employee_name, d.employee_id
         FROM owned_deliverables d
         LEFT JOIN employees e ON e.id = d.employee_id
        WHERE d.state = 'done' AND d.done_at IS NOT NULL AND d.done_at > ?
        ORDER BY d.done_at DESC`,
    )
    .bind(now - 7 * 86_400_000)
    .all<{ id: string; name: string; terminal_check: string; done_at: number; employee_name: string | null; employee_id: string }>();

  for (const d of recentlyDone.results ?? []) {
    const check = TERMINAL_CHECKS[d.terminal_check];
    // The breakdown is recomputed rather than remembered, so the sentence cannot claim a book is
    // Live after it has been pulled back down. It reports the shelf, not the moment.
    const outcome = check ? await check(env).catch(() => null) : null;
    alerts.push({
      severity: "medium",
      text:
        `DONE — ${d.employee_name ?? d.employee_id} finished "${d.name}" on ${on(d.done_at)}. ` +
        (outcome?.progress ?? "The completion check can no longer be evaluated, so this is the record of it rather than a re-check."),
      source_type: "tasks",
      source_id: d.id,
    });
  }

  /*
   * RULE 0, ON A SURFACE RATHER THAN IN A BUILD.
   *
   * A loop over an empty set that returns "nothing to report" is the defect class her rules name by
   * name, and here it would be the worst possible instance of it: a register of commitments that is
   * empty renders as "nothing is stuck", which is indistinguishable from "everything is fine". The
   * system was seeded with one deliverable in 0202, so zero means rows were lost or the table was
   * never migrated — either way she is told, rather than shown a reassuring blank.
   */
  if (open.length === 0) {
    const anyAtAll = await env.DB.prepare(`SELECT COUNT(*) AS n FROM owned_deliverables`).first<{ n: number }>();
    if ((anyAtAll?.n ?? 0) === 0) {
      alerts.push({
        severity: "high",
        text: "The register of owned work is empty. That is a broken register, not a clear plate — nothing can be tracked as owned until something is in it.",
        source_type: "tasks",
        source_id: null,
      });
    }
    return alerts;
  }

  for (const d of open) {
    const who = d.employee_name ?? d.employee_id;

    // ── Has the world made it true? ──
    const check = TERMINAL_CHECKS[d.terminal_check];
    if (check) {
      let outcome: { met: boolean; progress: string } | null = null;
      try {
        outcome = await check(env);
      } catch {
        // A check that throws must not close the deliverable and must not hide it. It stays open
        // and the ordinary escalation below still runs, which is the safe direction.
        outcome = null;
      }
      if (outcome?.met) {
        await env.DB
          .prepare(`UPDATE owned_deliverables SET state = 'done', done_at = ?, updated_at = ? WHERE id = ?`)
          .bind(now, now, d.id)
          .run();
        await reportCompletion(env, d, outcome.progress, who, now);
        alerts.push({
          severity: "medium",
          // Same wording as the seven-day record below, so the sentence she reads on the day it
          // lands is the sentence still there on Thursday.
          text: `DONE — ${who} finished "${d.name}" on ${on(now)}. ${outcome.progress}`,
          source_type: "tasks",
          source_id: d.id,
        });
        continue;
      }
    } else {
      /*
       * A DELIVERABLE WITH NO KNOWN CHECK CAN NEVER COMPLETE, so it is reported as the fault it is
       * rather than nagging her for ever about something with no way out. The build validator makes
       * this unreachable; it is here because a validator only guards the migrations it can see.
       */
      alerts.push({
        severity: "high",
        text: `"${d.name}" names a completion check (${d.terminal_check}) this system does not have, so nothing can ever mark it done. ${who} owns it.`,
        source_type: "tasks",
        source_id: d.id,
      });
    }

    // ── Blocked: tell her at once, and keep telling her, louder. ──
    if (d.state === "blocked") {
      const days = Math.floor((now - (d.blocked_since ?? now)) / 86_400_000);
      const { severity, tone } = escalationFor(days);
      /*
       * TWO SENTENCES, IN THIS ORDER, AND THE ORDER IS THE ARGUMENT.
       *
       * The standing reason first, because that is what she acts on and it is stable enough to be
       * worth reading twice. Then what is true right now, dated, because that is the half that was
       * frozen for a week while the connector died and support changed its answer.
       *
       * THE DAY COUNT IS UNAFFECTED BY EITHER OF THEM. It comes from `blocked_since`, which nothing
       * in the reporting path may touch, so a new sentence today does not make a nine-day block
       * look like a fresh one.
       */
      alerts.push({
        severity,
        text:
          `${who} is blocked on "${d.name}" — ${days} day${days === 1 ? "" : "s"}. ` +
          `${d.blocker ?? "No blocker was recorded, which is itself the problem."} ` +
          `${statusLine(d)} ${tone}`,
        source_type: "tasks",
        source_id: d.id,
      });
    }

    /*
     * ── Silence, which is its own alarm. ──
     *
     * THIS IS THE RULE THAT MAKES DROPPING IT IMPOSSIBLE. An owner who stops working something, a
     * launchd job that stops firing, a duty skipped for budget — all three look identical from
     * inside the system, and all three produce the same thing: nothing happening. So nothing
     * happening is what is measured, and it is measured against the deliverable rather than against
     * the executor, which means a broken executor makes this louder rather than quieter.
     */
    const since = d.last_activity_at ?? null;
    const stallDays = since === null ? null : Math.floor((now - since) / 86_400_000);
    if (stallDays !== null && stallDays >= d.stall_after_days) {
      alerts.push({
        severity: stallDays >= d.stall_after_days * 2 ? "critical" : "high",
        text:
          `Nothing has happened on "${d.name}" for ${stallDays} days and ${who} owns it. ` +
          (d.duty_id
            ? `${d.duty_id} is meant to be moving it, so either it has stopped running or it is running and achieving nothing. `
            : "Nothing automated is moving it, so it moves when you move it. ") +
          // The last thing anyone learned, dated — because "nothing has happened for nine days" and
          // "the last thing that happened was the credential dying" are a different next move.
          statusLine(d),
        source_type: "tasks",
        source_id: d.id,
      });
    }
    if (since === null) {
      alerts.push({
        severity: "high",
        text: `"${d.name}" has never had any activity recorded, and ${who} owns it. Nothing has started.`,
        source_type: "tasks",
        source_id: d.id,
      });
    }
  }

  /*
   * ── WORK STOPPED, WAITING FOR HER VERDICT ───────────────────────────────────
   *
   * "everything should be delivered like this for my approval? and i should have an easy way to say
   * approved or try again and if i say apprpved she should continue to finish."
   *
   * ONE LIST, NOT TWO. Her CLAUDE.md names "two components each keeping their own list with no link
   * between them" as a defect class, and a second register of things-needing-her — escalating on its
   * own clock, on its own screen — would be a textbook instance. So an unanswered judgement escalates
   * HERE, on the same ladder as every other piece of owned work, counted from when it was raised.
   *
   * It is deliberately not a stop on the employee's other work: Simone keeps chasing the KDP case on
   * her own cadence while the covers wait. What is blocked is the covers, and the alert says so.
   */
  const waiting = await env.DB
    .prepare(
      `SELECT j.id, j.title, j.question, j.created_at, j.attempt, j.approval_id, e.name AS employee_name,
              j.employee_id, a.status AS approval_status
         FROM judgement_calls j
         LEFT JOIN employees e ON e.id = j.employee_id
         LEFT JOIN approvals a ON a.id = j.approval_id
        WHERE j.state = 'awaiting'
        ORDER BY j.created_at`,
    )
    .all<any>();

  for (const j of waiting.results ?? []) {
    const days = Math.floor((now - j.created_at) / 86_400_000);
    const { severity, tone } = escalationFor(days);
    alerts.push({
      severity,
      text:
        `${j.employee_name ?? j.employee_id} is waiting on your verdict — "${j.title}", ${days} day${days === 1 ? "" : "s"}` +
        `${j.attempt > 1 ? `, attempt ${j.attempt}` : ""}. ${j.question} ` +
        "It is in your Inbox with the work in it: Approve to let her carry on and finish, or Try Again with a sentence saying what is wrong. " +
        tone,
      source_type: "approvals",
      source_id: j.approval_id,
    });

    /*
     * AN AWAITING JUDGEMENT WHOSE DOCKET IS GONE CANNOT BE ANSWERED. It would sit on this list for
     * ever with no control anywhere that could resolve it — the exact "nags her with no route out"
     * shape the terminal-check validator exists to prevent, arriving by a different door.
     */
    if (j.approval_status !== "pending") {
      alerts.push({
        severity: "high",
        text:
          `"${j.title}" is waiting on you but its Inbox docket is ${j.approval_status ?? "missing"}, so there is nothing left to click. ` +
          "The work cannot resume until it is raised again.",
        source_type: "approvals",
        source_id: j.approval_id,
      });
    }
  }

  return alerts;
}

/**
 * EVERY EMPLOYEE REPORTS COMPLETION. Not just Simone.
 *
 * Her correction, when told Simone would report the books going Live: "why only Simone! EVERY
 * FUCKING EMPLOYEE I GIVE A TASK SHOULD REPORT COMPLETION!!"
 *
 * So it is built here, at the mechanism, and every owned deliverable gets it — including a one-off
 * she hands someone, because `owned_deliverables` is what "something I gave you to own" means and it
 * does not care whether a duty is attached. An instruction living in one employee's prompt is one the
 * next employee does not have.
 *
 * ─── Blocks escalate; completions report. Both ends of the same commitment ──
 *
 * DETECTED, NEVER CLAIMED. This is called only from the branch where `TERMINAL_CHECKS` counted real
 * records and found the condition met. Nothing an employee, a run or a job says can reach it.
 *
 * IT FIRES ONCE. The insert is guarded on there being no existing judgement for this deliverable, so
 * a completion cannot announce itself twice — a report that repeats becomes noise, and noise is what
 * the escalation ladder was designed around in the first place.
 *
 * AND IT SAYS WHAT DID NOT COMPLETE, because `progress` comes from the check itself and names the
 * records. A partial result reported as success is worse than silence: she stops trusting the next
 * one.
 *
 * A FAILURE HERE MUST NOT UNDO THE COMPLETION. The deliverable is already closed by the world being
 * true; if the docket cannot be raised, the seven-day DONE alert above still reaches her, and that
 * is the honest ordering — the fact is not contingent on the notification.
 */
async function reportCompletion(
  env: Env,
  d: DeliverableRow,
  progress: string,
  who: string,
  now: number,
): Promise<void> {
  try {
    const already = await env.DB
      .prepare(`SELECT id FROM judgement_calls WHERE deliverable_id = ? AND resume_kind = 'completion_acknowledged'`)
      .bind(d.id)
      .first<{ id: string }>();
    if (already) return;

    const jid = `jdg_done_${d.id}`;
    const aid = `apr_done_${d.id}`;
    await env.DB.batch([
      env.DB
        .prepare(
          `INSERT INTO approvals (id, lane, title, summary, kind, origin_type, origin_id, risk,
                                  payload, status, requested_at, expires_at)
           VALUES (?,?,?,?,'judgement_call','judgement_calls',?,'low',?,'pending',?,NULL)`,
        )
        .bind(
          aid, d.lane, `DONE — ${d.name}`,
          `${who} finished it. ${progress} Approve to acknowledge, or Try Again if it is not actually done.`,
          jid, JSON.stringify({ judgement_id: jid, resume_kind: "completion_acknowledged" }), now,
        ),
      env.DB
        .prepare(
          `INSERT INTO judgement_calls
             (id, approval_id, employee_id, deliverable_id, title, question, resume_kind, state,
              attempt, created_at, updated_at)
           VALUES (?,?,?,?,?,?,'completion_acknowledged','awaiting',1,?,?)`,
        )
        .bind(
          jid, aid, d.employee_id, d.id, `DONE — ${d.name}`,
          `${who} finished it, and the records agree: ${progress} ` +
            "Approve to acknowledge. Try Again reopens it with your reason, if this is not actually done.",
          now, now,
        ),
      env.DB
        .prepare(`INSERT INTO approval_events (id, approval_id, ts, event, detail) VALUES (?,?,?,'raised',?)`)
        .bind(`ape_done_${d.id}`, aid, now, JSON.stringify({ completion: true })),
    ]);
  } catch {
    // See the header: the completion is a fact about the world and does not depend on this docket.
  }
}

/**
 * Something happened on a deliverable.
 *
 * Called by whatever moves the work — the KDP watcher's report is the first caller. It advances
 * `last_activity_at`, which is the only thing standing between a commitment and the stall alarm,
 * and it may set or clear the block. IT CANNOT MARK ANYTHING DONE: only `TERMINAL_CHECKS` does
 * that, and that asymmetry is the whole design.
 *
 * ─── What a run may write, and what it may not ──────────────────────────────
 *
 * `status` — YES, ON EVERY RUN. It is the point of the call. An alert that cannot be updated by the
 * thing doing the work is an alert that goes stale and then lies, which is what happened.
 *
 * `blocker` — the standing reason, and a run should not normally touch it. It is still a parameter
 * because a caller with a genuinely new standing reason should have somewhere to put it, and
 * `routes/kdp.ts` deliberately never passes one. The two are separate fields so that writing the
 * first cannot destroy the second; that separation, not a missing parameter, is what makes it safe.
 */
export async function recordDeliverableActivity(
  env: Env,
  args: {
    id: string;
    blocked?: boolean;
    blocker?: string | null;
    status?: string | null;
    statusKind?: "determined" | "could-not-run";
    now?: number;
  },
): Promise<void> {
  const now = args.now ?? Date.now();
  const row = await env.DB
    .prepare(`SELECT id, state, blocked_since FROM owned_deliverables WHERE id = ?`)
    .bind(args.id)
    .first<{ id: string; state: string; blocked_since: number | null }>();
  if (!row) return;
  // A deliverable she killed stays killed. A run reporting activity on it must not resurrect a
  // decision she made.
  if (row.state === "killed" || row.state === "done") {
    await env.DB.prepare(`UPDATE owned_deliverables SET last_activity_at = ?, updated_at = ? WHERE id = ?`)
      .bind(now, now, args.id).run();
    return;
  }

  const blocked = args.blocked === true;
  const status = typeof args.status === "string" && args.status.trim() ? args.status.trim().slice(0, 800) : null;
  // Enforced here rather than by a CHECK constraint, because ADD COLUMN cannot carry one without
  // rebuilding a table full of her history. An unrecognised kind falls back to the honest default.
  const kind = args.statusKind === "could-not-run" ? "could-not-run" : "determined";

  await env.DB
    .prepare(
      `UPDATE owned_deliverables
          SET last_activity_at = ?,
              state = ?,
              blocker = COALESCE(?, blocker),
              -- THE STATUS IS WRITTEN WHENEVER ONE IS GIVEN, and its timestamp with it, so the two
              -- can never disagree about when the sentence was true. A run that supplies none
              -- leaves the last one standing, dated as it was, rather than blanking the screen.
              current_status = COALESCE(?, current_status),
              current_status_at = CASE WHEN ? IS NULL THEN current_status_at ELSE ? END,
              current_status_kind = CASE WHEN ? IS NULL THEN current_status_kind ELSE ? END,
              -- THE CLOCK IS NOT RESTARTED BY A CHECK-IN. A block that is still a block on day
              -- twelve is twelve days old, however many times someone looked at it. Resetting here
              -- would make the ladder measure attention rather than duration, which is precisely
              -- the number that must not be resettable.
              blocked_since = CASE WHEN ? = 1 THEN COALESCE(blocked_since, ?) ELSE NULL END,
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      now,
      blocked ? "blocked" : "open",
      args.blocker ?? null,
      status, status, now, status, kind,
      blocked ? 1 : 0, now,
      now,
      args.id,
    )
    .run();
}
