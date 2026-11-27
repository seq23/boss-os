export const GROWTH_BRAINS: readonly string[];
export const FIELDS: readonly string[];
export const REQUIRED: readonly string[];
export const PRIVATE_CUT_BRAINS: readonly string[];
export const TIERS: readonly string[];
export const REQUIRED_BY_TIER: Readonly<Record<string, readonly string[]>>;
export const CLIENT_KEYS: readonly string[];
export const CLOSED_ROSTERS: readonly string[];
export const SPEND_ACTIONS: readonly string[];
export const NEVER_ACTIONS: Readonly<Record<string, string>>;
export interface RosterEntry { label: string; brain: string; key: string | null; tier: string; buyer: string | null; offer: string | null; money: string | null; channels: { channel: string; formats: string[]; note: string | null }[]; languages: string[]; voice: string | null; design: string | null; limits: string[]; season: string | null; linked: string[]; linkedNotes: Record<string, string>; paused: string | null; problems: string[] }
export function growthSection(slug: string, md: string): string | null;
export function parseChannels(v: string): { channel: string; formats: string[]; note: string | null }[];
export function parseRoster(body: string, brain: string): RosterEntry[];
export function rosterProblems(entries: RosterEntry[]): string[];
export const SHARED_RULINGS: readonly string[];
export const CHANNEL_RULINGS: Readonly<Record<string, string>>;
export const BRAIN_NAMES: Readonly<Record<string, string>>;
export interface RulingGroup { heading: string; body: string }
export interface Rulings { notRead: string | null; own: RulingGroup[]; shared: RulingGroup[]; problems: string[] }
export function headingGroups(body: string): RulingGroup[];
export function rulingsFor(entry: RosterEntry, md: string | null): Rulings;
export function mayAct(roster: RosterEntry[], a: { business: string; channel?: string; format?: string; action?: string }, ctx?: { accounts?: string[]; bufferFull?: string[] }): { ok: true; newFormat?: boolean; newChannel?: boolean } | { ok: false; stop: string; why: string };
