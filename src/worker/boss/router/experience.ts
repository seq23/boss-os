/**
 * WHICH MODELS HAVE ACTUALLY DONE WHICH JOBS.
 *
 * ─── The defect this replaces ───────────────────────────────────────────────────────────────────
 *
 * Every preference in this router is currently decided ON PAPER. `capability_tier` is a word
 * somebody typed; `in_micros_1k` is a published rate; `benchmark_status` is 'unbenchmarked' on five
 * of the six registered models. Nothing in the database can answer "has this model ever done this
 * kind of work well". So the cost stage ranks candidates by a number that describes their price and
 * a word that describes their ambition, and the cheapest one that LOOKS adequate wins.
 *
 * That is not hypothetical here. `rtd_m2b0p2mdcrt61m4g` is an 8-billion-parameter model answering a
 * request to find a buyer for $1B of OpenAI stock with "Classification: General Inquiry. Routing:
 * Route to Customer Service Team." It was eligible on paper and it was cheapest on paper.
 *
 * The rule this module exists to implement: PREFER THE CHEAPEST MODEL THAT HAS ACTUALLY DONE THIS
 * JOB WELL over the cheapest model that looks adequate on paper.
 *
 * ─── AND THE HONEST LIMIT, WHICH IS THE HARDER HALF ─────────────────────────────────────────────
 *
 * `usage_ledger` holds almost nothing — fifteen rows in its entire life, per 0248, and zero in the
 * shipped seed. `model_job_outcome` starts empty and nothing back-fills it. So for the foreseeable
 * future this module's honest answer about every model is UNKNOWN.
 *
 * AN UNPROVEN MODEL IS UNKNOWN, NOT GOOD. Unknown is not a mild negative that a low price can
 * outweigh — it is the absence of evidence, and this module will not manufacture confidence out of
 * a handful of rows to look useful. Concretely:
 *
 *   · `PROVEN` requires MIN_RUNS outcomes for that exact (task kind, model) pair, of which at least
 *     MIN_HUMAN_CONFIRMATIONS were recorded by a PERSON deciding, and a success share at or above
 *     PROVEN_SHARE. Router-recorded rows alone can never make a model proven, because "the call
 *     returned" is not "the work stood".
 *   · `UNKNOWN` never wins work that matters. `rank()` places unknown BELOW proven always, and
 *     `preferProven` refuses to promote an unknown model for protected work at all.
 *   · `sufficiency()` says, in a sentence, how many more runs are needed. A surface that shows a
 *     preference must be able to show that the preference rests on nothing yet.
 *
 * ─── WHAT THIS MODULE MAY NOT DO ────────────────────────────────────────────────────────────────
 *
 * IT CANNOT MAKE A MODEL ELIGIBLE, AND IT CANNOT REFUSE ONE. Eligibility is §3.1's first four
 * stages — privacy, capability, availability, budget — and this is evidence, which belongs to the
 * FIFTH: cost preference, which only ORDERS what already survived. A good record may not carry a
 * model past the privacy stage, and a poor one may not be a back-door capability refusal. It
 * reorders survivors, and that is all.
 */

import type { D1Database } from "@cloudflare/workers-types";
import { newId } from "../lib/id";
import { logEvent } from "../lib/log";

export const OUTCOMES = ["succeeded", "reworked", "rejected"] as const;
export type JobOutcome = (typeof OUTCOMES)[number];

export const OUTCOME_SOURCES = ["router", "human", "benchmark"] as const;
export type OutcomeSource = (typeof OUTCOME_SOURCES)[number];

/** Outcomes for one (task kind, model) pair before this module will say anything but "unknown". */
export const MIN_RUNS = 5;
/** Of those, how many a PERSON has to have decided. "It returned" is not "it worked". */
export const MIN_HUMAN_CONFIRMATIONS = 2;
/** Share of outcomes that must be `succeeded` for a pair to count as proven. */
export const PROVEN_SHARE = 0.8;
/** At or below this share, and with enough runs, a pair is recorded as poor and ranked last. */
export const POOR_SHARE = 0.5;

export const VERDICTS = ["proven", "mixed", "poor", "unknown"] as const;
export type ExperienceVerdict = (typeof VERDICTS)[number];

export interface PairExperience {
  taskKind: string;
  modelId: string;
  runs: number;
  succeeded: number;
  reworked: number;
  rejected: number;
  humanConfirmations: number;
  successShare: number;
  verdict: ExperienceVerdict;
  /** One sentence naming the counts and, when unknown, what is still missing. */
  sentence: string;
}

export function emptyExperience(taskKind: string, modelId: string): PairExperience {
  return {
    taskKind,
    modelId,
    runs: 0,
    succeeded: 0,
    reworked: 0,
    rejected: 0,
    humanConfirmations: 0,
    successShare: 0,
    verdict: "unknown",
    sentence:
      `Nothing is recorded of ${modelId} doing ${taskKind} work. ${MIN_RUNS} outcomes are needed, ` +
      `${MIN_HUMAN_CONFIRMATIONS} of them decided by a person, before this can say anything else.`,
  };
}

interface Counts {
  runs: number;
  succeeded: number;
  reworked: number;
  rejected: number;
  human: number;
}

/** The pure judgement, separated from the query so a test can drive every shape of evidence. */
export function judge(taskKind: string, modelId: string, c: Counts): PairExperience {
  const runs = Math.max(0, c.runs);
  if (runs === 0) return emptyExperience(taskKind, modelId);

  const share = c.succeeded / runs;
  const enough = runs >= MIN_RUNS && c.human >= MIN_HUMAN_CONFIRMATIONS;

  let verdict: ExperienceVerdict;
  if (!enough) verdict = "unknown";
  else if (share >= PROVEN_SHARE) verdict = "proven";
  else if (share <= POOR_SHARE) verdict = "poor";
  else verdict = "mixed";

  const tally =
    `${runs} recorded outcome${runs === 1 ? "" : "s"} on ${taskKind} work — ` +
    `${c.succeeded} stood, ${c.reworked} needed fixing, ${c.rejected} were sent back; ` +
    `${c.human} decided by a person`;

  const missing: string[] = [];
  if (runs < MIN_RUNS) missing.push(`${MIN_RUNS - runs} more run${MIN_RUNS - runs === 1 ? "" : "s"}`);
  if (c.human < MIN_HUMAN_CONFIRMATIONS) {
    const need = MIN_HUMAN_CONFIRMATIONS - c.human;
    missing.push(`${need} more outcome${need === 1 ? "" : "s"} a person decided`);
  }

  const sentence = enough
    ? `${tally}. That is ${Math.round(share * 100)}% success, which reads as ${verdict}.`
    : `${tally}. That is not enough to judge on: ${missing.join(" and ")} needed. Unknown, not good.`;

  return {
    taskKind,
    modelId,
    runs,
    succeeded: c.succeeded,
    reworked: c.reworked,
    rejected: c.rejected,
    humanConfirmations: c.human,
    successShare: share,
    verdict,
    sentence,
  };
}

/**
 * Every model's record on one kind of work.
 *
 * A MISSING TABLE IS NOT A GOOD RECORD. A query that throws returns an empty map, and an empty map
 * makes every model unknown — which ranks them all together and changes nothing, rather than
 * quietly promoting whichever model happens to be cheapest.
 */
export async function experienceFor(db: D1Database, taskKind: string | null | undefined): Promise<Map<string, PairExperience>> {
  const kind = String(taskKind ?? "").trim();
  const out = new Map<string, PairExperience>();
  if (!kind) return out;

  try {
    const rows = await db
      .prepare(
        `SELECT model_id,
                COUNT(*)                                              AS runs,
                SUM(CASE WHEN outcome = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
                SUM(CASE WHEN outcome = 'reworked'  THEN 1 ELSE 0 END) AS reworked,
                SUM(CASE WHEN outcome = 'rejected'  THEN 1 ELSE 0 END) AS rejected,
                SUM(CASE WHEN source  = 'human'     THEN 1 ELSE 0 END) AS human
           FROM model_job_outcome
          WHERE task_kind = ?
          GROUP BY model_id`,
      )
      .bind(kind)
      .all<{ model_id: string; runs: number; succeeded: number; reworked: number; rejected: number; human: number }>();

    for (const r of rows.results ?? []) {
      out.set(
        r.model_id,
        judge(kind, r.model_id, {
          runs: Number(r.runs ?? 0),
          succeeded: Number(r.succeeded ?? 0),
          reworked: Number(r.reworked ?? 0),
          rejected: Number(r.rejected ?? 0),
          human: Number(r.human ?? 0),
        }),
      );
    }
  } catch {
    return new Map();
  }
  return out;
}

/**
 * THE PREFERENCE RANK, and it is deliberately coarse.
 *
 * Lower sorts earlier. Cost remains the tie-break WITHIN a rank, which is the rule stated the right
 * way round: among models that have actually done this job well, take the cheapest — not, among the
 * cheapest, hope one can do the job.
 *
 * UNKNOWN AND MIXED SHARE A RANK WITH NOTHING BELOW THEM BUT POOR. Unknown is not ranked as "bad",
 * because it is not a finding; it is ranked below PROVEN because proven is a finding and unknown is
 * the absence of one. With an empty table every model is unknown, every rank is 1, and the ordering
 * collapses to exactly the cost ordering that exists today — which is the honest behaviour when
 * there is no evidence at all.
 */
export function rank(exp: PairExperience | undefined): number {
  switch (exp?.verdict) {
    case "proven":
      return 0;
    case "poor":
      return 2;
    default:
      return 1;
  }
}

/**
 * MAY THIS MODEL TAKE PROTECTED WORK ON THE STRENGTH OF ITS RECORD?
 *
 * "Unknown must never win work that matters" needs a place where it is enforced rather than merely
 * ranked, because a rank can be outvoted by a price. This is not an eligibility refusal — the
 * capability stage already owns that, and `benchmark_status` already refuses unbenchmarked models
 * high-risk work. This is narrower and it is about PROMOTION: a model may not be moved UP the
 * order, past another candidate, for protected work on evidence that does not exist.
 */
export function mayBePreferredForProtectedWork(exp: PairExperience | undefined): boolean {
  return exp?.verdict === "proven";
}

/** How much evidence exists at all, for a surface that must not imply more than there is. */
export interface Sufficiency {
  pairs: number;
  rows: number;
  provenPairs: number;
  sufficient: boolean;
  sentence: string;
}

export async function sufficiency(db: D1Database): Promise<Sufficiency> {
  let rows = 0;
  let pairs = 0;
  let provenPairs = 0;
  try {
    const totals = await db
      .prepare(`SELECT COUNT(*) AS rows, COUNT(DISTINCT task_kind || '|' || model_id) AS pairs FROM model_job_outcome`)
      .first<{ rows: number; pairs: number }>();
    rows = Number(totals?.rows ?? 0);
    pairs = Number(totals?.pairs ?? 0);

    const byPair = await db
      .prepare(
        `SELECT task_kind, model_id,
                COUNT(*) AS runs,
                SUM(CASE WHEN outcome = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
                SUM(CASE WHEN outcome = 'reworked'  THEN 1 ELSE 0 END) AS reworked,
                SUM(CASE WHEN outcome = 'rejected'  THEN 1 ELSE 0 END) AS rejected,
                SUM(CASE WHEN source  = 'human'     THEN 1 ELSE 0 END) AS human
           FROM model_job_outcome GROUP BY task_kind, model_id`,
      )
      .all<{ task_kind: string; model_id: string; runs: number; succeeded: number; reworked: number; rejected: number; human: number }>();
    for (const r of byPair.results ?? []) {
      const v = judge(r.task_kind, r.model_id, {
        runs: Number(r.runs ?? 0),
        succeeded: Number(r.succeeded ?? 0),
        reworked: Number(r.reworked ?? 0),
        rejected: Number(r.rejected ?? 0),
        human: Number(r.human ?? 0),
      });
      if (v.verdict === "proven") provenPairs++;
    }
  } catch {
    return {
      pairs: 0,
      rows: 0,
      provenPairs: 0,
      sufficient: false,
      sentence:
        "No outcome record could be read, so nothing here rests on evidence. Every model is unknown and the " +
        "router is ordering candidates on price alone, as it did before.",
    };
  }

  const sufficient = provenPairs > 0;
  const sentence = sufficient
    ? `${rows} recorded outcome${rows === 1 ? "" : "s"} across ${pairs} model/task pair${pairs === 1 ? "" : "s"}; ` +
      `${provenPairs} ${provenPairs === 1 ? "pair has" : "pairs have"} enough evidence to be preferred on record rather than on price.`
    : `${rows} recorded outcome${rows === 1 ? "" : "s"} across ${pairs} model/task pair${pairs === 1 ? "" : "s"} — ` +
      `not one has the ${MIN_RUNS} runs and ${MIN_HUMAN_CONFIRMATIONS} human decisions this needs, so every model is ` +
      `UNKNOWN and candidates are still ordered on price. This starts helping after roughly ${MIN_RUNS} runs of the ` +
      `same kind of work on the same model, with a person having decided at least ${MIN_HUMAN_CONFIRMATIONS} of them.`;

  return { pairs, rows, provenPairs, sufficient, sentence };
}

/**
 * Record what happened.
 *
 * WRITTEN AT THE MOMENT IT IS KNOWN, not reconstructed later. A router row is written when a call
 * completes; a human row when somebody decides an approval that traces back to a model. Both carry
 * their source, and the source is what stops one being mistaken for the other.
 *
 * IT NEVER THROWS INTO THE CALLER. Recording evidence must not be able to fail work that already
 * succeeded — but a failure to record is LOGGED, never swallowed, because an evidence table that
 * quietly stops being written is the worst of all the states this could be in.
 */
export async function recordOutcome(
  db: D1Database,
  row: {
    taskKind: string | null | undefined;
    modelId: string | null | undefined;
    outcome: JobOutcome;
    source: OutcomeSource;
    lane?: string | null;
    taskId?: string | null;
    usageId?: string | null;
    note?: string;
  },
): Promise<boolean> {
  const kind = String(row.taskKind ?? "").trim();
  const modelId = String(row.modelId ?? "").trim();
  if (!kind || !modelId) return false;

  try {
    await db
      .prepare(
        `INSERT INTO model_job_outcome (id, ts, task_kind, model_id, outcome, source, lane, task_id, usage_id, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newId("mjo"),
        Date.now(),
        kind,
        modelId,
        row.outcome,
        row.source,
        row.lane ?? null,
        row.taskId ?? null,
        row.usageId ?? null,
        (row.note ?? "").slice(0, 500),
      )
      .run();
    return true;
  } catch (err) {
    await logEvent(db, {
      level: "warn",
      scope: "router",
      event: "model_outcome_not_recorded",
      lane: row.lane ?? null,
      entityId: row.taskId ?? null,
      detail: { task_kind: kind, model_id: modelId, outcome: row.outcome, error: String((err as Error)?.message ?? err).slice(0, 200) },
    });
    return false;
  }
}

/**
 * A PERSON'S VERDICT, traced back to the model that did the work.
 *
 * `approvals.origin_id` names the task, and `routing_decisions` is the row this router already
 * writes for EVERY run — it carries the task, the intake kind and the model that was chosen, which
 * is exactly the three facts a verdict has to be attributed to. It is used here rather than
 * `tasks`, which has no kind column, and rather than `usage_ledger`, which has no intake kind.
 *
 * IF ANY LINK IS MISSING THIS RECORDS NOTHING rather than guessing. An outcome attributed to the
 * wrong model is worse than an outcome not attributed at all.
 */
export async function recordHumanVerdict(
  db: D1Database,
  args: { taskId: string | null | undefined; decision: "approved" | "rejected" | "deferred"; note?: string },
): Promise<boolean> {
  const taskId = String(args.taskId ?? "").trim();
  if (!taskId) return false;
  if (args.decision === "deferred") return false; // Not yet a verdict on the work.

  let row: { model_id: string | null; lane: string | null; intake_kind: string | null } | null = null;
  try {
    row = await db
      .prepare(
        `SELECT chosen_model_id AS model_id, lane, intake_kind
           FROM routing_decisions
          WHERE task_id = ? AND chosen_model_id IS NOT NULL AND intake_kind IS NOT NULL
          ORDER BY ts DESC LIMIT 1`,
      )
      .bind(taskId)
      .first();
  } catch {
    row = null;
  }
  if (!row?.model_id || !row.intake_kind) return false;

  return recordOutcome(db, {
    taskKind: row.intake_kind,
    modelId: row.model_id,
    outcome: args.decision === "approved" ? "succeeded" : "rejected",
    source: "human",
    lane: row.lane,
    taskId,
    note: args.note ?? `decided ${args.decision} in the approval inbox`,
  });
}
