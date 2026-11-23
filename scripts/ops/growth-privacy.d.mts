export const MIN_PROMPTS: number;
export const PERSONAL_MAIL_RE: RegExp;
export interface PrivateTerms { names: string[]; mails: string[] }
export function privateOnlyTerms(mds: Record<string, string | null>, alsoPublic?: string): PrivateTerms;
export function leaksIn(text: string, terms: PrivateTerms, known?: Set<string>): { private: number; mail: number };
export interface PrivacyRow { business: string; chars: number; private: number; mail: number; where: string[] }
export function checkPrompts(mds: Record<string, string | null>, opts?: { playbook?: string; today?: string }): { ok: boolean; exit: 0 | 1 | 2; stop: string | null; rows: PrivacyRow[]; prompts: number; terms: number };
