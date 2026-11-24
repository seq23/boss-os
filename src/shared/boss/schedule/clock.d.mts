/** Types for Boss OS's own clock. See clock.mjs. */
export declare const CATCH_UP_MINUTES: number;
export declare const CENTRAL: "America/Chicago";
export declare function dateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat;
/** Epoch ms, a Date or an ISO string. */
export type Instant = number | string | Date;
export declare function formatIn(at: Instant, options?: Intl.DateTimeFormatOptions, zone?: string): string;
export declare function zoneOffsetMs(ms: number, zone?: string): number;
export interface WallClock { y: number; m: number; d: number; h: number; min: number; dow: number }
export declare function wallClock(at: Instant, zone?: string): WallClock;
export declare function instantAt(zone: string, y: number, m: number, d: number, h?: number, min?: number): number;
export declare function dayOf(at: Instant, zone?: string, days?: number): string;
export declare function startOfDay(at: Instant, zone?: string): number;
export declare function weekOf(at: Instant, zone?: string): string;
export declare function parseCron(cron: string): { zone: string; fields: string[] } | null;
export declare function cronFiresAt(cron: string, ms: number): boolean;
export declare function clockRows(manifest: unknown, repo?: string): Array<{ id: string; trigger: { event?: string; file?: string; crons?: string[] } }>;
export interface DueJob { id: string; event: string; file: string; due_at: number; key: string }
export declare function dueJobs(manifest: unknown, nowMs: number, opts?: { windowMinutes?: number; repo?: string }): DueJob[];
export declare function clockRowProblems(manifest: unknown, repo?: string): string[];
export declare function slotWords(slot: string): string;
export declare function nextSlotAt(slot: string, nowMs: number): number | null;
export declare function nextRunWords(slots: string[] | null | undefined, nowMs: number): string | null;
