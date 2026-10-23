/** Types for the plain email layout. See plain.mjs for the rules. */
export type DetailItem = string | { heading: string };
export interface Button { label: string; url: string }
export interface DecideItem { title: string; body?: string; buttons?: Button[] }
export interface EmailSection {
  title: string; note?: string | null; boxed?: boolean; tone?: "done" | "decide" | null;
  items?: Array<string | { text: string; links?: Button[] }>;
  rows?: { columns: Array<{ key: string; label: string }>; data: Array<Record<string, unknown>> } | null;
  cards?: Array<DecideItem | string>;
  link?: Button | null;
  empty?: string | null;
}
export interface LaidOutEmail { subject: string; text: string; html: string; refs: string[]; kind: "plain" | "problem"; problems: string[] }
export const ACRONYMS: Set<string>;
export const JARGON: Array<{ ban: RegExp; find: RegExp; plain: string | ((...a: string[]) => string); sample: string }>;
export const REF_RE: RegExp;
export const DECIDE_HEADING: string;
export const NOTHING_TO_DECIDE: string;
export const PROBLEM_PARTS: { happened: string; did: string; status: string };
export const MAX_TEXT_CHARS: number;
export const MAX_SUBJECT_CHARS: number;
export const MAX_DECIDE: number;
export function clockWords(h: string | number, m: string | number): string;
export function utcClockWords(h: string | number, m: string | number, now?: number): string;
export function cleanText(input: unknown): string;
export function dedupeList(segment: string): string;
export function cleanSubject(input: unknown): string;
export function refsIn(text: unknown): string[];
export function linkLabel(url: string): string;
export function layoutEmail(input: {
  who: string; subject: string; happened: string; decide?: Array<DecideItem | string>; needs?: string[] | string;
  details?: DetailItem[]; sections?: EmailSection[]; refs?: string[]; footer?: string | null; postscript?: string | null; moreDecide?: string | null;
}): LaidOutEmail;
export function layoutProblem(input: {
  who: string; subject: string; happened: string; did: string; status?: string; done?: boolean; decide?: Array<DecideItem | string>; refs?: string[];
}): LaidOutEmail;
export function fromLegacy(input: { who: string; subject: string; text: string; refs?: string[] }): LaidOutEmail;
export function visibleText(input: { subject?: string; text?: string; html?: string | null }): string;
export function linksIn(input: { text?: string; html?: string | null }): string[];
export function plainProblems(input: { subject?: string; text?: string; html?: string | null; kind?: string | null }): string[];
export function lineProblems(line: unknown): string[];
