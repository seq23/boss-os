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
 * not acceptable and has been wrong before. `searched` carries the mailbox, the queries, the date
 * range and the message count, and both this script and the endpoint refuse a report without it.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { mayAutoFix, whyNoAutoFix, DISPOSITIONS } from "../../src/shared/boss/siteAudit/repoPolicy.mjs";

const ORIGIN = process.env.BOSS_OS_ORIGIN ?? "https://boss.sequoiataylor.com";
const DIR = process.env.BOSS_OS_SITE_AUDIT_DIR ?? `${process.env.HOME}/.boss-os/site-audit`;
const FILE = join(DIR, "findings.json");

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

  const searched = payload?.searched;
  if (!searched || typeof searched !== "object" || !searched.queries || !searched.mailbox) {
    stop(11, "NO_SEARCH_EVIDENCE",
      "`searched` must carry the mailbox, the queries, the date range and the message count.",
      "A bare 'nothing found' is not acceptable and has been wrong in this portfolio before.");
  }

  for (const [i, f] of findings.entries()) {
    for (const field of TEXT_FIELDS) {
      const v = f?.[field];
      if (typeof v === "string" && v.includes("@")) {
        stop(12, `ADDRESS_IN_${field.toUpperCase()}`,
          `Finding ${i + 1} carries an '@'. This table holds public domains and repository names.`,
          "THE WHOLE BATCH was refused — nothing was sent.");
      }
    }
    if (!DISPOSITION_SET.has(String(f?.disposition))) {
      stop(13, "BAD_DISPOSITION",
        `Finding ${i + 1} has disposition "${f?.disposition}". One of: ${DISPOSITIONS.join(", ")}.`);
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
      if (f?.mapped_by !== "repo_identity") {
        stop(17, "REPO_MATCHED_BY_RESEMBLANCE",
          `Finding ${i + 1} names ${f?.repo} without REPO_IDENTITY.md evidence for the domain.`,
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
    body: JSON.stringify({ run_id: payload.run_id ?? null, searched, findings }),
  });
  if (!res.ok) throw new Error(`site audit findings failed (${res.status}): ${(await res.text()).slice(0, 400)}`);

  const body = await res.json();
  const written = body?.data?.written ?? 0;
  const refused = body?.data?.refused ?? [];
  console.log(`Reported to Boss OS: ${written} finding(s) written from ${findings.length} sent.`);
  for (const r of refused) console.log(`  refused: ${r}`);

  const fixes = findings.filter((f) => f.disposition === "fixed_pr");
  if (fixes.length) {
    console.log(`${fixes.length} pull request(s) opened and NOT merged:`);
    for (const f of fixes) console.log(`  ${f.repo}: ${f.pr_url}`);
  }
  if (findings.length === 1 && findings[0].disposition === "none") {
    console.log("Nothing to fix this week, and that is a report. Danielle's clock advanced and the screen will say the audits were read.");
  }
}

main().catch((err) => {
  console.error(`ahrefs audit report failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
