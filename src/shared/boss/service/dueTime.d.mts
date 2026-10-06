/** Types for the deadline reader (R12). See dueTime.mjs. */
export interface DueTime { due_at: string; due_words: string; priority: "URGENT" | "HIGH" }
export declare function dueTimeIn(text: string, now?: Date): DueTime | null;
export declare function dueLine(due: Pick<DueTime, "due_at" | "due_words"> | null | undefined): string | null;
