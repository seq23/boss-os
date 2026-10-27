export interface EmployeeSender { from: string; key: string | undefined; reply_to: string; tag: string | null; name?: string; fallback?: boolean }
export type FallbackSender = (who: { label: string; local: string; tag: string | null }) => EmployeeSender;
export const FALLBACK_FROM: string;
export const FALLBACK_STOP: string;
export function sendersFor(who: string | null | undefined, opts?: { fallback?: FallbackSender }): EmployeeSender[];
export function employeeMail(
  sender: EmployeeSender,
  msg: {
    to: string | string[]; subject: string; text?: string; html?: string; refs?: string[];
    files?: Array<{ name: string; bytes: number; path?: string | null; drive_url?: string | null }>;
    layout?: { happened: string; needs?: string[]; details?: Array<string | { heading: string }>; sections?: unknown[]; footer?: string | null } | null;
    prelaid?: { subject: string; text: string; html: string; refs: string[] } | null;
    context?: string | null;
    /** Message-IDs this answers, oldest first: In-Reply-To the newest, References all. */
    thread?: string[];
  },
): { from: string; to: string[]; reply_to: string; subject: string; text: string; html: string; headers?: Record<string, string>; attachments?: Array<{ filename: string; content: string }> };
export function postEmployeeMail(sender: EmployeeSender, payload: ReturnType<typeof employeeMail>, fetchImpl?: typeof fetch, opts?: { context?: string | null }): Promise<Response>;
export function sendAsEmployee(who: string, msg: Parameters<typeof employeeMail>[1], fetchImpl?: typeof fetch): Promise<{ ok: boolean; id?: string | null; from?: string; fallback?: boolean; error?: string }>;
export function namesOnce(names: readonly string[]): string;
export function filesAt(paths: readonly string[]): Array<{ name: string; bytes: number; path: string | null }>;
export const EMPLOYEE_LOCAL_PARTS: string[];
export const FUND_SIDE_CHASSIS_SENDERS: string[];
export function mailGate(payload: { subject?: string; text?: string; html?: string; headers?: Record<string, string> }): string[];
export function heldDir(): string;
export function holdMail(sender: EmployeeSender, payload: ReturnType<typeof employeeMail>, problems: string[], fetchImpl?: typeof fetch): Promise<Response>;

export function plainOrSimplified(payload: any): { payload: any; simplified: string[] | null; held: string[] | null };
export const ERRAND_FROM: string;
export const ERRAND_REPLY_TO: string;
export function errandMail(i: { to: string; subject: string; text: string; cc?: string[]; inReplyTo?: string | null }): { from: string; to: string[]; reply_to: string; subject: string; text: string; cc?: string[]; headers?: Record<string, string> };
export function errandPayloadProblems(p: Record<string, any>, o?: { owner?: string }): string[];
export function postErrandMail(payload: Record<string, any>, fetchImpl?: typeof fetch, o?: { key?: string; commandId?: string | null }): Promise<{ ok: true; id: string } | { ok: false; error: string }>;

export function archiveSentMail(payload: Record<string, any>, id: string, fetchImpl?: typeof fetch, opts?: { commandId?: string | null; key?: string | null }): Promise<boolean>;
export function flushSentMail(fetchImpl?: typeof fetch, directory?: string): Promise<boolean>;
