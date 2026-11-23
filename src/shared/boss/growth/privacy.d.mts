export const PERSONAL_MAIL_RE: RegExp;
export function wordsOf(text: string): Set<string>;
export interface PrivateTerms { names: string[]; mails: string[] }
export function privateOnlyTerms(mds: Record<string, string | null>, alsoPublic?: string): PrivateTerms;
export function termCount(terms: PrivateTerms | null | undefined): number;
export function leaksIn(text: string, terms: PrivateTerms, known?: Set<string>): { private: number; mail: number };
type Prompt = { messages: { role: string; content: string }[]; left?: string[] };
type Group = { heading: string; body: string };
export function promptLeak(args: { fit: Prompt; bare: Prompt; rulings: { own?: Group[]; shared?: Group[] } | null; terms: PrivateTerms | null }): { unread: boolean; private: number; mail: number; where: string[] };
