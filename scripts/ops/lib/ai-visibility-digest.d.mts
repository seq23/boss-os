export const TOOL_PREFIX: string;
export function textOf(response: unknown): string;
export function parsed(response: unknown): { error?: string; body?: any; data?: any };
export function statusOf(row: any): "answered" | "no_answer" | "failed";
export function digestFor(tool: string, response: unknown): any;
export function weekFromStash(rows: any[], site: string): { block?: any; stop?: string; why?: string };
export function stashRows(text: string): { rows: any[]; bad: number };
