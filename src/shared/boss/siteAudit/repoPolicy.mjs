/**
 * WHICH REPOSITORIES AN AUDIT FINDING MAY BE FIXED IN WITHOUT ASKING.
 *
 * ─── The rule now: CLIENT REPOSITORIES, and nothing else ──────────────────────
 *
 * Client repos stay out of Boss OS (her standing rule: kept for learning, never a work project, not
 * to be raised). A finding against one is recorded as a `client_repo` row — never a branch, never a
 * PR, and never an alert, because raising it would be raising a client repo.
 *
 * ─── What this list used to hold, and why it no longer does (16 Oct 2026) ────
 *
 * It held `local-guides-citation-velocity`, "under active heavy change", so a branch cut there would
 * collide with work in flight. That reason was real and the remedy was wrong: it turned every LGCV
 * finding into a surfaced row nobody fixed (16 Oct: off_limits=1 in a run that fixed nothing), and
 * the owner's instruction that day was "fix danielle's job so she can actually fix things". The
 * collision it feared is now prevented where it actually happens: the fixer works in a fresh worktree
 * cut from origin (`scripts/ops/audit-worktree.sh`), never the owner's checkout, and it skips any
 * finding an open PR or branch already touches as IN_FLIGHT (`site-audit-lib.mjs inflight`). LGCV is
 * a repo where the work moves fast, not one the work may not reach.
 *
 * WRITTEN AS DATA IN ONE PLACE, ENFORCED IN FOUR:
 *
 *   1. `scripts/ops/ahrefs-audit-fix.sh` reads this list and prints it into the run log.
 *   2. `scripts/ops/audit-worktree.sh` refuses to cut a branch in a listed repo (NAMED STOP [CLIENT_REPO]).
 *   3. `POST /site-audit-findings` REFUSES to record a fix against a listed repo, whatever the job claims.
 *   4. `validate:audit-fixer` fails the build if any of those stops importing this file.
 *
 * A `.mjs` with a `.d.mts` for the same reason as `mail.mjs`: the Worker, the local job and the
 * validator all have to mean the same thing by "off limits".
 */

const CLIENT_WHY =
  "A client's repository. Client repos stay out of Boss OS: kept for learning, never a work project, "
  + "never raised. A finding against it is recorded as a client_repo row and nothing is branched or opened.";

/**
 * Repositories the fixer may READ and REPORT ON but never change. Each entry says WHY and of what
 * KIND, because a bare list decays into folklore and the next reader cannot tell a deliberate
 * exclusion from an old one that should have been removed — which is exactly what happened to LGCV.
 */
/*
 * hicks-consulting-canonical LEFT THIS LIST on 25 Oct 2026 (owner ruling, through the Search
 * Readiness work): horselegalguide.com and hicksconsulting.org get the same auto-fix lane as every
 * other grid repo site. They are still client properties (grid.mjs owner "client"), so anything
 * needing her there is client-facing — but their site defects are fixed, not reported and left.
 * The repositories below are clients who are not grid repo sites; they stay report-only.
 */
export const NO_AUTO_FIX = [
  { repo: "dianne-place-recovery-services", kind: "client", why: CLIENT_WHY },
  { repo: "sheila-creator-dashboard", kind: "client", why: CLIENT_WHY },
  { repo: "sheila-bruce", kind: "client", why: CLIENT_WHY },
  { repo: "mercedes-creator-dashboard", kind: "client", why: CLIENT_WHY },
  { repo: "justbeingmercedes", kind: "client", why: CLIENT_WHY },
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

/** Is this one of the client repositories? Their findings are `client_repo` rows, never PRs. */
export function isClientRepo(repo) {
  const name = String(repo ?? "").trim().replace(/\/+$/, "").split("/").pop() ?? "";
  return NO_AUTO_FIX.some((r) => r.repo === name && r.kind === "client");
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
 * refuses for a forbidden repo. Since 16 Oct 2026 a `fixed_pr` is LANDED by the runner through
 * `~/bin/land` and carries `land` on the row; one that did not land turns the run red.
 *
 *   surfaced     a defect HER OWN CRAWL confirmed in a fixable repo and did not fix — RED if fixed=0
 *   off_limits   a repo on the list for a reason other than being a client's (none today)
 *   no_repo      no repository in ~/GitHub claims the domain
 *   none         the run found nothing; recorded, so an empty week is a fact rather than a silence
 *   ahrefs_side  AHREFS_SIDE_CRAWL_FAILURE: Ahrefs could not crawl, an outside probe found the site
 *                reachable and robots.txt allowing Ahrefs — evidence, not a site defect
 *   client_repo  CLIENT_REPO: the site is a client's; recorded, never branched, never raised
 *   in_flight    IN_FLIGHT: an open PR or branch already touches this; a duplicate would collide
 *   ahrefs_credits AHREFS_CRAWL_CREDITS: the crawl could not start, or stopped, because the Ahrefs
 *                workspace ran out of monthly crawl credits (16 Oct 2026: every "crawl error" and
 *                "crawl failed" that month was this, read in the dashboard) — no site fix exists
 */
export const DISPOSITIONS = [
  "fixed_pr", "surfaced", "off_limits", "no_repo", "none", "ahrefs_side", "client_repo", "in_flight", "ahrefs_credits",
];

/** Dispositions that are recorded and NEVER alert: done, evidence, or not ours to raise. */
export const QUIET_DISPOSITIONS = ["fixed_pr", "none", "ahrefs_side", "client_repo", "in_flight", "ahrefs_credits"];
