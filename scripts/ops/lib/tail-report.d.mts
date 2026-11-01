export function sessionIdIn(log: string | null | undefined): string | null;
export function reportState(text: string | null | undefined): "complete" | "missing";
export interface RecoveryPlan { action: "none" | "resume" | "salvage"; sessionId?: string }
export function recoveryPlan(opts: { state: "complete" | "missing"; sessionId?: string | null; tried?: string[] }): RecoveryPlan;
