export const MAX_WORDS_PER_LINE: number;
export const CODE_WORDS: readonly string[];
export function ownerTextProblems(text: unknown): string[];
export function plainSentence(s: unknown): string | null;
export const STOCK: Readonly<Record<string, { broke: string; did: string }>>;
export function dayWords(ms: number): string;
export function repairReport(input: { kind: string | null | undefined; whatBroke?: unknown; whatWeDid?: unknown; live: boolean; at?: number; who?: string }): { subject: string; whatBroke: string; whatWeDid: string; status: string; text: string };
