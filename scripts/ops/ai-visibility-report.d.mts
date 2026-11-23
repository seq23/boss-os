export function prefixFrom(config: unknown, host: string): { prefix?: string | null; problem?: string; note?: string };
export const locsOf: (xml: string | null | undefined) => string[];
export function sitePages(host: string, prefix: string | null, fetchImpl?: (url: any, init?: any) => Promise<Response>): Promise<any>;
export function buildContext(o?: Record<string, unknown>): Promise<{ state: Record<string, any>; text: string }>;
export function parseRun(log: string): any;
export function entriesFrom(run: any, state: Record<string, any>, now?: number): any[];
export function post(logFile: string, stateFile: string, o?: { api?: { post: (path: string, body: unknown) => Promise<any> } }): Promise<number>;
