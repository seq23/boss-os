/** Types for the Chrome job lane. See chromeJob.mjs. */
export declare const CHROME_JOB_SEAT: "emp_research";
export declare const CHROME_JOB_BACKEND: "bk_claude_code";
export declare const CHROME_JOB_DIR: string;
export declare const CHROME_JOB_REQUESTED: Readonly<{ repo_path: string; allowed_paths: readonly string[]; browser: "chrome"; max_seconds: number }>;
export declare const CHROME_JOB_RE: RegExp;
export declare function chromeJobIn(text: string | null | undefined): boolean;
export declare function composeChromePrompt(args: { ask: string }): string;
