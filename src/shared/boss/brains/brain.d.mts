/** Types for the brains module. See brain.mjs for the rules. */
export interface BrainMeta { slug: string; title: string }
export interface BrainRow { slug: string; title: string; body_md: string; updated_at: number; updated_by?: string | null }
export interface BrainEdit { slug: string; section: string; op: "add" | "replace" | "set_number"; lines: string[]; metric?: string; value?: string }
export interface ScoreRow { slug: string; business: string; metric: string | null; value: string | null; words: string; last_updated: string | null }
export const BRAINS: readonly BrainMeta[];
export const BRAIN_SLUGS: readonly string[];
export const RETIRED_BRAINS: Readonly<Record<string, string>>;
export function resolveBrainSlug(slug: string | null | undefined): string;
export function historySlugsFor(slug: string): string[];
export const NOT_A_BUSINESS: readonly string[];
export const BUSINESS_SLUGS: readonly string[];
export const PLAIN_DOCS: readonly string[];
export const TEAM_SLUG: string;
export const TEAM_PLACEHOLDER_LINE: string;
export function seedFor(slug: string, title: string): string;
export function whosWhoBlock(teamDoc: { body_md: string } | null | undefined, opts?: { keepConfidential?: boolean }): string;
export const SECTIONS: readonly string[];
export const MISSING: string;
export const NUMBERS_HEADER: string;
export const NUMBERS_RULE: string;
export const STALE_DAYS: number;
export function skeleton(title: string): string;
export function missingCount(md: string | null | undefined): number;
export function isStale(updatedAt: number, now?: number): boolean;
export function daysSince(updatedAt: number, now?: number): number;
export function updatedWords(updatedAt: number, now?: number): string;
export function parseSections(md: string): { head: string; sections: { name: string; body: string }[] };
export function joinSections(head: string, sections: { name: string; body: string }[]): string;
export function sectionBody(md: string, name: string): string | null;
export function replaceSection(md: string, name: string, body: string): string;
export function appendToSection(md: string, name: string, lines: string[]): string;
export function canonicalSection(name: string): string | null;
export function numbersRows(md: string): { metric: string; definition: string; source: string; value: string | null; last_updated: string | null }[];
export function setNumber(md: string, metric: string, value: string, day: string, opts?: { definition?: string | null; source?: string | null }): string;
export function scoreboardRows(brain: { slug: string; title: string; body_md: string }): ScoreRow[];
export const CONFIDENTIAL_OPEN: string;
export const CONFIDENTIAL_CLOSE: string;
export const PRIVATE_PLACEHOLDER: string;
export function hasConfidential(text: string | null | undefined): boolean;
export function stripConfidential(text: string | null | undefined): string;
export const EMPLOYEE_BRAINS: Readonly<Record<string, "all" | "all+personal" | string[]>>;
export function brainsFor(employeeId: string | null | undefined): { slugs: string[]; summarised: boolean };
export function brainBlock(brains: { slug: string; title: string; body_md: string }[], opts?: { summarised?: boolean; keepConfidential?: boolean }): string;
export function brainSlugFor(words: string): string | null;
export function parseBrainEdits(text: string, today?: string): BrainEdit[];
export function decisionLine(text: string, today: string): string;
export function applyEdit(md: string, edit: BrainEdit, today: string): string;
export function shortName(b: { slug: string; title: string }): string;
export function cohesionLine(brains: { slug: string; title: string; body_md: string; updated_at: number }[], now?: number): string;
export const MAC_CHECK_FIELDS: readonly string[];
export interface MacCheck {
  strays_moved?: { from: string; to: string }[];
  memory_index_lines?: number;
  memory_index_too_big?: boolean;
  repos_checked?: number;
  repos_missing_pointer?: string[];
  skills_checked?: number;
  skills_flagged?: { skill: string; phrase: string }[];
  copy_age_hours?: number | null;
  copy_restarted?: boolean;
  copy_fresh_after?: boolean;
  unchecked?: string[];
}
export function cohesionCheckLine(brains: { slug: string; title: string; body_md: string; updated_at: number }[], mac: MacCheck | null, now?: number): string;
export function staleBit(brains: { slug: string; title: string; updated_at: number }[], now?: number): string | null;
