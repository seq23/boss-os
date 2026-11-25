export interface SimoneCall {
  id: string;
  lease: number;
  pendingHandoffs?: { employee: string; words: string }[];
  roster: { id: string; name: string; role: string; department: string }[];
  message: { body: string; context?: string; source?: string };
}

export function codexRouteArgs(prompt: string, output: string, schema: string): string[];
export function simoneMemory(home: string): Promise<string>;
export function childEnvironment(env: NodeJS.ProcessEnv, home: string, settings: string, promptFile: string): NodeJS.ProcessEnv;
export function runSimone(options: {
  api: (method: string, path: string, body?: unknown) => Promise<{ call?: SimoneCall; replied?: boolean; refused?: boolean; released?: boolean }>;
  run: (call: SimoneCall, prompt: string) => Promise<{ log: string; successful: boolean; receipts?: string[] }>;
  fallback?: (call: SimoneCall) => Promise<unknown[] | null>;
  hasCredential?: (text: string) => boolean;
}): Promise<{ state: 'idle' } | { state: 'done' | 'refused'; id: string } | { state: 'retry'; id: string; code: string }>;
