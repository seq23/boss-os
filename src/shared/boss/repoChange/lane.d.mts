/** Types for the repo-change lane. See lane.mjs for why every constant lives there. */

export const TASK_KIND: "repo_change";
export const EXECUTOR_SCRIPT: "repo-change.sh";
export const REPO_CHANGE_SEAT: "emp_repo";
export const MAC_LANE: { kind: string; executor: string; runner: string; prompt: string; route: string; seat: string };
export const PHASES: readonly string[];
export const RUNNABLE_PHASES: readonly ("plan" | "build" | "preview" | "land")[];
export const PHASE_MODELS: { plan: string; build: string; land: string };
export const PHASE_MAX_TURNS: { plan: number; build: number; land: number };
export const PHASE_TIMEOUT_MIN: { plan: number; build: number; land: number };
/** Reworks a failed post-land step gets before the owner is written to. One number for the Worker and the Mac runner. */
export const MAX_REWORKS: number;
export const CLAIM_LEASE_MS: number;
export const ASK_POLICY: { ask: readonly string[]; decide: readonly string[] };

export type RepoChangePhase = "plan" | "asking" | "build" | "preview" | "previewing" | "landing" | "land" | "done" | "failed";

export interface RepoChangeParse {
  repo: string | null;
  /** owner/name on GitHub — the grid owner for a grid repo, the address she wrote for a registered one. */
  github_repo: string | null;
  /** True when the repo is not on the grid and registered from her GitHub address (R24). */
  registered: boolean;
  property: string | null;
  drive_folder: string | null;
  drive_url: string | null;
  instruction: string;
  pre_approved_phrase: string | null;
  force_phrase: string | null;
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
  publish_ready?: number | null;
  preview_forced?: number | null;
  preview_sent_at?: number | null;
  land_approved_at?: number | null;
  land_approval_text?: string | null;
  forced_by?: string | null;
  forced_at?: number | null;
}

export interface GuardVerdict { ok: boolean; why: string }

export const PRE_APPROVAL_PHRASES: readonly string[];
export function preApprovalIn(text: string | null | undefined): string | null;
export function forcePhraseIn(text: string | null | undefined): string | null;
export function changeToken(id: string): string;
export function tokenIn(text: string | null | undefined): string | null;
export function driveFolderIn(text: string | null | undefined): { id: string; url: string } | null;
export function gridRepoNames(): string[];
export function repoIn(text: string | null | undefined): string | null;
export function excludedRepoIn(text: string | null | undefined): { repo: string; why: string } | null;
export function registeredRepoIn(text: string | null | undefined): { repo: string; github_repo: string } | null;
export function parseRepoChange(text: string | null | undefined): RepoChangeParse | RepoChangeExcluded | null;
export const APPROVAL_WORDS: readonly string[];
export const HOLD_PREFIXES: readonly string[];
export const APPROVED_DEFAULTS_TEXT: string;
export const PREVIEW_WORDS: readonly string[];
export const PREVIEW_DEFAULTS_TEXT: string;
export function herWords(text: string | null | undefined): string;
export function readReply(text: string | null | undefined): { mode: "approved" | "preview" | "forced" | "held" | "answers" | "empty"; text: string };
export const FORCE_WORDS: readonly string[];
export const FORCED_TEXT: string;
export function isForced(row: RepoChangeRowLike | null | undefined): boolean;
export function needsPreview(row: RepoChangeRowLike | null | undefined): boolean;
export function previewApproved(row: RepoChangeRowLike | null | undefined): boolean;
export function canPreview(row: RepoChangeRowLike | null | undefined): GuardVerdict;
export function canEnterBuild(row: RepoChangeRowLike | null | undefined): GuardVerdict;
export function canLand(row: RepoChangeRowLike | null | undefined): GuardVerdict;
export function claimablePhase(row: RepoChangeRowLike | null | undefined): "plan" | "build" | "preview" | "land" | null;
export function claimIsLive(row: RepoChangeRowLike | null | undefined, now?: number): boolean;
