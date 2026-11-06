export type Tier = "fast" | "general" | "frontier";
export interface JobPolicy { job_key: string; label: string; allowed_model_ids: string[]; paid_allowed: 0 | 1; min_capability_tier: Tier; on_no_model: "stop" | "skip" }
export const CAPABILITY_TIERS: Tier[];
export const ON_NO_MODEL: Array<"stop" | "skip">;
export const JOB_POLICY_DEFAULTS: Record<string, Omit<JobPolicy, "job_key">>;
export function readJobPolicy(row: any): JobPolicy | null;
export function jobPolicyAllows(policy: JobPolicy | null | undefined, model: { id: string; display_name?: string; capability_tier?: string }, billed: boolean): { ok: true } | { ok: false; reason: string };
export function isDefaultPolicy(p: JobPolicy): boolean;
export function validJobPolicyPatch(body: any, knownModelIds: string[]): { ok: true; value: Partial<JobPolicy> } | { ok: false; error: string };
