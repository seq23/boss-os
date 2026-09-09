import type { Env } from "../env";
import { recordDeliverableActivity } from "../today/deliverables";

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
  kdp_cover_upload: async (env, j, verdict, note, now) => {
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
