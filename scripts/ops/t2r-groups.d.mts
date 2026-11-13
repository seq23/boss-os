export const RESEARCH_BELOW: number;
export function researchPrompt(plan: Record<string, unknown>): string;
export function research(plan: Record<string, unknown>, opts?: Record<string, unknown>): Promise<any[]>;
export function publishedOnPage(row: Record<string, unknown>, fetchImpl?: typeof fetch): Promise<boolean>;
export function runGroups(opts: {
  live?: boolean; now?: number; api: { get(p: string): Promise<any>; post(p: string, b: unknown): Promise<any> };
  discover?: (plan: any) => Promise<any[]>; published?: (row: any) => Promise<boolean>;
  verify?: (emails: string[], opts?: any) => Promise<{ verdicts: Array<{ email: string; result: string }> }>;
  codeTable?: (spec: any) => Promise<any>; log?: (m: string) => void;
}): Promise<{ ready: number | null; researched: number; imported: number; verdicts: number; codes: number; usage: number; queued: number; stops: string[] }>;
export function partnerResearchPrompt(x: { org: string; brand: string }): string;
export function personResearchPrompt(x: { org: string; domain?: string | null; brand: string; people: Array<{ name: string; title?: string }> }): string;
export function shownOnPages(out: any, onPage?: (row: any) => Promise<boolean>): Promise<{ people: Array<{ name: string; title: string; email?: string; source_url?: string }>; seen: Array<{ name: string; email: string }> }>;
export function personResearch(work: { id: string; org: string; domain?: string | null; brand: string; people: Array<{ name: string; title?: string }> }, opts?: { discover?: (...a: any[]) => Promise<any>; onPage?: (row: any) => Promise<boolean> }): Promise<{ people: Array<{ name: string; title: string; email?: string; source_url?: string }>; seen: Array<{ name: string; email: string }>; domain: string | null }>;

export function groupsOutputLine(out: { ready: number | null }): string | null;
