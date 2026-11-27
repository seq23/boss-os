export const UNCERTAIN_RUNS: number;
export function stillUncertain(store: { uncertain?: Record<string, number> }, id: string): boolean;
export function holdForPerson(store: { uncertain?: Record<string, number>; held?: Record<string, unknown> }, id: string, detail: Record<string, unknown>): void;
export function heldLine(what: string, links: string[]): { text: string; links: { label: string; url: string }[] } | null;
export const messageLink: (mailbox: string, id: string) => string;
