/** Types for Simone's triage. See triage.mjs. */
export interface TriageSeat { id: string; name: string; role?: string | null; lane?: string; department?: string | null }
export interface TriageJob<S extends TriageSeat = TriageSeat> { seat: S; why: string; closest: boolean; ask: string; text: string }
export const TRIAGE_SEATS: ReadonlyArray<{ id: string; does: string; strong: RegExp; signals: RegExp }>;
export function scoreAsk(text: string): Array<{ id: string; score: number; matched: string[] }>;
export function seatForAsk<S extends TriageSeat>(text: string, roster: S[]): { seat: S; score: number; matched: string[]; closest: boolean; why: string } | null;
export function splitAsks(text: string): { context: string; parts: string[] };
export function triage<S extends TriageSeat>(input: { subject?: string; text?: string; roster?: S[] }): Array<TriageJob<S>>;
export function triageLines(jobs: Array<{ seat: TriageSeat; ask: string; closest: boolean }>): string[];
export function oneLine(s: string): string;
