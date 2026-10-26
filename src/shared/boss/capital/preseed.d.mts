export declare const SECTORS: Array<[string, RegExp]>;
export declare function sectorOf(text: unknown): string | null;
export declare function roundOf(text: unknown): string | null;
export declare function companyOf(m: { subject?: string; from?: string }): string | null;
export declare function crossedRow(msg: any): any | null;
export declare function fundedRow(item: any): any | null;
export declare function compareLists(crossed: any[], funded: any[]): { alike: any[]; gaps: any[] };
export declare function preseedLine(crossed: any[], funded: any[], cmp: { gaps: any[] }): string;
