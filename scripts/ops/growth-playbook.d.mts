export const SKILL_FILE: string;
export function compare(file?: string, text?: string): "same" | "differs" | "missing";
export function writeSkill(file?: string, text?: string): void;
