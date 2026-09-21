/** Types for the repo-change lane. See lane.mjs for why every constant lives there. */

export const TASK_KIND: "repo_change";
export const EXECUTOR_SCRIPT: "repo-change.sh";
export const REPO_CHANGE_SEAT: "emp_repo";
export const PHASES: readonly string[];
export const RUNNABLE_PHASES: readonly ("plan" | "build" | "land")[];
export const PHASE_MODELS: { plan: string; build: string; land: string };
export const PHASE_MAX_TURNS: { plan: number; build: number; land: number };
export const PHASE_TIMEOUT_MIN: { plan: number; build: number; land: number };
export const CLAIM_LEASE_MS: number;
export const ASK_POLICY: { ask: readonly string[]; decide: readonly string[] };

export type RepoChangePhase = "plan" | "asking" | "build" | "landing" | "land" | "done" | "failed";

export interface RepoChangeParse {
  repo: string | null;
  property: string | null;
  drive_folder: string | null;
  drive_url: string | null;
  instruction: string;
}
export interface RepoChangeExcluded {
  excluded: { repo: string; why: string };
}

export interface RepoChangeRowLike {
  phase?: string | null;
  plan_text?: string | null;
  answered_at?: number | null;
  answers_text?: string | null;
  pr_url?: string | null;
  pr_number?: number | null;
  checks_green_at?: number | null;
  claimed_at?: number | null;
}

export interface GuardVerdict { ok: boolean; why: string }

export function changeToken(id: string): string;
export function tokenIn(text: string | null | undefined): string | null;
export function driveFolderIn(text: string | null | undefined): { id: string; url: string } | null;
export function gridRepoNames(): string[];
export function repoIn(text: string | null | undefined): string | null;
export function excludedRepoIn(text: string | null | undefined): { repo: string; why: string } | null;
export function parseRepoChange(text: string | null | undefined): RepoChangeParse | RepoChangeExcluded | null;
export function canEnterBuild(row: RepoChangeRowLike | null | undefined): GuardVerdict;
export function canLand(row: RepoChangeRowLike | null | undefined): GuardVerdict;
export function claimablePhase(row: RepoChangeRowLike | null | undefined): "plan" | "build" | "land" | null;
export function claimIsLive(row: RepoChangeRowLike | null | undefined, now?: number): boolean;
