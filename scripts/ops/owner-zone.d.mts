export declare function zoneFromLink(link: unknown): string | null;
export declare function macZone(): string | null;
export declare function syncOwnerZone(api: { get: (p: string) => Promise<any>; put: (p: string, b: any) => Promise<any> }, zone: string | null, opts?: { dry?: boolean }): Promise<string>;
