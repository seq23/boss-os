/** Types for the duty lane. See lane.mjs for why every rule lives there. */

export const NEW_DUTY_RE: RegExp;
export const ROUTING_ROLE: "Chief of Staff";
export const APPROVAL_WORDS: readonly string[];
export const PRE_APPROVAL_PHRASES: readonly string[];
export const BUSY_HOURS: Record<number, string>;
export const CANDIDATE_HOURS: readonly number[];
export const INSTALLED_LOCAL_JOBS: readonly string[];

export interface LaneSeat { id: string; name: string; role?: string | null; lane?: string; department?: string | null }

export interface DutyRequest {
  seat: LaneSeat;
  tag: string;
  phrase: string;
  routedBy: LaneSeat | null;
  preApproved: string | null;
}
export interface DutyRequestError { error: string; tag: string }

export function preApprovalIn(text: string): string | null;
export function draftToken(id: string): string;
export function draftTokenIn(text: string | null | undefined): string | null;
export function dutyRequestIn(subject: string, body: string, roster: LaneSeat[]): DutyRequest | DutyRequestError | null;
export function readDutyReply(text: string): { mode: "approved" | "changes" | "held" | "other" | "empty"; text: string };
export function weekdayIn(text: string): number | null;
export function hourIn(text: string): { hour: number; minute: number } | null;
export function pickSlot(
  taken: Array<{ local_hour: number; cadence: string; weekday?: number | null; name?: string; id?: string }>,
  want: { cadence: "daily" | "weekly"; weekday?: number | null },
): { hour: number; minute: number; why: string };
export function scriptIn(text: string): string | null;
export function dutyProblems(
  draft: { employee_id?: string; employee_name?: string; employee_active?: boolean; model?: string; executor?: string; delivers?: string | null; local_job?: string | null } | null,
  existing: Array<{ id?: string; name?: string; local_job: string | null }>,
  deliverableKeys: readonly string[],
): string[];
export function overridesFrom(text: string): {
  cadence?: "daily" | "weekly"; weekday?: number; local_hour?: number; local_minute?: number;
  model?: string; executor?: "agent" | "local_job"; local_job?: string;
};
