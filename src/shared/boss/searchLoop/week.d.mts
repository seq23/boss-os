/** Types for the search loop's weekly report reader (week.mjs). Loose on purpose: the shapes are JSON. */
export const LOOP_ARTIFACT: string;
export const LOOP_SCHEMA: string;
export const LOOP_ENGINE_REPO: string;
export const LOOP_MAX_AGE_DAYS: number;
export const PACE: Readonly<{ start: number; step: number; cap: number; min: number }>;
export const HELD_STATES: readonly string[];
export const NUMBER_FIELDS: readonly string[];
export function weekProblem(week: unknown, opts?: { now?: number; maxAgeDays?: number }): string | null;
export function weekFor(weeks: any[] | null | undefined, opts: { domain: string; repo?: string | null; now?: number; maxAgeDays?: number }): { week?: any; problem?: string; none?: true };
export function publishingOn(week: any): { ok: boolean; why: string };
export function paceOk(week: any): { ok: boolean; why: string };
export function checksRan(week: any): { ok: boolean; why: string };
export function aiMeasured(week: any): { ok: boolean; why: string };
export function loopLine(weeks: any[] | null | undefined, opts?: { actionWord?: string }): string | null;
