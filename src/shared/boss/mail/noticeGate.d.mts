/** Types for the one email-or-page gate. See noticeGate.mjs. */
export const EMAIL_KINDS: readonly string[];
export const PAGE_KINDS: readonly string[];
export function needsHer(n?: { kind?: string | null; mailedByHer?: boolean }): boolean;
export function emailsHer(notice: { needs_her?: number | boolean | string | null } | null | undefined): boolean;
export const UPDATES_DAYS: number;
export const UPDATES_PATH: string;
export interface UpdatesSummary { updates: number; reminders: number; unread: number }
export function updatesSummary(rows: Array<{ kind: string; read_at: number | null }> | null | undefined): UpdatesSummary;
export function updatesLine(summary: { updates: number; reminders: number } | null | undefined): string | null;
export function updateLink(row: { kind?: string; task_id?: string; body?: string } | null | undefined): string;
export interface UpdateRow { id: string; kind: string; from: string; title: string; line: string; at: number; read_at: number | null; link: string }
export function updateRow(row: Record<string, unknown> | null | undefined): UpdateRow;
