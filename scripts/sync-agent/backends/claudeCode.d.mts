/** Types for the Claude Code adapter. Same reason as runner.d.mts: .mjs on the private machine. */
import type { Envelope, ExecutorInput, ExecutorResult } from "../runner.d.mts";

export const DENIED_TOOLS: string[];
export function buildArgs(envelope: Envelope, opts?: { model?: string }): string[];
export function parseCliJson(stdout: unknown): {
  summary: string;
  is_error: boolean;
  cost_micros: number;
  parse_error?: string;
  session_id?: string | null;
  num_turns?: number | null;
};
export function claudeCodeExecutor(
  input: ExecutorInput,
  deps?: {
    spawnImpl?: unknown;
    binary?: string;
    /**
     * Reads the run's structured output. Injected for the same reason `spawnImpl` is: the adapter's
     * tests run in workerd, which has no filesystem. Resolves to null when the run wrote no file.
     */
    readDelivers?: (cwd: string) => Promise<string | null>;
  },
): Promise<ExecutorResult & { session_id?: string | null; delivers: Record<string, unknown> | null }>;
export function defaultReadDelivers(cwd: string): Promise<string | null>;
export function describeAuth(source?: Record<string, string | undefined>): {
  mode: "api_key" | "owner_session";
  ok: boolean;
  detail: string;
};
