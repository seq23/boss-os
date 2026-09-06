/**
 * Types for the sync agent, which is plain .mjs because it runs as a Node process on the private
 * machine and never passes through the Worker build. The repo already uses this pattern for
 * scripts/validate/no-cross-repo-coupling.d.mts: keep the script runnable by node with no build
 * step, and give the tests something to check against.
 */
export interface AgentHealth {
  pushed: number;
  refused: number;
  conflicts: number;
  pulled: number;
  kept: number;
  error: string | null;
}

export interface AgentStatus {
  outbox: number;
  conflicts: number;
  received: number;
  cursor: number;
  last_success_at: number | null;
  last_error: string | null;
}

export interface LocalDb {
  prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): any; all(...args: unknown[]): any[] };
  exec(sql: string): void;
  close(): void;
}

export const DEFAULT_DB: string;
export function backoffMs(attempt: number): number;
export function openLocal(path?: string): LocalDb;
export function enqueue(
  db: LocalDb,
  args: { entity: string; recordId: string; baseVersion?: number | null; tombstone?: boolean; payloadHash?: string | null },
): string;
export function syncOnce(
  db: LocalDb,
  opts?: { origin?: string; deviceId?: string; fetchImpl?: typeof fetch; cookie?: string; now?: number },
): Promise<AgentHealth>;
export function status(db: LocalDb): AgentStatus;
export function unlock(origin: string, passcode: string, fetchImpl?: typeof fetch): Promise<string>;
