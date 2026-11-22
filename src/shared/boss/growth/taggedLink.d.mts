export const MEDIUMS: readonly string[];
export const NO_TRACKING_DOMAINS: Readonly<Record<string, string>>;
export function tagLink(url: string, tags: { source: string; medium: string; campaign: string }): string;
