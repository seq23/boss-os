export const RESEARCH_BELOW: number;
export function researchPrompt(plan: Record<string, unknown>): string;
export function research(plan: Record<string, unknown>, opts?: Record<string, unknown>): Promise<any[]>;
export function publishedOnPage(row: Record<string, unknown>, fetchImpl?: typeof fetch): Promise<boolean>;
export function runGroups(opts: {
  live?: boolean; now?: number; api: { get(p: string): Promise<any>; post(p: string, b: unknown): Promise<any> };
  discover?: (plan: any) => Promise<any[]>; published?: (row: any) => Promise<boolean>;
  verify?: (emails: string[], opts?: any) => Promise<{ verdicts: Array<{ email: string; result: string }> }>;
  codeTable?: (spec: any) => Promise<any>; log?: (m: string) => void;
}): Promise<{ researched: number; imported: number; verdicts: number; codes: number; usage: number; queued: number; stops: string[] }>;
