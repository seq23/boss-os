export const SPRY_WEEKLY: { artifact: string; schema: string; owner: string; parked_hosts: string[]; sources: Array<{ key: string; label: string; repo: string; workflow: string; ready_by_ct: string; max_age_hours?: number }> };
export function hostAllowed(host: string, parked?: string[]): boolean;
export function summaryProblem(summary: unknown, opts?: { now?: number; maxAgeHours?: number }): string | null;
export function sectionFor(source: unknown, summary: unknown, problem?: string | null): { title: string; items: string[]; link?: { label: string; url: string } };
export function composeSpryWeekly(got: Record<string, unknown>, opts?: { now?: number }): { subject: string; happened: string; sections: Array<{ title: string; items: string[] }>; missing: number; looks: number };
