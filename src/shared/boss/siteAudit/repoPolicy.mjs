/**
 * WHICH REPOSITORIES AN AUDIT FINDING MAY BE FIXED IN WITHOUT ASKING.
 *
 * ─── The one rule, and why it is a rule rather than a note ──────────────────
 *
 * `local-guides-citation-velocity` is OFF LIMITS to the automatic fixer. It is under active heavy
 * change, and an agent opening a branch off a moving `main` to correct a canonical tag produces a
 * conflict for whoever is actually working in there — and, at worst, a PR that reverts something
 * landed an hour ago. The finding is still real and still gets surfaced; what stops is the fixing.
 *
 * WRITTEN AS DATA IN ONE PLACE, ENFORCED IN THREE. The named defect in this codebase is "two
 * components each keeping their own list with no link": a shell script that knows the rule and a
 * route that does not is a rule with a one-refactor life expectancy. So:
 *
 *   1. `scripts/ops/ahrefs-audit-fix.sh` reads this list before it touches a repository.
 *   2. `POST /site-audit-findings` REFUSES to record a fix against a forbidden repo, whatever the
 *      job claims. A guard that only lives in the thing being guarded is not a guard.
 *   3. `validate:audit-fixer` fails the build if either of those stops importing this file.
 *
 * A `.mjs` with a `.d.mts` for the same reason as `mail.mjs`: the Worker, the local job and the
 * validator all have to mean the same thing by "off limits".
 */

/**
 * Repositories the fixer may READ and REPORT ON but never change.
 *
 * Each entry says WHY, because a bare list decays into folklore and the next person to read it
 * cannot tell a deliberate exclusion from an old one that should have been removed.
 */
export const NO_AUTO_FIX = [
  {
    repo: "local-guides-citation-velocity",
    why:
      "Under active heavy change. A branch cut here goes stale between the cut and the review, and a "
      + "PR from an automated fixer would collide with work already in flight. Findings against it are "
      + "surfaced for a person and the fixer stops.",
  },
];

/** Just the names, for a fast membership test. */
export const NO_AUTO_FIX_REPOS = NO_AUTO_FIX.map((r) => r.repo);

/**
 * May this repository be changed by the automatic fixer?
 *
 * MATCHES ON THE REPOSITORY NAME, NOT ON A PATH, and tolerates a full path or a `owner/name` form,
 * because the caller has whichever of those it happens to hold. An empty or unknown value is
 * REFUSED rather than allowed: "I could not tell which repo this is" must never resolve to "go
 * ahead and commit", which is the direction an allow-by-default check fails in.
 */
export function mayAutoFix(repo) {
  const name = String(repo ?? "").trim().replace(/\/+$/, "").split("/").pop() ?? "";
  if (!name) return false;
  return !NO_AUTO_FIX_REPOS.includes(name);
}

/** Why a repository is off limits, in one sentence, or null when it is not. */
export function whyNoAutoFix(repo) {
  const name = String(repo ?? "").trim().replace(/\/+$/, "").split("/").pop() ?? "";
  return NO_AUTO_FIX.find((r) => r.repo === name)?.why ?? null;
}

/**
 * What the fixer is allowed to have done with a finding.
 *
 * `fixed_pr` is the only one that means a repository was changed, and it is the only one the route
 * refuses for a forbidden repo. The rest are all forms of "said something and changed nothing",
 * which is always permitted — including `none`, which is how a week with no findings is RECORDED
 * rather than passed over in silence. "Found nothing" and "never ran" are opposite facts and a
 * surface that cannot tell them apart is worse than no surface.
 */
export const DISPOSITIONS = ["fixed_pr", "surfaced", "off_limits", "no_repo", "none"];
