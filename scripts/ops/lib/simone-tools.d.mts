import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from "node:child_process";

export function listenForSimoneTools(
  path: string,
  call: { id: string; lease: number },
  api: (method: string, path: string, body: { id: string; lease: number; tool: string; task?: unknown }) => Promise<{
    ok: boolean;
    receipt?: string;
    rows?: unknown[];
    code?: string;
    query?: string;
  }>,
  hasCredential: (text: string) => boolean,
  runConnector?: (bin: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) => Partial<SpawnSyncReturns<string>>,
): Promise<{ receipts: string[]; close: () => Promise<void> }>;
