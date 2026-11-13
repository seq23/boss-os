/**
 * A MODEL LIST FOR EACH JOB (owner approved, 4 Nov 2026). The defaults and the one filter rule, shared
 * by the router (src/worker/boss/router/policy.ts), the API (routes/models.ts) and the Settings screen.
 * The table is `model_job_policies` (migration 0337); its seed rows equal JOB_POLICY_DEFAULTS.
 */

export const CAPABILITY_TIERS = ["fast", "general", "frontier"];
export const ON_NO_MODEL = ["stop", "skip"];

/** Meeting-prep writers, in the order she wants them: the next free Gemini models, then OpenRouter free. */
export const MEETING_PREP_WRITERS = [
  "mdl_gemini_38_flash_free", "mdl_gemini_36_flash_free", "mdl_gemini_3_flash_preview_free",
  "mdl_or_nemotron_ultra_free", "mdl_or_deepseek_v4_free", "mdl_or_nemotron_super_free", "mdl_or_llama33_free",
];

/** Google-grounded search may ask every free Gemini model; the key's answers decide which still work (0364). */
export const GROUNDED_SEARCH_MODELS = [
  "mdl_gemini_25_flash_free", "mdl_gemini_38_flash_free", "mdl_gemini_36_flash_free",
  "mdl_gemini_3_flash_preview_free", "mdl_gemini_35_flash_lite_free", "mdl_gemini_31_flash_lite_free",
];

/** The seeded defaults: what "Default" means on the Settings screen. */
export const JOB_POLICY_DEFAULTS = {
  meeting_prep: { label: "Meeting prep", allowed_model_ids: [], paid_allowed: 1, min_capability_tier: "general", on_no_model: "stop" },
  lp_reply: { label: "LP replies", allowed_model_ids: [], paid_allowed: 1, min_capability_tier: "general", on_no_model: "stop" },
  brand_draft: { label: "Brand drafts", allowed_model_ids: [], paid_allowed: 1, min_capability_tier: "general", on_no_model: "stop" },
  owner_email: { label: "Emails to you", allowed_model_ids: [], paid_allowed: 1, min_capability_tier: "general", on_no_model: "stop" },
  classify: { label: "Sorting and labels", allowed_model_ids: [], paid_allowed: 0, min_capability_tier: "fast", on_no_model: "skip" },
  summarise: { label: "Short summaries", allowed_model_ids: [], paid_allowed: 0, min_capability_tier: "fast", on_no_model: "skip" },
  // Meeting-prep research (migration 0338): Google-grounded on the free gemini-2.5-flash; else the
  // guest's fetched pages, written by a free Gemini 3 Flash. A named stop when neither can run.
  // 0354: 2.5-flash retires 1 Dec 2026, so the writer walks the next free Gemini, then OpenRouter free.
  meeting_prep_search: { label: "Meeting prep: Google search", allowed_model_ids: GROUNDED_SEARCH_MODELS, paid_allowed: 0, min_capability_tier: "fast", on_no_model: "stop" },
  meeting_prep_write: { label: "Meeting prep: writing from their pages", allowed_model_ids: MEETING_PREP_WRITERS, paid_allowed: 0, min_capability_tier: "general", on_no_model: "stop" },
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
