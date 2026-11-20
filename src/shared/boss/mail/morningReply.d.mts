/** Types for morningReply.mjs. See that file. */
export type MorningCommand =
  | { kind: "drop"; number?: number; name?: string }
  | { kind: "gate" }
  | { kind: "grateful"; what: string }
  | { kind: "public"; company: string }
  | { kind: "rule"; words: string };
export function morningCommands(text: unknown): { commands: MorningCommand[]; rest: string };
export function commandOf(line: unknown): MorningCommand | null;
export function commandsFromRead(readCommands: ReadonlyArray<{ kind: string; n: number | null; text: string }> | null | undefined): MorningCommand[];
export const KNOWN_RULES: ReadonlyArray<{ re: RegExp; said: string; coach?: "harder" | "softer" }>;
export function knownRule(words: unknown): { re: RegExp; said: string; coach?: "harder" | "softer" } | null;
export function coachPressure(brainMd: unknown): "harder" | "softer";
export function gratitudeFromBrain(brainMd: unknown): string[];
export const brainLine: {
  grateful(day: string, what: string): string;
  rule(day: string, words: string): string;
  coach(day: string, which: string, words: string): string;
};
export function dropTargets(digest: any, cmd: MorningCommand): { id: string; label: string }[];
