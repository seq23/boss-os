export declare const HOME_TZ: string;
export declare const OWNER_TZ_KEY: string;
export declare function validZone(tz: unknown): string | null;
export declare function ownerZone(tz: unknown): string;
export declare function zoneWord(tz: string, at?: number): string;
export declare function wall(at: number, tz: string): { hour: number; minute: number };
export declare function fullClock(h: number, m: number): string;
export declare function ownerTime(at: number, opts?: { tz?: string | null; clock?: (h: number, m: number) => string }): string;
