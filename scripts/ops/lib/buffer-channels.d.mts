export const API: string;
export interface LiveRead { channels?: { platform: string; handle: string }[]; error?: string }
export function expectedByKey(accounts: any): Map<string, { account: string; channels: any[] }>;
export function driftProblems(accounts: any, live: Map<string, LiveRead>): { problems: string[]; read: number; stop: string | null };
export function readChannels(token: string | undefined, fetchImpl?: typeof fetch): Promise<LiveRead>;
export function runBufferCheck(o: { accounts: any; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch }): Promise<{ problems: string[]; read: number; stop: string | null; census: string }>;
