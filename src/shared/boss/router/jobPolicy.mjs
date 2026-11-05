/**
 * A MODEL LIST FOR EACH JOB (owner approved, 4 Nov 2026). The defaults and the one filter rule, shared
 * by the router (src/worker/boss/router/policy.ts), the API (routes/models.ts) and the Settings screen.
 * The table is `model_job_policies` (migration 0337); its seed rows equal JOB_POLICY_DEFAULTS.
 */

export const CAPABILITY_TIERS = ["fast", "general", "frontier"];
export const ON_NO_MODEL = ["stop", "skip"];

/** The seeded defaults: what "Default" means on the Settings screen. */
export const JOB_POLICY_DEFAULTS = {
  meeting_prep: { label: "Meeting prep", allowed_model_ids: [], paid_allowed: 1, min_capability_tier: "general", on_no_model: "stop" },
  lp_reply: { label: "LP replies", allowed_model_ids: [], paid_allowed: 1, min_capability_tier: "general", on_no_model: "stop" },
  brand_draft: { label: "Brand drafts", allowed_model_ids: [], paid_allowed: 1, min_capability_tier: "general", on_no_model: "stop" },
  owner_email: { label: "Emails to you", allowed_model_ids: [], paid_allowed: 1, min_capability_tier: "general", on_no_model: "stop" },
  classify: { label: "Sorting and labels", allowed_model_ids: [], paid_allowed: 0, min_capability_tier: "fast", on_no_model: "skip" },
  summarise: { label: "Short summaries", allowed_model_ids: [], paid_allowed: 0, min_capability_tier: "fast", on_no_model: "skip" },
};

const tierRank = (t) => CAPABILITY_TIERS.indexOf(String(t ?? ""));

/** A stored row → the policy the router reads. Malformed lists read as [] (any), never as "none". */
export function readJobPolicy(row) {
  if (!row) return null;
  let allowed = [];
  try { const v = JSON.parse(row.allowed_model_ids ?? "[]"); if (Array.isArray(v)) allowed = v.map(String); } catch { allowed = []; }
  return {
    job_key: String(row.job_key),
    label: String(row.label ?? row.job_key),
    allowed_model_ids: allowed,
    paid_allowed: Number(row.paid_allowed) === 1 ? 1 : 0,
    min_capability_tier: CAPABILITY_TIERS.includes(row.min_capability_tier) ? row.min_capability_tier : "fast",
    on_no_model: row.on_no_model === "skip" ? "skip" : "stop",
  };
}

/**
 * Whether the job's policy lets this model run. `{ ok: true }` or `{ ok: false, reason }`. It only ever
 * REMOVES: a model it passes still has to pass every other rule.
 *   model: { id, display_name, capability_tier }   billed: whether this route charges money
 */
export function jobPolicyAllows(policy, model, billed) {
  if (!policy) return { ok: true };
  const name = model.display_name ?? model.id;
  if (policy.allowed_model_ids.length && !policy.allowed_model_ids.includes(model.id)) {
    return { ok: false, reason: `${name} is not on the model list for ${policy.label}` };
  }
  if (!policy.paid_allowed && billed) {
    return { ok: false, reason: `${name} costs money and ${policy.label} may use free models only` };
  }
  const have = tierRank(model.capability_tier);
  if (have < tierRank(policy.min_capability_tier)) {
    return { ok: false, reason: `${name} is a ${model.capability_tier ?? "unrated"} model and ${policy.label} needs at least ${policy.min_capability_tier}` };
  }
  return { ok: true };
}

/** Whether a stored policy equals its seeded default (the Settings screen says "Default"). */
export function isDefaultPolicy(p) {
  const d = JOB_POLICY_DEFAULTS[p?.job_key];
  if (!d) return false;
  return p.paid_allowed === d.paid_allowed && p.min_capability_tier === d.min_capability_tier && p.on_no_model === d.on_no_model
    && JSON.stringify([...p.allowed_model_ids].sort()) === JSON.stringify([...d.allowed_model_ids].sort());
}

/** A change from the screen, checked. `{ ok: true, value }` or `{ ok: false, error }`. */
export function validJobPolicyPatch(body, knownModelIds) {
  const out = {};
  if (body?.allowed_model_ids !== undefined) {
    if (!Array.isArray(body.allowed_model_ids) || !body.allowed_model_ids.every((x) => typeof x === "string")) return { ok: false, error: "The model list must be a list of models" };
    const unknown = body.allowed_model_ids.filter((x) => !knownModelIds.includes(x));
    if (unknown.length) return { ok: false, error: "One of those models is not registered" };
    out.allowed_model_ids = [...new Set(body.allowed_model_ids)];
  }
  if (body?.paid_allowed !== undefined) {
    if (![0, 1, true, false].includes(body.paid_allowed)) return { ok: false, error: "Paid models: yes or no" };
    out.paid_allowed = body.paid_allowed === true || body.paid_allowed === 1 ? 1 : 0;
  }
  if (body?.min_capability_tier !== undefined) {
    if (!CAPABILITY_TIERS.includes(body.min_capability_tier)) return { ok: false, error: "The weakest model allowed must be fast, general or frontier" };
    out.min_capability_tier = body.min_capability_tier;
  }
  if (body?.on_no_model !== undefined) {
    if (!ON_NO_MODEL.includes(body.on_no_model)) return { ok: false, error: "When no model fits: stop or skip" };
    out.on_no_model = body.on_no_model;
  }
  if (!Object.keys(out).length) return { ok: false, error: "Nothing to change" };
  return { ok: true, value: out };
}
