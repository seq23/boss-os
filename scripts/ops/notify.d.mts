export interface EmployeeSender { from: string; key: string | undefined; reply_to: string; tag: string | null; fallback?: boolean }
export type FallbackSender = (who: { label: string; local: string; tag: string | null }) => EmployeeSender;
export const FALLBACK_FROM: string;
export const FALLBACK_STOP: string;
export function sendersFor(who: string | null | undefined, opts?: { fallback?: FallbackSender }): EmployeeSender[];
export function employeeMail(
  sender: EmployeeSender,
  msg: { to: string | string[]; subject: string; text: string; html?: string; files?: Array<{ name: string; bytes: number; path?: string | null; drive_url?: string | null }> },
): { from: string; to: string[]; reply_to: string; subject: string; text: string; html?: string; attachments?: Array<{ filename: string; content: string }> };
export function filesAt(paths: readonly string[]): Array<{ name: string; bytes: number; path: string | null }>;
export const EMPLOYEE_LOCAL_PARTS: string[];
