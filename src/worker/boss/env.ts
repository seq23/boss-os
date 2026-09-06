export interface Env {
  DB: D1Database;
  VAULT: R2Bucket;
  SESSIONS: KVNamespace;
  TASKS: Queue<TaskMessage>;
  ASSETS: Fetcher;

  BOSS_OS_VERSION: string;
  DEFAULT_PROVIDER: string;

  BOSS_PASSCODE: string;
  SESSION_SECRET: string;
  FIREWORKS_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

export interface TaskMessage {
  taskId: string;
  lane: string;
  attempt?: number;
}

export type Vars = { session: { id: string; issuedAt: number } };
