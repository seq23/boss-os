export const DRIVE_FOLDER: string;
export const DRIVE_TARGET: string;
export const DRIVE_DOC_NAME: string;
export const MAX_BYTES: number;
export class Stop extends Error { code: string; exit: number; constructor(code: string, sentence: string, exit?: number); }
export function herWords(text: unknown): string;
export function table(head: string[], rows: unknown[][]): string;
export function fillBlocks(template: string, blocks: Record<string, string>): string;
export function repoCategory(name: string, cats: any, mapRow?: any): string;
export function reposBlock(live: any[], mapRows: any[], cats: any): string;
export function appsBlock(spryBody: unknown): string;
export function domainsBlock(domains: any): string;
export function socialBlock(social: any): string;
export function safetyProblems(md: string): string[];
export function mdToHtml(md: string, title: string): string;
export function buildBook(input: { template: string; live: any[]; mapRows: any[]; cats: any; domains: any; social: any; spryBody?: string; now?: Date }): string;
export function run(opts?: Record<string, unknown>): Promise<{ md: string; stored: boolean }>;
