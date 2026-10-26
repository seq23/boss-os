export declare function recipientsOf(headers: Array<{ name: string; value: string }>): string[];
export declare function scanSent(sinceYmd: string, opts?: { fetchImpl?: typeof fetch }): Promise<{ scanned: number; rows: any[] }>;
