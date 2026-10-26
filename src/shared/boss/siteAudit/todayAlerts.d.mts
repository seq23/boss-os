/** Types for Today's site-audit alert lines (see todayAlerts.mjs). */

export declare function auditFindingAlerts(
  rows: ReadonlyArray<{ disposition: string; project: string; domain: string | null; repo: string | null; errors: number | null }>,
): Array<{ severity: "high" | "medium"; text: string }>;
