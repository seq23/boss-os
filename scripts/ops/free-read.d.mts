export function freeReadArgs(argv: string[]): { worker: string; instructionFile: string; maxOutputTokens: number; require: string | null; error?: undefined } | { error: string };
export function freeRead(
  job: { worker: string; instruction: string; source: string; maxOutputTokens: number; require?: string | null },
  opts?: { env?: Record<string, string | undefined>; read?: (input: any, env: any) => Promise<any> },
): Promise<{ code: number; out: string; err: string }>;
