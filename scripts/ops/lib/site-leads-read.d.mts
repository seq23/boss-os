/** Types for the leads reader (site-leads-read.mjs). */
export function rumCount(ctx: any, params: { host: string; paths: string[]; referer_host?: string }, from: number, to: number): Promise<number>;
export function readLeads(site: any, ctx: any): Promise<{ ok: true; current: number; previous: number; note?: string } | { ok: false; why: string } | null>;
