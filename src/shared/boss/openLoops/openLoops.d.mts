/** Types for the pure Open Loops rules. See openLoops.mjs. */
export interface Loop {
  id: string; title: string; finish_line: string; next_step: string | null; owner: string; next_date: string | null;
  business: string; section: "not_finished" | "parked"; status: "open" | "closed"; closed_reason: string | null; closed_at: number | null;
  source: string; source_key: string | null; blocked_by: string | null; repair_for: string | null; created_at: number; updated_at: number;
}
export const SECTIONS: readonly string[];
export const SOURCES: readonly string[];
export const OWNER_WORDS: readonly string[];
export const HER: string;
export const REPAIR_AFTER_DAYS: number;
export const PAGE_PATH: string;
export function isOwner(o: unknown): boolean;
export function isDay(d: unknown): boolean;
export function daysBetween(a: string, b: string): number;
export function isOverdue(loop: Partial<Loop> | null | undefined, today: string): boolean;
export function visibleLoops<T extends Partial<Loop>>(loops: T[] | null | undefined): { shown: T[]; waiting: number };
export function sortLoops<T extends Partial<Loop>>(loops: T[] | null | undefined, today: string): T[];
export function groupLoops<T extends Partial<Loop>>(loops: T[] | null | undefined, order: readonly string[], today: string): Array<{ key: string; rows: T[] }>;
export function ownerWords(owner: string, names?: Record<string, string>): string;
export function dayWords(d: string | null | undefined): string;
export function morningSection(loops: Partial<Loop>[], today: string, opts?: { origin?: string; names?: Record<string, string> }): { title: string; lines: Array<{ text: string; links: Array<{ label: string; url: string }> }>; link: { label: string; url: string } };
export function repairsDue<T extends Partial<Loop>>(loops: T[] | null | undefined, today: string): T[];
export function loopProblems(b: unknown, opts?: { partial?: boolean; slugs?: readonly string[] }): string[];
export function sourceKeyOf(repo: unknown, stop: unknown): string | null;
