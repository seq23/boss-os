import type { LpReplyScan } from "./lp-positive.mjs";
type Outcome = { bounced: number; replied: number; optedOut: number; when: string | null; resumeOn: string | null };
type Lists = { optedOut?: string[]; replied?: unknown[]; bounced?: unknown[] };
type Counts = { optedOut: number; replied: number; bounced: number };
export function summarizeLpOutcomes(scan: LpReplyScan, known: Set<string>): { outcome: Map<string, Outcome>; pending: Set<string> };
export function outcomeCounts(lists: Lists): Counts;
export function worthEmailing(counts: Counts, last: Partial<Counts> | null): boolean;
export function outcomesOwner(optedOut: number, replied: number, bounced: number): { layout: "note"; why: string; act: string };
export function outcomesMail(counts: Counts): { subject: string; layout: { happened: string; details: string[] }; owner: ReturnType<typeof outcomesOwner> };
export function readOutcomeReplies(options: Parameters<typeof import("./lp-positive.mjs").scanLpReplies>[0], deps?: { scan?: typeof import("./lp-positive.mjs").scanLpReplies; limit?: number }): Promise<LpReplyScan>;
export function holdThenName(
  ids: { held?: string[]; unnamed?: string[] },
  deps: { save: (unnamed: string[]) => void; name?: (ids: string[]) => Promise<void> },
): Promise<string[]>;
