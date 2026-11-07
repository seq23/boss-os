/** Types for task-notices.mjs. See that file. */
import type { LaidOutEmail } from "../../src/shared/boss/mail/plain.mjs";
export const STOPPED_STATES: Set<string>;
export function stillStopped(task: { status?: string } | null): boolean;
export function mergeNotices<T extends { from_name: string; subject: string }>(items: T[]): Array<{ first: T; also: T[] }>;
export function stoppedEmail(notice: { from_name: string; subject: string; body: string; task_id?: string }, task?: { title?: string } | null): LaidOutEmail;
export function sendNotice(notice: unknown, opts?: { fetchImpl?: typeof fetch; to?: string; task?: unknown }): Promise<string | null>;
export function askOrResolve(notice: unknown, opts?: unknown): Promise<{ resolved: boolean; body: string | null; searched?: string }>;
export function researchDoneEmail(notice: { kind?: string; from_name?: string; task_id?: string; subject: string; body: string }, page: unknown, who?: string): { subject: string; text: string; html: string; refs: string[]; kind?: string } | null;
export const GATE_HOLD: string;
export function gateHoldOf(status: number, text: string): string | null;
export function isGateHold(error: unknown): boolean;
export const ON_PAGE: string;
