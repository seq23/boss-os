import type { LaidOutEmail } from "../../src/shared/boss/mail/plain.mjs";
export function dayOf(at: number): string;
export function timeOf(at: number, tz?: string | null): string;
export function dayWords(iso: string, opts?: { weekday?: boolean }): string;
export function bounceLine(b: { replaced?: number; dropped?: number; restarted?: string[]; restarts?: { business: string; why: string; sent_since: number }[] } | null): string | null;
export function briefingLines(briefing: unknown, today: string): string[] | null;
export function briefingLateLine(briefing: unknown, now: number, tz?: string | null): string;
export function briefingBelowLine(briefing: unknown): string | null;
export function briefingReady(briefing: unknown, today: string): boolean;
export const BRIEFING_CAP: { hour: number; minute: number };
export function briefingDecision(briefing: unknown, now: number, opts?: { inProgress?: boolean }): "send" | "wait" | "send_late";
export function briefingInProgress(tasks: unknown[] | null | undefined, now: number): boolean;
export const NOT_YET: number;
export function selfStartedWaiting(data: any): any[];
export function selfWaitingRepairs(waiting: any[], tasks?: any[]): { title: string; prompt: string }[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildDay(data: Record<string, unknown>, now?: number): LaidOutEmail & { dropped: string[]; digest: any; cuts: string[]; bytes: number; memory: { decide: Record<string, string>; done: string[]; still: Record<string, number>; loops: Record<string, number> }; yoursTold: string[]; teamNotes: string[] };
export function briefingFull(briefing: unknown): Array<{ heading: string; lines: unknown[] }>;
export function briefingSourceUrl(briefing: unknown): (n: number) => string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function prospectSection(a: any, now?: number, people?: any[]): any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function prospectDecisions(a: any, existingKeys?: Set<string>, now?: number): any[];
export function eightRaiseLine(credits: { used?: number; budget?: number; kept?: number; error?: string } | null): string | null;
export function itemId(kind: string, key: string): string;
export function itemUrl(day: string, id: string): string;
export function taskUrl(id: string): string;
export const BRIEFING_URL: string;
export const PROSPECTS_URL: string;
export const CHANNEL: string;
export function replyContext(text: string): string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function spiritSection(day: any, week: any, now?: number, lapseLine?: string | null, o?: { coach?: string | null; action?: string | null }): any;
export function ancestralLine(day: any): string | null;
export function valerieItems(feed: { items?: any[] } | null | undefined, now?: number): string[] | null;
export const SPIRIT_LINK_LABEL: string;
export function failedTaskLines(tasks: unknown[], now?: number): Array<{ id: string; text: string }>;
export const SPIRIT_URL: string;
export const EMAIL_HTML_BUDGET: number;
export const MAX_DEAL_ROWS: number;
export const MAX_FOUND_LINES: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CUT_ORDER: ReadonlyArray<[string, Record<string, any>]>;
export function lawLine(law: { n: number; title: string; text: string } | null | undefined): string | null;
export declare const oneLine: (t: string | null | undefined) => string;
export declare function carriedLines(carried: any[], opts: { shown?: Set<string>; keys?: Set<string>; today: string }): any[];
export const BRAINS_URL: string;
export const SCOREBOARD_URL: string;
export const SCOREBOARD_KEY_METRICS: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function brainsSectionFor(data: Record<string, unknown>, now?: number): any;
export function t2rGroupsSectionFor(data: Record<string, unknown>, now?: number): any;
export function qualitySectionFor(data: Record<string, unknown>, now?: number): any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scoreboardSectionFor(data: Record<string, unknown>, now?: number): any;
export function notReportedRepairs(missing: Array<{ name: string; label: string }> | null | undefined, tasks?: Array<{ title?: string; status?: string }>): Array<{ title: string; prompt: string }>;
export function dutyChangeCard(title: string, task: any, worker: string | null): { title: string; body: string } | null;
export function bossDecisions(data: Record<string, unknown>): Array<{ key: string; title: string; body: string; details?: string[]; buttons: any[]; priority: number }>;
export function theChange(words: unknown): string | null;
export const MAX_OPEN_LOOP_LINES: number;
export const MAX_BRIEFING_LINES: number;
export function plainSummary(a: any): string | null;
export function companyKey(name: unknown): string;
export function mergeDealRows<T extends Record<string, any>>(rows: T[]): T[];
export function read(api: { get: (p: string) => Promise<any> }, now: number): Promise<any>;
export const HEADLINE_CHARS: number;
export function headline(line: unknown): string;
// 18 Nov 2026 review (see your-day.mjs).
export function calendarItems(a: { events?: any[] | null; diary?: any[]; today: string; her?: string[]; tz?: string | null }): { at: number; text: string }[];
export function cardButtons(buttons: any[] | null | undefined, screen: string): { label: string; url: string }[];
export function onePerPerson<T>(rows: T[]): T[];
export function stillPreview(d: any): string;
export function publicFromBriefing(briefing: any, list?: any[]): { company: string; evidence: string }[];
export function neverMissTwice(missed: unknown, o?: { waiting?: number; oldestWait?: number; action?: string | null; deadline?: string; pressure?: string }): { line: string | null; banner: { tone: string; title: string; lines: string[] } | null };
export function gateLine(o: { gratitude?: string | null; action?: string | null; done?: boolean }): string | null;
export function gratitudeLine(o: { wins?: { sentence: string; theme: string }[]; herList?: string[]; fallback?: string | null; history?: any[]; today: string }): { sentence: string; theme: string } | null;
export function winsFrom(o: { lpRows?: any[]; prospects?: any; deals?: number; now?: number }): { sentence: string; theme: string }[];
export const INVENTED_DETAIL: RegExp;
export const MONEY_OR_OUTREACH: RegExp;
export function teamStopsLine(tasks: any[]): string | null;
