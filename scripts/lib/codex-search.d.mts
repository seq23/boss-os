/** Types for scripts/lib/codex-search.mjs (the Mac scripts are plain ESM; tests import them). */
export interface CodexSearchParse {
  events: number;
  queries: string[];
  answer: string;
  errorText: string;
  terminal: "completed" | "failed" | null;
  /** True when at least one JSON row was read — false means the CLI ignored `--json`. */
  jsonl: boolean;
}
export function parseCodexSearch(stdout: string): CodexSearchParse;
export function researchWasSeen(parsed: CodexSearchParse): { ok: true; searches: number | null } | { ok: false; reason: string };
