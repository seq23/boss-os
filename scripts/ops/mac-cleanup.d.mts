export declare const NEVER: string[];
export declare const LOW_GB: number;
export declare const forbidden: (p: string) => boolean;
export declare function pickWorktrees(trees: any[], now?: number): { remove: any[]; list: any[] };
export declare function pickRenders(files: Array<{ name: string; mtime: number }>, published: string[], now?: number): Array<{ name: string; mtime: number }>;
export declare function pickPlaywright(dirs: string[]): string[];
export declare function lowDiskLine(freeGb: number, cleanedGb: number, biggest: string[]): string | null;
