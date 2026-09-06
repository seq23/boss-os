/**
 * The AI Quant Fund — the ladder, the gates and the kill-switch proof.
 *
 * Boss OS governs; it does not execute. Nothing here holds a credential, places
 * an order, or moves capital. What it does is refuse: a stage that was skipped,
 * a promotion with no evidence, a rung opened without approval, and a
 * micro-live readiness claim made while the kill switch has never been
 * acknowledged by a running engine.
 *
 * Build plan §1.7: "A kill switch that only sets a local flag is not a kill
 * switch." So the proof here is a round trip — a command sent to the engine's
 * control endpoint and an acknowledgement read back. No acknowledgement, no
 * proof, and the validation status says so rather than rounding up.
 */

import type { Env } from "../env";
import { newId } from "../lib/id";
import { conflict } from "../lib/http";
import { logEvent } from "../lib/log";

/** How long a kill-switch proof stays good before it has to be re-proven. */
export const PROOF_VALID_MS = 30 * 86_400_000;

/** How long to wait for the engine to acknowledge before calling it unproven. */
export const ACK_TIMEOUT_MS = 5_000;

export interface StageRow {
  id: string;
  stage_no: number;
  key: string;
  name: string;
  capital_limit_micros: number;
  pass_criteria: string;
  fail_criteria: string;
  required_logs: string;
  required_review: string;
  advance_requires_approval: number;
}

/**
 * The ladder, in order. Advancing means moving to exactly the next stage: the
 * canon rule is "no skipping", and a rung reached by skipping is not a rung.
 */
export async function stages(db: D1Database): Promise<StageRow[]> {
  const rows = await db.prepare(`SELECT * FROM deployment_stages ORDER BY stage_no ASC`).all<StageRow>();
  return rows.results ?? [];
}

export async function assertLadderStep(db: D1Database, from: string, to: string): Promise<{ from: StageRow; to: StageRow }> {
  const all = await stages(db);
  const fromStage = all.find((s) => s.key === from);
  const toStage = all.find((s) => s.key === to);
  if (!fromStage || !toStage) {
    throw conflict("That is not a stage on the ladder", `The ladder is: ${all.map((s) => s.key).join(" → ")}.`);
  }
  if (toStage.stage_no !== fromStage.stage_no + 1) {
    throw conflict(
      `${toStage.name} is not the next stage after ${fromStage.name}`,
      "The Capital Deployment Ladder has no skipping. Repair the failed gate rather than stepping over it.",
    );
  }
  return { from: fromStage, to: toStage };
}

export interface KillSwitchProof {
  proven: boolean;
  engine_id: string | null;
  engine_status: string | null;
  last_probe_at: number | null;
  last_outcome: string | null;
  reason: string;
}

/**
 * Whether the kill switch has been proven to reach a running engine, recently
 * enough to still mean something.
 */
export async function killSwitchProof(db: D1Database, now = Date.now()): Promise<KillSwitchProof> {
  const engine = await db
    .prepare(`SELECT id, status, control_url FROM trading_engines ORDER BY created_at ASC LIMIT 1`)
    .first<{ id: string; status: string; control_url: string | null }>();

  if (!engine) {
    return { proven: false, engine_id: null, engine_status: null, last_probe_at: null, last_outcome: null, reason: "No engine is registered." };
  }

  const probe = await db
    .prepare(`SELECT ts, outcome FROM kill_switch_probes WHERE engine_id = ? AND kind = 'stop' ORDER BY ts DESC LIMIT 1`)
    .bind(engine.id)
    .first<{ ts: number; outcome: string }>();

  if (!probe) {
    return {
      proven: false, engine_id: engine.id, engine_status: engine.status,
      last_probe_at: null, last_outcome: null,
      reason: "The kill switch has never been probed against a running engine. A flag that stops nothing is not a kill switch.",
    };
  }
  if (probe.outcome !== "acknowledged") {
    return {
      proven: false, engine_id: engine.id, engine_status: engine.status,
      last_probe_at: probe.ts, last_outcome: probe.outcome,
      reason: `The last probe ended ${probe.outcome}. Unacknowledged is unproven.`,
    };
  }
  if (now - probe.ts > PROOF_VALID_MS) {
    return {
      proven: false, engine_id: engine.id, engine_status: engine.status,
      last_probe_at: probe.ts, last_outcome: probe.outcome,
      reason: `The last acknowledged probe was ${Math.floor((now - probe.ts) / 86_400_000)} days ago. Proof expires; re-prove it.`,
    };
  }

  return {
    proven: true, engine_id: engine.id, engine_status: engine.status,
    last_probe_at: probe.ts, last_outcome: probe.outcome,
    reason: "Acknowledged by the running engine.",
  };
}

export interface ProbeResult {
  id: string;
  outcome: "acknowledged" | "no_ack" | "error" | "not_configured";
  latency_ms: number | null;
  ack_reference: string | null;
  detail: string;
}

/**
 * Sends a stop command to the engine and waits for an acknowledgement.
 *
 * The engine is not part of this repository, so the transport is the only place
 * this build touches it. An engine with no control URL is `not_configured` —
 * which is a truthful failure, not an error.
 */
export async function probeKillSwitch(
  env: Env,
  engineId: string,
  kind: "reach" | "stop" = "stop",
  now = Date.now(),
): Promise<ProbeResult> {
  const engine = await env.DB
    .prepare(`SELECT id, name, control_url, status, environment FROM trading_engines WHERE id = ?`)
    .bind(engineId)
    .first<{ id: string; name: string; control_url: string | null; status: string; environment: string }>();
  if (!engine) throw conflict("No engine with that id");

  const id = newId("ksp");
  const sentAt = Date.now();

  const record = async (result: Omit<ProbeResult, "id">) => {
    await env.DB
      .prepare(
        `INSERT INTO kill_switch_probes (id, engine_id, ts, kind, sent_at, acknowledged_at, ack_reference, latency_ms, outcome, detail, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id, engineId, now, kind, sentAt,
        result.outcome === "acknowledged" ? Date.now() : null,
        result.ack_reference, result.latency_ms, result.outcome, result.detail, now,
      )
      .run();
    await logEvent(env.DB, {
      level: result.outcome === "acknowledged" ? "info" : "warn",
      scope: "trading", event: "kill_switch_probe", entityId: id,
      detail: { engine: engineId, kind, outcome: result.outcome },
    });
    return { id, ...result };
  };

  if (!engine.control_url) {
    return record({
      outcome: "not_configured",
      latency_ms: null,
      ack_reference: null,
      detail: "The engine has no control endpoint. Nothing was sent, and the kill switch is unproven.",
    });
  }

  try {
    const response = await fetch(engine.control_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: kind === "stop" ? "kill_switch" : "ping", issued_at: sentAt, source: "boss_os" }),
      signal: AbortSignal.timeout(ACK_TIMEOUT_MS),
    });

    const latency = Date.now() - sentAt;
    if (!response.ok) {
      return record({
        outcome: "no_ack",
        latency_ms: latency,
        ack_reference: null,
        detail: `The engine answered ${response.status}. An error is not an acknowledgement.`,
      });
    }

    const body = (await response.json().catch(() => ({}))) as { acknowledged?: boolean; reference?: string; stopped?: boolean };
    if (!body?.acknowledged) {
      return record({
        outcome: "no_ack",
        latency_ms: latency,
        ack_reference: null,
        detail: "The engine replied without acknowledging the command. Unacknowledged is unproven.",
      });
    }

    return record({
      outcome: "acknowledged",
      latency_ms: latency,
      ack_reference: body.reference ?? null,
      detail: `Acknowledged in ${latency}ms${body.stopped ? "; the engine reported it stopped" : ""}.`,
    });
  } catch (err) {
    return record({
      outcome: "error",
      latency_ms: Date.now() - sentAt,
      ack_reference: null,
      detail: `The probe failed: ${err instanceof Error ? err.message : String(err)}. Unreachable is unproven.`,
    });
  }
}

export interface ValidationItem {
  key: string;
  requirement: string;
  status: "met" | "unmet" | "externally_unproven";
  detail: string;
}

/**
 * The honest validation status. Canon's acceptance for this phase includes
 * "trading validation status stays honest", so this endpoint is written to be
 * uncomfortable: it reports what is externally unproven as unproven, and it
 * never rounds a procedural intention up to a met gate.
 */
export async function validationStatus(env: Env, now = Date.now()): Promise<{
  ready_for_live: boolean;
  blocking: string[];
  items: ValidationItem[];
  note: string;
}> {
  const [authority, engine, proof, stagesPassed, rungs, scorecards] = await Promise.all([
    env.DB.prepare(`SELECT * FROM trading_authority LIMIT 1`).first<Record<string, number | string | null>>(),
    env.DB.prepare(`SELECT id, status, environment, control_url FROM trading_engines ORDER BY created_at ASC LIMIT 1`)
      .first<{ id: string; status: string; environment: string; control_url: string | null }>(),
    killSwitchProof(env.DB, now),
    env.DB
      .prepare(`SELECT stage_to FROM promotion_scorecards WHERE status = 'applied' ORDER BY ts DESC`)
      .all<{ stage_to: string }>(),
    // The rung's approval is joined in rather than assumed: "every rung opened
    // behind an approval" is a claim this endpoint has to check, not repeat.
    env.DB
      .prepare(
        `SELECT r.rung_no, r.reached_at, r.requires_approval, r.approval_id, a.status AS approval_status
           FROM scale_rungs r
           LEFT JOIN approvals a ON a.id = r.approval_id
          ORDER BY r.rung_no`,
      )
      .all<{
        rung_no: number;
        reached_at: number | null;
        requires_approval: number;
        approval_id: string | null;
        approval_status: string | null;
      }>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM promotion_scorecards WHERE verdict = 'pass'`).first<{ n: number }>(),
  ]);

  const passed = new Set((stagesPassed.results ?? []).map((s) => s.stage_to));

  /*
   * A rung counts as properly opened when it either needed no approval (rung 0,
   * the baseline the ladder starts from) or carries an approval that was
   * actually approved. A rung pointing at a pending or rejected approval is not
   * approved, and neither is one pointing at nothing.
   */
  const allRungs = rungs.results ?? [];
  const openedRungs = allRungs.filter((r) => r.reached_at);
  const unapprovedRungs = openedRungs.filter(
    (r) => r.requires_approval && r.approval_status !== "approved",
  );

  const items: ValidationItem[] = [
    {
      key: "live_adapter",
      requirement: "A live broker adapter exists",
      status: "unmet",
      detail: "There is none in this repository. Enabling live execution returns 501 by construction, not by configuration.",
    },
    {
      key: "engine_provisioned",
      requirement: "The engine is provisioned and reachable",
      status: engine?.status === "connected" ? "met" : "externally_unproven",
      detail: engine
        ? `The engine is recorded as ${engine.status}${engine.control_url ? "" : " with no control endpoint"}. Provisioning is a human action outside this repository.`
        : "No engine is registered.",
    },
    {
      key: "kill_switch_proven",
      requirement: "The kill switch reaches the engine and is acknowledged",
      status: proof.proven ? "met" : engine?.control_url ? "unmet" : "externally_unproven",
      detail: proof.proven
        ? // What the round trip establishes and what it does not. The endpoint
          // answered; that whatever answered is a real Hummingbot against Kraken
          // demo is the operator's declaration, and this build cannot verify it.
          `${proof.reason} This proves the control endpoint answered and acknowledged. ` +
            `That the responder is a real engine on a real server is recorded from the operator's ` +
            `registration (${engine?.environment ?? "unknown environment"}, status ${engine?.status ?? "unknown"}), not verified here.`
        : proof.reason,
    },
    {
      key: "micro_live_gates",
      requirement: "All six micro-live gates recorded",
      status: authority && ["backtest_recorded", "paper_run_recorded", "risk_limits_set", "kill_switch_tested", "ledger_export_tested", "human_approval_recorded"]
        .every((g) => Number(authority[g] ?? 0) === 1)
        ? "met"
        : "unmet",
      detail: "The six gates live on the trading authority envelope and are recorded there, not here.",
    },
    {
      key: "paper_before_live",
      requirement: "The paper stage is passed before micro-live",
      status: passed.has("paper") ? "met" : "unmet",
      detail: passed.has("paper") ? "A scored card advanced a strategy into paper." : "No strategy has passed the paper stage.",
    },
    {
      key: "no_credentials_held",
      requirement: "Boss OS holds no key that can move money",
      status: "met",
      detail: "No exchange credential field exists in this schema, and none is read anywhere in this Worker.",
    },
    {
      key: "scale_rung_approval",
      requirement: "No rung opens without an approval",
      status: unapprovedRungs.length === 0 ? "met" : "unmet",
      detail:
        unapprovedRungs.length === 0
          ? `${openedRungs.length} of ${allRungs.length} rungs opened, each behind an approved approval.`
          : `Rung(s) ${unapprovedRungs.map((r) => r.rung_no).join(", ")} are open without an approved approval. ` +
            "An open rung with no approval behind it is exactly what this gate exists to catch.",
    },
    {
      key: "scorecards",
      requirement: "Promotion happens against scored evidence",
      status: (scorecards?.n ?? 0) > 0 ? "met" : "unmet",
      detail: `${scorecards?.n ?? 0} passing scorecard(s) on file.`,
    },
  ];

  const blocking = items.filter((i) => i.status !== "met").map((i) => i.key);
  return {
    ready_for_live: false,
    blocking,
    items,
    note:
      "Live execution is not available in this build and this status does not round up. " +
      "Everything marked externally unproven needs a machine, an account or a human action that does not exist in this repository.",
  };
}
