/** Types for what the morning email already told her (morningMemory.mjs). */
export declare function jobFamily(title: unknown): string;
export declare function firstSentence(text: unknown): string;
export declare function failedDoneLine(task: any): string;
export declare function jobName(task: any): { name: string; quoted: boolean };
export declare function doneForYou(items: any[], opts?: { told?: Set<string>; max?: number }): { shown: any[]; more: number; keys: string[]; all: any[] };
export declare function decideLabel(d: any): string;
export declare function daysWaiting(d: any, firstShown: string | null | undefined, now: number): number;
export declare function thinDecideLine(d: any, firstShown: string | null | undefined, now: number): string;
export declare function splitRepeats(decide: any[], opts: { told?: Record<string, string>; today: string; now: number }): { full: any[]; thin: any[]; memory: Record<string, string> };
export declare function fixJobsToOpen(failed: any[], opts?: { tasks?: any[]; repoChanges?: any[]; told?: string[]; now?: number }): Array<{ id: string; family: string; task: any }>;
export declare function answeredUnderneath(key: unknown, sets?: { pending?: Set<string>; waiting?: Set<string> }): boolean;
export declare const MAX_SHOWINGS: number;
export declare function withinShowings<T extends { seenKey: string }>(rows: T[], seen?: Record<string, number>, max?: number): { shown: T[]; memory: Record<string, number> };
