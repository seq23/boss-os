export interface PassWorktree { dir: string; repo: string; stamp: string }
export function pickWorktrees(names: string[], since: string, repo?: string): PassWorktree[];
export function salvageSteps(state: { dirty: boolean; ahead: number; hasPr: boolean }): string[];
export function stampOf(d: Date): string;
export function salvage(opts: { root: string; since: string; repo?: string; gh?: string }): string[];
