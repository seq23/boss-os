/** Types for the executor record. See executors.mjs for why it exists. */
export type Capability = "owner_account_web" | "colleague_work";
export const OWNER_ACCOUNT_WEB_RE: RegExp;
export const CAPABILITIES: readonly Capability[];
export const SEAT_EXECUTORS: Readonly<Record<string, Readonly<Partial<Record<Capability, string>>>>>;
export function requiredCapability(work?: { what?: string; why?: string; requires?: string | null }): Capability;
export function executorsFor(capability: Capability): [string, string][];
export type AssignmentCheck =
  | { ok: true; capability: Capability; executor: string }
  | { ok: false; capability: Capability; error: string; why: string };
export function checkAssignment(work?: { helper?: string; what?: string; why?: string; requires?: string | null }): AssignmentCheck;
export function ownerAskIsATask(text: unknown): string | null;
export type TaskExecutor = { who: string; file: string; marker: string; command?: string };
export const TASK_EXECUTORS: Readonly<Record<string, Readonly<TaskExecutor>>>;
export const TASK_CREATORS: Readonly<Record<string, readonly string[]>>;
export const GRID_KINDS_THE_PROBE_SEES: readonly string[];
export const GRID_KINDS_FOR_THE_INBOX: readonly string[];
export function gridDispatchGoesTo(kind: string): "inbox" | "probe" | null;
