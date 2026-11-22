export const GROWTH_BRAINS: readonly string[];
export const FIELDS: readonly string[];
export const REQUIRED: readonly string[];
export const SPEND_ACTIONS: readonly string[];
export const NEVER_ACTIONS: Readonly<Record<string, string>>;
export interface RosterEntry { label: string; brain: string; key: string | null; buyer: string | null; offer: string | null; money: string | null; channels: { channel: string; formats: string[]; note: string | null }[]; languages: string[]; voice: string | null; design: string | null; limits: string[]; season: string | null; linked: string[]; paused: string | null; problems: string[] }
export function growthSection(slug: string, md: string): string | null;
export function parseChannels(v: string): { channel: string; formats: string[]; note: string | null }[];
export function parseRoster(body: string, brain: string): RosterEntry[];
export function rosterProblems(entries: RosterEntry[]): string[];
export function mayAct(roster: RosterEntry[], a: { business: string; channel?: string; format?: string; action?: string }): { ok: true } | { ok: false; stop: string; why: string };
