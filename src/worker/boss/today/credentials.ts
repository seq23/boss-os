import type { Env } from "../env";

/**
 * A DEAD CREDENTIAL, ON HER SCREEN, BEFORE A DUTY NEEDS IT AND FAILS.
 *
 * ─── What happened ─────────────────────────────────────────────────────────
 *
 * She changed her Google password. Google revokes every OAuth refresh token when that happens, so
 * the claude.ai Gmail connector died in the same instant — and nothing noticed. Simone's KDP watch
 * ran blind, Monique's mailbox sweep would have run blind, and the escalation on Today went on
 * confidently describing a week-old theory about an Amazon account flag. It was found because a
 * human ran the watcher by hand and read the output.
 *
 * ─── Why an alert on Today rather than an owned deliverable per credential ──
 *
 * An owned deliverable is defined by a TERMINAL CONDITION — it ends. "The Gmail connector works"
 * never ends; it is a standing property that flips back and forth for ever, and a deliverable that
 * completes and is then re-raised on every password change would be a register full of resurrections.
 * The right shape for a standing property is a check computed on read, which is what this is.
 *
 * The failover — a path to the KDP mail that does not depend on that connector — IS a deliverable,
 * because it genuinely finishes. That one is `del_kdp_mail_failover`, owned by Toni.
 *
 * ─── Three conditions, three sentences ─────────────────────────────────────
 *
 * DEAD is the loud one. STALE is nearly as loud and is the subtler failure: a row saying `live`
 * with a three-week-old date is not evidence about today, and a prober that has stopped running
 * produces exactly that — the same shape as the watcher whose silence read as good news. NEVER
 * CHECKED is its own sentence, because an empty register is not a clean bill of health.
 */

export interface CredentialAlert {
  severity: "medium" | "high" | "critical";
  text: string;
  source_type: string;
  source_id: string | null;
}

interface ProbeRow {
  id: string;
  label: string;
  what_depends: string;
  state: string;
  detail: string | null;
  fix_steps: string;
  checked_at: number | null;
  max_age_hours: number;
}

const on = (ts: number) => new Date(ts).toISOString().slice(0, 10);

export async function credentialAlerts(env: Env, now = Date.now()): Promise<CredentialAlert[]> {
  const rows = await env.DB
    .prepare(
      `SELECT id, label, what_depends, state, detail, fix_steps, checked_at, max_age_hours
         FROM credential_probes
        ORDER BY CASE state WHEN 'dead' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END, id`,
    )
    .all<ProbeRow>();

  const probes = rows.results ?? [];
  const alerts: CredentialAlert[] = [];

  /*
   * RULE 0, ON A SURFACE. A register with nothing in it renders as "every credential is fine",
   * which is indistinguishable from "nothing has ever been checked" — and the second is what is
   * actually true. 0207 seeds three, so zero means the table was never migrated or the rows were
   * lost, and either way she is told rather than reassured.
   */
  if (probes.length === 0) {
    alerts.push({
      severity: "high",
      text:
        "The credential register is empty, so nothing is watching whether the logins this system runs on still work. " +
        "That is a broken register rather than a clean one — the last time nothing was watching, the Gmail connector was dead for days before anyone noticed.",
      source_type: "tasks",
      source_id: null,
    });
    return alerts;
  }

  for (const p of probes) {
    if (p.state === "dead") {
      alerts.push({
        severity: "critical",
        text:
          `${p.label} is not working. ${p.what_depends} ` +
          (p.detail ? `${p.detail} ` : "") +
          `Fix: ${p.fix_steps}`,
        source_type: "tasks",
        source_id: p.id,
      });
      continue;
    }

    if (p.checked_at === null) {
      alerts.push({
        severity: "high",
        text:
          `Nothing has ever checked ${p.label}. ${p.what_depends} ` +
          "It could be dead right now and the first sign would be a job failing. Run: npm run credentials:check",
        source_type: "tasks",
        source_id: p.id,
      });
      continue;
    }

    /*
     * TWICE THE MAX AGE BEFORE THIS FIRES, DELIBERATELY. The prober runs daily against a 36-hour
     * window, so one skipped morning — a shut laptop, a slow boot — is not an alarm. Three days of
     * silence is, because by then the thing that stopped is the prober itself.
     */
    const staleAfter = p.max_age_hours * 2 * 3_600_000;
    if (now - p.checked_at > staleAfter) {
      const days = Math.floor((now - p.checked_at) / 86_400_000);
      alerts.push({
        severity: "high",
        text:
          `Nothing has checked ${p.label} for ${days} day${days === 1 ? "" : "s"} — it last answered "${p.state}" on ${on(p.checked_at)}. ` +
          "That is old enough to be about a different week, and a prober that has stopped running looks exactly like a credential that is fine. " +
          "Run: npm run credentials:check",
        source_type: "tasks",
        source_id: p.id,
      });
      continue;
    }

    /*
     * `unknown` IS NOT `live`. A probe that could not decide has decided nothing, and rendering it
     * as healthy is the empty-loop pass wearing a green badge.
     */
    if (p.state === "unknown") {
      alerts.push({
        severity: "medium",
        text:
          `${p.label} could not be checked on ${on(p.checked_at)}, so whether it works is unknown. ` +
          (p.detail ? `${p.detail} ` : "") +
          `${p.what_depends}`,
        source_type: "tasks",
        source_id: p.id,
      });
    }
  }

  return alerts;
}
