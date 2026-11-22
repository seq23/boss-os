export interface MacSlot { mins: number; dow?: number; dom?: number }
export declare function slotsOf(text: string, shift?: number): MacSlot[];
export declare function guardOf(text: string): { cls: string; label: string } | null;
export declare function macDayProblems(jobs: Record<string, string>, manifest: unknown, opts?: { shift?: number; from?: Date; days?: number }): string[];
export declare function rowProblems(manifest: unknown): string[];
