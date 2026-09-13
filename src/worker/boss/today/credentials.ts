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

export interface ProbeRow {
  id: string;
  label: string;
  what_depends: string;
  state: string;
  detail: string | null;
  fix_steps: string;
  checked_at: number | null;
  max_age_hours: number;
  /** The execution backend this credential exists to unlock, if it exists to unlock one. */
  backend_id: string | null;
  /** That backend's status: registered | enabled | disabled. Null when there is no backend. */
  backend_status: string | null;
}

const on = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/**
 * Is this credential's absence a DECISION rather than a fault?
 *
 * Read off the backend's own status row, never off a list of credential names. A probe that points
 * at no backend is not covered by this at all — which is every calendar feed, the Gmail connector,
 * the service account and the delegation, all of which unlock things that ARE switched on.
 */
export function isDecisionInForce(p: Pick<ProbeRow, "backend_id" | "backend_status">): boolean {
  return p.backend_id !== null && p.backend_status !== "enabled";
}

export async function credentialAlerts(env: Env, now = Date.now()): Promise<CredentialAlert[]> {
  const rows = await env.DB
    .prepare(
      /*
       * THE BACKEND'S STATUS COMES BACK WITH THE PROBE, because a credential is only a gap if
       * something that is switched ON needs it. See `dependsOnSomethingSwitchedOn` below.
       */
      `SELECT p.id, p.label, p.what_depends, p.state, p.detail, p.fix_steps, p.checked_at,
              p.max_age_hours, p.backend_id, b.status AS backend_status
         FROM credential_probes p
    LEFT JOIN execution_backends b ON b.id = p.backend_id
        ORDER BY CASE p.state WHEN 'dead' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END, p.id`,
    )
    .all<ProbeRow>();

  return alertsForProbes(rows.results ?? [], now);
}

/**
 * The judgement, over rows, with no database in it.
 *
 * Split out so `scripts/validate/an-alert-describes-a-live-fault.mjs` can run the SHIPPED rules
 * over the exact production rows that produced the two false HIGH alerts, rather than asserting
 * something about the source text that looks like the rule.
 */
export function alertsForProbes(probes: ProbeRow[], now = Date.now()): CredentialAlert[] {
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
    /*
     * ── A DECISION IN FORCE IS NOT A FAULT ───────────────────────────────────
     *
     * Two of the five alerts on her screen, both HIGH, both at the top:
     *
     *   "Nothing has ever checked The Anthropic key ... It could be dead right now"
     *   "Nothing has ever checked The OpenAI key ... It could be dead right now"
     *
     * Neither key is missing by accident. `bk_anthropic` and `bk_openai` are `registered`, never
     * enabled, because she routes coaching through the free Llama on Workers AI and has said
     * plainly that she does not want to spend money here. The system was shouting, twice, at the
     * top of her morning, about a choice she made on purpose.
     *
     * THE RULE IS READ OFF THE BACKEND, NOT OFF THE TWO NAMES. Special-casing `cred_anthropic_key`
     * would fix this morning and leave the next deliberately-off backend to make the same noise —
     * and would put the decision in a hardcoded list rather than in the row that actually records
     * it. `execution_backends.status` already carries exactly this: "registered — known, not usable
     * yet. enabled — may take work. disabled — deliberately off."
     *
     * A DEAD PROBE STILL SHOUTS EITHER WAY. This gate is above the never-checked and stale
     * branches only. If a credential was proven BROKEN by an actual call, that is evidence about
     * the world and it is said out loud whatever the backend's status is — the alternative is a
     * disabled backend quietly hiding a revoked token that something else also uses.
     */
    const switchedOff = isDecisionInForce(p);

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

    if (switchedOff) continue;

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
