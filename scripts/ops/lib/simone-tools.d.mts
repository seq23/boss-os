import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from "node:child_process";

export function readBrokerageGoogle(path: unknown, recheck: () => boolean | Promise<boolean>, ctx?: {
  env: Record<string, string | undefined>;
  now: number;
  fetch: typeof fetch;
}): Promise<{ ok: boolean; code?: string; receipt?: string; evidence?: string }>;

export function listenForSimoneTools(
  path: string,
  call: { id: string; lease: number },
  api: (method: string, path: string, body: { id: string; lease: number; tool: string; task?: unknown }) => Promise<{
    ok: boolean;
    receipt?: string;
    rows?: unknown[];
    code?: string;
    query?: string;
    brokerageRead?: string;
  }>,
  hasCredential: (text: string) => boolean,
  runConnector?: (bin: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) => Partial<SpawnSyncReturns<string>>,
): Promise<{ receipts: string[]; close: () => Promise<void> }>;
