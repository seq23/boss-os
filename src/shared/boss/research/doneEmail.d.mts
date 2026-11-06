/** Types for the research Done email. See doneEmail.mjs. */
export type DonePage = { title?: string | null; summary?: string | null; markdown?: string | null; sources?: unknown[] | null; gaps?: unknown[] | null; status?: string | null };
export function answerOf(markdown: string | null | undefined): string;
export function answerBlockOf(page: DonePage): string;
export const MAX_KEY_NUMBERS: number;
export const MAX_GAPS_NAMED: number;
export function keyNumbersOf(page: DonePage, max?: number): string[];
export function gapsLineOf(gaps: unknown[] | null | undefined, max?: number): string;
export function researchDoneParts(page: DonePage): {
  title: string; partial: boolean; answer: string; numbers: string[];
  gapCount: number; gapsLine: string; sourceCount: number;
};
export function researchDoneSubject(page: DonePage): string;
export function researchDoneLines(page: DonePage, url: string): string[];
export function researchDoneLayout(args: { who: string; subject: string; page: DonePage; url: string; refs?: string[] }): { subject: string; text: string; html: string; refs: string[]; kind?: string };
export function researchPageIdIn(text: string | null | undefined): string | null;
