/** Types for morningRoutine.mjs. See that file. */
export interface RoutineStep { n: number; at: string; minutes: number; place: "bed" | "floor" | "standing" | "wall"; where: string; move: string; purpose: string; swapped: boolean; line: string }
export declare const DEFAULT_MORNING_ROUTINE: ReadonlyArray<{ from: number; to: number; place: string; move: string; alt: string | null; purpose: string }>;
export declare const FALLBACK_STEPS: number;
export declare const ROUTINE_MINUTES: number;
export declare function centralDay(now?: number): string;
export declare function routineFor(ymd: string | null | undefined): RoutineStep[];
export declare function fallbackFor(ymd: string | null | undefined): RoutineStep[];
