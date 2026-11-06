/** Loose types so tests can import this node script; the script itself is the authority. */
export function parseCsv(...args: any[]): any;
export function parseSentLog(...args: any[]): any;
export function kindOf(...args: any[]): any;
export function importRows(...args: any[]): any;
export function mime(...args: any[]): any;
export function interestedReply(...args: any[]): any;
export function supplyFrom(...args: any[]): any;
export function templateDecide(...args: any[]): any;
export function prospectsMorning(...args: any[]): any;
export function neverBounceCheck(emails: string[], opts?: { key?: string; fetchImpl?: any; cacheFile?: string }): Promise<{ verdicts: { email: string; result: string }[]; checked: number; marks: Record<string, number> }>;
export function verifyDue(api: { get: (u: string) => Promise<any>; post: (u: string, b: any) => Promise<any> }, opts?: { key?: string; fetchImpl?: any; cacheFile?: string }): Promise<{ verdicts: { email: string; result: string }[]; marks: Record<string, number> }>;
export function isSendDay(now?: number): boolean;
export const ADMIN_STEP: string;
export function token(scope?: string, opts?: { fetchImpl?: any; env?: Record<string, string | undefined> }): Promise<string>;
export function threadHeaders(readTok: string, threadId: string, opts?: { fetchImpl?: any }): Promise<{ messageId?: string | null; subject?: string | null; held?: string; stop?: string }>;
export function runVerdict(r: { due?: number; sent?: number; held?: string[]; stop?: string | null }): { stop: string | null; line: string | null };
