/** Types for archive-audit.mjs. See that file. */
export const STALE_DAYS: number;
export const OPEN_LOOPS_URL: string;
export const NOT_OURS_RE: RegExp;
export function dateIn(text: unknown): number | null;
export function daysSince(t: number, now: number): number;
export function kindOf(title: unknown): string;
export function handoffTodayDate(md: unknown): number | null;
export function citedBossFiles(mapMd: unknown): string[];
