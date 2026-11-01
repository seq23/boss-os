// Types for scripts/ops/lib/schedule.mjs (the Schedule's guard). The manifest is loosely typed here on purpose: the guard checks its shape.
export type Slots = string[];
export interface CronFile { file: string; crons: string[]; gated?: Record<string, string[]> }
export const DAY_NAMES: string[];
export const LAUNCHD_FAMILIES: RegExp;
export function canonical(events: unknown[]): string[];
export function sameSlots(a: string[], b: string[]): boolean;
export function plistEvents(text: string, shift?: number): unknown[];
export function installerJobs(sh: string): Record<string, string[]>;
export function installedJobs(dir?: string, shift?: number): Record<string, string[]>;
export function dutySlots(d: Record<string, unknown>): string[];
export function cronEvents(cron: string, utcOffsetHours?: number): unknown[];
export function chicagoOffset(now?: Date): number;
export function gatedCrons(yaml: string): Record<string, string[]>;
export function activeCrons(f: { crons: string[]; gated?: Record<string, string[]> }, utcOffset?: number): string[];
export function workflowCrons(yaml: string): string[];
export function wranglerCrons(text: string): string[];
export function readSchedule(root: string): any;
export function shapeProblems(m: any): string[];
export function scheduleCategoryProblems(m: any, scanned?: string[], cats?: any): string[];
export function dutyProblems(m: any, duties: any[]): string[];
export function launchdProblems(m: any, jobs: Record<string, string[]>): string[];
export function missingLabels(m: any, jobs: Record<string, string[]>): string[];
export function cronProblems(m: any, repo: string, files: CronFile[], utcOffset?: number): string[];
export function repoCronFiles(repo: string, root: string, opts?: { fetch?: boolean; disabled?: Set<string> }): CronFile[] | null;
export function repoCronFilesApi(owner: string, repo: string): CronFile[];
export function scheduleRepoDir(repo: string, root: string): string | null;
export function disabledWorkflows(owner: string, repo: string): Set<string>;
export function candidateRepos(owner: string, keep?: string[]): string[];
export function displayWindow(t: string): { from: number; to: number } | null;
export function slotTimes(slot: string): Array<{ day: string; mins: number }>;
export function weekProblems(m: any): { problems: string[]; pending: string[] };

export function ghApiRetrying(p: string, o?: { run?: (args: string[]) => string; waitMs?: number; tries?: number }): any;
