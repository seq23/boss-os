/** Types for duty-kit.mjs. See that file. */
export type Reading = { key: string; state: string; line: string; [k: string]: unknown };
export const ORIGIN: string;
export const OWNER_TO: string;
export function statePath(name: string): string;
export function loadState(name: string): Record<string, any>;
export function saveState(name: string, state: unknown): void;
export function movedReadings(readings: Reading[], prev?: Record<string, string>): (Reading & { was: string | null })[];
export function stateMap(readings: Reading[]): Record<string, string>;
export function readNothingStop(readings: Reading[], code: string): string | null;
export function bossApi(fetchImpl?: typeof fetch): Promise<{ get(p: string): Promise<any>; post(p: string, b: unknown): Promise<any>; put(p: string, b: unknown): Promise<any> }>;
export function sendAs(who: string, msg: { subject: string; text: string; html?: string; to?: string }, fetchImpl?: typeof fetch): Promise<boolean>;
export function googleToken(scope: string, sub: string, fetchImpl?: typeof fetch): Promise<string>;
export function gmailHeaders(token: string, q: string, max?: number, fetchImpl?: typeof fetch): Promise<{ id: string; from: string; subject: string; date: string }[]>;
export function fromDomain(from: unknown): string;
export function askClaudeJson(prompt: string, opts?: Record<string, unknown>): { ok: true; json: any } | { ok: false; why: string };
