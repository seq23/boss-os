/** Types for the owner's duty edits. See ownerEdits.mjs. */
export const DUTY_PROMPT_FILES: Readonly<Record<string, string>>;
export const DAY_NAMES: readonly string[];
export interface ScheduleChoice { key: string; label: string }
export interface ScheduleRow {
  cadence: string; weekday?: number | null; weekdays?: string | number[] | null;
  local_hour?: number; local_minute?: number; executor?: string | null; mac_tick?: string | null;
}
export function allChoices(): ScheduleChoice[];
export function choiceOf(row: ScheduleRow): string;
export function scheduleFromChoice(key: string): { cadence: "daily" | "weekly" | "monthly"; weekday: number | null; weekdays: string | null } | null;
export function scheduleWords(row: ScheduleRow): string;
export function choicesFor(duty: ScheduleRow): ScheduleChoice[];
export function timeEditable(duty: { executor?: string | null }): boolean;
export function localDate(timeZone: string, at: number): string;
export function macDueToday(d: { next_due_at: number | null; timezone: string }, now: number): boolean;
export interface DutyBrief {
  duty_id: string; paused: boolean; removed: boolean; owner_schedule: boolean; due: boolean; reason: string;
  instructions: string | null; version: number | null;
}
export function briefDecision(brief: DutyBrief, opts?: { onlyIfDue?: boolean }): { run: boolean; code: 0 | 10; line: string; instructions?: string | null };
