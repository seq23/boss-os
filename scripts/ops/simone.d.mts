export interface SimoneCall {
  id: string;
  lease: number;
  roster: { id: string; name: string; role: string; department: string }[];
  message: { body: string; context?: string };
}

export function childEnvironment(env: NodeJS.ProcessEnv, home: string, settings: string, promptFile: string): NodeJS.ProcessEnv;
export function runSimone(options: {
  api: (method: string, path: string, body?: unknown) => Promise<{ call?: SimoneCall; replied?: boolean; released?: boolean }>;
  run: (call: SimoneCall, prompt: string) => Promise<{ log: string; successful: boolean }>;
  hasCredential?: (text: string) => boolean;
}): Promise<{ state: 'idle' } | { state: 'done'; id: string } | { state: 'retry'; id: string; code: string }>;
