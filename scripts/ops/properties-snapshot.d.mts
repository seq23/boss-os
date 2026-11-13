export const LINKS_DIR: string;
export function buildProperties(
  sites: Array<Record<string, unknown>>,
  perf: { report?: Array<{ site: string; clicks: number; clicks_prev?: number }>; error?: string } | null,
  now?: number,
): {
  computed_at: string; note: string; performance: string; count: number;
  properties: Array<{ property: string; url: string; about: string; business: string | null; kind: string | null; clicks_last_week: number | "not read"; clicks_week_before: number | "not read" }>;
};
