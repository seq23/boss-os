export function listenForSimoneTools(
  path: string,
  call: { id: string; lease: number },
  api: (method: string, path: string, body: { id: string; lease: number; tool: string; task?: unknown }) => Promise<{
    ok: boolean;
    receipt?: string;
    rows?: unknown[];
    code?: string;
  }>,
  hasCredential: (text: string) => boolean,
): Promise<{ receipts: string[]; close: () => Promise<void> }>;
