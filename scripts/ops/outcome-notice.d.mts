export const KEY_RE: RegExp;
export const MAX_TEXT: number;
export const VERDICT_WORDS: Readonly<Record<"working" | "not-working" | "not-checked", string>>;
export function noticeArgs(argv: string[]): { key: string; text: string } | { error: string; code: number };
export function writeOutcomeNotice(
  notice: { key: string; text: string },
  opts?: { api?: { get(path: string): Promise<any> } | null; dir?: string; add?: (section: string, body: any, opts: { dir: string }) => unknown },
): Promise<{ written: boolean; why: string }>;
