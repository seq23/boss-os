export const KEY_NAMES: readonly string[];
export const NEVER_KEYS: readonly string[];
export const READ_TOOLS: readonly string[];
export const SPEND_TOOLS: readonly string[];
export function resolveKey(env?: Record<string, string | undefined>, names?: readonly string[]): string | null;
export function balanceIn(text: unknown): number | null;
export function call8r(tool: string, args?: Record<string, unknown>): string;
export function runEightraiseProducer(api: {
  get(path: string): Promise<{ used?: number }>;
  post(path: string, body: Record<string, unknown>): Promise<unknown>;
}, options?: {
  readBalance?: () => string;
  write?: (section: string, body: { lines: string[]; credits: { used: number; budget: number; kept: number } }) => string;
}): Promise<void>;
