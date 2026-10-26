/** Types for Simone's Mac tick. See simone-commands.mjs. */
export const SUPABASE_KEY_NAME: string;
export function codeCalls(spec: Record<string, any>, base?: string): Array<{ method: string; url: string; prefer?: string; body?: Record<string, any> }>;
export function runCode(spec: Record<string, any>, o?: { key?: string; fetchImpl?: typeof fetch }): Promise<{ ok: true; done: boolean; already: boolean; missing: boolean; codes: Array<Record<string, any>> } | { ok: false; why: string }>;
export function lookupPrompt(spec: Record<string, any>): string;
export function draftPrompt(spec: Record<string, any>, o?: { changeNote?: string | null; previous?: string | null }): string;
export function noticeArgs(id: string, notice: Record<string, any>, to?: string): any;
export function errandPrompt(spec: Record<string, any>, now?: number): string;
export function buildErrand(json: Record<string, any> | null): { subject: string; request: string; text: string; problems: string[] };
