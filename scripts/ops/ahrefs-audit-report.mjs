/**
 * THE AUDIT RUN'S CONCLUSIONS, POSTED — and the wire that makes Danielle's ownership visible.
 *
 * `ahrefs-audit-fix.sh` reads `seq.taylor@gmail.com` on this machine, maps the Ahrefs projects onto
 * repositories, fixes the causes at source and opens a pull request per repository. This script
 * sends the file that run wrote and nothing else. It opens no mailbox, runs no git command, and
 * never touches a repository.
 *
 * ─── Rule 0 ─────────────────────────────────────────────────────────────────
 *
 * This may not exit 0 having done nothing. A missing file, a stale file, a refused row — each is a
 * non-zero exit with a NAMED reason, because "the audit found nothing" and "the audit never ran"
 * look identical on a screen and telling those two apart is the entire point of reporting.
 *
 * ─── AN EMPTY WEEK IS A REPORT, AND IT IS NOT AN EMPTY ARRAY ────────────────
 *
 * Her bar, in her own words about a sibling job: "if she comes up empty handed its fine. better
 * than giving me trash." Accepted. But an empty array posted to the endpoint would advance the
 * duty's clock and record nothing — the "runs but inert" shape this system produces more than any
 * other. So a week with no findings sends ONE row, `disposition: 'none'`, carrying the queries that
 * were run and what they returned. The endpoint refuses an empty array on purpose.
 *
 * ─── AND THE SEARCH EVIDENCE IS NOT OPTIONAL ────────────────────────────────
 *
 * Owner's standing correction after five false alarms in this portfolio: a bare "nothing found" is
 * not acceptable and has been wrong before. A MAILBOX pass's `searched` carries the mailbox, the
 * queries, the date range and the message count. A QUEUE pass (SR_SCOPE_REPO set: the daily Search
 * Readiness run, which reads no mailbox) carries the queue file, when it was written, the repo and
 * the brief ids — built here from the runner's scope snapshot, never from the model's wording
 * (26 Oct 2026: seven queue passes were refused under the mailbox rule and 129 fixes never reached
 * Boss OS). Both this script and the endpoint refuse a report without its kind's evidence
 * (`searchEvidenceGap`, src/shared/boss/siteAudit/evidence.mjs).
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { mayAutoFix, whyNoAutoFix, DISPOSITIONS } from "../../src/shared/boss/siteAudit/repoPolicy.mjs";
import { carriesAddress, searchEvidenceGap, queueEvidence, scopeSnapshot } from "../../src/shared/boss/siteAudit/evidence.mjs";
import { repoForDomain, domainOfRow } from "../../src/shared/boss/siteAudit/domainRepos.mjs";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const DIR = process.env.BOSS_OS_SITE_AUDIT_DIR ?? `${process.env.HOME}/.boss-os/site-audit`;
const FILE = join(DIR, "findings.json");
/** Written by ahrefs-audit-fix.sh before a scoped pass starts: which queue briefs it was handed. */
const SCOPE_FILE = join(DIR, "scope.json");
const QUEUE_FILE = process.env.SR_QUEUE_FILE ?? `${process.env.HOME}/.boss-os/search-readiness/fix-queue.json`;
const SCOPE_REPO = process.env.SR_SCOPE_REPO || null;

/**
 * How old a findings file may be and still count as this run's.
 *
 * The runner deletes it before starting, so this is the second of two guards. It matters anyway: a
 * manual invocation, or a run that crashed after writing, would otherwise re-post last week's
 * findings and put a pass on the screen that never happened. Six hours is generous for a job that
 * clones nothing and works in checkouts that already exist.
 */
const MAX_AGE_MS = Number(process.env.BOSS_OS_SITE_AUDIT_MAX_AGE_MS ?? 6 * 60 * 60 * 1000);

const DISPOSITION_SET = new Set(DISPOSITIONS);

/** No new fix is needed for these outcomes; a blank model field must not lose the report. */
const DEFAULT_ACTIONS = new Map([
  ["fixed_pr", "A fix was opened; we'll confirm the result next week."],
  ["off_limits", "This repository is outside the automatic repair scope, so we logged it and will check again next week."],
  ["no_repo", "No repo is linked to this site, so we logged it and will check again next week."],
  ["none", "Nothing to change: the audit found no site defect to fix."],
  ["ahrefs_side", "The site is reachable; we'll check whether Ahrefs can crawl it next week."],
  ["client_repo", "This client repository is report-only, so we logged the finding without changing the site."],
  ["in_flight", "A fix is already open; we'll confirm it next week."],
  ["ahrefs_credits", "Ahrefs ran out of crawl credits; we'll check the next audit without buying more credits."],
]);

/** Everything a person reads. An address in any of them refuses the whole batch. */
const TEXT_FIELDS = ["project", "domain", "repo", "headline", "because", "suggested_action", "notes"];

function stop(code, tag, ...lines) {
  console.error(`NAMED STOP [${tag}]`);
  for (const l of lines) console.error(`  ${l}`);
  process.exit(code);
}

async function main() {
  let info;
  try { info = await stat(FILE); }
  catch {
    stop(6, "NO_FINDINGS_FILE",
      `${FILE} was not written.`,
      "The run produced no file, so Boss OS is told nothing rather than told a stale week.",
      "Danielle's duty stays overdue and Today will say so, which is the correct visible state.");
  }

  const ageMs = Date.now() - info.mtimeMs;
  if (ageMs > MAX_AGE_MS) {
    stop(7, "STALE_FINDINGS",
      `${FILE} is ${Math.round(ageMs / 60000)} minutes old, so this run did not write it.`,
      "Re-posting it would put an audit pass on the screen that never happened.");
  }

  let payload;
  try { payload = JSON.parse(await readFile(FILE, "utf8")); }
  catch (err) { stop(8, "UNREADABLE_FINDINGS", String(err?.message ?? err)); }

  const findings = Array.isArray(payload?.findings) ? payload.findings : null;
  if (findings === null) {
    stop(9, "NO_FINDINGS_ARRAY", "The file has no `findings` array. A malformed run is not an empty week.");
  }
  if (findings.length === 0) {
    stop(10, "EMPTY_ARRAY_IS_NOT_A_REPORT",
      "A week with nothing in it writes ONE row with disposition 'none' and its search evidence.",
      "An empty array would advance the duty's clock and record nothing, which is the exact",
      "shape of a job that runs and does nothing.");
  }

  /*
   * THE EVIDENCE FITS THE PASS. A queue pass reads no mailbox, so its evidence is the queue and the
   * briefs it was handed — from the runner's snapshot, or from the queue itself when no snapshot was
   * written (a re-delivery by hand). The model's own `searched` is not sent for a queue pass.
   */
  let searched = payload?.searched;
  if (SCOPE_REPO) {
    let scope = null;
    try { scope = JSON.parse(await readFile(SCOPE_FILE, "utf8")); } catch { /* no snapshot */ }
    if (!scope) {
      try { scope = scopeSnapshot({ queue: JSON.parse(await readFile(QUEUE_FILE, "utf8")), queueFile: QUEUE_FILE, repo: SCOPE_REPO, briefIds: (process.env.SR_SCOPE_BRIEFS ?? "").split(/[\s,]+/).filter(Boolean) }); }
      catch { scope = { queue_file: QUEUE_FILE, repo: SCOPE_REPO, item_ids: [] }; }
    }
    searched = queueEvidence({ scope, repo: SCOPE_REPO, findings });
  }
  const gap = searchEvidenceGap(searched);
  if (gap) {
    stop(11, "NO_SEARCH_EVIDENCE",
      `${gap}.`,
      "A bare 'nothing found' is not acceptable and has been wrong in this portfolio before.");
  }

  /*
   * ONE LIST SAYS WHICH REPO SERVES A DOMAIN (src/shared/boss/siteAudit/domainRepos.mjs, built from
   * sites.json). A row whose repo is the one that list names is mapped by it; the endpoint checks
   * the same list. A queue pass maps from the grid manifest by construction, and on 26 Oct 2026 the
   * endpoint refused a whole pass for writing "wrangler_toml" there.
   */
  for (const f of findings) {
    if (f?.repo && f.mapped_by !== "repo_identity" && repoForDomain(domainOfRow(f))?.repo === f.repo) f.mapped_by = "grid_manifest";
  }

  for (const [i, f] of findings.entries()) {
    for (const field of TEXT_FIELDS) {
      const v = f?.[field];
      if (carriesAddress(v)) {
        stop(12, `ADDRESS_IN_${field.toUpperCase()}`,
          `Finding ${i + 1} carries an email address. This table holds public domains and repository names.`,
          "THE WHOLE BATCH was refused — nothing was sent.");
      }
    }
    if (!DISPOSITION_SET.has(String(f?.disposition))) {
      stop(13, "BAD_DISPOSITION",
        `Finding ${i + 1} has disposition "${f?.disposition}". One of: ${DISPOSITIONS.join(", ")}.`);
    }
    if (f.suggested_action == null || (typeof f.suggested_action === "string" && !f.suggested_action.trim())) {
      f.suggested_action = DEFAULT_ACTIONS.get(f.disposition) ?? f.suggested_action;
    }
    for (const field of ["project", "headline", "because", "suggested_action"]) {
      if (typeof f?.[field] !== "string" || !f[field].trim()) {
        stop(14, "INCOMPLETE_FINDING",
          `Finding ${i + 1} has no ${field}. A finding needs a project, a headline, a reason and one next action.`);
      }
    }

    /*
     * ─── THE OFF-LIMITS RULE, CHECKED BEFORE ANYTHING IS SENT ───────────────
     *
     * The endpoint refuses this too, and the duplication is deliberate: the server's refusal is the
     * guarantee, this one is the legible error. A 400 in a launchd log at 06:00 on a Thursday is
     * not something anyone reads.
     */
    if (String(f?.disposition) === "fixed_pr") {
      if (!mayAutoFix(f?.repo)) {
        stop(15, "FIX_IN_A_FORBIDDEN_REPO",
          `Finding ${i + 1} claims a fix in ${f?.repo ?? "an unnamed repository"}.`,
          whyNoAutoFix(f?.repo) ?? "The repository could not be identified, and an unidentified repository is never fixable.",
          "Report it as 'off_limits' or 'surfaced'. THE WHOLE BATCH was refused.");
      }
      if (typeof f?.pr_url !== "string" || !f.pr_url.trim()) {
        stop(16, "FIX_WITH_NO_PR",
          `Finding ${i + 1} claims a fix in ${f?.repo} and names no pull request.`,
          "An unverifiable fix is not recorded.");
      }
      if (f?.mapped_by !== "repo_identity" && f?.mapped_by !== "grid_manifest") {
        stop(17, "REPO_MATCHED_BY_RESEMBLANCE",
          `Finding ${i + 1} names ${f?.repo} without REPO_IDENTITY.md or grid-manifest evidence for the domain.`,
          "dentistryguides and thedentistryguides are two different projects. A resemblance is not a mapping.");
      }
    }
  }

  if (!process.env.BOSS_PASSCODE) {
    stop(18, "NO_PASSCODE",
      "BOSS_PASSCODE is not in the environment.",
      "Run this through the vault: npm run vault:run -- node scripts/ops/ahrefs-audit-report.mjs");
  }

  const unlock = await fetch(`${ORIGIN}/api/boss/auth/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: process.env.BOSS_PASSCODE }),
  });
  if (!unlock.ok) throw new Error(`unlock failed (${unlock.status})`);
  const cookie = (unlock.headers.get("set-cookie") ?? "").split(";")[0];

  const res = await fetch(`${ORIGIN}/api/boss/engineering/site-audit-findings`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    // ran_at: when the pass wrote its findings, so a late re-delivery never supersedes a later pass.
    body: JSON.stringify({ run_id: payload.run_id ?? null, ran_at: Math.trunc(info.mtimeMs), searched, findings }),
  });
  if (!res.ok) throw new Error(`site audit findings failed (${res.status}): ${(await res.text()).slice(0, 400)}`);

  const body = await res.json();
  const written = body?.data?.written ?? 0;
  const refused = body?.data?.refused ?? [];
  console.log(`Reported to Boss OS: ${written} finding(s) written from ${findings.length} sent.`);
  for (const r of refused) console.log(`  refused: ${r}`);
  if (refused.length) console.log(`NAMED STOP [ROWS_REFUSED] ${refused.length} row(s) did not reach Boss OS; each reason is above.`);
  if (written !== findings.length || refused.length) {
    stop(19, "REPORT_NOT_DELIVERED", `Expected ${findings.length} finding(s) written; received ${written}, with ${refused.length} refused.`);
  }

  /*
   * SAY WHAT HAPPENED TO EACH PR, FROM THE ROW. This used to print "opened and NOT merged" for every
   * fix, which stopped being true on 16 Oct 2026 when the runner began landing green fixes through
   * ~/bin/land — its first real run printed it beside a PR that had just landed. One line per PR.
   */
  const fixes = findings.filter((f) => f.disposition === "fixed_pr");
  const byPr = new Map();
  for (const f of fixes) if (!byPr.has(f.pr_url)) byPr.set(f.pr_url, f);
  for (const f of byPr.values()) {
    console.log(`  PR ${f.repo}: ${f.pr_url} — ${f.land === "landed" ? "LANDED (merged, main watched, deployed)" : `NOT landed (${f.land ?? "never attempted"})`}`);
  }
  if (findings.length === 1 && findings[0].disposition === "none") {
    console.log("Nothing to fix this week, and that is a report. Danielle's clock advanced and the screen will say the audits were read.");
  }
}

main().catch((err) => {
  console.error(`ahrefs audit report failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
