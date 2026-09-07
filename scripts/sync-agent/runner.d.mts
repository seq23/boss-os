/**
 * Types for the execution runner, which is plain .mjs for the same reason agent.mjs is: it runs as a
 * Node process on the private machine and never passes through the Worker build. Same pattern as
 * agent.d.mts and scripts/validate/no-cross-repo-coupling.d.mts — runnable by node with no build
 * step, and something for the tests and `tsc --noEmit` to check against.
 */
export interface Envelope {
  run_id?: string;
  task_id?: string | null;
  backend_id?: string;
  envelope_id?: string | null;
  approved?: boolean;
  approval_receipt?: string | null;
  kind?: string;
  repo_path?: string;
  allowed_paths?: string[];
  instruction?: string;
  instruction_origin?: string;
  verification?: string[];
  forbidden_actions?: string[];
  allowed_kinds?: string[];
  capabilities?: string[];
  credential_ref?: string;
  required_capability?: string;
  max_seconds?: number;
  model?: string;
  [key: string]: unknown;
}

export interface RanCommand {
  cmd: string;
  exit_code: number | null;
}

export interface Violation {
  action: string;
  evidence: string;
}

export interface EvidencePacket {
  run_id: string | null;
  task_id: string | null;
  backend_id: string;
  envelope_id: string | null;
  requested: string;
  status: "succeeded" | "failed" | "refused";
  summary: string;
  files_touched: string[];
  commands: RanCommand[];
  checks_run: { run: number; passed: number; failed: number; detail: Array<{ cmd: string; exit_code: number | null; tail: string }> };
  remaining_risks: string[];
  violations: Violation[];
  rollback_ref: string | null;
  refusal_reason: string | null;
  error: string | null;
  cost_micros: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface GitState {
  head: string | null;
  branch: string | null;
  upstream: string | null;
  dirty: boolean;
  changed_files: string[];
}

export interface ExecutorInput {
  envelope: Envelope;
  prompt: string;
  sentinel: string;
  forbidden: string[];
  cwd: string;
}

export interface ExecutorResult {
  summary?: string;
  exit_code?: number;
  commands?: Array<{ cmd: string; exit_code?: number } | string>;
  files_touched?: string[];
  cost_micros?: number;
  remaining_risks?: string[];
  error?: string | null;
  refused?: boolean;
  refusal_reason?: string;
  /** Structured output the run wrote to `delivers.json`, read from its workspace by the adapter. */
  delivers?: Record<string, unknown> | null;
}

export interface RunDeps {
  execute?: (input: ExecutorInput) => Promise<ExecutorResult>;
  runCommand?: (cmd: string, opts: { cwd: string; forbidden?: string[]; timeoutMs?: number }) => Promise<{ exit_code: number; tail?: string }>;
  gitProbe?: (cwd: string) => Promise<GitState>;
  /** Copies read-only materials into the run's own directory. Returns the base names placed. */
  placeMaterials?: (cwd: string, materials: string[]) => Promise<string[]>;
  now?: () => number;
  backend?: { allowed_kinds?: string[]; capabilities?: string[]; credential_ref?: string };
}

export interface WorkDeps extends RunDeps {
  origin: string;
  deviceId: string;
  backendId?: string;
  fetchImpl?: typeof fetch;
  cookie?: string;
}

export const REQUIRED_FORBIDDEN: string[];
export const REFUSAL: Record<string, string>;
/** The only web tools an envelope may ask for. Anything else is an escalation, not a typo. */
export const ALLOWED_WEB_TOOLS: string[];
export function fenceUntrusted(text: unknown, opts?: { sentinel?: string }): { sentinel: string; fenced: string };
export function buildPrompt(envelope: Envelope, opts?: { sentinel?: string }): { sentinel: string; prompt: string };
export function scanCommand(command: unknown, forbidden?: string[]): string[];
export function matchesGlob(pattern: string, path: string): boolean;
export function validateEnvelope(
  envelope: Envelope | null | undefined,
  backend?: RunDeps["backend"],
): { ok: true; forbidden: string[] } | { ok: false; reason: string; detail: string };
export function executeRun(envelope: Envelope, deps?: RunDeps): Promise<EvidencePacket>;
export function claimRun(opts: { origin: string; deviceId: string; backendId?: string; fetchImpl?: typeof fetch; cookie?: string }): Promise<Envelope | null>;
export function reportRun(evidence: EvidencePacket, opts: { origin: string; deviceId: string; fetchImpl?: typeof fetch; cookie?: string }): Promise<Record<string, unknown>>;
export function workOnce(deps: WorkDeps): Promise<{ claimed: boolean; reported?: boolean; error: string | null; evidence: EvidencePacket | null }>;
export function defaultRunCommand(cmd: string, opts?: { cwd?: string; forbidden?: string[]; timeoutMs?: number }): Promise<{ exit_code: number; tail: string }>;
export function childEnv(source?: Record<string, string | undefined>): Record<string, string>;
export function defaultGitProbe(cwd: string): Promise<GitState>;
export function defaultPlaceMaterials(cwd: string, materials: string[]): Promise<string[]>;
