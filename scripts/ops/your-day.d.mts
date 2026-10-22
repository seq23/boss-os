import type { LaidOutEmail } from "../../src/shared/boss/mail/plain.mjs";
export function dayOf(at: number): string;
export function timeOf(at: number): string;
export function dayWords(iso: string, opts?: { weekday?: boolean }): string;
export function buildDay(data: Record<string, unknown>, now?: number): LaidOutEmail;
export function buildWeek(data: Record<string, unknown>, now?: number): LaidOutEmail;
export function replyContext(text: string): string;
