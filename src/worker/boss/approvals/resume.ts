import type { Env } from "../env";
import { recordDeliverableActivity } from "../today/deliverables";
import { DELIVERABLE_KEYS } from "../duties/author";

/**
 * WHAT HER "APPROVED" ACTUALLY SETS IN MOTION.
 *
 * ─── The defect this is the inverse of ─────────────────────────────────────
 *
 * The approval inbox was emptied on 8 September because approving applied nothing: the docket
 * vanished, the world was unchanged, and `approvals/execute.ts` said so in a comment — "APPROVING
 * APPLIES NOTHING, AND THAT IS THE DESIGN RATHER THAN AN OMISSION."
 *
 * Her instruction now is the opposite end of the same rule: "if i say apprpved she should continue
 * to finish". So a judgement call is only allowed to exist if there is a named thing that happens
 * when she says yes, and that thing has to be recorded as having actually happened. A decision with
 * no resume behind it is the original defect wearing a different hat.
 *
 * ─── Why a registry, and why the endpoint checks it ────────────────────────
 *
 * Identical construction to `TERMINAL_CHECKS` in `today/deliverables.ts`, for an identical reason.
 * `POST /judgement` refuses a `resume_kind` that is not a key here, so a judgement call cannot be
 * created in a shape that looks actionable and is inert. A typo in a resume kind would otherwise
 * produce an item she approves, that reports success, and that starts nothing at all — which is the
 * single defect this repository produces most often, at the one point where it would be least
 * visible.
 *
 * ─── And why a failing resume must not swallow the item ────────────────────
 *
 * If a handler throws, the judgement stays `awaiting` and stays on her screen. The alternative —
 * recording it approved and moving on — means the work quietly stops and the only record is an
 * execution status nobody reads. She said yes; if the yes did not take, she needs to still be
 * looking at it.
 */

export interface JudgementRow {
  id: string;
  approval_id: string;
  employee_id: string;
  deliverable_id: string | null;
  title: string;
  question: string;
  resume_kind: string;
  state: string;
  attempt: number;
}

export type Verdict = "approved" | "try_again";

export interface ResumeResult {
  /** One sentence, in her language, about what is now in motion. Shown back to her. */
  detail: string;
}

export type ResumeHandler = (
  env: Env,
  judgement: JudgementRow,
  verdict: Verdict,
  note: string | null,
  now: number,
) => Promise<ResumeResult>;

export const RESUME_HANDLERS: Record<string, ResumeHandler> = {
  /**
   * The letter to a buyer she reviewed — and the hard line about what "approved" means here.
   *
   *   "i reviewed them ....now what? it doesn't suggest an email already crafted to send to them?"
   *
   * ─── APPROVE DOES NOT SEND. IT CANNOT, AND IT MUST NOT ────────────────────
   *
   * Boss OS has no path to a third party's inbox. `gmail.send` was deliberately never granted, the
   * Worker cannot reach a mailbox, and this handler does not create the first exception — a system
   * that could email a counterparty on a button press is a different product with a different risk
   * profile, and she has not asked for it.
   *
   * So APPROVED means: the letter is finished, it is hers, and it is on the desk ready to send from
   * her own address. `sent_at` is stamped by HER pressing "I sent it", never by anything here, and
   * the candidate only reaches `contacted` at that same moment — so the buyer list and the letter
   * can never disagree about whether an approach actually happened.
   *
   * TRY AGAIN IS THE HALF THAT DOES WORK. Her sentence is stored on the attempt and a NEW letter is
   * composed with it attached, superseding this one. A second attempt that does not visibly answer
   * the reason for the first is a second attempt she has no way to evaluate.
   */
  buyer_outreach_email: async (env, j, verdict, note, now) => {
    const draft = await env.DB
      .prepare(`SELECT id, candidate_id, attempt FROM buyer_outreach_drafts WHERE judgement_id = ?`)
      .bind(j.id)
      .first<{ id: string; candidate_id: string; attempt: number }>();
    if (!draft) {
      /*
       * THROWS RATHER THAN SHRUGGING, which leaves the item awaiting on her screen. Recording an
       * approval over a letter nothing can find would be the original defect — a decision with no
       * work behind it — rebuilt inside the mechanism that exists to prevent it.
       */
      throw new Error(
        "The letter this approval was for is missing, so there is nothing to approve. It stays on your screen rather than recording a verdict over work that is not there.",
      );
    }

    const candidate = await env.DB
      .prepare(`SELECT name FROM sourcing_candidates WHERE id = ?`)
      .bind(draft.candidate_id)
      .first<{ name: string }>();
    const who = candidate?.name ?? "that firm";

    if (verdict === "approved") {
      await env.DB
        .prepare(
          `UPDATE buyer_outreach_drafts SET state = 'approved', approved_at = ?, her_note = COALESCE(?, her_note), updated_at = ?
            WHERE id = ?`,
        )
        .bind(now, note, now, draft.id)
        .run();
      return {
        detail:
          `Approved. The letter to ${who} is on the desk under Capital, ready to send from your own address — ` +
          "nothing here has sent it and nothing here can. Press \"I sent it\" when you have, and the candidate moves to contacted.",
      };
    }

    await env.DB
      .prepare(`UPDATE buyer_outreach_drafts SET state = 'try_again', her_note = ?, updated_at = ? WHERE id = ?`)
      .bind(note, now, draft.id)
      .run();

    if (!note) {
      return {
        detail:
          `Sent back with no reason, so the next letter to ${who} would be a guess. Say what was wrong and ` +
          "mark them reviewed again; nothing was sent to anybody.",
      };
    }

    /*
     * THE REDRAFT IS ATTEMPTED HERE, so "try again" is a thing that happens rather than an
     * instruction she has to remember to act on. If it cannot be composed, the reason is returned
     * and her note is still recorded — the verdict is never lost to a drafting failure.
     */
    const { draftOutreachFor } = await import("../routes/wealth");
    const again = await draftOutreachFor(env, draft.candidate_id, note, now);
    return {
      detail: again.drafted
        ? `Sent back with your reason attached. Attempt ${draft.attempt + 1} to ${who} is already in your Inbox. Nothing was sent to anybody.`
        : `Sent back and your reason is on the record. A new letter was not written: ${again.detail}`,
    };
  },

  /**
   * The seven blocked Kindle titles, and the covers that unblock them.
   *
   * Amazon support's diagnosis is that Cover Creator images fail server-side processing and that
   * uploading finished covers directly is the fix. Seven were generated at 1600x2560. She looks at
   * them, and:
   *
   *   APPROVED — the verdict is written where Simone's watcher reads it. `GET /api/boss/kdp`
   *   answers `covers.state = 'approved'`, `scripts/ops/kdp-resume.mjs` sees that on the next Mac
   *   tick and starts the watch immediately rather than waiting for Friday, and the prompt's
   *   publish path opens. ONE TITLE FIRST — that rule is older than this feature and it stays: if
   *   something is still wrong it is wrong on one book rather than on her whole shelf.
   *
   *   TRY AGAIN — her reason is written to the same place, the covers are not uploaded, and the
   *   work goes back to whoever generates them with the sentence she wrote attached.
   *
   * IN BOTH CASES THE DELIVERABLE'S CURRENT STATUS IS REWRITTEN, so Today stops saying the books
   * are waiting on a verdict the moment they are not. That is the whole of the alert-goes-stale
   * defect, applied to the new mechanism before it has a chance to reproduce it.
   */
  /*
   * ── THE RUN THIS PROMISES IS `kdp-publish.sh`, AND IT NOW EXISTS ──────────
   *
   * WHAT WENT WRONG HERE, WRITTEN DOWN SO IT CANNOT QUIETLY RECUR.
   *
   * She approved this batch on 9 September at 14:30. This handler fired, `executed_at` was stamped,
   * `execution_status` read `executed`, and the ENTIRE EFFECT was the status sentence below — a
   * description of work "Simone uploads on her next run". No run did it. The two KDP jobs are
   * `claude -p` processes that read Amazon and report, and a scheduled `claude -p` has no browser
   * tools at all, so nothing in the system could upload a cover or press Publish. Seven books sat
   * blocked for two more days while every screen said her decision had been executed.
   *
   * That is the defect in its most dangerous form: not an approval nobody consumed, but one
   * consumed by a handler that recorded an intention and stamped a receipt. The receipt is what
   * stopped anyone looking.
   *
   * So the promise now names the job that keeps it — `kdp-publish.sh`, owned by `duty_kdp_publish`,
   * installed by `install-agent-launchd.sh` at 09:45 daily — and
   * `validate:approval-promise` fails the build if any resume handler ever again promises future
   * work without naming a script that exists, is installed, and is owned by a standing duty.
   *
   * THIS HANDLER STILL DOES NOT PUBLISH ANYTHING, AND THAT IS RIGHT. A Worker cannot drive a
   * browser holding her Amazon session. What changed is that the thing it hands to is real.
   */
  kdp_cover_upload: async (env, j, verdict, note, now) => {
    /*
     * THE RUN THIS HANDS TO IS `kdp-publish.sh`, owned by `duty_kdp_publish`, installed by
     * install-agent-launchd.sh at 09:45 daily. Named here, inside the handler, because
     * `validate:approval-promise` reads each handler's own body — and because the thing that went
     * wrong was precisely that the promise below named nobody.
     */
    if (verdict === "approved") {
      await recordDeliverableActivity(env, {
        id: j.deliverable_id ?? "del_kdp_publication",
        blocked: true,
        status:
          `Covers approved by you on ${new Date(now).toISOString().slice(0, 10)}. ` +
          "Simone uploads them, publishes ONE title first, confirms it actually reaches Live on the bookshelf, " +
          "and only then does the remaining six. She reports back here when they are Live — not when Publish is clicked." +
          (note ? ` Your note: ${note}` : ""),
        statusKind: "determined",
        now,
      });
      return {
        detail:
          "Approved. Simone uploads the covers on her next run, publishes one title, checks it reaches Live, then does the rest. " +
          "Nothing is reported done until the bookshelf says Live.",
      };
    }

    await recordDeliverableActivity(env, {
      id: j.deliverable_id ?? "del_kdp_publication",
      blocked: true,
      status:
        `You sent the covers back on ${new Date(now).toISOString().slice(0, 10)} (attempt ${j.attempt}). ` +
        (note
          ? `Your reason: ${note} New covers are being made to that; nothing has been uploaded to Amazon.`
          : "No reason was given, so the next attempt is a guess. Nothing has been uploaded to Amazon."),
      statusKind: "determined",
      now,
    });
    return {
      detail: note
        ? "Sent back with your reason attached. Nothing was uploaded to Amazon."
        : "Sent back. No reason was recorded, so say what was wrong and the next set will be closer.",
    };
  },

  /**
   * The Wednesday packet, and what she actually raised with him.
   *
   * ─── Why approving a packet is a real decision rather than filing ──────────
   *
   * "it should be in my inbox and my screen should either mirror it or say to check inbox". A packet
   * she reads is not a decision; a packet she has TAKEN INTO A MEETING is. `mai_wp_gmail_grant` has
   * appeared identically on this packet every week since 19 August, and three weeks passed with
   * nobody noticing, precisely because nothing recorded whether it had ever been said out loud.
   *
   *   APPROVED — "I raised these." Every open item is stamped `raised_at`, so next Wednesday the
   *   same item reads "raised 9 Sep, still not granted" rather than arriving as if it were new. It
   *   is NOT closed: raising something is not the same as it being done, and the grant item is
   *   closed by the credential prober actually authenticating, never by her ticking a box.
   *
   *   TRY AGAIN — "I did not get to these", with her sentence. Nothing is stamped, and what she
   *   wrote is kept so next week's packet says why it slipped rather than pretending it did not.
   */
  meeting_packet_raised: async (env, j, verdict, note, now) => {
    const counterpart = "scooter";
    if (verdict === "approved") {
      const res = await env.DB
        .prepare(
          `UPDATE meeting_agenda_items
              SET status = 'raised', raised_at = ?, updated_at = ?
            WHERE counterpart = ? AND status = 'open'`,
        )
        .bind(now, now, counterpart)
        .run();
      const n = res.meta?.changes ?? 0;
      return {
        detail:
          n === 0
            ? "Recorded. There was nothing open to mark as raised, so nothing changed — which is itself worth knowing."
            : `Recorded: ${n} item${n === 1 ? "" : "s"} raised with him on ${new Date(now).toISOString().slice(0, 10)}. ` +
              "Anything still not done comes back next Wednesday saying how long he has had it, rather than arriving as if it were new.",
      };
    }

    /*
     * NOT STAMPED, AND HER REASON IS KEPT. An item marked raised when it was not is worse than one
     * marked nothing: next week it would read "raised 9 Sep, still not granted" about a conversation
     * that never happened, and the ageing figure — the only thing making this visible — becomes a
     * lie that gets larger every week.
     */
    if (note) {
      await env.DB
        .prepare(
          `INSERT INTO meeting_agenda_items (id, counterpart, title, detail, source, priority, status, created_at, updated_at)
           VALUES (?,?,?,?,'owner',2,'open',?,?)`,
        )
        .bind(
          `mai_note_${now}`, counterpart,
          "Last week's packet was not raised",
          `Your note on ${new Date(now).toISOString().slice(0, 10)}: ${note}`,
          now, now,
        )
        .run();
    }
    return {
      detail: note
        ? "Nothing was marked as raised, and your note is on next week's packet so it does not just slip quietly."
        : "Nothing was marked as raised. The items come back next Wednesday unchanged.",
    };
  },

  /**
   * A completion, put in front of her — and her answer if it is not actually done.
   *
   * ─── Her words, correcting a scope that was too narrow ────────────────────
   *
   *   "Simone reports completion. ----> why only Simone! EVERY FUCKING EMPLOYEE I GIVE A TASK
   *    SHOULD REPORT COMPLETION!!"
   *
   * So it is built once, at the mechanism, and every owned deliverable gets it. Not in Simone's
   * prompt: an instruction that lives in one employee's brief is one the next employee does not
   * have, which is fixing the instance instead of the class.
   *
   * ─── Detected, never claimed ───────────────────────────────────────────────
   *
   * The report fires off `TERMINAL_CHECKS` — real rows counted in the Worker — so an employee
   * announcing success cannot produce one. "Publish clicked" and "the title is Live" are different
   * facts and this case has already produced one confident answer that changed nothing.
   *
   * ─── Which makes TRY AGAIN the load-bearing half ──────────────────────────
   *
   * APPROVED is an acknowledgement and changes nothing — the world was already true. TRY AGAIN
   * REOPENS THE DELIVERABLE, because a completion she disputes is a completion the records got
   * wrong, and the alternative is a commitment closed against her judgement with no way back. It
   * returns to `blocked`, with her sentence as its current status, and starts escalating again.
   */
  completion_acknowledged: async (env, j, verdict, note, now) => {
    if (verdict === "approved") {
      return { detail: "Acknowledged. It stays finished, and the record of it stays in the register." };
    }

    const id = j.deliverable_id;
    if (!id) {
      throw new Error(
        "This completion names no deliverable, so there is nothing to reopen. It stays on your screen rather than recording a decision over work nothing can find.",
      );
    }
    await env.DB
      .prepare(
        `UPDATE owned_deliverables
            SET state = 'blocked', done_at = NULL,
                blocked_since = COALESCE(blocked_since, ?),
                current_status = ?, current_status_at = ?, current_status_kind = 'determined',
                last_activity_at = ?, updated_at = ?
          WHERE id = ?`,
      )
      .bind(
        now,
        `You said this is not actually done, on ${new Date(now).toISOString().slice(0, 10)}. ` +
          (note ? `Your reason: ${note}` : "No reason was given, so whoever picks it up is guessing."),
        now, now, now, id,
      )
      .run();
    return {
      detail: "Reopened. It is blocked again, with your reason on it, and it escalates from here like any other owned work.",
    };
  },

  /**
   * A duty she drafted, created exactly as she saw it.
   *
   *   "i can add duties? and maybe the system can help me prompt that."
   *
   * ─── IT CREATES WHAT SHE APPROVED, NOT WHAT IT WOULD DRAFT NOW ────────────
   *
   * The draft is stored on the judgement row when it is raised, and this reads it back rather than
   * re-deriving. Re-deriving would be shorter and would let an approval produce something different
   * from what was on the screen when she pressed it — which is the one thing an approval must never
   * do, and it would be undetectable.
   *
   * ─── AND THE INVARIANTS ARE CHECKED AGAIN AT THE MOMENT OF CREATION ───────
   *
   * They were checked when the draft was raised. Between then and now, a handler could have been
   * removed or the schedule could have grown. Checking once is how a validator becomes a formality.
   */
  duty_created: async (env, j, verdict, note, now) => {
    if (verdict === "try_again") {
      return {
        detail: note
          ? "Sent back. Nothing was added to the schedule, and your note is on the draft for the next attempt."
          : "Sent back. Nothing was added to the schedule.",
      };
    }

    const row = await env.DB
      .prepare(`SELECT resume_detail FROM judgement_calls WHERE id = ?`)
      .bind(j.id)
      .first<{ resume_detail: string | null }>();

    let draft: any = null;
    try { draft = row?.resume_detail ? JSON.parse(row.resume_detail) : null; } catch { draft = null; }
    if (!draft?.employee_id) {
      throw new Error(
        "The draft this approval was for is missing, so there is nothing to create. It stays on your screen rather than recording a decision over a duty that was never written.",
      );
    }
    if (Array.isArray(draft.refusals) && draft.refusals.length > 0) {
      throw new Error(`This draft cannot be created: ${draft.refusals.join(" ")}`);
    }
    if (draft.executor === "agent" && !(DELIVERABLE_KEYS as readonly string[]).includes(draft.delivers)) {
      /*
       * RE-CHECKED AT CREATION. A `delivers` key with no handler is the defect that had
       * `duty_practice_week` running every Sunday for eleven weeks into the floor while every signal
       * said it worked. Checking only at draft time would let a handler removed in between produce
       * exactly that.
       */
      throw new Error(
        `"${draft.delivers}" is not a delivery route this system has, so the duty would run and its output would land nowhere. Nothing was created.`,
      );
    }

    const id = `duty_${String(draft.name ?? "new").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40)}_${now.toString(36).slice(-4)}`;
    await env.DB
      .prepare(
        `INSERT INTO standing_duties
           (id, name, employee_id, lane, local_hour, local_minute, timezone, cadence, weekday,
            next_due_at, executor, task_kind, task_title, task_input, success_criteria)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id, draft.name, draft.employee_id, "ops",
        draft.local_hour, draft.local_minute, draft.timezone,
        draft.cadence, draft.weekday,
        // Tomorrow rather than 0: seeding 0 reads as permanently overdue from the moment it exists,
        // which is a false alarm on day one.
        now + 86_400_000,
        draft.executor, "ops", draft.name,
        JSON.stringify({
          // NAMED, ALWAYS. A duty with no model runs the dearest one available.
          requested: { model: draft.model, max_seconds: 600 },
          ...(draft.delivers ? { delivers: draft.delivers } : {}),
          ...(draft.local_job ? { local_job: draft.local_job } : {}),
          prompt: draft.task_prompt,
          authored_from: "her own words, drafted and approved in the Inbox",
        }),
        draft.success_criteria,
      )
      .run();

    return {
      detail:
        `Created. ${draft.employee_name} runs it ${draft.cadence} at ` +
        `${String(draft.local_hour).padStart(2, "0")}:${String(draft.local_minute).padStart(2, "0")}, first time tomorrow. ` +
        `About $${draft.estimated_per_month_usd} a month, taking the schedule to $${draft.monthly_total_after_usd} of $${draft.ceiling_usd}.`,
    };
  },
};

/**
 * Run the resume for a verdict.
 *
 * THROWS RATHER THAN RETURNING A SHRUG when the kind is unknown. The caller turns that into a
 * failed execution and leaves the item awaiting, which is the only safe direction: an approval that
 * silently started nothing is indistinguishable, from her side, from one that worked.
 */
export async function runResume(
  env: Env,
  judgement: JudgementRow,
  verdict: Verdict,
  note: string | null,
  now = Date.now(),
): Promise<ResumeResult> {
  const handler = RESUME_HANDLERS[judgement.resume_kind];
  if (!handler) {
    throw new Error(
      `"${judgement.resume_kind}" is not a resume kind this system has, so approving it would start nothing. ` +
      "The item stays on your screen rather than recording a decision over work that never restarted.",
    );
  }
  return handler(env, judgement, verdict, note, now);
}
