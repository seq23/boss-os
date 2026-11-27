export function chiefSignoff(pr: {
  head: string;
  branch: string;
  messages: string[];
  paths: string[];
  body?: string;
  comments?: string[];
}): string | null;
export const SIGNOFF_NEEDS: Readonly<Record<string, string>>;
