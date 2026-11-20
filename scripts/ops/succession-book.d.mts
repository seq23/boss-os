export const DRIVE_TARGET: string;
export const MAX_BYTES: number;
export class Stop extends Error { code: string; exit: number; constructor(code: string, sentence: string, exit?: number); }
export function stripConfidential(text: unknown): string;
export function herWords(text: unknown): string;
export function table(head: string[], rows: unknown[][]): string;
export function fillBlocks(template: string, blocks: Record<string, string>): string;
export function section(md: string, name: string): string;
export function handoffBackups(handoff: unknown): string;
export function companyFacts(body: string, max?: number): string[];
export function brainsBlock(brains: any[]): string;
export function reposBlock(live: any[], mapRows: any[]): string;
export function categoriesBlock(cats: any): string;
export function accountsBlock(accounts: any): string;
export function socialBlock(social: any): string;
export function safetyProblems(md: string): string[];
export function buildBook(input: { template: string; brains: any[]; live: any[]; mapRows: any[]; cats: any; accounts: any; social: any; handoff: string; now?: Date }): string;
export function run(opts?: Record<string, unknown>): Promise<{ md: string; stored: boolean }>;
