/** Types for her ruling on an existing duty, by email. See editByMail.mjs. */
export interface EditableDutyRef { id: string; name: string; employee_id: string; removed_at?: number | null; task_input?: string | null }
export interface SeatRef { id: string; name: string }
export type DutyEditRequest<D extends EditableDutyRef, S extends SeatRef> =
  | { duty: D; seat: S | null; matched: string[]; phrase: string; preApproved: string | null; ambiguous?: undefined }
  | { ambiguous: D[]; seat: S | null; duty?: undefined };
export function dutyEditRequestIn<D extends EditableDutyRef, S extends SeatRef>(
  subject: string, text: string, opts: { roster?: S[]; duties?: D[] },
): DutyEditRequest<D, S> | null;
export function editedInstructions(current: string, phrase: string, day: string): string;
export function dutyCodeHome(duty: { task_input?: string | null }): { github_repo: string; path: string | null };
