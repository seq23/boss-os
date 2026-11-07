export function orphanVerdict(row: any, pr: any, opts?: { sites?: any[]; approvedSites?: string[] }): string;
export function blockerLines(rows: any[]): string[];
export function blockedStopSentence(rows: any[]): string;
export function fixedNothingCause(rows: any[]): { code: '' | 'SR_BLOCKED_BY_OPEN_PRS' | 'SR_AWAITING_HOST_PUBLISH'; sentence: string };
