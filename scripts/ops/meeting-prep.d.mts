/** Types for Simone's meeting-prep runner (meeting-prep.mjs). */
export declare const HER_ADDRESSES: string[];
export declare function dealRowsOf(grid: any): Array<{ company: string; side: string; size: string | null; price: string | null; from_email: string | null; hers: boolean }>;
export declare function prepEmail(event: any, data: any, opts?: any): { key: string; subject: string; who: string; sections: any[]; happened: string; decide: any[]; needsPurpose: boolean; purpose: any; laid: { subject: string; text: string; html: string; refs: string[] } };
export declare const WORKSPACE_MAILBOXES: string[];
export declare function contextPrompt(o: { name?: string | null; email?: string | null; domain?: string | null; firm?: string | null; title: string; when: string; today: string }): string;
export declare function readContext(json: any): any;
export declare function mergeWorkspaceMail(ctx: any, hits: any[], opts?: { email?: string | null }): any;
export declare function siteOf(domain: string | null, fetchImpl?: typeof fetch): Promise<{ domain: string; title: string | null; about: string | null } | null>;
export declare function gatherContext(event: any, data: any, opts?: any): Promise<any>;
export declare function lineFits(line: unknown): boolean;
export declare function planPrompt(o: any): string;
export declare function readPlan(json: any): { goals: string[]; ready: string[]; order: string[] } | null;
export declare function planFor(event: any, prep: any, context: any, opts?: any): { goals: string[]; ready: string[]; order: string[] } | null;
export declare function eventSnapshot(e: any): any;
export declare function sendPrep(api: any, event: any, data: any, opts?: any): Promise<any>;
export declare function finishPrep(api: any, p: any, opts?: any): Promise<any>;
