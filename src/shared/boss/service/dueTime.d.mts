/** Types for the deadline reader (R12). See dueTime.mjs. */
export interface DueTime { due_at: string; due_words: string; priority: "URGENT" | "HIGH" }
export declare function dueTimeIn(text: string, now?: Date): DueTime | null;
export declare function dueLine(due: Pick<DueTime, "due_at" | "due_words"> | null | undefined): string | null;
export interface NotBefore { at: string; words: string }
export declare function notBeforeIn(text: string, now?: Date): NotBefore | null;
export declare function heldDue(due: DueTime | null | undefined, notBefore: NotBefore | null | undefined): DueTime | null;
