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
 *   2. A FORBIDDEN REPOSITORY CANNOT BE RECORDED AS FIXED. Client repositories are off limits
 *      (local-guides-citation-velocity was until 16 Oct 2026) — see `shared/boss/siteAudit/repoPolicy.mjs` — and a row claiming `fixed_pr` against
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
import { carriesAddress, searchEvidenceGap, findingItemId } from "../../../shared/boss/siteAudit/evidence.mjs";
import { repoForDomain, domainOfRow } from "../../../shared/boss/siteAudit/domainRepos.mjs";
import { fillBlankFields } from "../../../shared/boss/siteAudit/defaultActions.mjs";

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
      // An ADDRESS, not any '@': JSON-LD's @type and @id are what structured-data findings name.
      if (carriesAddress(v)) {
        throw badRequest(
          `Finding ${i + 1} carries an address in ${field}, so the whole batch was refused`,
          "Boss OS stores public domains and repository names here, never an address. Nothing was written.",
        );
      }
    }
  }

  const now = Date.now();
  /*
   * WHEN THE PASS RAN, not when it reported. A report re-delivered hours later (26 Oct 2026: seven
   * queue passes refused overnight, sent again in the morning) must not supersede rows a LATER pass
   * already wrote. The reporter sends the findings file's write time; anything outside the last week
   * or in the future is ignored and the arrival time is used.
   */
  const ranAtRaw = Number(b?.ran_at);
  const ranAt = Number.isFinite(ranAtRaw) && ranAtRaw <= now && ranAtRaw > now - 7 * 86_400_000 ? Math.trunc(ranAtRaw) : now;
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
  /*
   * AND THE EVIDENCE FITS THE KIND OF PASS (26 Oct 2026). A mailbox pass names the mailbox, the
   * queries, the date range and the message count; a Search Readiness queue pass names the queue
   * file, when it was written, the repo and the brief ids. One rule, shared with the reporter
   * (`searchEvidenceGap`), so the two cannot disagree about what counts.
   */
  const gap = searchEvidenceGap(searched);
  if (!searchedJson || searchedJson === "{}" || gap) {
    throw badRequest(
      "A report without its search evidence was refused",
      `${gap ?? "`searched` is empty"}. 'I looked and found nothing' is not a finding unless it says where it looked.`,
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

  for (const [i, raw] of rows.entries()) {
    // The same defaults as the reporter: a blank next action or reason is filled, never refused.
    const f: any = fillBlankFields(raw);
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
       * Client repositories are never branched by the fixer. The job knows this (and its worktree
       * helper refuses them); this refuses to believe it if it forgets.
       */
      if (!mayAutoFix(repo)) {
        refused.push(
          `finding ${i + 1}: claims a fix in ${repo ?? "an unnamed repository"}, which the fixer may not change. `
          + `${whyNoAutoFix(repo) ?? "The repository could not be identified, and an unidentified repository is never fixable."} `
          + "Report it as 'client_repo'.",
        );
        continue;
      }
      // "I fixed it" with no link is an assertion nobody can check.
      if (!prUrl) {
        refused.push(`finding ${i + 1}: claims a fix in ${repo} and names no pull request. An unverifiable fix is not recorded.`);
        continue;
      }
    }

    /*
     * ONE LIST SAYS WHICH REPO SERVES A DOMAIN (shared/boss/siteAudit/domainRepos.mjs, built from the
     * grid manifest). A repository is mapped by its own REPO_IDENTITY.md or by that list, never by a
     * resemblance — `dentistryguides` and `thedentistryguides` are two different domains.
     */
    const listed = repoForDomain(domainOfRow({ domain: text(f?.domain, 200), project }));
    const claimed = text(f?.mapped_by, 32);
    const mappedBy = !repo ? null
      : claimed === "repo_identity" ? "repo_identity"
      : listed?.repo === repo ? "grid_manifest"
      : "unmapped";
    if (repo && mappedBy === "unmapped") {
      refused.push(`finding ${i + 1}: names repository ${repo} without REPO_IDENTITY.md evidence or a grid-manifest entry for the domain. A resemblance is not a mapping.`);
      continue;
    }
    /*
     * A "NO REPOSITORY" ROW FOR A DOMAIN THE LIST MAPS IS A CONTRADICTION, and it is the one that put
     * "Porchandparty901 … no repository claims that domain" on Today for five weeks while
     * seq23/p-n-p served it. Refused with the repo named, so the next pass fixes it there.
     */
    if (disposition === "no_repo" && listed?.repo) {
      refused.push(`finding ${i + 1}: says no repository serves ${domainOfRow({ domain: text(f?.domain, 200), project })}, but ${listed.repo} does (${listed.source}). Report it against ${listed.repo}.`);
      continue;
    }
    // An off-limits row for a repository the fixer may change is stale policy, not a finding.
    if (disposition === "off_limits" && repo && mayAutoFix(repo)) {
      refused.push(`finding ${i + 1}: calls ${repo} off limits, but it is not on the fixer's list (repoPolicy.mjs). Fix it there.`);
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
        searchedJson, runId, ranAt, now,
      )
      .run();
    written++;

    /*
     * A NEWER ROW SUPERSEDES THE OLDER ONES ABOUT THE SAME THING (26 Oct 2026). Rows were never
     * retired, so Today's "left for a person" line counted 49 rows: Ahrefs mail from September that
     * later passes had re-read, and one checklist item reworded by three passes (j9 for
     * dentistryguides.com, three times). A checklist row retires the older live rows of its own
     * project and item; an Ahrefs row retires the older live rows of its project from earlier runs.
     */
    const itemId = findingItemId({ project, headline });
    const item = itemId ? itemId.slice(itemId.lastIndexOf("-") + 1) : null;
    const note = `superseded ${new Date(now).toISOString().slice(0, 10)} by run ${runId}`;
    if (item) {
      await c.env.DB
        .prepare(
          `UPDATE site_audit_findings SET archived_at = ?, updated_at = ?, notes = ?
            WHERE project = ? AND headline <> ? AND archived_at IS NULL AND lower(headline) LIKE ? AND found_at <= ?`,
        )
        .bind(now, now, note, project, headline, `${item}:%`, ranAt)
        .run();
      // And a re-delivered row that a later pass has already superseded is recorded, but not live.
      await c.env.DB
        .prepare(
          `UPDATE site_audit_findings SET archived_at = ?, notes = 'superseded by a later pass on arrival'
            WHERE project = ? AND headline = ? AND archived_at IS NULL
              AND EXISTS (SELECT 1 FROM site_audit_findings o WHERE o.project = ? AND o.headline <> ? AND lower(o.headline) LIKE ? AND o.found_at > ? AND o.archived_at IS NULL)`,
        )
        .bind(now, project, headline, project, headline, `${item}:%`, ranAt)
        .run();
    } else if (!project.startsWith("checklist:")) {
      await c.env.DB
        .prepare(
          `UPDATE site_audit_findings SET archived_at = ?, updated_at = ?, notes = ?
            WHERE project = ? AND archived_at IS NULL AND COALESCE(run_id, '') <> ? AND found_at < ?`,
        )
        .bind(now, now, note, project, runId, ranAt)
        .run();
    }
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
/**
 * WHAT NOW PASSES CLEARS ITS OLD FINDING (26 Oct 2026). The weekly Search Readiness audit posts the
 * items that passed on each site; every older open finding for that site and item is archived with
 * the reason, so a repair run's "surfaced" row is never relayed to her once the check passes.
 */
siteAudit.post("/site-audit-findings/cleared", async (c) => {
  const b = await c.req.json<any>().catch(() => null);
  const passes = Array.isArray(b?.passes) ? b.passes.slice(0, 5000) : null;
  if (!passes) throw badRequest("passes[] is required");
  const at = Number.isFinite(Date.parse(String(b?.at ?? ""))) ? Date.parse(String(b.at)) : Date.now();
  const now = Date.now();
  let archived = 0;
  for (const p of passes) {
    const project = String(p?.project ?? "").slice(0, 120);
    const item = String(p?.item ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
    if (!project.startsWith("checklist:") || !item) continue;
    const r = await c.env.DB
      .prepare(
        `UPDATE site_audit_findings SET archived_at = ?, updated_at = ?, notes = ?
          WHERE project = ? AND archived_at IS NULL AND lower(headline) LIKE ? AND found_at <= ?`,
      )
      .bind(now, now, `cleared ${new Date(at).toISOString().slice(0, 10)}: the check passes`, project, `${item}:%`, at)
      .run();
    archived += r.meta?.changes ?? 0;
  }
  return ok(c, { archived });
});

siteAudit.post("/site-audit-findings/:id/:action", async (c) => {
  const id = c.req.param("id");
  const action = c.req.param("action");
  if (!STATUS_SET.has(action)) {
    throw badRequest("Unknown action", "A finding can be marked 'acted' or 'dismissed'.");
  }
  /*
   * A DECISION CARRIES ITS REASON (31 Oct 2026). Sixteen findings were decided in one pass ("acted":
   * fixed and live; "dismissed": a platform limit, a transient, the protected page). The reason goes on
   * the row's notes and the audit log, so the record says why a finding left the screen.
   */
  const b = await c.req.json<any>().catch(() => null);
  const reason = String(b?.reason ?? "").trim().slice(0, 1000);
  const now = Date.now();
  const res = await c.env.DB
    .prepare(`UPDATE site_audit_findings SET status = ?, updated_at = ?, archived_at = ?, notes = COALESCE(?, notes) WHERE id = ?`)
    .bind(action, now, action === "new" ? null : now, reason || null, id)
    .run();
  if (!res.meta.changes) throw badRequest("No such finding", "It may already have been archived.");
  await audit(c.env.DB, { actor: "boss", lane: "ops", entityType: "site_audit_finding", entityId: id, action: `finding_${action}`, detail: reason ? { reason } : undefined });
  return ok(c, { id, status: action, reason: reason || null });
});
