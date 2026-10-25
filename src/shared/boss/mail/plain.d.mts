/** Types for the plain email layout. See plain.mjs for the rules. */
export type DetailItem = string | { heading: string };
export interface Button { label: string; url: string }
export interface DecideItem { title: string; body?: string; details?: string[]; draft?: { heading?: string; text: string } | null; buttons?: Button[] }
export interface ProseRun { text: string; bold?: boolean; cite?: Array<{ n: number; url: string | null }> }
export interface EmailSection {
  title: string; note?: string | null; boxed?: boolean; tone?: "done" | "decide" | null;
  items?: Array<string | { text?: string; runs?: ProseRun[]; links?: Button[] }>;
  full?: { summary?: string; blocks: Array<{ heading?: string; lines: Array<string | { runs: ProseRun[] }> }> } | null;
  rows?: { columns: Array<{ key: string; label: string }>; data: Array<Record<string, unknown>> } | null;
  cards?: Array<DecideItem | string>;
  link?: Button | null;
  empty?: string | null;
}
export interface LaidOutEmail { subject: string; text: string; html: string; refs: string[]; kind: "plain" | "problem" | "morning"; problems: string[] }
export const ACRONYMS: Set<string>;
export const JARGON: Array<{ ban: RegExp; find: RegExp; plain: string | ((...a: string[]) => string); sample: string }>;
export const REF_RE: RegExp;
export const DECIDE_HEADING: string;
export const NOTHING_TO_DECIDE: string;
export const PROBLEM_PARTS: { happened: string; did: string; status: string };
export const MAX_TEXT_CHARS: number;
export const MORNING_MAX_TEXT_CHARS: number;
export const PROSE_MARK: string;
export function proseRuns(line: string, sourceUrl?: (n: number) => string | null): ProseRun[];
export function proseText(runs: ProseRun[]): string;
export const MAX_SUBJECT_CHARS: number;
export const MAX_DECIDE: number;
export function clockWords(h: string | number, m: string | number): string;
export function utcClockWords(h: string | number, m: string | number, now?: number): string;
export function cleanText(input: unknown, opts?: { prose?: boolean }): string;
export function quotedSentence(words: unknown): string;
export function dedupeList(segment: string): string;
export function cleanSubject(input: unknown): string;
export function refsIn(text: unknown): string[];
export function linkLabel(url: string): string;
export function layoutEmail(input: {
  who: string; subject: string; happened: string; decide?: Array<DecideItem | string>; needs?: string[] | string;
  details?: DetailItem[]; sections?: EmailSection[]; refs?: string[]; footer?: string | null; postscript?: string | null; moreDecide?: string | null; maxDecide?: number; kind?: "plain" | "morning";
}): LaidOutEmail;
export function layoutProblem(input: {
  who: string; subject: string; happened: string; did: string; status?: string; done?: boolean; decide?: Array<DecideItem | string>; refs?: string[]; happenedLabel?: string;
}): LaidOutEmail;
export function fromLegacy(input: { who: string; subject: string; text: string; refs?: string[] }): LaidOutEmail;
export function visibleText(input: { subject?: string; text?: string; html?: string | null }, opts?: { prose?: "keep" | "drop" | "only" }): string;
export function linksIn(input: { text?: string; html?: string | null }): string[];
export function plainProblems(input: { subject?: string; text?: string; html?: string | null; kind?: string | null }): string[];
export function simplifyForOwner(input: { subject?: string; text?: string; html?: string | null; kind?: string | null }): { subject: string; text: string; html: string; kind: string | null; details: string[] };
export function lineProblems(line: unknown): string[];
export function gmailSearchLink(subject: string): string;
