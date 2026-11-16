export const KEY_NAMES: readonly string[];
export const NEVER_KEYS: readonly string[];
export const READ_TOOLS: readonly string[];
export const SPEND_TOOLS: readonly string[];
export function resolveKey(env?: Record<string, string | undefined>, names?: readonly string[]): string | null;
export function balanceIn(text: unknown): number | null;
export function call8r(tool: string, args?: Record<string, unknown>, keyName?: string | null): string;
export const FREE_KEY_NAMES: readonly string[];
export function pickAccount(a: { purpose: string; credits: number; names?: readonly string[]; env?: Record<string, string | undefined>; remaining: (name: string) => number | null }): { name: string; left: number } | null;
export function spend8r(api: { post(path: string, body: Record<string, unknown>): Promise<any> }, s: { purpose: string; tool: string; args?: Record<string, unknown>; credits: number; company?: string | null; contacts?: number }, o?: { call?: (tool: string, args?: Record<string, unknown>, keyName?: string | null) => string; env?: Record<string, string | undefined> }): Promise<{ ok: boolean; why?: string; out?: string; account?: string }>;
export function runEightraiseProducer(api: {
  get(path: string): Promise<{ used?: number }>;
  post(path: string, body: Record<string, unknown>): Promise<unknown>;
}, options?: {
  readBalance?: () => string;
  write?: (section: string, body: { lines: string[]; credits: { used: number; budget: number; kept: number } }) => string;
}): Promise<void>;
