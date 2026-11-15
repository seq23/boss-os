/** Loose types so tests can import this node script; the script itself is the authority. */
export function lpMorning(...args: any[]): any;
export function writeMorning(...args: any[]): any;
export function bookedCalls(...args: any[]): Map<string, { start: number; held: boolean }>;
export function doNotContact(...args: any[]): { call_booked: string[]; replied: string[] };
