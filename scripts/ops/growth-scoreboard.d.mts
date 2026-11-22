export class Stop extends Error { exit: number; constructor(code: string, s: string, exit?: number); }
export function readAll(manifest: any, ctx: any, day: string): Promise<any[]>;
export function run(opts?: { env?: any; now?: number; fetchImpl?: typeof fetch; dry?: boolean; ctx?: any }): Promise<{ day: string; readings: any[]; read: number; unread: number }>;
