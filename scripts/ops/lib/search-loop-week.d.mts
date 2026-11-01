export const LOOP_WORKFLOW_RE: RegExp;
export function fetchLoopWeeks(repo: string, opts?: { run?: (args: string[]) => string; now?: number; maxAgeDays?: number; cap?: number }): { weeks: any[]; adopted: boolean; problem?: undefined } | { problem: string; weeks?: undefined; adopted?: undefined };
