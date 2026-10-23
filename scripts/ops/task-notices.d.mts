/** Types for task-notices.mjs. See that file. */
import type { LaidOutEmail } from "../../src/shared/boss/mail/plain.mjs";
export const STOPPED_STATES: Set<string>;
export function stillStopped(task: { status?: string } | null): boolean;
export function mergeNotices<T extends { from_name: string; subject: string }>(items: T[]): Array<{ first: T; also: T[] }>;
export function stoppedEmail(notice: { from_name: string; subject: string; body: string; task_id?: string }, task?: { title?: string } | null): LaidOutEmail;
export function sendNotice(notice: unknown, opts?: { fetchImpl?: typeof fetch; to?: string; task?: unknown }): Promise<string | null>;
export function askOrResolve(notice: unknown, opts?: unknown): Promise<{ resolved: boolean; body: string | null; searched?: string }>;
