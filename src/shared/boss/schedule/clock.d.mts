/** Types for Boss OS's own clock. See clock.mjs. */
export declare const CATCH_UP_MINUTES: number;
export interface WallParts { year: number; month: number; day: number; hour: number; minute: number; dow: number }
export declare function wallParts(ms: number, zone?: string): WallParts;
export declare function parseCron(cron: string): { zone: string; fields: string[] } | null;
export declare function cronFiresAt(cron: string, ms: number): boolean;
export declare function clockRows(manifest: unknown, repo?: string): Array<{ id: string; trigger: { event?: string; file?: string; crons?: string[] } }>;
export interface DueJob { id: string; event: string; file: string; due_at: number; key: string }
export declare function dueJobs(manifest: unknown, nowMs: number, opts?: { windowMinutes?: number; repo?: string }): DueJob[];
export declare function clockRowProblems(manifest: unknown, repo?: string): string[];
export declare function slotWords(slot: string): string;
export declare function nextSlotAt(slot: string, nowMs: number): number | null;
export declare function nextRunWords(slots: string[] | null | undefined, nowMs: number): string | null;
