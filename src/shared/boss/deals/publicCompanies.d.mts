/** Types for publicCompanies.mjs. See that file. */
export interface PublicRow { company: string; since: string | null; evidence: string | null; via: string | null }
export const PUBLIC_SEED: readonly PublicRow[];
export function companyNorm(name: unknown): string;
export function publicList(stored?: unknown): PublicRow[];
export function isPublicCompany(name: unknown, list?: ReadonlyArray<PublicRow | string>): boolean;
export function publicFromHeadline(text: unknown): string | null;
export function publicFromReply(line: unknown): string | null;
