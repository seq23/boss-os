export type Shape = "NEGATES" | "CONDITIONS" | "REPORTS" | "ASKS";
export const ALL_SHAPES: readonly Shape[];
export interface Sentence { text: string; start: number }
export function sentencesOf(text: string | null | undefined): Sentence[];
export function vetoOf(sentence: string, span?: { from: number; to: number } | null, shapes?: readonly Shape[]): Shape | null;
export function standingIn(sentence: string, re: RegExp, shapes?: readonly Shape[]): RegExpMatchArray | null;
export function stands(text: string | null | undefined, re: RegExp, shapes?: readonly Shape[]): boolean;
export function quoteStands(words: string | null | undefined, quote: string | null | undefined, shapes?: readonly Shape[]): boolean;
