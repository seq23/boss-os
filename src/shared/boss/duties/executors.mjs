/**
 * WORK GOES ONLY TO A SEAT THAT CAN DO IT — the one record of who can execute what.
 *
 * ─── The defect this exists to end (7 Oct 2026) ────────────────────────────
 *
 * 27 Sep: Simone's `npm run kdp:retitle` stopped at `no_fields` (its selectors were the PRINT book's
 * field ids, and The Gift Letter is a Kindle eBook). She asked the owner to make the edit by hand.
 * 4 Oct: she assigned the same edit — "Edit The Gift Letter KDP Details tab … save, and publish" —
 * to Zora (`asg_m43n6p5k3vkjrsmt`). Zora has no executor of any kind: no duty, no launchd job, no
 * browser profile, and NOTHING in this repository reads `work_assignments.helper_employee_id`. The
 * row sat until the 3-day stale alert, and on 7 Oct Simone emailed the owner: "Can you check the
 * status with Zora or complete the manual edit yourself?"
 *
 * Two defects, one class — work handed to an executor that cannot reach what it governs:
 *   1. ASSIGNMENT: `/kdp/assign` and the `assign` block on `/kdp/mail` checked only that the helper
 *      was a seat that EXISTS. Existing is not being able to act.
 *   2. ESCALATION: when the executor failed, the ask went to the owner as "do it yourself", and
 *      then as "chase your employee". Neither is a decision; both are tasks.
 *
 * ─── The rule, enforced at the endpoint ────────────────────────────────────
 *
 * Every piece of handed-over work has a REQUIRED CAPABILITY. Work inside one of the owner's own
 * logged-in accounts (KDP, Amazon, a bookshelf, Publish, a sign-in) is `owner_account_web`,
 * whatever label the caller puts on it — the task's own words decide, so a mislabel cannot route around it.
 * A seat may take work only if it HOLDS that capability here, with the command that executes it.
 * `owner_account_web` for KDP is held by ONE seat: Simone's own run, through the Chrome profile
 * `~/.boss-os/browser/simone/` and `npm run kdp:retitle` / `kdp:publish` — so it is never handed
 * over; it is done (outcome `acted`), and a tool failure is a repair, not an owner ask.
 *
 * `colleague_work` (an asset, a review, research) may still go to any seat: it escalates under the
 * owner's name on the 3-day ladder in `today/deliverables.ts`, which is how the owner asked delegation
 * to work. What may NEVER be handed over is a capability only one executor holds.
 */

/**
 * Words that put the TASK ITSELF inside one of her own accounts. Matched on `what` only — the `why`
 * may mention Amazon ("Amazon rejects the cover") for work that is plainly a colleague's asset job.
 */
export const OWNER_ACCOUNT_WEB_RE =
  /\b(kdp|kindle direct|seller central|bookshelf|title-setup|details tab|(?:re)?publish(?:ing)?|press publish|sign[ -]?in|log[ -]?in|password|two[- ]factor|2fa)\b/i;

export const CAPABILITIES = Object.freeze(["owner_account_web", "colleague_work"]);

/**
 * Seat → capability → the executor that actually performs it. A capability with no command is not
 * a capability, so every entry names one.
 */
export const SEAT_EXECUTORS = Object.freeze({
  emp_chief: Object.freeze({
    owner_account_web: "Simone's own run (kdp-surface.sh) in her Chrome profile: npm run kdp:retitle / npm run kdp:publish",
  }),
});

/** The capability a piece of work needs. The text wins over the label. */
export function requiredCapability({ what = "", why = "", requires = null } = {}) {
  if (OWNER_ACCOUNT_WEB_RE.test(String(what))) return "owner_account_web";
  if (requires && CAPABILITIES.includes(String(requires))) return String(requires);
  return "colleague_work";
}

/** Who can execute a capability, as [seat, command] pairs. */
export function executorsFor(capability) {
  return Object.entries(SEAT_EXECUTORS)
    .filter(([, caps]) => caps[capability])
    .map(([seat, caps]) => [seat, caps[capability]]);
}

/**
 * Pure: may `helper` be handed this work? `{ ok: true, capability }` or
 * `{ ok: false, capability, error, why }` — the endpoint turns the refusal into a 400.
 */
export function checkAssignment({ helper, what, why, requires } = {}) {
  const capability = requiredCapability({ what, why, requires });
  const held = SEAT_EXECUTORS[helper]?.[capability];
  if (held) return { ok: true, capability, executor: held };
  const who = executorsFor(capability);
  if (capability === "owner_account_web") {
    return {
      ok: false, capability,
      error: `${helper} has no way into her accounts — this is owner-account web work (KDP/Amazon) and only Simone's own run can do it`,
      why:
        `Do it yourself and record it as 'acted': ${who.map(([, cmd]) => cmd).join("; ")}. ` +
        "If the tool fails, that is a broken tool: file the RETITLE/PUBLISH line verbatim as acted with needs_owner false (a named stop on the board), " +
        "never as an assignment and never as an ask that she do it by hand. On 4 Oct this edit went to Zora, who has no browser and no executor, and it sat until it was overdue.",
    };
  }
  if (capability === "colleague_work") return { ok: true, capability, executor: "the colleague's own queue, escalating under the owner's name" };
  return { ok: false, capability, error: `${helper} does not hold ${capability}`, why: `Held by: ${who.map(([seat]) => seat).join(", ") || "no seat"}.` };
}

/**
 * Pure: is this owner_ask a task she is being handed instead of a decision? Returns the reason, or null.
 *
 * Her rule: decisions are hers, tasks are not. An ask that tells her to chase an employee, or to do
 * a manual step an executor exists for, is the defect of 7 Oct 2026 in words.
 */
export function ownerAskIsATask(text) {
  const s = String(text ?? "");
  if (/\b(check|follow up|chase|ask|status)\b[^.?!]{0,40}\bwith (zora|simone|kendra|imani|monique|danielle|toni|camille|the team|an? (employee|colleague))\b/i.test(s) ||
      /\b(nudge|chase|remind|ping)\s+(zora|kendra|imani|monique|danielle|toni|camille)\b/i.test(s)) {
    return "it asks her to chase an employee. Assignments escalate under the owner's name; she never manages the queue.";
  }
  if (/\b(yourself|by hand|manual(?:ly)? edit|complete the manual|do the (manual )?edit)\b/i.test(s) ||
      /\bgo to (kdp|the kdp|amazon|the bookshelf)\b/i.test(s) || /bookshelf\s*(→|->|>)/i.test(s)) {
    return "it hands her a manual step in her own account. Simone's run executes KDP edits (npm run kdp:retitle); a failure there is a repair, filed as acted with needs_owner false.";
  }
  return null;
}
