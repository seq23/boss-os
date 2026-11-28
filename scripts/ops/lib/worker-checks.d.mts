type Row = { kind: string; id: string; name: string; aim: string; coverage: string; state: string; evidence: string };
export function readMailCounts(day: string | undefined, schedule: unknown, env?: Record<string, string | undefined>): Promise<Record<string, { source: number; handled: number; unread: string[] }> | null>;
export function readSiteAudit(day: string | undefined, sites: unknown, env: Record<string, string | undefined>): Promise<{ source: number; handled: number | null } | null>;
export function workerChecks(schedule: any, inputs: any, launchd: any): Row[];
