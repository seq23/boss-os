/** Types for the plain email layout. See plain.mjs for the rules. */
export type DetailItem = string | { heading: string };
export interface EmailSection { title: string; note?: string | null; items: string[]; empty?: string; boxed?: boolean }
export interface LaidOutEmail { subject: string; text: string; html: string; refs: string[] }
export const ACRONYMS: Set<string>;
export const JARGON: Array<{ ban: RegExp; find: RegExp; plain: string | ((...a: string[]) => string) }>;
export const REF_RE: RegExp;
export const NOTHING_NEEDED: string;
export const NEEDS_HEADING: string;
export function clockWords(h: string | number, m: string | number): string;
export function cleanText(input: unknown): string;
export function dedupeList(segment: string): string;
export function cleanSubject(input: unknown): string;
export function refsIn(text: unknown): string[];
export function layoutEmail(input: {
  who: string; subject: string; happened: string; needs?: string[] | string; details?: DetailItem[];
  sections?: EmailSection[]; refs?: string[]; footer?: string | null;
}): LaidOutEmail;
export function fromLegacy(input: { who: string; subject: string; text: string; refs?: string[] }): LaidOutEmail;
export function visibleText(input: { subject?: string; text?: string; html?: string | null }): string;
export function plainProblems(input: { subject?: string; text?: string; html?: string | null }): string[];
