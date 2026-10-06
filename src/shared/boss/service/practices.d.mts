/** Types for the shared service practices (R7, R8, R13–R17, R19, R21–R23). See practices.mjs. */
export interface ServicePractice { rule: string; line: string }
export interface DeferredItem { ask: string; due_at: string }
export interface NamedDriveFolder { id: string; url: string }
export declare const SERVICE_INTAKE_ADDRESS: string;
export declare const SERVICE_PRACTICES_HEADING: string;
export declare const SERVICE_PRACTICES: readonly ServicePractice[];
export declare function servicePracticesBlock(constraints?: readonly string[]): string;
export declare function deferredItemsIn(text: string | null | undefined): DeferredItem[];
export declare function deferKey(sourceTaskId: string, item: DeferredItem): string;
export declare function driveFoldersIn(text: string | null | undefined): NamedDriveFolder[];
export declare function standingConstraintsIn(text: string | null | undefined): string[];
export declare function missingKeysIn(text: string | null | undefined): string[];
