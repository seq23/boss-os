/** Types for the capital chain's unfinished-run marker (chainMark.mjs). Loose on purpose: the shape is JSON. */
export const UNFINISHED_PATH: string;
export const MAX_RESUMES: number;
export type ChainMarkRecord = { chain: string; day: string; pid: number; started_at: string; attempts: number };
export function resumeDecision(args: { record?: ChainMarkRecord | null; today: string; pidAlive: boolean; now?: number }): { action: "none" | "wait" | "resume" | "stale"; reason: string };
