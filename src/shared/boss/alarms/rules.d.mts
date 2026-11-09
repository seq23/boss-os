/** Types for Kendra's pure alarm rules. See rules.mjs. */
export declare const KENDRA: "emp_continuity";
export declare const DEFAULT_OUTPUT_RUNS: number;
export declare function parseOutputLine(text: unknown): { count: number; metric: string } | null;
export declare function outputLine(count: number, metric: string): string;

export interface FloorRun { outcome?: string; output_count?: number | null; finished_at?: number }
export interface FloorDuty { name?: string; output_metric?: string | null; output_floor?: number | null; output_runs?: number | null }
export interface FloorVerdict { alarm: boolean; low: number; needed: number; newest: FloorRun | null }
export declare function runIsLow(run: FloorRun, floor: number | null | undefined): boolean;
export declare function floorVerdict(duty: FloorDuty, runs: FloorRun[]): FloorVerdict;
export declare function producedWords(run: FloorRun | null, metric: string): string;
export declare function floorAlarmText(duty: FloorDuty & { name: string }, verdict: FloorVerdict): string;

export declare function centralDay(ms: number, days?: number): string;
export declare function firstRunLoop(job: { id: string; name: string; created_at: number; output_metric?: string | null; output_floor?: number | null }): {
  source_key: string; title: string; finish_line: string; next_step: string; owner: string; next_date: string;
};
export declare function firstRunMet(run: FloorRun | null | undefined, floor: number | null | undefined): boolean;

export declare const STALE_ABSOLUTE_MS: number;
export declare const USUAL_MIN_SAMPLES: number;
export declare const STALE_FLOOR_MS: number;
export declare function usualDuration(durations: number[]): number | null;
export declare const POLL_WINDOW: readonly [number, number];
export declare const NEVER_CLAIMED_POLLING_MS: number;
export declare function pollingHoursMs(from: number, to: number): number;
export interface StaleVerdict {
  stale: boolean;
  why: "twice_usual" | "no_progress" | "never_claimed" | "waiting_for_seat" | "fine" | "not started";
  age?: number; quiet?: number; usualMs?: number; waited?: number; polling?: number;
}
export declare function staleTaskVerdict(
  task: { started_at: number | null; claimed_at?: number | null; parked?: boolean; parked_at?: number | null; last_progress_at?: number | null },
  usualMs: number | null, now: number,
): StaleVerdict;
export declare function staleTaskText(task: { title: string; seat?: string | null; parked_on?: string | null }, verdict: StaleVerdict): string;

export declare const MAIL_FAILS_IN_A_ROW: number;
export declare function errorClass(detail: unknown): string;
export declare function subjectKind(subject: unknown): string;
export interface MailAttempt { app: string; subject: string; ok: boolean; detail?: string | null; at: string }
export interface MailVerdict { key: string; app: string; subject: string; errorClass: string; fails: number; last_at: string; hers: boolean }
export declare function appSlug(app: unknown): string;
export declare function shortHash(s: string): string;
export declare function mailSeriesKey(app: string, subject: unknown): string;
export declare function ownerMailVerdicts(attempts: MailAttempt[]): MailVerdict[];
export declare function ownerMailText(v: MailVerdict): string;
