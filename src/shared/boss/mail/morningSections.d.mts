/** Types for the pure morning-section rules. See morningSections.mjs. */
import type { MorningSection, MorningDecide } from "./morning.mjs";
export const MORNING_SECTIONS: readonly string[];
export const STALE_MS: number;
export const APPEND_FRESH_MS: number;
export function morningSectionProblems(obj: unknown): string[];
export function appendToSection(prev: MorningSection | null, section: string, add: { lines?: MorningSection["lines"]; decide?: MorningDecide[] }, now?: number): MorningSection;
export function newerSections(...sources: Array<Record<string, MorningSection> | null | undefined>): Record<string, MorningSection>;
