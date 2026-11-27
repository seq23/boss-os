export function simoneGitHub(
  call: { id: string },
  text: unknown,
  hasCredential: (text: string) => boolean,
  deps?: {
    run?: (command: string, args: string[], input?: string, cwd?: string) => Promise<string>;
    verified?: (repo: string) => void | Promise<void>;
    recheck?: () => boolean | Promise<boolean>;
  },
): Promise<{ ok: boolean; code?: string; receipt?: string; head?: string; evidence?: string }>;
