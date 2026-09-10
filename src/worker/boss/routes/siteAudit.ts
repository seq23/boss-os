/**
 * WHERE DANIELLE'S WEEKLY AUDIT RUN REPORTS BACK.
 *
 * `duty_site_audit_repair` runs from launchd on her Mac — it reads `seq.taylor@gmail.com`, maps the
 * Ahrefs projects onto repositories by the domains their own REPO_IDENTITY.md declares, fixes the
 * causes at source, and opens a pull request per repository. None of that can happen in a Worker.
 * This is the endpoint it posts its conclusions to, and it is the link that makes the duty a duty
 * rather than a cron job nobody hears from.
 *
 * ─── THREE THINGS THIS REFUSES, AND WHY EACH IS SERVER-SIDE ────────────────
 *
 * A rule enforced only inside the thing being governed is not a rule. The local job checks all
 * three before it acts; this checks them again on arrival, because the job is a shell script on a
 * laptop and this is the system of record.
 *
 *   1. NO ADDRESS EVER LANDS HERE. Same guard as the mailbox sweep, which caught a real leak on the
 *      contacts sync's first run. The whole batch is refused rather than the offending field
 *      dropped: a partial write would leave her looking at a list that silently lost rows.
 *   2. A FORBIDDEN REPOSITORY CANNOT BE RECORDED AS FIXED. `local-guides-citation-velocity` is off
 *      limits — see `shared/boss/siteAudit/repoPolicy.mjs` — and a row claiming `fixed_pr` against
 *      it is refused outright. If the script were ever changed to fix it anyway, the report of that
 *      fix does not land, and the discrepancy is loud instead of silent.
 *   3. A `fixed_pr` MUST NAME ITS PULL REQUEST. "I fixed it" with no link is an assertion nobody can
 *      check, and this system's rule is that an unverifiable claim is worse than no claim.
 *
 * ─── AND AN EMPTY RUN IS A REPORT ──────────────────────────────────────────
 *
 * `{ findings: [] }` is REFUSED, deliberately, and that is not the same as refusing an empty week.
 * A week with nothing in it posts one row with `disposition: 'none'` carrying the queries it ran and
 * the message count it saw. Posting a literally empty array would advance the duty's clock while
 * recording nothing, which is precisely the "runs but inert" shape this repository keeps producing.
 */

import { Hono } from "hono";
import type { Env, Vars } from "../env";
import { newId } from "../lib/id";
import { audit } from "../lib/audit";
import { logEvent } from "../lib/log";
import { ok, badRequest } from "../lib/http";
import { nextDueAt } from "../duties/cadence";
import { mayAutoFix, whyNoAutoFix, DISPOSITIONS } from "../../../shared/boss/siteAudit/repoPolicy.mjs";

export const siteAudit = new Hono<{ Bindings: Env; Variables: Vars }>();

const DUTY_ID = "duty_site_audit_repair";

/** Free text a person reads. Every one of these is checked for an address before anything is written. */
const TEXT_FIELDS = ["project", "domain", "repo", "headline", "because", "suggested_action", "notes"];

const DISPOSITION_SET = new Set(DISPOSITIONS);
const STATUS_SET = new Set(["new", "acted", "dismissed"]);

/** What she is looking at now: live findings, newest first. */
siteAudit.get("/site-audit-findings", async (c) => {
  const { results } = await c.env.DB
    .prepare(
      `SELECT * FROM site_audit_findings
        WHERE archived_at IS NULL AND status != 'dismissed'
        ORDER BY (disposition = 'none') ASC, found_at DESC
        LIMIT 100`,
    )
    .all<Record<string, unknown>>();
  const last = await c.env.DB
    .prepare(`SELECT run_id, MAX(found_at) AS at FROM site_audit_findings`)
    .first<{ run_id: string | null; at: number | null }>();
  return ok(c, {
    findings: results ?? [],
    last_run: last?.at ?? null,
    last_run_id: last?.run_id ?? null,
  });
});

siteAudit.post("/site-audit-findings", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const rows = Array.isArray(b?.findings) ? b.findings : null;
  if (rows === null) {
    throw badRequest(
      "An audit run reports a findings array",
      "Send { findings: [...], run_id, searched }. A week with nothing in it sends ONE row with disposition 'none' and its search evidence — not an empty array.",
    );
  }
  if (rows.length === 0) {
    throw badRequest(
      "An empty array is not a report",
      "A run that found nothing must say so: one row, disposition 'none', carrying the mailbox, the queries, the date range and the message count. Nothing was written and the duty's clock did not move.",
    );
  }

  for (const [i, f] of rows.entries()) {
    for (const field of TEXT_FIELDS) {
      const v = f?.[field];
      if (typeof v === "string" && v.includes("@")) {
        throw badRequest(
          `Finding ${i + 1} carries an address in ${field}, so the whole batch was refused`,
          "Boss OS stores public domains and repository names here, never an address. Nothing was written.",
        );
      }
    }
  }

  const now = Date.now();
  const runId = typeof b?.run_id === "string" && b.run_id.trim() ? b.run_id.trim().slice(0, 64) : null;
  if (!runId) {
    throw badRequest("Every run identifies itself", "Send a run_id, so each finding traces back to the run that produced it.");
  }

  /*
   * THE SEARCH EVIDENCE IS MANDATORY, AT THE DOOR.
   *
   * Owner's standing correction after five false alarms: a bare "nothing found" is not acceptable
   * and has been wrong in this project before. The column is NOT NULL and this is where that is
   * actually enforced — a default of '{}' in the schema would let a silent job satisfy it.
   */
  const searched = b?.searched;
  const searchedJson = searched && typeof searched === "object" ? JSON.stringify(searched).slice(0, 4000) : null;
  if (!searchedJson || searchedJson === "{}") {
    throw badRequest(
      "A report without its search evidence was refused",
      "Send { searched: { mailbox, queries, since, until, messages } }. 'I looked and found nothing' is not a finding unless it says where it looked.",
    );
  }

  const text = (v: unknown, max = 600): string | null => {
    if (typeof v !== "string") return null;
    const s = v.trim();
    return s ? s.slice(0, max) : null;
  };
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null);

  let written = 0;
  const refused: string[] = [];

  for (const [i, f] of rows.entries()) {
    const disposition = String(f?.disposition ?? "");
    const project = text(f?.project, 120);
    const headline = text(f?.headline, 300);
    const because = text(f?.because, 1200);
    const action = text(f?.suggested_action, 600);
    const repo = text(f?.repo, 120);

    /*
     * ALL FOUR OR IT IS DROPPED — the same rule the mailbox findings use. The failure mode of an
     * automated reader is a plausible sentence nobody can check, and here checking one costs a look
     * through somebody else's repository.
     */
    if (!DISPOSITION_SET.has(disposition) || !project || !headline || !because || !action) {
      refused.push(`finding ${i + 1}: incomplete — a disposition, a project, a headline, a reason and a next action are all required.`);
      continue;
    }

    const prUrl = text(f?.pr_url, 300);

    if (disposition === "fixed_pr") {
      /*
       * THE OFF-LIMITS RULE, ENFORCED WHERE THE SCRIPT CANNOT REACH IT.
       *
       * `local-guides-citation-velocity` is under active heavy change. A PR from an automated fixer
       * collides with work in flight. The job knows this; this refuses to believe it if it forgets.
       */
      if (!mayAutoFix(repo)) {
        refused.push(
          `finding ${i + 1}: claims a fix in ${repo ?? "an unnamed repository"}, which the fixer may not change. `
          + `${whyNoAutoFix(repo) ?? "The repository could not be identified, and an unidentified repository is never fixable."} `
          + "Report it as 'off_limits' or 'surfaced'.",
        );
        continue;
      }
      // "I fixed it" with no link is an assertion nobody can check.
      if (!prUrl) {
        refused.push(`finding ${i + 1}: claims a fix in ${repo} and names no pull request. An unverifiable fix is not recorded.`);
        continue;
      }
    }

    const mappedBy = repo ? (text(f?.mapped_by, 32) === "repo_identity" ? "repo_identity" : "unmapped") : null;
    if (repo && mappedBy !== "repo_identity") {
      /*
       * A REPOSITORY MATCHED BY ANYTHING BUT ITS OWN DECLARED DOMAIN IS A GUESS. That is how a PR
       * ends up in the wrong repo, and the names in this portfolio are similar enough for it to
       * happen — `dentistryguides` and `thedentistryguides` are two different Ahrefs projects.
       */
      refused.push(`finding ${i + 1}: names repository ${repo} without REPO_IDENTITY.md evidence for the domain. A resemblance is not a mapping.`);
      continue;
    }

    await c.env.DB
      .prepare(
        `INSERT INTO site_audit_findings
           (id, project, domain, repo, mapped_by, disposition, headline, because, suggested_action,
            pr_url, health_score, errors, message_id, reported_at, searched, status, run_id, found_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?,?,?)
         ON CONFLICT(project, headline) DO UPDATE SET
           domain = excluded.domain,
           repo = excluded.repo,
           mapped_by = excluded.mapped_by,
           disposition = excluded.disposition,
           because = excluded.because,
           suggested_action = excluded.suggested_action,
           pr_url = excluded.pr_url,
           health_score = excluded.health_score,
           errors = excluded.errors,
           message_id = excluded.message_id,
           reported_at = excluded.reported_at,
           searched = excluded.searched,
           run_id = excluded.run_id,
           updated_at = excluded.updated_at,
           -- Re-raised because it is still broken. A row she dismissed stays dismissed; one she has
           -- not looked at comes back to the top rather than quietly ageing out.
           archived_at = NULL`,
      )
      .bind(
        newId("saf"), project, text(f?.domain, 200), repo, mappedBy, disposition, headline, because, action,
        prUrl, num(f?.health_score), num(f?.errors), text(f?.message_id, 64), num(f?.reported_at),
        searchedJson, runId, now, now,
      )
      .run();
    written++;
  }

  /*
   * RULE 0, AT THE DOOR. A batch where every row was refused must not advance the duty's clock —
   * that would report a healthy weekly rhythm over a job producing nothing usable, which is this
   * repository's most-shipped defect wearing a green badge.
   */
  if (written === 0) {
    throw badRequest(
      `All ${rows.length} finding(s) were refused, so nothing was recorded and the duty is still overdue`,
      refused.join(" "),
    );
  }

  /*
   * THE DUTY'S CLOCK ADVANCES HERE AND ONLY HERE — the rule the mailbox sweep established. A
   * `local_job` duty is honest only when `last_run_at` means "the job reported back", never "launchd
   * fired something". A run that reported nothing usable leaves the clock alone and reads as overdue
   * on Today, which is the correct visible state.
   */
  const duty = await c.env.DB
    .prepare(`SELECT local_hour, local_minute, timezone, cadence, weekday, weekdays FROM standing_duties WHERE id = ?`)
    .bind(DUTY_ID)
    .first<{
      local_hour: number; local_minute: number; timezone: string;
      cadence: "daily" | "weekly" | "monthly"; weekday: number | null; weekdays: string | null;
    }>();
  if (duty) {
    let weekdays: number[] | null = null;
    try { weekdays = duty.weekdays ? (JSON.parse(duty.weekdays) as number[]) : null; } catch { weekdays = null; }
    let advanced: number | null = null;
    try { advanced = nextDueAt({ ...duty, weekdays }, now); }
    catch { advanced = null; }
    await c.env.DB
      .prepare(
        advanced === null
          ? `UPDATE standing_duties SET last_run_at = ? WHERE id = ?`
          : `UPDATE standing_duties SET last_run_at = ?, next_due_at = ? WHERE id = ?`,
      )
      .bind(...(advanced === null ? [now, DUTY_ID] : [now, advanced, DUTY_ID]))
      .run();
  }

  await audit(c.env.DB, {
    actor: "system", lane: "ops", entityType: "site_audit_findings", entityId: runId,
    action: "reported", detail: { written, refused: refused.length },
  }).catch(() => {});
  await logEvent(c.env.DB, {
    level: refused.length ? "warn" : "info", scope: "engineering", event: "site_audit_reported",
    entityId: "emp_repo", detail: { written, refused, run_id: runId },
  }).catch(() => {});

  return ok(c, { written, refused, total: rows.length }, 201);
});

/** She acts on one, or waves it away. Nothing here decides anything on her behalf. */
siteAudit.post("/site-audit-findings/:id/:action", async (c) => {
  const id = c.req.param("id");
  const action = c.req.param("action");
  if (!STATUS_SET.has(action)) {
    throw badRequest("Unknown action", "A finding can be marked 'acted' or 'dismissed'.");
  }
  const now = Date.now();
  const res = await c.env.DB
    .prepare(`UPDATE site_audit_findings SET status = ?, updated_at = ?, archived_at = ? WHERE id = ?`)
    .bind(action, now, action === "new" ? null : now, id)
    .run();
  if (!res.meta.changes) throw badRequest("No such finding", "It may already have been archived.");
  return ok(c, { id, status: action });
});
