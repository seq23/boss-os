/** Types for scripts/lib/codex-seat.mjs (the Mac scripts are plain ESM; tests import them). */
export declare function codexOnSubscription(authJsonText: string): boolean;
export declare function codexSeatUsable(home?: string): { ok: boolean; why: string };
export declare function codexExecArgs(addDirs?: string[]): string[];
export declare const CODEX_CANNOT_RUN_PHASES: readonly string[];
export declare const CODEX_BUILD_NOTE: string;
export declare function isGitSandboxBlock(blocked: unknown): boolean;
export interface SpawnLike { status: number | null; stdout?: string; stderr?: string }
export declare function finishCodexBuild(args: {
  cwd: string;
  repo: string;
  branch: string | null;
  out: Record<string, unknown> | null;
  run: (cmd: string, args: string[], opts: { cwd: string }) => SpawnLike;
  base?: string;
}): { ok: true; result: Record<string, unknown> & { branch: string; pr_url: string; pr_number: number } } | { ok: false; tag: string; why: string };
export declare function helpMentions(helpText: string | undefined, flag: string): boolean;
export interface RunResult {
  code: number | null;
  out: string;
  err: string;
}
export interface FallbackResult extends RunResult {
  servedBy: "claude" | "codex";
  handedOver: boolean;
  /** True when Claude's seat is spent on a phase Codex cannot run (land): the phase waits for the reset. */
  waitForSeat?: boolean;
}
export declare function runWithCodexFallback(deps: {
  runClaude: () => Promise<RunResult>;
  runCodex: () => Promise<RunResult>;
  /** Returns a short description of the spent-usage notice, or null when the result is not one. */
  limited: (r: RunResult) => string | null;
  usable: () => { ok: boolean; why: string };
  /** Returns the first unsupported flag, or null when all are supported. */
  supports: (flags: string[]) => Promise<string | null>;
  addDirs?: string[];
  onLine?: (line: string) => void;
  phase?: string | null;
}): Promise<FallbackResult>;
