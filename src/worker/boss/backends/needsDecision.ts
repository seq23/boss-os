/**
 * WHAT THE INBOX IS FOR, AND WHY THE EXECUTIVE REPORT WAS NEVER IT.
 *
 * ─── The owner's words, 8 September 2026 ──────────────────────────────────────
 *
 *   "when i click on inbox i have all these executive intelligence reports to 'approve' then they
 *    disappear after hitting the button. then in the 'today' screen i dont see any hting WTF? they
 *    are to be delivered to the today screen automatically. i shouldnt have to fucking approve it."
 *
 * Every part of that is accurate, and the code agreed with her in writing. `approvals/execute.ts`
 * carried the comment "APPROVING APPLIES NOTHING, AND THAT IS THE DESIGN RATHER THAN AN OMISSION."
 * It was right that nothing is applied and wrong that this should therefore be an approval. A
 * control whose two outcomes differ only in whether the card is still on screen is not a decision;
 * it is a chore, dressed as governance, on the one screen that exists to remove chores.
 *
 * ─── The rule ────────────────────────────────────────────────────────────────
 *
 * AN APPROVAL EXISTS WHEN HER ANSWER CHANGES WHAT HAPPENS NEXT. That is the whole test, and it is
 * the reason this file is one function rather than a policy table: if approving and rejecting lead
 * to the same world, there was no question.
 *
 * So a succeeded run raises an approval only when one of these is true:
 *
 *   · **It touched files.** A run that wrote to her disk is proposing a change to her machine, and
 *     accepting or discarding it is a real fork in the road. This is the Stage 2 repository lane
 *     the plan was actually written for.
 *   · **It was contracted to deliver nothing.** A task with no `delivers` key is ad-hoc work she
 *     dispatched by hand; its output has nowhere to land on its own, so the docket IS the delivery.
 *   · **A guard fired.** Violations already force the run to `failed` upstream, but the check is
 *     repeated here rather than assumed, because a rule enforced in one place is a rule that
 *     survives exactly one refactor.
 *   · **The run says it needs her.** §79.8's evidence packet has always carried
 *     `approval_needed`; nothing read it. A runner that has found something it will not decide on
 *     its own is the one voice that should always reach this list.
 *
 * Everything else — the daily report, the buyer list, the backlink prospects, the tool scan, the
 * week's practice — is DELIVERED WORK. It already has a table, a handler and a screen; the run
 * wrote it there before this function was ever called. Asking her to approve it afterwards adds a
 * click and removes nothing.
 *
 * ─── What this does NOT weaken ───────────────────────────────────────────────
 *
 * **Nothing commits, merges, pushes or deploys.** That is enforced by the forbidden-actions list in
 * `execution_backends` and by `guard.ts`, at the boundary, before a run starts — not by whether a
 * card appeared on a screen afterwards. An approval that arrives after the work is finished never
 * protected anything; it recorded her having seen it. Acceptance is still recorded, by
 * `backend_run_auto_accepted` in the audit log, naming the run, the backend and the reason.
 *
 * **A failure or a refusal still closes with its reason** and still shows up as a Critical Alert on
 * Today. Silence is not what replaces the docket.
 */

export interface DecisionVerdict {
  needed: boolean;
  /** Said on the docket, or in the audit record when it is accepted without one. */
  reason: string;
  /** The delivery contract this task carried, if any. Null for ad-hoc dispatched work. */
  delivers: string | null;
}

/** Delivery keys `routes/backends.ts` has a handler for. A key with no handler is not a delivery. */
export const DELIVERY_KINDS = [
  "executive_reports",
  "sourcing_candidates",
  "link_prospects",
  "tool_suggestions",
  "practice_week",
  "mailbox_findings",
] as const;

export function runNeedsHerDecision(
  taskInput: string | null,
  evidence: Record<string, unknown> | null | undefined,
  violations: unknown[],
): DecisionVerdict {
  let input: Record<string, unknown> = {};
  try { input = taskInput ? (JSON.parse(taskInput) as Record<string, unknown>) : {}; } catch { input = {}; }

  const declared = typeof input.delivers === "string" ? input.delivers : null;
  const delivers = declared !== null && (DELIVERY_KINDS as readonly string[]).includes(declared) ? declared : null;

  if (violations.length > 0) {
    return { needed: true, reason: "A forbidden action was detected in this run", delivers };
  }

  if (evidence?.approval_needed === true) {
    return { needed: true, reason: "The run asked for your decision before this is used", delivers };
  }

  /*
   * A DELIVERY DUTY WRITES ITS OWN WORKSPACE, AND THAT IS NOT A PROPOSAL.
   *
   * FOUND BY USING IT. The first version of this rule raised an approval on any `files_touched`,
   * and the very next morning's Executive Intelligence Report still appeared in the Inbox — because
   * the way a run delivers is by writing `~/.boss-os/reports/delivers.json`. The mechanism by which
   * the report reaches her was being counted as a proposal to change her machine, so the fix for
   * "I should not have to approve my own briefing" would have shipped and changed nothing. Reading
   * the code would not have caught it; opening the Inbox did.
   *
   * So the question is not "did it touch a file" but "did it touch a file OUTSIDE the workspace it
   * was given". `~/.boss-os/` is the agent's own scratch directory — the sky snapshot, the sourcing
   * output, the packets, the findings. Writing there is how delivery happens. Writing anywhere else
   * — a repository, a document, anything of hers — is a change she should see before it stands.
   */
  const files = Array.isArray(evidence?.files_touched) ? (evidence!.files_touched as unknown[]) : [];
  const outside = files.filter((f) => !String(f).includes("/.boss-os/"));
  if (outside.length > 0) {
    return {
      needed: true,
      reason:
        `This run changed ${outside.length} file${outside.length === 1 ? "" : "s"} outside its own workspace ` +
        `(${String(outside[0])})`,
      delivers,
    };
  }

  /*
   * A DECLARED KEY WITH NO HANDLER IS NOT A DELIVERY, and this is the branch that catches the exact
   * failure `0200` was written for: `duty_practice_week` declared `delivers: 'practice_week'` for
   * eleven weeks with nothing handling it, and every run reported success. If a duty names a
   * delivery this file does not know about, its output landed nowhere — so it comes to her, loudly,
   * instead of being quietly accepted.
   */
  if (declared !== null && delivers === null) {
    return {
      needed: true,
      reason: `This run was contracted to deliver "${declared}", and nothing in Boss OS handles that — so its output landed nowhere`,
      delivers: null,
    };
  }

  if (delivers === null) {
    return {
      needed: true,
      reason: "You dispatched this by hand and it delivers into no table, so this docket is the result",
      delivers: null,
    };
  }

  return {
    needed: false,
    reason: `Delivered to ${delivers}; nothing was changed on your machine and accepting would apply nothing`,
    delivers,
  };
}
