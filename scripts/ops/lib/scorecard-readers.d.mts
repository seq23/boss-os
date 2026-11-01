// Types for scorecard-readers.mjs (the Scorecard's readers).
export class NamedStop extends Error { code: string; constructor(code: string, sentence: string) }
export const READERS: Readonly<Record<string, (params: any, ctx: any) => Promise<{ raw: number | string | null; note?: string }> | { raw: number | string | null }>>;
export function d1Sql(params: { sql: string; days?: number }, now: number): string;
export function spryLabsDomains(sitesJson: any): string[];
export function googleAccess(ctx: any, scope: string, sub?: string | null): Promise<string>;
export function pick(obj: any, path: string): any;
export function macContext(o?: { env?: Record<string, string | undefined>; now?: number; sites?: any }): any;
export function readMetric(metric: any, ctx: any): Promise<{ raw: number | string | null; note: string | null; error: string | null }>;
