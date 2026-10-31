import type { LaidOutEmail } from "../../src/shared/boss/mail/plain.mjs";
export function dayOf(at: number): string;
export function timeOf(at: number): string;
export function dayWords(iso: string, opts?: { weekday?: boolean }): string;
export function bounceLine(b: { replaced?: number; dropped?: number; restarted?: string[] } | null): string | null;
export function briefingLines(briefing: unknown, today: string): string[] | null;
export function briefingReady(briefing: unknown, today: string): boolean;
export const BRIEFING_CAP: { hour: number; minute: number };
export const BRIEFING_POLL_MS: number;
export function briefingDecision(briefing: unknown, now: number): "send" | "wait" | "send_late";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildDay(data: Record<string, unknown>, now?: number): LaidOutEmail & { dropped: string[]; digest: any; cuts: string[]; bytes: number; memory: { decide: Record<string, string>; done: string[] }; yoursTold: string[] };
export function briefingFull(briefing: unknown): Array<{ heading: string; lines: unknown[] }>;
export function briefingSourceUrl(briefing: unknown): (n: number) => string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function prospectSection(a: any, now?: number): any;
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
export function spiritSection(day: any, week: any, now?: number): any;
export function ancestralLine(day: any): string | null;
export function valerieItems(feed: { items?: any[] } | null | undefined, now?: number): string[] | null;
export const SPIRIT_LINK_LABEL: string;
export function failedTaskLines(tasks: unknown[], now?: number): Array<{ id: string; text: string }>;
export const SPIRIT_URL: string;
export const EMAIL_HTML_BUDGET: number;
export const MAX_DEAL_ROWS: number;
export const MAX_FOUND_LINES: number;
export const MAX_PROSPECT_SENDS: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CUT_ORDER: ReadonlyArray<[string, Record<string, any>]>;
