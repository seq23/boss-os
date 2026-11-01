/** Types for the pure morning-section rules. See morningSections.mjs. */
import type { MorningSection, MorningDecide } from "./morning.mjs";
export const MORNING_SECTIONS: readonly string[];
export interface MorningSectionSpec { name: string; label: string; expect: readonly string[] | null }
export const MORNING_SECTION_SPECS: readonly MorningSectionSpec[];
export const REPORT_IN_MS: number;
export function sectionsNotReported(sections: Record<string, MorningSection> | null | undefined, opts: { weekday: string; now?: number }): { sections: Record<string, MorningSection>; missing: Array<{ name: string; label: string }> };
export function notReportedLine(missing: Array<{ name: string; label: string }> | null | undefined): string | null;
export const STALE_MS: number;
export const APPEND_FRESH_MS: number;
export function morningSectionProblems(obj: unknown): string[];
export function appendToSection(prev: MorningSection | null, section: string, add: { lines?: MorningSection["lines"]; decide?: MorningDecide[] }, now?: number): MorningSection;
export function newerSections(...sources: Array<Record<string, MorningSection> | null | undefined>): Record<string, MorningSection>;
