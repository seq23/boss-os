/**
 * The airlock. One place that answers "may this leave, and may a hosted model see it?"
 *
 * Boss OS v20.1 §3 requires that LOCAL_ONLY material never reaches Claude, OpenAI, OpenRouter,
 * Fireworks, Workers AI or any other external inference provider, and never enters cloud D1, R2,
 * queues, exports, snapshots or the Firm OS bridge — "enforced technically, not merely by prompt
 * wording or an approval card". A rule that lives in a prompt is a request; this is a function
 * that throws.
 *
 * TWO AXES, ASKED SEPARATELY. Where a record may LIVE is not what may THINK about it. A meeting
 * capture can legitimately sit on a device its owner controls while still never being sent to a
 * hosted model, and the reverse — cloud-resident but model-forbidden — is just as real.
 *
 * FAILURE IS CLOSED, INCLUDING IGNORANCE. An entity nobody classified is not an open question to
 * be resolved later at the call site; it is a refusal (§11, "Unknown classification"). The one way
 * to make something shareable is to say so, in a migration, with a reason.
 */
import type { D1Database } from "@cloudflare/workers-types";

export type Residency = "CLOUD_SYNC" | "LOCAL_ONLY";
export type AiProcessing = "EXTERNAL_OK" | "EXTERNAL_WITH_APPROVAL" | "LOCAL_ONLY";

export interface Classification {
  residency: Residency;
  ai_processing: AiProcessing;
  /** Where the answer came from, so a refusal can explain itself. */
  source: "record" | "entity" | "unclassified";
  reason: string;
}

/**
 * Strictness order. Higher is tighter, and a per-record policy may only move UP.
 *
 * Without this a record override is a loophole rather than a control: anything able to write one
 * could turn a LOCAL_ONLY entity into a syncable one, which is precisely the "override that
 * converts a sovereign request into external inference" §3.3 forbids.
 */
const RESIDENCY_RANK: Record<Residency, number> = { CLOUD_SYNC: 0, LOCAL_ONLY: 1 };
const AI_RANK: Record<AiProcessing, number> = { EXTERNAL_OK: 0, EXTERNAL_WITH_APPROVAL: 1, LOCAL_ONLY: 2 };

/** The refusal. Carries what was asked and why it was refused, never the record itself. */
export class AirlockRefusal extends Error {
  constructor(
    readonly entity: string,
    readonly recordId: string | null,
    readonly axis: "residency" | "ai_processing",
    readonly classification: Classification,
    message: string,
  ) {
    super(message);
    this.name = "AirlockRefusal";
  }
}

const UNCLASSIFIED: Classification = {
  residency: "LOCAL_ONLY",
  ai_processing: "LOCAL_ONLY",
  source: "unclassified",
  reason:
    "No policy row exists for this entity. An unclassified record is refused rather than trusted, " +
    "so a table added without a classification fails closed instead of quietly syncing.",
};

export async function classify(db: D1Database, entity: string, recordId?: string | null): Promise<Classification> {
  const base = await db
    .prepare(`SELECT residency, ai_processing, reason FROM data_policy WHERE entity = ?1`)
    .bind(entity)
    .first<{ residency: Residency; ai_processing: AiProcessing; reason: string }>();
  if (!base) return UNCLASSIFIED;

  if (!recordId) {
    return { residency: base.residency, ai_processing: base.ai_processing, source: "entity", reason: base.reason };
  }

  const over = await db
    .prepare(`SELECT residency, ai_processing, reason FROM record_policy WHERE entity = ?1 AND record_id = ?2`)
    .bind(entity, recordId)
    .first<{ residency: Residency | null; ai_processing: AiProcessing | null; reason: string }>();
  if (!over) {
    return { residency: base.residency, ai_processing: base.ai_processing, source: "entity", reason: base.reason };
  }

  // Tightest of the two wins on each axis independently, so a stored override can never loosen.
  const residency =
    over.residency && RESIDENCY_RANK[over.residency] > RESIDENCY_RANK[base.residency] ? over.residency : base.residency;
  const ai =
    over.ai_processing && AI_RANK[over.ai_processing] > AI_RANK[base.ai_processing] ? over.ai_processing : base.ai_processing;
  return { residency, ai_processing: ai, source: "record", reason: over.reason };
}

/**
 * May this record be written to, or serialized towards, anything in the cloud domain?
 *
 * Cloud domain is D1, R2, KV, queues, cloud exports, cloud snapshots and the Firm OS bridge. The
 * refusal names the entity and never the content.
 */
export async function assertMayEnterCloud(db: D1Database, entity: string, recordId?: string | null): Promise<Classification> {
  const c = await classify(db, entity, recordId);
  if (c.residency === "LOCAL_ONLY") {
    throw new AirlockRefusal(
      entity,
      recordId ?? null,
      "residency",
      c,
      `LOCAL_ONLY — NOTHING TRANSMITTED. ${entity} may not enter the cloud domain. ${c.reason}`,
    );
  }
  return c;
}

/**
 * May a hosted model be shown this record?
 *
 * `approved` is a receipt the caller already holds, not a promise to obtain one — this function
 * never opens an approval, because a gate that can grant its own permission is not a gate.
 */
export async function assertMayReachExternalModel(
  db: D1Database,
  entity: string,
  recordId?: string | null,
  approved = false,
): Promise<Classification> {
  const c = await classify(db, entity, recordId);
  if (c.ai_processing === "LOCAL_ONLY") {
    throw new AirlockRefusal(
      entity,
      recordId ?? null,
      "ai_processing",
      c,
      `LOCAL_AI_ONLY — NOTHING TRANSMITTED. ${entity} may only be reasoned about by a local model. ${c.reason}`,
    );
  }
  if (c.ai_processing === "EXTERNAL_WITH_APPROVAL" && !approved) {
    throw new AirlockRefusal(
      entity,
      recordId ?? null,
      "ai_processing",
      c,
      `APPROVAL REQUIRED — NOTHING TRANSMITTED. ${entity} reaches an external model only with an approval on the record. ${c.reason}`,
    );
  }
  return c;
}

/**
 * Tighten one record below its entity default, and record that it happened.
 *
 * Only tightening exists. There is deliberately no loosen(): moving a record from LOCAL_ONLY to
 * CLOUD_SYNC is not a policy edit but a data-movement decision, and it belongs in a migration
 * where it can be reviewed, not in a request handler.
 */
export async function tighten(
  db: D1Database,
  args: {
    entity: string;
    recordId: string;
    residency?: Residency;
    ai_processing?: AiProcessing;
    reason: string;
    by: string;
  },
): Promise<Classification> {
  const before = await classify(db, args.entity, args.recordId);
  if (before.source === "unclassified") {
    throw new AirlockRefusal(args.entity, args.recordId, "residency", before, `${args.entity} is unclassified; classify the entity before tightening a record.`);
  }
  if (args.residency && RESIDENCY_RANK[args.residency] < RESIDENCY_RANK[before.residency]) {
    throw new AirlockRefusal(args.entity, args.recordId, "residency", before, "A record policy may only tighten. Loosening residency is a data-movement decision and belongs in a migration.");
  }
  if (args.ai_processing && AI_RANK[args.ai_processing] < AI_RANK[before.ai_processing]) {
    throw new AirlockRefusal(args.entity, args.recordId, "ai_processing", before, "A record policy may only tighten. Loosening AI processing is a data-movement decision and belongs in a migration.");
  }

  await db
    .prepare(
      `INSERT INTO record_policy (entity, record_id, residency, ai_processing, reason, set_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (entity, record_id) DO UPDATE SET
         residency = excluded.residency, ai_processing = excluded.ai_processing,
         reason = excluded.reason, set_by = excluded.set_by, set_at = unixepoch() * 1000`,
    )
    .bind(args.entity, args.recordId, args.residency ?? null, args.ai_processing ?? null, args.reason, args.by)
    .run();

  const after = await classify(db, args.entity, args.recordId);
  await db
    .prepare(
      `INSERT INTO policy_change_log (id, entity, record_id, from_residency, to_residency, from_ai, to_ai, reason, changed_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .bind(
      `pol_${crypto.randomUUID()}`,
      args.entity,
      args.recordId,
      before.residency,
      after.residency,
      before.ai_processing,
      after.ai_processing,
      args.reason,
      args.by,
    )
    .run();
  return after;
}
